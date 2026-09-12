// Dismissal rules for a near-full-height sheet, as pure decisions plus a
// small controller that a hook wires to the DOM. Pure so every path can be
// tested without a browser: Escape, the browser or Android back (a pushed
// history entry the WebView's goBack() pops), pull-down on the sheet, a
// mouse drag on the handle, and the left-edge swipe iOS has no free gesture
// for.

export const SHEET_PULL_DISMISS_PX = 120;      // pull this far and letting go closes
export const SHEET_FLING_VELOCITY = 0.6;       // px per ms: a quick short flick also closes
export const SHEET_EDGE_START_PX = 24;         // a swipe that begins this close to the left edge
export const SHEET_EDGE_DISMISS_PX = 80;       // and travels this far right closes

/** A pull-down closes only from the top of the content, so scrolling never dismisses by accident. */
export function shouldDismissPull({ dy, dtMs, scrollTop }) {
  if (!(dy > 0) || scrollTop > 0) return false;
  if (dy >= SHEET_PULL_DISMISS_PX) return true;
  return dtMs > 0 && dy / dtMs >= SHEET_FLING_VELOCITY && dy >= 24;
}

/** A left-edge swipe: starts at the edge, moves right, and stays more horizontal than vertical. */
export function shouldDismissEdgeSwipe({ startX, dx, dy }) {
  return startX <= SHEET_EDGE_START_PX && dx >= SHEET_EDGE_DISMISS_PX && Math.abs(dy) < dx;
}

/**
 * @param {object} deps
 * @param {string} deps.key      history-state key that marks this sheet's entry
 * @param {(reason: string) => void} deps.onClose
 * @param {object} deps.win      window-like: { history, addEventListener, removeEventListener, hasNotesPanel? }
 */
export function createSheetController({ key, onClose, win }) {
  let opened = false;
  let closed = false;
  let drag = null;

  const close = (reason) => {
    if (closed) return;
    closed = true;
    onClose(reason);
  };

  const ownsHistoryEntry = () => !!win.history?.state?.[key];

  // Every non-back path leaves through history when we pushed an entry, so
  // the entry never lingers and a later back press cannot re-close a sheet
  // that is already gone. popstate then does the actual close.
  const dismiss = (reason) => {
    if (closed) return;
    if (ownsHistoryEntry()) { win.history.back(); return; }
    close(reason);
  };

  const onPopState = () => close('back');
  const onKeyDown = (event) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    // Inner overlays (a card's notes panel) handle their own Escape.
    if (win.hasInnerOverlay?.()) return;
    dismiss('escape');
  };

  const onDragStart = ({ x, y, t, scrollTop = 0 }) => {
    drag = { x0: x, y0: y, t0: t, scrollTop, dx: 0, dy: 0, dt: 0 };
  };
  /** Returns the pull offset to translate the sheet by (0 while the content is scrolled). */
  const onDragMove = ({ x, y, t }) => {
    if (!drag) return 0;
    drag.dx = x - drag.x0;
    drag.dy = y - drag.y0;
    drag.dt = t - drag.t0;
    return drag.scrollTop === 0 && drag.dy > 0 && Math.abs(drag.dy) >= Math.abs(drag.dx) ? drag.dy : 0;
  };
  /** Returns true when the gesture dismissed the sheet. */
  const onDragEnd = () => {
    if (!drag) return false;
    const { dx, dy, dt, scrollTop, x0 } = drag;
    drag = null;
    if (shouldDismissPull({ dy, dtMs: dt, scrollTop })) { dismiss('pull'); return true; }
    if (shouldDismissEdgeSwipe({ startX: x0, dx, dy })) { dismiss('edge-swipe'); return true; }
    return false;
  };

  const open = () => {
    if (opened) return;
    opened = true;
    // Push one entry per sheet, not per controller: React StrictMode mounts
    // an effect twice in development, and a second push would leave a stale
    // entry that the next back press swallows instead of leaving the view.
    if (win.history?.pushState && !ownsHistoryEntry()) {
      win.history.pushState({ ...(win.history.state || {}), [key]: true }, '');
    }
    win.addEventListener('popstate', onPopState);
    win.addEventListener('keydown', onKeyDown);
  };
  const dispose = () => {
    win.removeEventListener('popstate', onPopState);
    win.removeEventListener('keydown', onKeyDown);
  };

  return { open, dispose, dismiss, onKeyDown, onPopState, onDragStart, onDragMove, onDragEnd, isDragging: () => drag !== null };
}
