// The edits the Frames UI makes to frame sets (#2305), as pure functions over
// the two lists. The rules of a set (when it is active, what the switch does
// to its periods) are agenda-core's frameSets.js; this module only applies
// them to the app's state and stamps what changed.
//
// Every edit stamps `lastModified`: sets and frames sync by last-writer-wins on
// it (packages/dayglance-vault/src/adapter.js, src/mergeSync.js), and nothing
// re-stamps them on persist, so an unstamped edit would lose to the stored copy
// on the next merge. An edit that changes nothing returns the list itself, so
// it neither re-renders nor re-stamps.

import { switchFrameSetOn, switchFrameSetOff, withFrameSetPeriods, readFrameSetPeriod } from '@glance-apps/agenda-core';
import { DELETED_FRAME_SET_IDS_KEY } from './storedSlices.js';

/**
 * A new set, active on every date (one period open at both ends): frames moved
 * into it keep every date they had, past ones included, until it is switched
 * off or given periods.
 */
export function newFrameSet({ id, name, now, ownerSyncId = null }) {
  return {
    id,
    name: String(name ?? '').trim(),
    periods: [{ from: null, until: null }],
    lastModified: now,
    ...(ownerSyncId ? { ownerSyncId } : {}),
  };
}

/** `sets` with the set `id` replaced by `edit(set)`, stamped when it changed. */
export function editFrameSet(sets, id, edit, now) {
  if (!Array.isArray(sets)) return sets;
  let changed = false;
  const next = sets.map((set) => {
    if (!set || String(set.id) !== String(id)) return set;
    const edited = edit(set);
    if (!edited || edited === set) return set;
    changed = true;
    return { ...edited, lastModified: now };
  });
  return changed ? next : sets;
}

export const renameFrameSet = (sets, id, name, now) => editFrameSet(sets, id, (set) => {
  const trimmed = String(name ?? '').trim();
  return trimmed && trimmed !== set.name ? { ...set, name: trimmed } : set;
}, now);

/** The one-tap switch for today. */
export const switchFrameSet = (sets, id, on, today, now) => editFrameSet(
  sets, id, (set) => (on ? switchFrameSetOn(set, today) : switchFrameSetOff(set, today)), now,
);

export const setFrameSetPeriods = (sets, id, periods, now) => editFrameSet(
  sets, id, (set) => withFrameSetPeriods(set, periods), now,
);

/**
 * Frames that belonged to set `setId`, unassigned and stamped. A frame's set
 * is a field of the frame, so deleting the set has to edit its frames too, in
 * the same step, or they would keep naming a set that no longer exists.
 * (They would still show: an unknown set applies. But a set re-created later
 * under the same id cannot happen, and a dangling id helps nobody.)
 */
export function detachFramesFromSet(frames, setId, now) {
  if (!Array.isArray(frames)) return frames;
  let changed = false;
  const next = frames.map((frame) => {
    if (!frame || frame.setId === undefined || String(frame.setId) !== String(setId)) return frame;
    changed = true;
    const { setId: _dropped, ...rest } = frame;
    return { ...rest, lastModified: now };
  });
  return changed ? next : frames;
}

/**
 * Move one frame into a set, or into none (`setId` null or ''), as a drag in
 * the Frames list does (#2335). The same row the editor's save would write:
 * `setId` set, or absent for no set (the shape a frame from before sets has),
 * and a fresh `lastModified` so the move wins the merge on other devices.
 * Returns `frames` itself when the frame is missing or already there. Whether
 * the move would make an overlap is the caller's to check first
 * (utils/frameOverlap.js).
 */
export function moveFrameToSet(frames, frameId, setId, now) {
  if (!Array.isArray(frames)) return frames;
  const target = setId == null || setId === '' ? undefined : setId;
  const at = frames.findIndex((frame) => frame && String(frame.id) === String(frameId));
  if (at < 0) return frames;
  const frame = frames[at];
  const current = frame.setId == null || frame.setId === '' ? undefined : frame.setId;
  if (String(current) === String(target)) return frames;
  const { setId: _old, ...rest } = frame;
  const moved = target === undefined ? { ...rest, lastModified: now } : { ...rest, setId: target, lastModified: now };
  return frames.map((f, i) => (i === at ? moved : f));
}

/**
 * Record the deletion tombstone for a set. The vault tier propagates the row's
 * delete only when a tombstone authorizes it (sync/snapshotDeleteGuard.js), and
 * the file tier drops copies older than it, so a delete without one would come
 * straight back from another device.
 */
export function recordFrameSetTombstones(ids, now, storage = globalThis.localStorage) {
  if (!storage || !ids?.length) return;
  let tombstones = {};
  try {
    const parsed = JSON.parse(storage.getItem(DELETED_FRAME_SET_IDS_KEY) || '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) tombstones = parsed;
  } catch { /* an unreadable map is rebuilt with this entry */ }
  for (const id of ids) tombstones[String(id)] = now;
  storage.setItem(DELETED_FRAME_SET_IDS_KEY, JSON.stringify(tombstones));
}

/**
 * Undo and redo for frame sets. A step names the sets it touched
 * (`frameSetIds`), and only those are put back as the snapshot had them: a set
 * the snapshot holds returns, freshly stamped so the next sync keeps the undo
 * (the same reason utils/undoFrames.js stamps); a set the snapshot lacks is
 * removed again, with its tombstone. Sets the step did not touch are left
 * alone, so undoing an older step never removes a set made since.
 *
 * Returns `{ sets, removed }`; `sets` is `current` itself when nothing changed.
 */
export function restoreFrameSets(current, snapshot, ids, now) {
  if (!Array.isArray(current) || !Array.isArray(snapshot) || !ids?.length) return { sets: current, removed: [] };
  const wanted = new Set(ids.map(String));
  const before = new Map(snapshot.filter((s) => s && wanted.has(String(s.id))).map((s) => [String(s.id), s]));
  const stamp = (set, was) => {
    const at = Math.max(now, (Date.parse(set?.lastModified) || 0) + 1);
    return { ...was, lastModified: new Date(at).toISOString() };
  };
  const removed = [];
  let changed = false;
  const next = [];
  for (const set of current) {
    const id = String(set?.id);
    if (!set || !wanted.has(id)) { next.push(set); continue; }
    const was = before.get(id);
    before.delete(id);
    if (!was) { removed.push(id); changed = true; continue; }
    if (JSON.stringify({ ...was, lastModified: null }) === JSON.stringify({ ...set, lastModified: null })) { next.push(set); continue; }
    next.push(stamp(set, was));
    changed = true;
  }
  for (const was of before.values()) {
    next.push(stamp(was, was));
    changed = true;
  }
  return { sets: changed ? next : current, removed };
}

/**
 * What a set's header says about it today: `{ on, until, next }`. `until` is
 * the last day of the period covering today (null when it has no end), and
 * `next` the first period planned after today, for a set that is off.
 */
export function frameSetStatus(set, todayStr) {
  const periods = (Array.isArray(set?.periods) ? set.periods : []).map(readFrameSetPeriod).filter(Boolean);
  const covering = periods.filter((p) => (p.from === null || p.from <= todayStr) && (p.until === null || todayStr <= p.until));
  if (covering.length) {
    const until = covering.some((p) => p.until === null) ? null : covering.map((p) => p.until).sort().at(-1);
    return { on: true, until, next: null };
  }
  const later = periods.filter((p) => p.from !== null && p.from > todayStr).sort((a, b) => (a.from < b.from ? -1 : 1));
  return { on: false, until: null, next: later[0] ?? null };
}
