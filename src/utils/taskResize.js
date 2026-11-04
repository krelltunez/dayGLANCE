// The arithmetic of resizing a block on the timeline by one of its edges
// (#2273). Pure, so the gesture handlers in hooks/useDragDrop.js only wire
// pointer events to it.
//
// A drag is measured in pixels and converted at the hour height the view
// actually renders with: MULTI measures its hour rows (getHourHeight), DAY
// and JOBO pass the height their columns are drawn at. The handlers used a
// fixed 80px per hour for years while the rows were ~161px, so an edge ran
// about twice as fast as the pointer.

export const RESIZE_SNAP_MINUTES = 15;
export const MIN_BLOCK_MINUTES = 15;

// Pixels dragged -> minutes, snapped to the 15-minute grid of every view.
// The drag is snapped, not the edge's position: an edge that starts off the
// grid (an imported 9:10 event) moves in whole steps from where it was, and a
// press that has not moved a full step changes nothing.
export function pixelsToSnappedMinutes(deltaY, hourHeight, snap = RESIZE_SNAP_MINUTES) {
  if (!Number.isFinite(deltaY) || !(hourHeight > 0)) return 0;
  // `|| 0` folds the -0 Math.round gives a small upward drag into 0.
  return (Math.round((deltaY / hourHeight) * 60 / snap) * snap) || 0;
}

// Resize a block from one edge; the other edge stays where it was.
//
// 'bottom' moves the end: the start is untouched and the duration never
// drops below the minimum. 'top' moves the start: the end is fixed, so the
// duration changes inversely; the start never goes before 00:00 and never
// closer than the minimum to the end. A block already shorter than the
// minimum (an imported 5-minute event) can grow from either edge but does not
// shrink further, and does not jump to the minimum before the pointer moves.
export function resizeBlock({ startMinutes, duration, edge, deltaMinutes }) {
  const delta = Number.isFinite(deltaMinutes) ? deltaMinutes : 0;
  if (edge === 'top') {
    const end = startMinutes + duration;
    const latestStart = Math.max(end - MIN_BLOCK_MINUTES, startMinutes);
    const start = Math.max(0, Math.min(latestStart, startMinutes + delta));
    return { startMinutes: start, duration: end - start };
  }
  return { startMinutes, duration: Math.max(Math.min(MIN_BLOCK_MINUTES, duration), duration + delta) };
}

// One step of a resize gesture: the pointer has moved `deltaY` pixels from
// where the edge was grabbed, on rows `hourHeight` pixels tall.
export function resizeBlockByPixels({ startMinutes, duration, edge, deltaY, hourHeight }) {
  return resizeBlock({ startMinutes, duration, edge, deltaMinutes: pixelsToSnappedMinutes(deltaY, hourHeight) });
}
