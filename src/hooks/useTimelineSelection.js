// The timeline's swept range (#2366), shared by DAY, MULTI and WEEK (and the
// JOBO Plan side, which is DAY's column): a press on empty timeline space, or
// on a frame's band, dragged past a few pixels, highlights a 15-minute-snapped
// range in that column (utils/timelineRange.js). The highlight then stays
// until it is used or dismissed:
//
//   - a left click on it adds a task with that start and length;
//   - a right click on it opens the timeline menu for that range (add a task,
//     or add a frame where the range runs into no frame);
//   - Escape, or a press anywhere else, clears it. That press does nothing
//     else on the timeline: the click that clears a highlight does not also
//     open the new-task form. (It can start a new drag.)
//
// Desktop only: a drag starts from a mouse, and the phone's timeline is
// another component, whose drag scrolls. A plain click and a plain right click
// do what they did: the form at that time with the default task duration,
// the timeline menu (a one-hour frame), a frame's own menu inside a frame.
//
// One range at a time, app-wide, in a small store outside React state: the
// columns that draw it subscribe, and nothing else re-renders.

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { DRAG_THRESHOLD_PX, rangeBetween } from '../utils/timelineRange.js';

let selection = null; // { dateStr, start, end, dragging }
const listeners = new Set();
// The next timeline click is not an add: a drag just ended, or the press
// cleared a range. Re-decided at every press, so it never outlives one.
let swallowClick = false;
let docBound = false;

const emit = () => listeners.forEach((fn) => fn());
const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const getSnapshot = () => selection;

export const getTimelineSelection = () => selection;

export function setTimelineSelection(next) {
  selection = next;
  bindDocument();
  emit();
}

export function clearTimelineSelection() {
  if (!selection) return;
  selection = null;
  emit();
}

/** For a timeline click handler: true (and spent) when this click must not add a task. */
export function consumeSwallowedClick() {
  const was = swallowClick;
  swallowClick = false;
  return was;
}

function bindDocument() {
  if (docBound || typeof document === 'undefined') return;
  docBound = true;
  // Capture, so it runs before the column's own handlers.
  document.addEventListener('mousedown', (e) => {
    const onRange = !!e.target?.closest?.('[data-timeline-selection]');
    swallowClick = !!selection && !onRange && e.button === 0;
    if (selection && !onRange && !selection.dragging) clearTimelineSelection();
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') clearTimelineSelection();
  });
}

/** The range, wherever it is (MULTI draws every date's column itself). */
export function useTimelineSelectionState() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** This column's range, or null: one on `dateStr` that falls in `min`..`max`. */
export function useTimelineSelection(dateStr, { min = 0, max = 1440 } = {}) {
  const s = useTimelineSelectionState();
  return s && s.dateStr === dateStr && s.start < max && s.end > min ? s : null;
}

/**
 * The press handler that starts a sweep: `(e, column) => void`, for a
 * column's onMouseDown.
 *
 * @param {object} o
 * @param {(target: Element) => boolean} o.canStart  whether a press there may sweep
 *   (empty slot space or a frame band's body: never a task, a handle, a routine)
 * @param {boolean} [o.enabled]  false on touch devices
 * The column, given at the press: `{ dateStr, minuteAt(clientY), min, max }`,
 * `min`..`max` its window in minutes, which the range never leaves.
 */
export function useTimelineSweep({ canStart, enabled = true }) {
  const cleanup = useRef(null);
  useEffect(() => () => cleanup.current?.(), []);

  return (e, { dateStr, minuteAt, min = 0, max = 1440 }) => {
    if (!enabled || e.button !== 0 || !canStart(e.target)) return;
    bindDocument();
    const y0 = e.clientY;
    const anchor = minuteAt(y0);
    let dragging = false;
    const prevUserSelect = document.body?.style?.userSelect;

    const move = (ev) => {
      if (!dragging && Math.abs(ev.clientY - y0) < DRAG_THRESHOLD_PX) return;
      if (!dragging) {
        dragging = true;
        if (document.body) document.body.style.userSelect = 'none';
      }
      window.getSelection?.()?.removeAllRanges?.();
      setTimelineSelection({ dateStr, ...rangeBetween(anchor, minuteAt(ev.clientY), { min, max }), dragging: true });
    };
    const done = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      if (document.body) document.body.style.userSelect = prevUserSelect || '';
      cleanup.current = null;
    };
    const up = () => {
      done();
      if (!dragging) return;
      swallowClick = true; // the click this mouseup makes is the drag's end
      if (selection) setTimelineSelection({ ...selection, dragging: false });
    };
    cleanup.current?.();
    cleanup.current = done;
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  };
}

/** For tests: forget everything. */
export function resetTimelineSelectionForTests() {
  selection = null;
  swallowClick = false;
  docBound = false;
  listeners.clear();
}
