// A task's duration and end time in the task dialogs (#2249). Pure, so the
// dialog's arithmetic is tested without it.
//
// A task stores a start and a duration in minutes; the end is derived, never
// stored. An end at or before the start is the next day, as typing a range
// already reads it ("11pm-1am" is two hours, quickAddParser.js).

/** What the duration menu offers before "Custom…". */
export const DURATION_PRESETS = Object.freeze([15, 30, 45, 60, 90, 120, 180, 240]);

/** The longest duration the dialog takes: a whole day. */
export const MAX_DURATION_MINUTES = 24 * 60;

const toMinutes = (time) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(time ?? ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const toTime = (minutes) => {
  const day = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(day / 60)).padStart(2, '0')}:${String(day % 60).padStart(2, '0')}`;
};

/**
 * The menu's choices: the presets, and the task's own duration among them
 * when it is not one (a resize to 75 minutes, "22m" typed in a title), so the
 * menu shows what the task holds rather than a blank or the wrong preset.
 */
export function durationChoices(current) {
  const own = Number(current);
  const list = [...DURATION_PRESETS];
  if (Number.isInteger(own) && own > 0 && !list.includes(own)) list.push(own);
  return list.sort((a, b) => a - b);
}

/**
 * A typed duration in minutes, or null when it is not one: "22" (minutes),
 * "1:30" (hours:minutes), "90m", "1h", "1h 30", "1h30m", "1.5h" or "1,5h".
 * Clamped to 1 minute … a whole day.
 */
export function parseDurationInput(text) {
  const s = String(text ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!s) return null;
  let minutes = null;
  let m;
  if ((m = /^(\d+)$/.exec(s))) minutes = Number(m[1]);
  else if ((m = /^(\d+):([0-5]\d)$/.exec(s))) minutes = Number(m[1]) * 60 + Number(m[2]);
  else if ((m = /^(\d+) ?m(?:in(?:s|utes?)?)?$/.exec(s))) minutes = Number(m[1]);
  else if ((m = /^(\d+(?:[.,]\d+)?) ?h(?:(?:ou)?rs?)?(?: ?(\d+) ?(?:m(?:in(?:s|utes?)?)?)?)?$/.exec(s))) {
    minutes = Math.round(Number(m[1].replace(',', '.')) * 60) + (m[2] ? Number(m[2]) : 0);
  }
  if (minutes === null || !Number.isFinite(minutes) || minutes < 1) return null;
  return Math.min(minutes, MAX_DURATION_MINUTES);
}

/** Where a task ends: `{ time: 'HH:MM', nextDay }`, or null without a start. */
export function endOf(startTime, duration) {
  const start = toMinutes(startTime);
  if (start === null) return null;
  const end = start + Math.max(0, Number(duration) || 0);
  return { time: toTime(end), nextDay: end >= 1440 };
}

/**
 * The duration that makes a task end at `endTime`: the minutes from its start,
 * the next day when the end is at or before the start. Null without a start.
 */
export function durationUntil(startTime, endTime) {
  const start = toMinutes(startTime);
  const end = toMinutes(endTime);
  if (start === null || end === null) return null;
  return end > start ? end - start : end + 1440 - start;
}
