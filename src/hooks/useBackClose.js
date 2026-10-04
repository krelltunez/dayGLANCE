import { useEffect, useRef } from 'react';

// The phone's back (gesture or button, and the browser's) closes an overlay
// such as PLANNER or the Bucket List. Without an entry of its own, back went
// to whatever was under the overlay (the tab's entry, then out of the app),
// and the overlay was still open when the app came back.
//
// The overlay pushes one history entry, marked with its key and copying the
// state below (the way MONTH's day sheet does, utils/sheetDismissal.js), so
// popping it lands on the entry the tab hook (useMobileTabBack) already
// reads as "something inside this tab closed". An overlay closes when the
// entry under the pointer no longer carries its key, so overlays nest: a
// page inside PLANNER pushes its own key on top, and back closes that page
// while PLANNER's key is still on the entry below.
//
// The task editor has its own entry too, so back from an editor opened in
// PLANNER closes the editor and leaves PLANNER open.
//
// Closed any other way (its X, Escape, the backdrop), the overlay's entry
// is popped for it, so a later back press is never swallowed by a stale one.
// The pop is deferred a tick and cancelled by a re-open with the same key:
// React StrictMode unmounts and remounts an effect at once in development,
// and an immediate pop would arrive after the remount and close it.

const pendingPops = new Map();

/**
 * Wires the back entry for one open overlay. Pure apart from `win`, so it
 * can be tested without React or a browser. Returns the cleanup.
 *
 * @param {object} deps
 * @param {string} deps.key                 history-state key that marks this overlay's entry
 * @param {() => void} deps.onClose         close the overlay (back was pressed)
 * @param {() => boolean} [deps.isCovered]  true while something above the overlay (a task editor) is open
 * @param {object} deps.win                 window-like: { history, addEventListener, removeEventListener, setTimeout, clearTimeout }
 */
export function attachBackClose({ key, onClose, isCovered, win }) {
  const pending = pendingPops.get(key);
  if (pending) { win.clearTimeout(pending); pendingPops.delete(key); }
  const owns = () => !!win.history.state?.[key];
  if (!owns()) win.history.pushState({ ...(win.history.state || {}), [key]: true }, '');
  const onPopState = () => {
    if (owns()) return; // an entry above ours was popped (a nested page)
    // Something without a back entry of its own is open on top (a task
    // editor): closing the overlay underneath it would be the wrong layer,
    // so put the entry back and let back do nothing, as it did before.
    if (isCovered?.()) { win.history.pushState({ ...(win.history.state || {}), [key]: true }, ''); return; }
    onClose();
  };
  win.addEventListener('popstate', onPopState);
  return () => {
    win.removeEventListener('popstate', onPopState);
    // Closed by back, the entry is already gone and owns() is false below.
    const timer = win.setTimeout(() => {
      pendingPops.delete(key);
      if (owns()) win.history.back();
    }, 0);
    pendingPops.set(key, timer);
  };
}

// Layers that sit above an overlay without a back entry of their own: the
// z-[80] modals (InboxFilterPopover, DoEditor) over the z-[70] sheets, and
// the z-[90] pickers and panels (date, time, a card's notes) over both.
export const ABOVE_SHEETS = '[class*="z-[80]"], [class*="z-[90]"]';
export const ABOVE_EDITORS = '[class*="z-[90]"]';

/**
 * Back closes the overlay while `open`; `onClose` may change between renders.
 * `coveredBy` selects the layers above it: back does nothing while one is
 * open. An overlay at z-[80] (a task editor) passes ABOVE_EDITORS, or it
 * would count itself.
 */
export default function useBackClose({ open = true, key, onClose, coveredBy = ABOVE_SHEETS }) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!open || typeof window === 'undefined' || !window.history?.pushState) return undefined;
    return attachBackClose({
      key,
      onClose: () => onCloseRef.current?.(),
      isCovered: () => !!coveredBy && !!document.querySelector(coveredBy),
      win: {
        history: window.history,
        addEventListener: (type, fn) => window.addEventListener(type, fn),
        removeEventListener: (type, fn) => window.removeEventListener(type, fn),
        setTimeout: (fn, ms) => window.setTimeout(fn, ms),
        clearTimeout: (id) => window.clearTimeout(id),
      },
    });
  }, [open, key, coveredBy]);
}
