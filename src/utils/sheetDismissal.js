// Dismissal and paging rules for a near-full-height sheet, as pure decisions
// plus a small controller that a hook wires to the DOM. Pure so every path
// can be tested without a browser: Escape, the browser or Android back (a
// pushed history entry the WebView's goBack() pops), pull-down on the sheet,
// a mouse drag on the handle, the left-edge swipe iOS has no free gesture
// for, and (step 5) a horizontal swipe or arrow key that pages to the
// adjacent day.
//
// A drag locks to one axis once it has moved past a small slop: whichever
// of |dx| and |dy| is larger at that moment. A vertical drag can only
// dismiss, a horizontal one can only page (or, from the left edge, dismiss),
// so a diagonal gesture never does both.

export const SHEET_PULL_DISMISS_PX = 120;      // pull this far and letting go closes
export const SHEET_FLING_VELOCITY = 0.6;       // px per ms: a quick short flick also closes
export const SHEET_EDGE_START_PX = 24;         // a swipe that begins this close to the left edge
export const SHEET_EDGE_DISMISS_PX = 80;       // and travels this far right closes
export const SHEET_AXIS_LOCK_PX = 10;          // movement before a drag commits to one axis
export const SHEET_PAGE_SWIPE_PX = 80;         // a horizontal swipe this long pages to the adjacent day
export const SHEET_PAGE_FLING_VELOCITY = 0.5;  // px per ms: a quick shorter flick pages too

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

/** The axis a drag commits to once past the slop, or null while it is still ambiguous. */
export function dragAxis({ dx, dy }) {
  if (Math.hypot(dx, dy) < SHEET_AXIS_LOCK_PX) return null;
  return Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
}

/**
 * A horizontal swipe long or quick enough to page: -1 for a swipe to the
 * right (the previous day), +1 for one to the left (the next day), 0 for
 * neither.
 */
export function pageDirection({ dx, dtMs }) {
  const far = Math.abs(dx) >= SHEET_PAGE_SWIPE_PX;
  const fling = dtMs > 0 && Math.abs(dx) / dtMs >= SHEET_PAGE_FLING_VELOCITY && Math.abs(dx) >= 24;
  if (!far && !fling) return 0;
  return dx < 0 ? 1 : -1;
}

const isTextTarget = (target) => {
  const tag = target?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!target?.isContentEditable;
};

/**
 * @param {object} deps
 * @param {string} deps.key      history-state key that marks this sheet's entry
 * @param {(reason: string) => void} deps.onClose
 * @param {(delta: -1 | 1) => void} [deps.onPage]  page to the previous/next day
 * @param {object} deps.win      window-like: { history, addEventListener, removeEventListener, hasInnerOverlay? }
 */
export function createSheetController({ key, onClose, onPage, win }) {
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

  // Only when OUR entry was popped: an overlay opened over the sheet (the
  // task editor, hooks/useBackClose.js) pushes an entry that copies ours,
  // and popping that one leaves ours on top.
  const onPopState = () => { if (!ownsHistoryEntry()) close('back'); };
  const page = (delta) => { if (!closed && onPage) onPage(delta); };
  const onKeyDown = (event) => {
    if (event.defaultPrevented) return;
    // Inner overlays (a card's notes panel, a task editor) own the keyboard.
    if (win.hasInnerOverlay?.()) return;
    if (event.key === 'Escape') { dismiss('escape'); return; }
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    if (isTextTarget(event.target)) return; // a caret is moving, not the day
    event.preventDefault?.();
    page(event.key === 'ArrowLeft' ? -1 : 1);
  };

  const onDragStart = ({ x, y, t, scrollTop = 0 }) => {
    drag = { x0: x, y0: y, t0: t, scrollTop, dx: 0, dy: 0, dt: 0, axis: null };
  };
  /** Returns the pull offset to translate the sheet by (0 while the content is scrolled or the drag is horizontal). */
  const onDragMove = ({ x, y, t }) => {
    if (!drag) return 0;
    drag.dx = x - drag.x0;
    drag.dy = y - drag.y0;
    drag.dt = t - drag.t0;
    if (!drag.axis) drag.axis = dragAxis(drag);
    return drag.axis === 'y' && drag.scrollTop === 0 && drag.dy > 0 ? drag.dy : 0;
  };
  /** Returns true when the gesture dismissed the sheet (a page is reported through onPage). */
  const onDragEnd = () => {
    if (!drag) return false;
    const { dx, dy, dt, scrollTop, x0, axis } = drag;
    drag = null;
    if (axis === 'y') {
      if (shouldDismissPull({ dy, dtMs: dt, scrollTop })) { dismiss('pull'); return true; }
      return false;
    }
    if (axis === 'x') {
      // The left edge stays a dismiss so the iOS "back" swipe keeps working;
      // it wins over paging to the previous day from that strip.
      if (shouldDismissEdgeSwipe({ startX: x0, dx, dy })) { dismiss('edge-swipe'); return true; }
      const delta = pageDirection({ dx, dtMs: dt });
      if (delta) page(delta);
    }
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
