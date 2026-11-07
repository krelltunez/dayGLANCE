// Which GTD frames apply to a given date, and what each one looks like there.
//
// Extracted verbatim from App.jsx's getFrameInstancesForDate so the MCP read
// surface and the UI resolve frames the same way. The rules are small but
// easy to get subtly wrong from memory, and a second implementation would
// drift exactly as the three occupancy answers did (see dayOccupancy.js):
//
//   - a frame applies when it is enabled AND either pins a singleDate that
//     matches, or lists the date's day-of-week
//   - a per-date exception can override start and end, or delete the instance
//     for that date alone
//   - bufferMinutes defaults to 5, energyLevel to 'medium', tagAffinity to []
//   - a frame in a SET (`frame.setId`, frameSets.js) also needs its set active
//     on the date; a frame with no set, or whose set is unknown, is unaffected.
//     Every caller passes the sets (`{ frameSets }`): one that does not shows
//     every set's frames on every date.
//
// OWNERSHIP IS NOT FILTERED HERE, deliberately, and this is the same trap
// routines carry. Frames use the single-owner `ownerSyncId` model, NOT the
// broadcast-with-filter `assignedUserSyncIds` that isVisibleForUser
// understands. Feed this the unscoped roster and every member's frames come
// back. Callers pass an already-scoped list; see the ownership tests.

import { frameSetAllows, frameSetsById } from './frameSets.js';

/** 0=Sunday..6=Saturday for a `YYYY-MM-DD` string, without a Date round-trip. */
export function dayOfWeekFor(dateStr) {
  const [y, m, d] = String(dateStr ?? '').split('-').map(Number);
  if (!y || !m || !d) return null;
  // Noon, so no DST transition can shift the calendar day.
  return new Date(y, m - 1, d, 12, 0, 0).getDay();
}

/**
 * True when `frame` has an instance on `dateStr`, before exceptions: its own
 * rules hold, and its set (if it has a known one) is active that day.
 * `options.frameSets` is the sets array, or frameSetsById's Map of it.
 */
export function frameAppliesTo(frame, dateStr, dayOfWeek, options) {
  if (!frame?.enabled) return false;
  const ownRule = frame.singleDate
    ? frame.singleDate === dateStr
    : Array.isArray(frame.days) && frame.days.includes(dayOfWeek);
  if (!ownRule) return false;
  return frameSetAllows(frame, dateStr, options?.frameSets);
}

/**
 * The frame instances on `dateStr`, in template order.
 *
 * `frames` must already be scoped to the current user (see the module header).
 * Returns the same instance shape App.jsx has always produced, so existing
 * consumers are unaffected by the move.
 *
 * `options.frameSets` is every set (unscoped is fine: a set is only looked up
 * by a frame's `setId`). Omitted, every frame is read as if it had no set.
 */
export function frameInstancesForDate(frames, dateStr, options) {
  const dayOfWeek = dayOfWeekFor(dateStr);
  if (dayOfWeek === null) return [];
  const gate = { frameSets: frameSetsById(options?.frameSets) };
  return (frames ?? [])
    .filter((f) => frameAppliesTo(f, dateStr, dayOfWeek, gate))
    .map((f) => {
      const exception = f.exceptions?.[dateStr];
      if (exception?.deleted) return null;
      return {
        frameId: f.id,
        templateId: f.id,
        date: dateStr,
        start: exception?.start || f.start,
        end: exception?.end || f.end,
        label: f.label,
        color: f.color,
        tagAffinity: f.tagAffinity || [],
        energyLevel: f.energyLevel || 'medium',
        bufferMinutes: f.bufferMinutes ?? 5,
      };
    })
    .filter(Boolean);
}
