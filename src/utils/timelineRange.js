// Drag to sweep a time range on the timeline (#2366). Pure, so the snapping is
// tested without a pointer.
//
// The press picks a 15-minute slot (the anchor), and the range always holds
// it: dragging down runs from the anchor's start to the slot under the
// pointer's end, dragging up from that slot's start to the anchor's end. Both
// ends stay inside the column the press was in (`min`..`max`): a drag that
// leaves it is clamped, never carried into the next column.

export const RANGE_STEP = 15;
// How far (px) the pointer has to move before a press is a drag, not a click.
export const DRAG_THRESHOLD_PX = 4;

const floorTo = (m, step) => Math.floor(m / step) * step;
const ceilTo = (m, step) => Math.ceil(m / step) * step;

/**
 * @param {number} anchor   the minute under the press
 * @param {number} current  the minute under the pointer now
 * @param {{ min?: number, max?: number, step?: number }} [opts]  the column's window
 * @returns {{ start: number, end: number }}  minutes from midnight, end > start
 */
export function rangeBetween(anchor, current, { min = 0, max = 1440, step = RANGE_STEP } = {}) {
  const lo = ceilTo(min, step);
  const hi = floorTo(max, step);
  const clamp = (m) => Math.max(lo, Math.min(hi, m));
  const slot = clamp(floorTo(anchor, step));
  const anchorStart = Math.min(slot, hi - step);
  const anchorEnd = anchorStart + step;
  const at = clamp(current);
  if (at >= anchorStart) return { start: anchorStart, end: Math.max(anchorEnd, clamp(ceilTo(at, step))) };
  return { start: clamp(floorTo(at, step)), end: anchorEnd };
}

/** Whether the range runs into any of `frames` (instances with 'HH:MM' start/end) on its date. */
export function rangeOverlapsFrame({ start, end }, frames = [], toMinutes) {
  return (frames || []).some((f) => {
    const s = toMinutes(f.start);
    const e = toMinutes(f.end);
    return s < end && e > start;
  });
}
