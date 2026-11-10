// The length a new task gets when nobody gives it one (#2367): the block it
// takes when it lands on the timeline, whether it was made there (a click, the
// N key, the new-task button) or in the Inbox and dragged on later. It used to
// be 30 minutes, written into each of those paths.
//
// Per device, like the other `day-planner-` settings (utils/deviceSettings.js
// carries them in local backups; sync names only the keys it carries): a phone
// and a desk can suit different blocks. Read when a task is made, so a change
// applies to the next one without threading state through every path that
// makes tasks.
//
// A length someone chose always wins: the duration field, quick-add's `%`
// sigil, a voice "for an hour", an AI suggestion, a drag that sweeps a range.
// External creators (automation intents, the MCP tools) keep their documented
// default of 30.

export const DEFAULT_TASK_DURATION_KEY = 'day-planner-default-task-duration';
export const FALLBACK_TASK_DURATION = 30;
export const DEFAULT_TASK_DURATION_OPTIONS = Object.freeze([15, 30, 45, 60, 90]);

/** The saved default, in minutes; anything missing, unreadable or not an offered length is 30. */
export function readDefaultTaskDuration(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(DEFAULT_TASK_DURATION_KEY);
    const minutes = Number(raw);
    return raw != null && DEFAULT_TASK_DURATION_OPTIONS.includes(minutes) ? minutes : FALLBACK_TASK_DURATION;
  } catch {
    return FALLBACK_TASK_DURATION;
  }
}

/** Save `minutes` as the default (30 clears the key: the default needs no row). Returns what was kept. */
export function writeDefaultTaskDuration(minutes, storage = globalThis.localStorage) {
  const value = DEFAULT_TASK_DURATION_OPTIONS.includes(Number(minutes)) ? Number(minutes) : FALLBACK_TASK_DURATION;
  try {
    if (value === FALLBACK_TASK_DURATION) storage?.removeItem(DEFAULT_TASK_DURATION_KEY);
    else storage?.setItem(DEFAULT_TASK_DURATION_KEY, String(value));
  } catch { /* this session only */ }
  return value;
}
