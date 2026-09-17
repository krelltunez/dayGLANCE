// Mobile adapters use the same journal as desktop Jobo. They never complete,
// reschedule or delete a native task (or send a Todoist command).
import * as C from './jobo.js';

export const MOBILE_HOUR_HEIGHT = 84;

export function latestMobileAttempt(state, taskId) {
  return [...state.records].reverse().find(record =>
    record.sourceTaskId === String(taskId) || record.planId === String(taskId));
}

export function mobileRecordDraft({ record, source, seed, date, initial, now = new Date() }) {
  let interval;
  if (record) interval = record;
  else if (initial != null) interval = { date, startTime: initial, duration: source?.duration || 30 };
  else if (date === C.dateString(now)) interval = C.immediatelyBeforeNow(source || { duration: 30 }, now);
  else interval = { date, startTime: source?.startTime || '09:00', duration: source?.duration || 30 };
  const start = C.minutes(interval.startTime);
  const end = (start + Number(interval.duration || 30)) % 1440;
  return {
    date: interval.date,
    startTime: interval.startTime,
    end: C.clock(end),
    title: record?.title ?? source?.title ?? seed?.title ?? '',
    color: record?.color || source?.color || seed?.color || 'bg-blue-500',
    progress: record?.progress || 'complete',
    notes: source ? source.notes || '' : record?.notes || seed?.notes || '',
    tags: (record?.tags || []).join(' '),
  };
}

export function mobileRecordPatch(form) {
  const title = String(form.title || '').trim();
  const start = C.minutes(form.startTime), end = C.minutes(form.end);
  if (!title) throw new Error('title');
  if (!C.validDate(form.date)) throw new Error('date');
  if (!Number.isFinite(start) || start >= 1440 || !Number.isFinite(end) || start === end) throw new Error('time');
  const duration = end > start ? end - start : 1440 - start + end;
  if (duration < 1 || duration > 1440) throw new Error('time');
  if (!C.PROGRESS.includes(form.progress)) throw new Error('progress');
  return {
    title, date: form.date, startTime: C.clock(start), duration,
    color: form.color || 'bg-blue-500', progress: form.progress,
    notes: String(form.notes || ''),
    tags: C.normalizeTags(String(form.tags || '').split(/\s+/)),
  };
}

// Only compare fields this editor can overwrite. Shared source notes may refresh
// while the sheet is open; that is not a conflicting edit to the actual interval.
export function mobileRecordRevision(record) {
  if (!record) return null;
  return JSON.stringify([
    record.id, record.planId, record.sourceTaskId, record.title, record.date,
    record.startTime, record.duration, record.color, record.progress,
    record.tags || [], record.notesOwn, record.notesOwn ? record.notes : null,
  ]);
}

// Recurring expansion and native stores can expose the same id more than once.
// A chooser must never offer duplicate identities or imported read-only events.
export function mobileRecordSources(tasks) {
  const unique = new Map();
  for (const task of tasks) {
    if (!task || task.imported || task.isExample || task.id == null) continue;
    const id = String(task.id);
    if (!unique.has(id)) unique.set(id, task);
  }
  return [...unique.values()];
}

// Construct the entire edit before the single durable commit. A quota failure
// must not leave half of a new record behind and create a duplicate on retry.
export function saveMobileRecord(store, { record, source, form }, id = crypto.randomUUID()) {
  const patch = mobileRecordPatch(form);
  let next = store.get();
  const current = record && next.records.find(item => item.id === record.id);
  if (record && !current) throw new Error('missing');
  if (record && mobileRecordRevision(current) !== mobileRecordRevision(record)) throw new Error('conflict');
  const recordId = record?.id || id;
  if (!record) next = C.createRecord(next, source || null, patch, recordId);
  next = C.updateRecord(next, recordId, { ...patch, notes: source ? String(source.notes || '') : patch.notes, notesOwn: !source });
  store.commit(next);
  return recordId;
}

export function mobileScrollMinute(items, date, now = new Date()) {
  const times = items.map(item => C.minutes(item.startTime)).filter(Number.isFinite);
  const anchor = times.length ? Math.min(...times) : date === C.dateString(now)
    ? now.getHours() * 60 + now.getMinutes() : 9 * 60;
  return Math.max(0, anchor - 30);
}

export function mobileTapTime(offsetY, height = MOBILE_HOUR_HEIGHT) {
  return C.clock(Math.max(0, Math.min(1425, Math.round(offsetY / height * 60 / 15) * 15)));
}
