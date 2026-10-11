// Form adapters above the settled core; no clock or persistence is read here.
import { DO_PROGRESS, DO_TIMING, createDoRecord, canCompleteDo, canLinkDo, linkDoRecord, reassessDoProgress, tombstoneDoRecord, updateDoRecord } from './core.js';
import { resolveEditableDoRecord } from './viewModel.js';
const DAY_MINUTES = 1440;
const MIN_INTERVAL_MINUTES = 5;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EDITABLE_PROGRESS = Object.freeze([DO_PROGRESS.STARTED, DO_PROGRESS.PARTIAL, DO_PROGRESS.MOSTLY]);
const EDITABLE_FIELDS = new Set(['timing', 'date', 'startTime', 'endDate', 'endTime']);
function validDate(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
}


function dayNumber(date) {
  if (!validDate(date)) throw new TypeError('Invalid civil date');
  const time = Date.parse(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(time)) throw new RangeError('Civil date is outside the supported range');
  return time / 86400000;
}


function asWholeMinutes(value, name, { minimum, allowNegative = false } = {}) {
  if (!Number.isSafeInteger(value) || (!allowNegative && value < 0)
    || (minimum !== undefined && value < minimum)) {
    throw new TypeError(`${name} must be a whole number of minutes`);
  }
  return value;
}


function dateTimeFromAbsolute(minute) {
  if (!Number.isSafeInteger(minute)) throw new RangeError('Interval is outside the supported date range');
  const day = Math.floor(minute / DAY_MINUTES);
  const minuteOfDay = minute - day * DAY_MINUTES;
  const date = new Date(day * 86400000);
  if (!Number.isFinite(date.getTime())) throw new RangeError('Interval is outside the supported date range');
  const isoDate = date.toISOString().slice(0, 10);
  if (!validDate(isoDate)) throw new RangeError('Interval is outside the supported date range');
  return { date: isoDate, minute: minuteOfDay };
}


function timeFromMinute(minute) {
  if (!Number.isSafeInteger(minute) || minute < 0 || minute >= DAY_MINUTES) {
    throw new RangeError('Invalid minute of day');
  }
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}


function intervalPatchFromBounds(start, end) {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end <= start) {
    throw new RangeError('Timed interval must be positive');
  }
  const startValue = dateTimeFromAbsolute(start);
  const endValue = dateTimeFromAbsolute(end);
  return {
    timing: DO_TIMING.TIMED,
    date: startValue.date,
    startTime: timeFromMinute(startValue.minute),
    endDate: endValue.date,
    endTime: timeFromMinute(endValue.minute),
  };
}


function stampFromEpoch(now) {
  if (typeof now !== 'number' || !Number.isFinite(now)) {
    throw new TypeError('now must be an epoch millisecond number');
  }
  const date = new Date(now);
  if (!Number.isFinite(date.getTime())) throw new RangeError('now is outside the supported date range');
  return date.toISOString();
}


function monotonicEpoch(record, now) {
  const requested = new Date(stampFromEpoch(now)).getTime();
  const previous = Date.parse(record.updatedAt);
  if (!Number.isFinite(previous)) throw new TypeError('Record has an invalid updatedAt');
  const next = Math.max(requested, previous + 1);
  if (!Number.isSafeInteger(next)) throw new RangeError('Record version is outside the supported date range');
  return next;
}


function addMinutes(value, delta) {
  if (!Number.isSafeInteger(value) || !Number.isSafeInteger(delta)) {
    throw new RangeError('Interval is outside the supported date range');
  }
  const result = value + delta;
  if (!Number.isSafeInteger(result)) throw new RangeError('Interval is outside the supported date range');
  return result;
}


export function doIntervalAt(date, startMinute, duration = 30) {
  if (!validDate(date)) throw new TypeError('Invalid civil date');
  const start = asWholeMinutes(startMinute, 'startMinute');
  if (start >= DAY_MINUTES) throw new RangeError('startMinute must be within the day');
  const length = asWholeMinutes(duration, 'duration', { minimum: MIN_INTERVAL_MINUTES });
  const startAbsolute = dayNumber(date) * DAY_MINUTES + start;
  return intervalPatchFromBounds(startAbsolute, addMinutes(startAbsolute, length));
}


export function createManualDo({
  id,
  title,
  task = null,
  planSnapshot = null,
  date,
  startMinute,
  duration = 30,
  progress = DO_PROGRESS.STARTED,
  now,
} = {}) {
  if (task !== null && (typeof task !== 'object' || Array.isArray(task))) {
    throw new TypeError('task must be an object or null');
  }
  const taskId = task === null ? null : (task.recurringTemplateId ?? task.id ?? null);
  if (!EDITABLE_PROGRESS.includes(progress)
    && !(progress === DO_PROGRESS.COMPLETED && canCompleteDo({ source: 'manual', taskId }))) {
    const error = new TypeError('A linked manual Do cannot complete its task');
    error.code = 'completionUnavailable';
    throw error;
  }
  const stamp = stampFromEpoch(now);
  const interval = doIntervalAt(date, startMinute, duration);
  return createDoRecord({
    id,
    taskId,
    title: title ?? task?.title,
    ...interval,
    planSnapshot: planSnapshot === undefined ? null : planSnapshot,
    source: 'manual',
    progress,
    createdAt: stamp,
    updatedAt: stamp,
    observedAt: stamp,
  });
}


export function prepareDoEdit({ records, record, patch = {}, progress, now, taskCompleted = false } = {}) {
  const current = resolveEditableDoRecord(records, record);
  if (!current) return null;
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new TypeError('patch must be an object');
  }
  for (const key of Object.keys(patch)) {
    if (!EDITABLE_FIELDS.has(key)) throw new TypeError(`Cannot edit captured field: ${key}`);
  }
  if (progress !== undefined && !Object.values(DO_PROGRESS).includes(progress)) {
    throw new TypeError('Invalid Do progress');
  }
  if (progress === DO_PROGRESS.COMPLETED && current.progress !== DO_PROGRESS.COMPLETED
    && !canCompleteDo(current, { taskCompleted })) {
    const error = new TypeError('The task must still be completed to restore this Do');
    error.code = 'completionUnavailable';
    throw error;
  }
  const intervalChanged = Object.keys(patch).some((key) => patch[key] !== current[key]);
  const progressChanged = progress !== undefined && progress !== current.progress;
  if (!intervalChanged && !progressChanged) return current;

  let next = current;
  let version = monotonicEpoch(current, now);
  if (intervalChanged) next = updateDoRecord(next, patch, new Date(version).toISOString());
  if (progressChanged) {
    version = Math.max(version, Date.parse(next.updatedAt) + 1);
    next = reassessDoProgress(next, progress, new Date(version).toISOString(), { taskCompleted });
  }
  return next;
}


/**
 * The link "Make a task" writes: `record`, as the ledger holds it now, linked
 * to the new task. Null when the record is gone or changed since (the
 * ledger's resolve), or can no longer be linked.
 */
export function prepareDoLink({ records, record, taskId, now } = {}) {
  const current = resolveEditableDoRecord(records, record);
  if (!current || !canLinkDo(current)) return null;
  return linkDoRecord(current, taskId, new Date(monotonicEpoch(current, now)).toISOString());
}


export function prepareDoDelete({ records, record, now } = {}) {
  const current = resolveEditableDoRecord(records, record);
  if (!current) return null;
  return tombstoneDoRecord(current, new Date(monotonicEpoch(current, now)).toISOString());
}


export async function commitDoEdit(recordJobo, record) {
  if (typeof recordJobo !== 'function') throw new TypeError('recordJobo must be a function');
  if (!record || typeof record !== 'object') throw new TypeError('A prepared Do record is required');
  const result = await recordJobo([record]);
  if (result?.ok === true || result?.held === true) return result;
  const error = result?.error instanceof Error
    ? result.error
    : new Error(String(result?.error || 'JOBO write rejected'));
  if (!error.code && typeof result?.error === 'string') error.code = result.error;
  if (!error.code && result?.error && typeof result.error.code === 'string') error.code = result.error.code;
  throw error;
}

/**
 * Whether the editor offers "Complete task" for `record`, whose linked task
 * resolves to `task`: a manual Do linked to a task that is not done yet and
 * that the user can check off, so not a read-only imported calendar event.
 * The action is the task's own checkbox; it never writes the Do record.
 */
export function offersCompleteTask(record, task) {
  return !!record && !record.deleted && record.source === 'manual' && record.taskId != null
    && !!task && task.completed !== true && !(task.imported && !task.isTaskCalendar);
}
