// Scrolling the timeline while a task is dragged (#2346). Pure.
//
// The edge bands, on the calendar's own scroller: holding the cursor near the
// top (under the sticky date header and all-day row) or the bottom scrolls.
// The speed ramps with how deep the cursor is in the band, so a short push at
// the band's inner edge scrolls slowly and there is no need to go right up to
// the edge, where the all-day row starts and a drop would land there instead.
//
// Not the mouse wheel. During a native HTML5 drag, Chromium (Chrome, Edge and
// every Electron build) hands the pointer to the OS's drag loop and delivers
// no wheel events to the page, on Windows, Linux and macOS alike; a wheel
// handler shipped in #2349 never fired in the desktop app and was removed.
// Wheel scrolling mid-drag would need the timeline's drag rebuilt on pointer
// events instead of native drag and drop.

/** How far in from each edge the band reaches. */
export const DRAG_SCROLL_ZONE_PX = 80;
/** Pixels per tick (about 16 ms) at the band's inner edge, and at the edge itself. */
export const DRAG_SCROLL_MIN_STEP = 2;
export const DRAG_SCROLL_MAX_STEP = 20;

const speed = (distance) => {
  const depth = 1 - distance / DRAG_SCROLL_ZONE_PX; // 0 at the inner edge, 1 at the edge
  return Math.round(DRAG_SCROLL_MIN_STEP + (DRAG_SCROLL_MAX_STEP - DRAG_SCROLL_MIN_STEP) * depth);
};

/**
 * The scroll per tick for a cursor at `cursorY`: negative scrolls up, positive
 * down, 0 for none. `top` is where the timeline starts showing (below the
 * sticky header), `bottom` the scroller's bottom edge. Outside the scroller
 * (over the sticky header, say) is no scroll, and neither is a band at the end
 * it would scroll past.
 */
export function dragAutoScrollStep({ cursorY, top, bottom, scrollTop, maxScroll }) {
  const fromTop = cursorY - top;
  const fromBottom = bottom - cursorY;
  if (fromTop > 0 && fromTop < DRAG_SCROLL_ZONE_PX && scrollTop > 0) return -speed(fromTop);
  if (fromBottom > 0 && fromBottom < DRAG_SCROLL_ZONE_PX && scrollTop < maxScroll) return speed(fromBottom);
  return 0;
}
