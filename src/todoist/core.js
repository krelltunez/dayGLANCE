// Read-source sync with optional guarded completion writeback. Never emits remote deletes.
export const DEFAULT_SETTINGS = Object.freeze({
  enabled: false, mode: 'today', destination: 'today',
  includeOverdue: false, todayOnly: false,
  priorities: [1, 2], projects: [], labels: [],
  match: 'all', labelMatch: 'any', subprojects: true,
  completionWriteback: false, intervalMinutes: 5,
});
const flag = value => value === true || value === 1;
const key = value => String(value ?? '');
export const active = item => !flag(item.is_deleted) && !flag(item.checked);
export const taskId = (accountId, id) => `todoist:${key(accountId)}:${key(id)}`;
export function normalizeSettings(raw = {}) {
  const list = value => [...new Set(Array.isArray(value) ? value.map(String) : [])];
  const legacy = !raw.mode && ['priorities', 'projects', 'labels'].some(field => Object.hasOwn(raw, field));
  // Old experimental mirror settings are migrated to a read-source mode,
  // with automation and writeback off until the user opts in again.
  const wasMirror = raw.mode === 'mirror';
  const supportedModes = ['today', 'all', 'filtered'];
  const requestedMode = wasMirror ? raw.mirrorScope : raw.mode;
  const mode = supportedModes.includes(requestedMode)
    ? requestedMode
    : legacy || wasMirror ? 'filtered' : 'today';
  return {
    enabled: !wasMirror && raw.enabled === true,
    mode,
    destination: ['inbox', 'due', 'today'].includes(raw.destination) ? raw.destination : legacy ? 'inbox' : mode === 'today' ? 'today' : 'due',
    includeOverdue: raw.includeOverdue === true, todayOnly: raw.todayOnly === true,
    priorities: [...new Set((Array.isArray(raw.priorities) ? raw.priorities : DEFAULT_SETTINGS.priorities).filter(p => [1, 2, 3, 4].includes(p)))],
    projects: list(raw.projects), labels: list(raw.labels),
    match: raw.match === 'any' ? 'any' : 'all',
    labelMatch: raw.labelMatch === 'all' ? 'all' : 'any',
    subprojects: raw.subprojects !== false,
    completionWriteback: !wasMirror && raw.completionWriteback === true,
    intervalMinutes: [0, 1, 5, 15].includes(raw.intervalMinutes) ? raw.intervalMinutes : 5,
  };
}
export function matches(item, settings, projects = {}, now = new Date(), timezone) {
  const scope = settings.mode;
  if (scope === 'today' || (scope === 'filtered' && settings.todayOnly)) {
    const due = dueParts(item.due, timezone);
    const today = dateParts(now, timezone).date;
    if (!due.date || !(due.date === today || (settings.includeOverdue && due.date < today))) return false;
  }
  if (scope === 'all' || scope === 'today') return true;
  const tests = [];
  if (settings.priorities.length) tests.push(settings.priorities.includes(5 - Number(item.priority)));
  if (settings.labels.length) {
    const labels = Array.isArray(item.labels) ? item.labels : [];
    tests.push(settings.labels[settings.labelMatch === 'all' ? 'every' : 'some'](label => labels.includes(label)));
  }
  if (settings.projects.length) {
    let id = key(item.project_id);
    const visited = new Set();
    let found = false;
    while (id && !visited.has(id)) {
      visited.add(id);
      if (settings.projects.includes(id)) { found = true; break; }
      if (!settings.subprojects) break;
      id = key(projects[id]?.parent_id);
    }
    tests.push(found);
  }
  // Empty criteria must never turn into an accidental whole-account import.
  return tests.length > 0 && tests[settings.match === 'any' ? 'some' : 'every'](Boolean);
}
export function mergeResponse(previous = {}, response) {
  if (!response || typeof response.sync_token !== 'string') throw new Error('invalidResponse');
  const full = response.full_sync === true || response.full_sync === 1;
  const user = response.user ?? previous.user;
  const next = { ...previous, cursor: response.sync_token, user: user ? { id: user.id, full_name: user.full_name, timezone: user.tz_info?.timezone || user.timezone } : null };
  for (const resource of ['items', 'projects', 'labels']) {
    if (!Array.isArray(response[resource])) throw new Error('invalidResponse');
    next[resource] = Object.assign(Object.create(null), full ? {} : previous[resource]);
    for (const item of response[resource]) {
      if (item?.id != null) next[resource][key(item.id)] = !full ? { ...next[resource][key(item.id)], ...item } : item;
    }
  }
  if (!next.user?.id) throw new Error('invalidResponse');
  if (previous.user?.id && key(previous.user.id) !== key(next.user.id)) throw new Error('accountChanged');
  return next;
}
// Keep active resources needed for filtering and parent-task safety. An
// inactive item is retained only while a local copy or pending command still
// references it. Never mutate the source cache or discard its sync cursor.
export function pruneCache(cache, retainIds = new Set()) {
  const items = Object.create(null);
  for (const [id, item] of Object.entries(cache.items || {})) {
    if (active(item) || retainIds.has(id)) items[id] = item;
  }
  const next = { ...cache, items };
  for (const resource of ['projects', 'labels']) {
    next[resource] = Object.create(null);
    for (const [id, item] of Object.entries(cache[resource] || {})) {
      if (!flag(item.is_deleted)) next[resource][id] = item;
    }
  }
  return next;
}

export function remoteFields(item) {
  return {
    title: String(item.content ?? ''), notes: String(item.description ?? ''),
    priority: Math.max(0, Math.min(3, Number(item.priority || 1) - 1)),
    deadline: item.deadline?.date ?? null, completed: flag(item.checked),
  };
}
export function linked(task, accountId) {
  return task.todoist?.accountId === key(accountId) && !!task.todoist?.id;
}
function sourceMetadata(item, cache, settings, now) {
  return {
    accountId: key(cache.user.id), id: key(item.id), projectId: key(item.project_id),
    project: cache.projects[key(item.project_id)]?.name ?? '', labels: item.labels ?? [],
    due: item.due ?? null, recurring: !!item.due?.is_recurring,
    inScope: matches(item, settings, cache.projects, now, cache.user.timezone), remoteDeleted: flag(item.is_deleted),
  };
}
export function importTask(item, cache, settings, now) {
  return {
    id: taskId(cache.user.id, item.id), ...remoteFields(item),
    ...scheduleFields(item, settings, now, cache.user.timezone),
    color: 'bg-red-500', subtasks: [], imported: false, importSource: 'todoist',
    lastModified: now,
    todoist: { ...sourceMetadata(item, cache, settings, now), base: remoteFields(item),
      scheduleBase: scheduleFields(item, settings, now, cache.user.timezone), conflicts: {} },
  };
}
export function reconcileTask(task, cache, settings, now) {
  if (!linked(task, cache.user.id)) return task;
  const item = cache.items[task.todoist.id];
  if (!item) return task; // Missing from a snapshot is NOT evidence of deletion/completion.
  const metadata = { ...task.todoist, ...sourceMetadata(item, cache, settings, now) };
  let result = { ...task, todoist: metadata };
  if ((metadata.inScope || flag(item.checked)) && !metadata.remoteDeleted) {
    const remote = remoteFields(item);
    const base = task.todoist.base ?? remote;
    const conflicts = { ...task.todoist.conflicts };
    for (const field of Object.keys(remote)) {
      const local = task[field] ?? (field === 'deadline' ? null : remote[field]);
      if (local === remote[field]) { result[field] = remote[field]; delete conflicts[field]; }
      else if (local === base[field]) { result[field] = remote[field]; delete conflicts[field]; }
      else if (remote[field] !== base[field] || Object.hasOwn(conflicts, field)) conflicts[field] = remote[field];
    }
    if (result.completed && !task.completed) result.completedAt = item.completed_at ?? now;
    if (!result.completed && task.completed) result.completedAt = null;
    const schedule = scheduleFields(item, settings, now, cache.user.timezone);
    const scheduleBase = task.todoist.scheduleBase;
    // Pull mode follows dates only while the user has not made their own time block.
    // Migrated v1 inbox tasks can be placed once; existing calendar blocks are preserved.
    const unchangedSchedule = scheduleBase
      ? Object.keys(schedule).every(field => (task[field] ?? false) === (scheduleBase[field] ?? false))
      : !task.date;
    if (unchangedSchedule && metadata.inScope) Object.assign(result, schedule);
    result.todoist = { ...metadata, base: remote, scheduleBase: schedule, conflicts };
  }
  return JSON.stringify(result) === JSON.stringify(task) ? task : { ...result, lastModified: now };
}
export function additions(allTasks, cache, settings, blockedIds = new Set(), now) {
  const ids = new Set(allTasks.map(t => key(t.id)));
  const sources = new Set(allTasks.filter(t => linked(t, cache.user.id)).map(t => t.todoist.id));
  return Object.values(cache.items).filter(item => active(item) && matches(item, settings, cache.projects, now, cache.user.timezone)
    && !ids.has(taskId(cache.user.id, item.id)) && !sources.has(key(item.id))
    && !blockedIds.has(taskId(cache.user.id, item.id)))
    .map(item => importTask(item, cache, settings, now));
}
export function writebackReason(task, cache, settings, now = new Date()) {
  if (!settings.completionWriteback || !linked(task, cache.user.id) || !task.completed
    || task.todoist.base?.completed !== false) return 'none';
  const item = cache.items[task.todoist.id];
  if (!item || !active(item) || !matches(item, settings, cache.projects, now, cache.user.timezone)) return 'outOfScope';
  if (item.due?.is_recurring) return 'recurring';
  // Closing a parent also closes descendants, including those outside the filter.
  if (Object.values(cache.items).some(child => active(child) && key(child.parent_id) === key(item.id))) return 'parent';
  if (item.responsible_uid && key(item.responsible_uid) !== key(cache.user.id)) return 'assignedElsewhere';
  return 'ready';
}
export function prepareOutbox(existing, tasks, cache, settings, uuid, now = new Date()) {
  const byId = new Map(tasks.map(t => [key(t.id), t]));
  const queue = existing.filter(op => op.accountId === key(cache.user.id)
    && !flag(cache.items[op.args.id]?.checked) && !flag(cache.items[op.args.id]?.is_deleted));
  const queued = new Set(queue.map(op => op.localId));
  for (const task of tasks) {
    if (writebackReason(task, cache, settings, now) !== 'ready' || queued.has(key(task.id))) continue;
    queue.push({ uuid: uuid(), type: 'item_close', args: { id: task.todoist.id },
      accountId: key(cache.user.id), localId: key(task.id) });
    queued.add(key(task.id));
  }
  return {
    queue,
    send: queue.filter(op => byId.has(op.localId)
      && writebackReason(byId.get(op.localId), cache, settings, now) === 'ready').slice(0, 25),
  };
}
export function acknowledge(queue, sent, response) {
  const succeeded = new Set(sent.filter(op => response.sync_status?.[op.uuid] === 'ok').map(op => op.uuid));
  return { queue: queue.filter(op => !succeeded.has(op.uuid)),
    failed: sent.filter(op => !succeeded.has(op.uuid)), succeeded };
}


// Explicit numeric parts avoid UTC slicing and locale-dependent date strings.
export function dateParts(value, timezone) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return { date: null, time: null };
  let formatter;
  const options = { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
  try { formatter = new Intl.DateTimeFormat('en-CA', { ...options, ...(timezone ? { timeZone: timezone } : {}) }); }
  catch { formatter = new Intl.DateTimeFormat('en-CA', options); }
  const parts = Object.fromEntries(formatter.formatToParts(date).map(part => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}
export function dueParts(due, timezone) {
  const value = due?.datetime || due?.date;
  if (typeof value !== 'string') return { date: null, time: null };
  const match = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/.exec(value);
  if (!match || !Number.isFinite(Date.parse(match[1] + 'T00:00:00Z')) || new Date(match[1] + 'T00:00:00Z').toISOString().slice(0, 10) !== match[1]) return { date: null, time: null };
  if (match[2] && (Number(match[2].slice(0, 2)) > 23 || Number(match[2].slice(3)) > 59)) return { date: null, time: null };
  // Todoist fixed-zone instances are UTC/offset instants. Floating times are wall-clock times.
  if (match[3]) return dateParts(value, timezone);
  return { date: match[1], time: match[2] || null };
}
export function scheduleFields(item, settings, now, timezone) {
  const due = dueParts(item.due, timezone);
  const destination = settings.destination;
  const date = destination === 'inbox' ? null : destination === 'today' ? dateParts(now, timezone).date : due.date;
  const minutes = item.duration?.unit === 'minute' ? Number(item.duration.amount)
    : item.duration?.unit === 'day' ? Number(item.duration.amount) * 1440 : 30;
  return { date, startTime: date && due.time ? due.time : date ? '00:00' : '09:00',
    isAllDay: !!date && !due.time, duration: Number.isFinite(minutes) && minutes > 0 ? Math.min(minutes, 10080) : 30 };
}
// Reconciliation never deletes or restores local tasks. The recycle bin is
// consulted only to avoid importing a copy the user has already removed.
export function reconcileLists({ tasks, unscheduledTasks, recycleBin = [], cache, settings, blockedIds = new Set(), now }) {
  const remote = Object.values(cache.items);
  const selected = remote.filter(item => active(item) && matches(item, settings, cache.projects, now, cache.user.timezone));
  const report = {
    scanned: remote.filter(active).length,
    matched: selected.length,
    added: 0,
    updated: 0,
    unchanged: 0,
    suppressed: 0,
    unknown: 0,
    calendar: 0,
    inbox: 0,
    at: now,
  };
  const result = { tasks: [], unscheduledTasks: [], recycleBin, report };
  const all = [...tasks, ...unscheduledTasks];
  const existing = new Set(all.map(task => key(task.id)));
  const sourceIds = new Set(all.filter(task => linked(task, cache.user.id)).map(task => key(task.todoist.id)));
  const archivedSources = new Set(recycleBin.filter(task => linked(task, cache.user.id)).map(task => key(task.todoist.id)));
  const blocked = new Set([...blockedIds, ...recycleBin.map(task => key(task.id))]);

  const put = task => {
    (task.date ? result.tasks : result.unscheduledTasks).push(task);
    if (linked(task, cache.user.id) && !task.completed) {
      report[task.date ? 'calendar' : 'inbox']++;
    }
  };

  // Preserve native tasks in their existing bucket. Only linked Todoist
  // tasks may move between the calendar and inbox as their dates change.
  for (const [bucket, list] of [['tasks', tasks], ['unscheduledTasks', unscheduledTasks]]) {
    for (const task of list) {
      if (!linked(task, cache.user.id)) {
        result[bucket].push(task);
        continue;
      }
      const updated = reconcileTask(task, cache, settings, now);
      if (!cache.items[task.todoist.id]) report.unknown++;
      else report[updated === task ? 'unchanged' : 'updated']++;
      put(updated);
    }
  }

  for (const item of selected) {
    const id = taskId(cache.user.id, item.id);
    if (existing.has(id) || sourceIds.has(key(item.id))) continue;
    if (blocked.has(id) || archivedSources.has(key(item.id))) {
      report.suppressed++;
      continue;
    }
    put(importTask(item, cache, settings, now));
    report.added++;
  }

  if (report.scanned === 0) {
    report.reason = 'noActive';
  } else if (report.matched === 0) {
    const requiresToday = settings.mode === 'today' || (settings.mode === 'filtered' && settings.todayOnly);
    report.reason = requiresToday ? 'noToday' : 'noMatch';
  } else if (report.added + report.updated === 0) {
    report.reason = report.suppressed ? 'suppressed' : 'unchanged';
  } else {
    report.reason = 'done';
  }
  return result;
}
