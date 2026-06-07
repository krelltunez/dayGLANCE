import {
  ACTIONS,
  ENTITY_TYPES,
  EVENTS,
  SOURCE_APPS,
  TABS,
  QUERY_RETURN_VARS,
  RETURN_VAR_TYPES,
  CreateSchema,
  CompleteSchema,
  OpenSchema,
  QuerySchema,
  NotifySchema,
  normalizePriority,
  normalizeTags,
  normalizeDue,
  normalizeRecurring,
  createKey,
} from '@glance-apps/intents';

export const DEFAULT_TASK_COLOR = 'bg-blue-500';

// Derive a deterministic UUID from a seed string so that two devices
// processing the same intent create tasks with the same ID, letting the sync
// engine deduplicate them naturally rather than keeping both copies.
async function deterministicTaskId(seed) {
  const data = new TextEncoder().encode(seed);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  hash[6] = (hash[6] & 0x0f) | 0x40; // version 4
  hash[8] = (hash[8] & 0x3f) | 0x80; // variant
  const h = [...hash.slice(0, 16)].map(b => b.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}

function ok(extra = {}) {
  return { success: true, task_id: '', error: '', warning: '', ...extra };
}

function fail(message) {
  return { success: false, task_id: '', error: message, warning: '' };
}

function validate(schema, payload) {
  const result = schema.safeParse(payload);
  if (!result.success) {
    return { ok: false, error: result.error.issues[0]?.message ?? 'Invalid payload' };
  }
  return { ok: true, data: result.data };
}

/**
 * Re-embed tags into the title so dayGLANCE's tag-in-title storage model is
 * satisfied. normalizeTags strips inline #tags from the title; this puts the
 * full merged+deduped set back.
 */
function rebuildTitle(cleanedTitle, tags) {
  if (!tags?.length) return cleanedTitle;
  return `${cleanedTitle} ${tags.map(t => `#${t}`).join(' ')}`;
}

/**
 * Split a normalized ISO `due` string into the dayGLANCE task scheduling fields.
 * Date-only strings (YYYY-MM-DD) and explicit all_day=true produce isAllDay tasks.
 */
function parseDue(due, allDay) {
  if (!due) return null;

  const dateOnly = !due.includes('T');
  if (dateOnly || allDay) {
    return { date: due.slice(0, 10), startTime: null, isAllDay: true };
  }

  const d = new Date(due);
  const date = [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-');
  const startTime = [
    String(d.getHours()).padStart(2, '0'),
    String(d.getMinutes()).padStart(2, '0'),
  ].join(':');

  return { date, startTime, isAllDay: false };
}

/**
 * Convert a normalizeRecurring-produced `FREQ=…` string to dayGLANCE's
 * internal recurrence object `{ type, startDate, daysOfWeek?, … }`.
 */
function freqToRecurrence(freqStr, startDate) {
  const DAY_MAP = { MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6, SU: 0 };
  const parts = Object.fromEntries(
    freqStr.split(';').map(p => {
      const eq = p.indexOf('=');
      return [p.slice(0, eq).toUpperCase(), p.slice(eq + 1).toUpperCase()];
    })
  );

  const base = { startDate };

  switch (parts.FREQ) {
    case 'DAILY':
      return { ...base, type: 'daily' };
    case 'WEEKLY': {
      if (parts.BYDAY) {
        const daysOfWeek = parts.BYDAY.split(',')
          .map(d => DAY_MAP[d.trim()])
          .filter(d => d !== undefined);
        return { ...base, type: 'weekly', daysOfWeek };
      }
      return { ...base, type: 'weekly' };
    }
    case 'MONTHLY':
      return { ...base, type: 'monthly' };
    case 'YEARLY':
      return { ...base, type: 'yearly' };
    default:
      return { ...base, type: 'daily' };
  }
}

/** Match a project name or ID against the projects list. Returns projectId or undefined. */
function resolveProjectId(nameOrId, projects) {
  if (!nameOrId || !projects?.length) return undefined;
  return (
    projects.find(p => p.id === nameOrId)?.id ??
    projects.find(p => p.name?.toLowerCase() === nameOrId.toLowerCase())?.id
  );
}

async function handleCreateGoal(payload, context) {
  const { goals = [], addGoal } = context;

  // Idempotency: skip if a goal with this source_app + source_entity_id already exists.
  if (payload.source_app && payload.source_entity_id) {
    const existing = goals.find(
      g => g.source_app === payload.source_app && g.source_entity_id === payload.source_entity_id
    );
    if (existing) {
      return ok({ task_id: existing.id, warning: 'Goal already exists' });
    }
  }

  if (!addGoal) {
    return ok({ warning: '', _normalized: payload });
  }

  const targetDate = payload.due ? payload.due.slice(0, 10) : undefined;

  // Deterministic ID so two devices processing the same intent create the same
  // goal ID — the sync engine then merges them as one rather than keeping both.
  const goalId = payload.source_app && payload.source_entity_id
    ? await deterministicTaskId(`${payload.source_app}|${payload.source_entity_id}`)
    : crypto.randomUUID();

  const newGoal = addGoal({
    id: goalId,
    title: payload.title,
    ...(targetDate ? { targetDate } : {}),
    ...(payload.source_app ? { source_app: payload.source_app } : {}),
    ...(payload.source_entity_id ? { source_entity_id: payload.source_entity_id } : {}),
  });

  return ok({ task_id: newGoal.id });
}

function handleNotify(payload, context) {
  const v = validate(NotifySchema, payload);
  if (!v.ok) return fail(v.error);

  const { goals = [], updateGoal, deleteGoal } = context;
  const { source_app, source_entity_id, event, entity_type, due, title } = v.data;

  // Skip notifies about tasks — only handle goal notifies here.
  if (entity_type && entity_type !== ENTITY_TYPES.GOAL) {
    return ok({ warning: 'entity_type not goal — skipped' });
  }

  // When source_app is dayGLANCE, source_entity_id IS the goal's own id.
  // Otherwise match by source_app + source_entity_id (goal created by lifeGLANCE).
  const goal =
    source_app === SOURCE_APPS.DAYGLANCE
      ? goals.find(g => g.id === source_entity_id)
      : goals.find(g => g.source_app === source_app && g.source_entity_id === source_entity_id);

  if (!goal) return ok({ warning: 'no matching goal' });
  if (!updateGoal && !deleteGoal) return ok({ warning: '', _normalized: v.data });

  switch (event) {
    case EVENTS.COMPLETED:
      updateGoal(goal.id, { status: 'completed' });
      break;
    case EVENTS.UNCOMPLETED:
      updateGoal(goal.id, { status: 'active' });
      break;
    case EVENTS.DELETED:
      deleteGoal?.(goal.id);
      break;
    case EVENTS.RESCHEDULED:
      updateGoal(goal.id, { targetDate: due ? due.slice(0, 10) : null });
      break;
    case EVENTS.UPDATED:
      updateGoal(goal.id, { title });
      break;
    default:
      return fail(`Unknown event: ${event}`);
  }

  return ok({ task_id: goal.id });
}

async function handleCreate(payload, context) {
  const {
    tasks = [],
    unscheduledTasks = [],
    recurringTasks = [],
    setTasks,
    setUnscheduledTasks,
    setRecurringTasks,
    projects = [],
    goals = [],
    addGoal,
    eventId,
  } = context;

  const v = validate(CreateSchema, payload);
  if (!v.ok) return fail(v.error);

  if (v.data.entity_type === ENTITY_TYPES.GOAL) {
    return handleCreateGoal(v.data, context);
  }

  const raw = v.data;

  const { title: cleanedTitle, tags } = normalizeTags({ title: raw.title, tags: raw.tags });
  const { due, all_day: inferredAllDay } = normalizeDue(raw.due);
  const priority = normalizePriority(raw.priority);

  let recurring;
  try {
    recurring = normalizeRecurring(raw.recurring);
  } catch {
    return fail(`Invalid recurring value: ${raw.recurring}`);
  }

  const allDay = raw.all_day !== undefined ? raw.all_day : inferredAllDay;

  const normalized = {
    title: cleanedTitle,
    tags,
    due,
    all_day: allDay,
    duration: raw.duration,
    deadline: raw.deadline,
    notes: raw.notes,
    project: raw.project,
    priority,
    recurring,
    source_app: raw.source_app,
    source_entity_id: raw.source_entity_id,
  };

  let intentKey = null;

  if (raw.source_app && raw.source_entity_id) {
    intentKey = await createKey(raw.source_app, raw.source_entity_id, due);

    const existing =
      tasks.find(t => t._intentKey === intentKey && !t.completed) ||
      unscheduledTasks.find(t => t._intentKey === intentKey && !t.completed) ||
      recurringTasks.find(t => t._intentKey === intentKey);

    if (existing) {
      if (setTasks || setUnscheduledTasks || setRecurringTasks) {
        // Execute: update the existing task in whichever list it lives in.
        const projectId = resolveProjectId(normalized.project, projects);
        const taskTitle = rebuildTitle(cleanedTitle, tags);
        const updates = {
          title: taskTitle,
          notes: normalized.notes ?? existing.notes,
          priority: priority ?? existing.priority,
          ...(projectId !== undefined ? { projectId } : {}),
        };

        if (tasks.find(t => t.id === existing.id)) {
          setTasks(prev => prev.map(t => t.id === existing.id ? { ...t, ...updates } : t));
        } else if (unscheduledTasks.find(t => t.id === existing.id)) {
          setUnscheduledTasks(prev => prev.map(t => t.id === existing.id ? { ...t, ...updates } : t));
        } else {
          setRecurringTasks(prev => prev.map(t => t.id === existing.id ? { ...t, ...updates } : t));
        }

        return ok({ task_id: existing.id, warning: 'Updated existing task' });
      }

      // Skeleton: no setters — return normalized result with warning.
      const warning = `Task already exists; will update (id: ${existing.id})`;
      return ok({ warning, _normalized: normalized, _intentKey: intentKey });
    }
  }

  // Skeleton mode: no setters provided, return normalized result only.
  if (!setTasks && !setUnscheduledTasks && !setRecurringTasks) {
    return ok({ warning: '', _normalized: normalized, _intentKey: intentKey });
  }

  // Execute: create a new task.
  // Use a deterministic ID so two devices creating from the same source produce
  // the same task ID — the sync engine then merges them as one rather than
  // keeping both copies.
  // Priority: intentKey (source_app+entity+due triple) > event_id > random.
  // intentKey covers the case where two devices independently emit a create for
  // the same chore; event_id covers unassigned intents received by multiple devices.
  const taskId = intentKey
    ? await deterministicTaskId(intentKey)
    : eventId
      ? await deterministicTaskId(eventId)
      : crypto.randomUUID();
  const projectId = resolveProjectId(normalized.project, projects);
  const taskTitle = rebuildTitle(cleanedTitle, tags);

  const baseTask = {
    id: taskId,
    title: taskTitle,
    duration: normalized.duration ?? 30,
    color: DEFAULT_TASK_COLOR,
    completed: false,
    notes: normalized.notes ?? '',
    subtasks: [],
    ...(intentKey || eventId ? { transitionId: intentKey ?? eventId } : {}),
    ...(projectId !== undefined ? { projectId } : {}),
    ...(normalized.source_app ? { source_app: normalized.source_app } : {}),
    ...(normalized.source_entity_id ? { source_entity_id: normalized.source_entity_id } : {}),
    ...(intentKey ? { _intentKey: intentKey } : {}),
    ...(raw.assigned_user_ids?.length ? { assignedUserSyncIds: raw.assigned_user_ids } : {}),
  };

  if (recurring) {
    const scheduled = parseDue(due, allDay);
    const startDate = scheduled?.date ?? new Date().toISOString().slice(0, 10);
    const newRecurring = {
      ...baseTask,
      startTime: scheduled && !scheduled.isAllDay ? scheduled.startTime : '00:00',
      isAllDay: allDay ?? true,
      recurrence: freqToRecurrence(recurring, startDate),
      completedDates: [],
      exceptions: {},
      lastModified: new Date().toISOString(),
    };
    setRecurringTasks(prev => prev.some(t => t.id === taskId) ? prev : [...prev, newRecurring]);
  } else if (due) {
    const scheduled = parseDue(due, allDay);
    const newTask = { ...baseTask, date: scheduled.date, startTime: scheduled.startTime, isAllDay: scheduled.isAllDay };
    setTasks(prev => prev.some(t => t.id === taskId) ? prev : [...prev, newTask]);
  } else {
    const newTask = { ...baseTask, priority: priority ?? 0, ...(normalized.deadline ? { deadline: normalized.deadline } : {}) };
    setUnscheduledTasks(prev => prev.some(t => t.id === taskId) ? prev : [...prev, newTask]);
  }

  return ok({ task_id: taskId });
}

function handleComplete(payload, context) {
  const v = validate(CompleteSchema, payload);
  if (!v.ok) return fail(v.error);

  const { title: searchTitle, completed_at } = v.data;
  const { tasks = [], unscheduledTasks = [], setTasks, setUnscheduledTasks } = context;

  // Skeleton mode: no setters provided.
  if (!setTasks && !setUnscheduledTasks) {
    return ok({ _normalized: v.data });
  }

  // Collect all incomplete tasks, tagging each with which list it came from.
  const candidates = [
    ...tasks.map(t => ({ ...t, _list: 'tasks' })),
    ...unscheduledTasks.map(t => ({ ...t, _list: 'unscheduled' })),
  ].filter(t => !t.completed);

  const norm = s => s.toLowerCase().trim();
  const needle = norm(searchTitle);

  // Exact match first, then partial.
  let matches = candidates.filter(t => norm(t.title) === needle);
  if (!matches.length) {
    matches = candidates.filter(t => norm(t.title).includes(needle));
  }

  if (!matches.length) {
    return fail('no matching task');
  }

  let warning = '';
  let target = matches[0];

  if (matches.length > 1) {
    // Soonest-due tiebreak: scheduled date, then deadline, then no-date (sorts last).
    const dueOf = t => t.date || t.deadline || null;
    matches.sort((a, b) => {
      const da = dueOf(a), db = dueOf(b);
      if (!da && !db) return 0;
      if (!da) return 1;
      if (!db) return -1;
      return da < db ? -1 : da > db ? 1 : 0;
    });
    target = matches[0];
    warning = `${matches.length} tasks matched "${searchTitle}"; completed soonest-due (${target.date || target.deadline || 'no date'})`;
  }

  const completedAt = completed_at || new Date().toISOString();
  const patch = { completed: true, completedAt };

  if (target._list === 'tasks') {
    setTasks(prev => prev.map(t => t.id === target.id ? { ...t, ...patch } : t));
  } else {
    setUnscheduledTasks(prev => prev.map(t => t.id === target.id ? { ...t, ...patch } : t));
  }

  return ok({ task_id: target.id, warning });
}

function handleOpen(payload, context) {
  const v = validate(OpenSchema, payload);
  if (!v.ok) return fail(v.error);

  const requested = v.data.tab;
  const tab = Object.values(TABS).includes(requested) ? requested : TABS.GLANCE;

  // navigate(tab) is provided by the transport layer; it handles device-specific
  // routing (mobileActiveTab vs tabletActiveTab) and the goals-enabled fallback.
  context.navigate?.(tab);

  return ok({ _normalized: { tab } });
}

function handleQuery(payload, context) {
  const v = validate(QuerySchema, payload);
  if (!v.ok) return fail(v.error);

  const { tasks = [], unscheduledTasks = [], now = new Date() } = context;

  const todayStr = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');

  const weekEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 6);
  const weekEndStr = [
    weekEnd.getFullYear(),
    String(weekEnd.getMonth() + 1).padStart(2, '0'),
    String(weekEnd.getDate()).padStart(2, '0'),
  ].join('-');

  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const toMinutes = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

  const activeTasks = tasks.filter(t => !t._native && !t.archived && !t.completed);
  const activeInbox = unscheduledTasks.filter(t => !t._native && !t.archived && !t.completed);

  const countToday = activeTasks.filter(t => t.date === todayStr).length;
  const countOverdue = activeTasks.filter(t => t.date < todayStr).length;
  const countWeek = activeTasks.filter(t => t.date >= todayStr && t.date <= weekEndStr).length;
  const countTotal = activeTasks.length + activeInbox.length;
  const countInbox = activeInbox.length;

  const todayTimed = activeTasks.filter(t => t.date === todayStr && !t.isAllDay && t.startTime);

  let inProgressTitle = '';
  let inProgressEnd = '';
  let inProgressRemainingMin = 0;

  for (const t of todayTimed) {
    const start = toMinutes(t.startTime);
    const end = start + (t.duration ?? 30);
    if (nowMinutes >= start && nowMinutes < end) {
      const endH = Math.floor(end / 60) % 24;
      const endM = end % 60;
      inProgressTitle = t.title;
      inProgressEnd = `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
      inProgressRemainingMin = end - nowMinutes;
      break;
    }
  }

  const nextTask = todayTimed
    .filter(t => toMinutes(t.startTime) > nowMinutes)
    .sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime))[0] ?? null;

  return ok({
    [QUERY_RETURN_VARS.COUNT_TODAY]: countToday,
    [QUERY_RETURN_VARS.COUNT_OVERDUE]: countOverdue,
    [QUERY_RETURN_VARS.COUNT_WEEK]: countWeek,
    [QUERY_RETURN_VARS.COUNT_TOTAL]: countTotal,
    [QUERY_RETURN_VARS.COUNT_INBOX]: countInbox,
    [QUERY_RETURN_VARS.IN_PROGRESS_TITLE]: inProgressTitle,
    [QUERY_RETURN_VARS.IN_PROGRESS_END]: inProgressEnd,
    [QUERY_RETURN_VARS.IN_PROGRESS_REMAINING_MIN]: inProgressRemainingMin,
    [QUERY_RETURN_VARS.NEXT_TITLE]: nextTask?.title ?? '',
    [QUERY_RETURN_VARS.NEXT_TIME]: nextTask?.startTime ?? '',
  });
}

/**
 * Core intent handler. Validates, normalizes, and checks idempotency.
 * Executes state changes when setters are provided in context.
 *
 * @param {string} action - One of the ACTIONS constants
 * @param {object} payload - Raw payload from the transport layer
 * @param {object} context - { tasks?, unscheduledTasks?, recurringTasks?, projects?,
 *                             setTasks?, setUnscheduledTasks?, setRecurringTasks? }
 * @returns {Promise<object>} Result: { success, task_id, error, warning, ...queryVars? }
 */
export async function handleIntent(action, payload, context = {}) {
  switch (action) {
    case ACTIONS.CREATE:
      return handleCreate(payload, context);
    case ACTIONS.COMPLETE:
      return handleComplete(payload, context);
    case ACTIONS.NOTIFY:
      return handleNotify(payload, context);
    case ACTIONS.OPEN:
      return handleOpen(payload, context);
    case ACTIONS.QUERY:
      return handleQuery(payload, context);
    default:
      return fail(`Unknown action: ${action}`);
  }
}
