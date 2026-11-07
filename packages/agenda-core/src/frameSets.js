// Frame sets: named groups of GTD frames that are switched on and off by DATE
// (#2305), so a scenario (classes, work, holiday) can be swapped at once
// without rewriting history.
//
// A frame's own `enabled` flag has no date dimension: turning it off removes
// the frame from every date, past ones included, and the timeline, the dial,
// the launcher, the widgets, the MCP read tools and JOBO all read that past.
// A set carries the dates instead:
//
//   { id, name, periods: [{ from, until }], lastModified, ownerSyncId? }
//
//   - `from` and `until` are 'YYYY-MM-DD', inclusive. `until: null` is open
//     ended ("from then on"); `from: null` is open started ("since always").
//     A new set is created as one period open at both ends, so frames moved
//     into it keep every date they had.
//   - A set is active on D when any period covers D. A set with no periods
//     is never active. Overlapping and adjacent periods are fine to read; the
//     writers below keep them merged and sorted so two devices that make the
//     same switch write the same row.
//   - A frame belongs to at most one set (`frame.setId`). It applies on D when
//     its own rules do (enabled, days, singleDate, exceptions, unchanged) AND
//     its set is active on D. A frame with no set, or whose set is unknown
//     here (deleted, or not synced yet), applies as if it had no set: a sync
//     gap must never hide frames.
//
// The switch is one tap and keeps history: OFF closes the period covering
// today at yesterday (or drops it when it began today), ON opens a period at
// today, merged with one that touches it. Periods planned for later are left
// alone by both, so switching a holiday set off today does not cancel next
// year's.
//
// Pure: no clock, no storage. Callers pass today.

import { shiftDateStr } from './agenda.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isDateStr = (s) => typeof s === 'string' && DATE_RE.test(s);

/**
 * A period as the rules read it, `{ from, until }` with nulls for open ends,
 * or null when it is malformed and covers nothing. A missing end reads as an
 * open one, so a malformed row errs towards showing frames, never hiding them.
 */
export function readFrameSetPeriod(period) {
  if (!period || typeof period !== 'object') return null;
  const from = period.from ?? null;
  const until = period.until ?? null;
  if (from !== null && !isDateStr(from)) return null;
  if (until !== null && !isDateStr(until)) return null;
  if (from !== null && until !== null && until < from) return null;
  return { from, until };
}

const covers = (p, dateStr) => (p.from === null || p.from <= dateStr) && (p.until === null || dateStr <= p.until);

/** True when `set` is active on `dateStr`: one of its periods covers it. */
export function frameSetActiveOn(set, dateStr) {
  if (!isDateStr(dateStr) || !set || !Array.isArray(set.periods)) return false;
  return set.periods.some((raw) => {
    const p = readFrameSetPeriod(raw);
    return p !== null && covers(p, dateStr);
  });
}

/** `frameSets` (an array, or a Map already built by this function) by id. */
export function frameSetsById(frameSets) {
  if (frameSets instanceof Map) return frameSets;
  const byId = new Map();
  for (const set of Array.isArray(frameSets) ? frameSets : []) {
    if (set && set.id != null) byId.set(String(set.id), set);
  }
  return byId;
}

/**
 * The set gate for one frame on one date: true when the frame has no set,
 * when its set is unknown here, or when its set is active on `dateStr`.
 * `frameSets` is the array or the Map frameSetsById built from it.
 */
export function frameSetAllows(frame, dateStr, frameSets) {
  const setId = frame?.setId;
  if (setId === undefined || setId === null || setId === '') return true;
  const set = frameSetsById(frameSets).get(String(setId));
  if (!set) return true;
  return frameSetActiveOn(set, dateStr);
}

// Sort key: an open start sorts first.
const fromKey = (p) => (p.from === null ? '' : p.from);

/**
 * Periods in canonical form: malformed ones dropped, sorted by start, and
 * overlapping or adjacent ones (one ends the day before the next begins)
 * merged. Activity is unchanged by this; it only makes the row deterministic.
 */
export function normalizeFrameSetPeriods(periods) {
  const valid = (Array.isArray(periods) ? periods : []).map(readFrameSetPeriod).filter(Boolean);
  valid.sort((a, b) => (fromKey(a) < fromKey(b) ? -1 : fromKey(a) > fromKey(b) ? 1 : 0));
  const out = [];
  for (const p of valid) {
    const last = out[out.length - 1];
    const touches = last && (last.until === null || p.from === null || p.from <= shiftDateStr(last.until, 1));
    if (!touches) { out.push({ ...p }); continue; }
    if (last.until !== null && (p.until === null || p.until > last.until)) last.until = p.until;
  }
  return out;
}

/** True when the set's periods are already in canonical form. */
const samePeriods = (a, b) => a.length === b.length
  && a.every((p, i) => (p.from ?? null) === b[i].from && (p.until ?? null) === b[i].until);

/**
 * The set switched ON from `today`: a period opened at today, merged with any
 * period it touches. Returns `set` itself when it is already active today.
 * The caller stamps lastModified.
 */
export function switchFrameSetOn(set, today) {
  if (!set || !isDateStr(today) || frameSetActiveOn(set, today)) return set;
  return { ...set, periods: normalizeFrameSetPeriods([...(set.periods || []), { from: today, until: null }]) };
}

/**
 * The set switched OFF from `today`: the period covering today closes at
 * yesterday, or is dropped when it began today. Past periods and periods
 * planned after today are kept. Returns `set` itself when it is already off
 * today. The caller stamps lastModified.
 */
export function switchFrameSetOff(set, today) {
  if (!set || !isDateStr(today) || !frameSetActiveOn(set, today)) return set;
  const yesterday = shiftDateStr(today, -1);
  const next = [];
  for (const raw of set.periods || []) {
    const p = readFrameSetPeriod(raw);
    if (!p) continue;
    if (!covers(p, today)) { next.push(p); continue; }
    if (p.from === today) continue;
    next.push({ from: p.from, until: yesterday });
  }
  return { ...set, periods: normalizeFrameSetPeriods(next) };
}

/**
 * The set with `periods` replaced, in canonical form. Returns `set` itself
 * when nothing changes, so a save with no edit does not re-stamp the row.
 */
export function withFrameSetPeriods(set, periods) {
  const next = normalizeFrameSetPeriods(periods);
  if (set && Array.isArray(set.periods) && samePeriods(set.periods, next)) return set;
  return { ...set, periods: next };
}
