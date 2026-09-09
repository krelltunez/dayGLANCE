// Whole-row long-press reorder for touch devices.
//
// Task rows in the project card, the project planner and the bucket list are
// reordered by HTML5 drag on desktop. On Android the same rows relied on the
// WebView starting an HTML5 drag from a long press, which the app never
// controlled: it worked for months and then stopped with a WebView update
// (151.0.7922.199 was the first version seen failing). The row now owns the
// gesture itself, the way the inbox and the timeline already do: hold
// anywhere on the row for LONG_PRESS_MS, then move to reorder; a finger that
// moves before the hold completes is a scroll and is left alone.
//
// iOS keeps its existing grip-only path (ProjectCard's IS_IOS note). This
// module only adds the row gesture on the other touch devices.
import { isNativeAndroid, triggerHaptic } from '../native.js';

export const LONG_PRESS_MS = 500;
export const LONG_PRESS_CANCEL_PX = 10;

/**
 * iOS/iPadOS, including the native shell and an iPad reporting as a Mac.
 * Mirrors the IS_IOS check the three reorder surfaces already carry.
 */
export const isIOSTouchDevice = () => typeof navigator !== 'undefined' && (
  /iP(hone|ad|od)/.test(navigator.platform || '') ||
  (/Mac/.test(navigator.platform || '') && (navigator.maxTouchPoints || 0) > 1) ||
  (typeof window !== 'undefined' && !!window.DayGlanceIOS)
);

/**
 * True where a task row should carry the long-press touch reorder instead of
 * an HTML5 draggable: the Android shell, or any browser whose primary pointer
 * is a touch screen, except iOS (which keeps its grip path).
 */
export const isLongPressRowDevice = () => {
  if (isIOSTouchDevice()) return false;
  if (isNativeAndroid()) return true;
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return !!window.matchMedia('(pointer: coarse)').matches;
  } catch (_) {
    return false;
  }
};

/**
 * Start a long-press reorder from a row's touchstart.
 *
 * Listeners go on the document (non-passive, so preventDefault is honoured)
 * and are removed when the touch ends, exactly like the grip path. Until the
 * hold completes nothing is prevented, so a tap still clicks and a swipe
 * still scrolls. Once it completes the finger owns the gesture: moves are
 * prevented and hit-tested against `hitSelector`, the browser's own drag,
 * context menu and the click synthesized on release are all suppressed.
 *
 * @param {TouchEvent} e            the row's touchstart
 * @param {object} opts
 * @param {number} opts.idx         the row's reorder index
 * @param {string} [opts.hitSelector='[data-drag-idx]'] rows to hit-test
 * @param {(idx:number)=>void} [opts.onActivate]  hold completed
 * @param {(overIdx:number)=>void} [opts.onOver]  finger over another row
 * @param {(r:{activated:boolean, fromIdx:number, overIdx:number|null})=>void} [opts.onEnd]
 * @param {number} [opts.longPressMs]
 * @param {number} [opts.cancelPx]
 * @param {Document} [opts.doc]     injectable for tests
 * @param {Function} [opts.setTimeoutFn]
 * @param {Function} [opts.clearTimeoutFn]
 * @param {Function} [opts.haptic]
 * @returns {() => void} cancel: tears the gesture down without an onEnd
 */
export function beginLongPressReorder(e, {
  idx,
  hitSelector = '[data-drag-idx]',
  onActivate,
  onOver,
  onEnd,
  longPressMs = LONG_PRESS_MS,
  cancelPx = LONG_PRESS_CANCEL_PX,
  doc = typeof document !== 'undefined' ? document : null,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  haptic = triggerHaptic,
} = {}) {
  const touch = e?.touches?.[0];
  if (!doc || !touch || (e.touches && e.touches.length > 1)) return () => {};

  const start = { x: touch.clientX, y: touch.clientY };
  const state = { activated: false, fromIdx: idx, overIdx: null };
  let timer = null;

  const preventDefault = (ev) => ev.preventDefault();

  const teardown = () => {
    if (timer !== null) {
      clearTimeoutFn(timer);
      timer = null;
    }
    doc.removeEventListener('touchmove', onMove);
    doc.removeEventListener('touchend', onTouchEnd);
    doc.removeEventListener('touchcancel', onTouchCancel);
    doc.removeEventListener('dragstart', preventDefault);
    doc.removeEventListener('contextmenu', preventDefault);
  };

  const activate = () => {
    timer = null;
    state.activated = true;
    try { doc.defaultView?.getSelection?.()?.removeAllRanges?.(); } catch (_) {}
    try { haptic('heavy'); } catch (_) {}
    onActivate?.(idx);
  };

  const onMove = (moveEvent) => {
    const t = moveEvent.touches?.[0];
    if (!t) return;
    if (!state.activated) {
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      if (Math.sqrt(dx * dx + dy * dy) > cancelPx) teardown(); // a scroll, not a hold
      return;
    }
    moveEvent.preventDefault(); // honoured: registered non-passive
    const el = typeof doc.elementFromPoint === 'function'
      ? doc.elementFromPoint(t.clientX, t.clientY)
      : null;
    const rowEl = el?.closest?.(hitSelector);
    if (!rowEl) return;
    const overIdx = parseInt(rowEl.getAttribute('data-drag-idx'), 10);
    if (Number.isNaN(overIdx) || overIdx === state.overIdx) return;
    state.overIdx = overIdx;
    onOver?.(overIdx);
  };

  const finish = (endEvent) => {
    const wasActive = state.activated;
    if (wasActive && endEvent?.cancelable) endEvent.preventDefault(); // no synthesized click
    teardown();
    onEnd?.({ activated: wasActive, fromIdx: state.fromIdx, overIdx: state.overIdx });
  };
  const onTouchEnd = (endEvent) => finish(endEvent);
  const onTouchCancel = () => {
    state.overIdx = null;
    finish(null);
  };

  doc.addEventListener('touchmove', onMove, { passive: false });
  doc.addEventListener('touchend', onTouchEnd);
  doc.addEventListener('touchcancel', onTouchCancel);
  doc.addEventListener('dragstart', preventDefault);
  doc.addEventListener('contextmenu', preventDefault);
  timer = setTimeoutFn(activate, longPressMs);

  return teardown;
}
