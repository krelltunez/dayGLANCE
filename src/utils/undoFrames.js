// Undo and redo for Frames. Pure: useUndo hands in the frames as they are,
// the copy taken when the step was pushed, and the clock.
//
// Frames sync by last-writer-wins on `lastModified` (packages/dayglance-vault/src/adapter.js) and,
// unlike tasks, nothing re-stamps them on persist. Writing the copy back as it
// was would restore its OLD stamp, and the next sync would hand the newer,
// undone version straight back. So a frame the step changed comes back with a
// stamp strictly newer than the one it has now: an undo is a fresh edit.
//
// Only frames the step changed are touched. A frame added since is kept, and a
// frame deleted since is not brought back: no Frame edit that pushes an undo
// step adds or removes one, and resurrecting a deletion is not undo's call.

const canonical = (value) => (Array.isArray(value) ? value.map(canonical)
  : value !== null && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value);

const sameFrame = (a, b) => {
  const { lastModified: _a, ...restA } = a;
  const { lastModified: _b, ...restB } = b;
  return JSON.stringify(canonical(restA)) === JSON.stringify(canonical(restB));
};

/**
 * `current` with each frame that differs from its copy in `snapshot` replaced
 * by that copy, stamped newer than both `now` and the frame's current stamp.
 * Returns `current` itself when nothing differs.
 */
export function restoreFrames(current, snapshot, now) {
  if (!Array.isArray(current) || !Array.isArray(snapshot)) return current;
  const before = new Map(snapshot.map((frame) => [frame.id, frame]));
  let changed = false;
  const next = current.map((frame) => {
    const was = before.get(frame.id);
    if (!was || sameFrame(was, frame)) return frame;
    changed = true;
    const stamp = Math.max(now, (Date.parse(frame.lastModified) || 0) + 1);
    return { ...was, lastModified: new Date(stamp).toISOString() };
  });
  return changed ? next : current;
}
