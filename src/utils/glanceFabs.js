// Collapsible GLANCE action buttons — the shared rules behind the phone's FAB
// stack and the desktop/tablet panel's labelled pills. The two look nothing
// alike (56px circles over the viewport vs 36px pills inside a side panel), but
// they collapse identically: everything folds into one persistent handle at the
// bottom of the column. Timing and hidden-state styling live here so the two
// layouts cannot drift apart.

// Device-scoped by construction: a `day-planner-` key is excluded from cloud
// sync and captured by the local folder backup (see utils/deviceSettings.js),
// which is the lifetime a per-screen view preference wants — collapsing the
// buttons on a phone must not empty the corner of the user's desktop.
export const GLANCE_FABS_KEY = 'day-planner-glance-fabs-collapsed';

// Default EXPANDED. These buttons are the only route to the daily note, the
// weekly review and the recycle bin, so a first run must not hide them behind a
// handle nobody has been taught to look for.
export const readGlanceFabsCollapsed = () => {
  try {
    return localStorage.getItem(GLANCE_FABS_KEY) === '1';
  } catch {
    // Private mode / storage disabled: expanded is the safe direction.
    return false;
  }
};

export const writeGlanceFabsCollapsed = (collapsed) => {
  try {
    localStorage.setItem(GLANCE_FABS_KEY, collapsed ? '1' : '0');
  } catch { /* nothing to do — the session still honours the in-memory choice */ }
};

// Hidden state: faded, nudged DOWN toward the handle, and slightly shrunk, so
// the buttons read as folding INTO it rather than blinking out. pointer-events
// is load-bearing, not decoration — an opacity-0 button still swallows taps,
// which over the phone timeline would be an invisible dead zone.
export const glanceFabVisibilityClass = (collapsed) =>
  collapsed
    ? 'opacity-0 translate-y-4 scale-90 pointer-events-none'
    : 'opacity-100 translate-y-0 scale-100 pointer-events-auto';

const STAGGER_STEP_MS = 50;

/**
 * Per-button animation delay, so the stack unfolds away from the handle and
 * folds back toward it instead of moving as one block.
 *
 * @param collapsed The state being animated INTO.
 * @param index     Position in the column, 0 = nearest the handle.
 * @param count     How many buttons the column has right now — it varies: the
 *                  recycle-bin button exists only when the bin is non-empty,
 *                  and Goals & Projects only when the feature is on.
 * @returns delay in ms
 */
export const glanceFabStagger = (collapsed, index, count) => {
  const last = Math.max(0, count - 1);
  const i = Math.min(Math.max(index, 0), last);
  // Expanding, the button beside the handle leads; collapsing, the far end
  // leaves first. Either way the one next to the handle is closest in time to
  // it, which is what makes the handle read as the thing they fold into.
  return (collapsed ? last - i : i) * STAGGER_STEP_MS;
};
