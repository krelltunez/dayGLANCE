import { describe, it, expect, vi } from 'vitest';
import { beginLongPressReorder, LONG_PRESS_MS, LONG_PRESS_CANCEL_PX } from './longPressReorder.js';

// A document stand-in: listeners by type, an elementFromPoint the test
// controls, and a counter so listener leaks show up.
function fakeDoc() {
  const listeners = new Map();
  const doc = {
    hit: null,
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn);
    },
    dispatch(type, ev = {}) {
      const e = { cancelable: true, preventDefault: vi.fn(), ...ev };
      for (const fn of [...(listeners.get(type) || [])]) fn(e);
      return e;
    },
    elementFromPoint: () => doc.hit,
    listenerCount: () => [...listeners.values()].reduce((n, s) => n + s.size, 0),
  };
  return doc;
}

const row = (idx) => ({
  closest: (sel) => (sel === '[data-drag-idx]' ? row.el(idx) : null),
});
row.el = (idx) => ({ getAttribute: () => String(idx) });

const touchAt = (x, y) => ({ touches: [{ clientX: x, clientY: y }] });

function start(doc, idx, cbs = {}, extra = {}) {
  const timers = [];
  const setTimeoutFn = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
  const clearTimeoutFn = (id) => { timers[id - 1].cleared = true; };
  const haptic = vi.fn();
  const cancel = beginLongPressReorder(touchAt(10, 10), {
    idx, doc, setTimeoutFn, clearTimeoutFn, haptic, ...cbs, ...extra,
  });
  const fire = () => { const t = timers[0]; if (t && !t.cleared) t.fn(); };
  return { timers, fire, haptic, cancel };
}

describe('beginLongPressReorder', () => {
  it('holds for LONG_PRESS_MS, then owns the gesture: moves prevented, rows hit-tested, click suppressed', () => {
    const doc = fakeDoc();
    const onActivate = vi.fn(); const onOver = vi.fn(); const onEnd = vi.fn();
    const { timers, fire, haptic } = start(doc, 2, { onActivate, onOver, onEnd });
    expect(timers[0].ms).toBe(LONG_PRESS_MS);

    // Before the hold completes nothing is prevented (a swipe scrolls).
    const early = doc.dispatch('touchmove', touchAt(12, 12));
    expect(early.preventDefault).not.toHaveBeenCalled();

    fire();
    expect(onActivate).toHaveBeenCalledWith(2);
    expect(haptic).toHaveBeenCalledWith('heavy');

    doc.hit = row(0);
    const mv = doc.dispatch('touchmove', touchAt(12, -40));
    expect(mv.preventDefault).toHaveBeenCalled();
    expect(onOver).toHaveBeenCalledWith(0);
    // Same row again is not re-reported.
    doc.dispatch('touchmove', touchAt(12, -42));
    expect(onOver).toHaveBeenCalledTimes(1);

    const end = doc.dispatch('touchend');
    expect(end.preventDefault).toHaveBeenCalled();
    expect(onEnd).toHaveBeenCalledWith({ activated: true, fromIdx: 2, overIdx: 0 });
    expect(doc.listenerCount()).toBe(0);
  });

  it('a finger that moves past the cancel radius before the hold is a scroll: timer cleared, no callbacks, listeners gone', () => {
    const doc = fakeDoc();
    const onActivate = vi.fn(); const onEnd = vi.fn();
    const { timers, fire } = start(doc, 1, { onActivate, onEnd });
    doc.dispatch('touchmove', touchAt(10, 10 + LONG_PRESS_CANCEL_PX + 1));
    expect(timers[0].cleared).toBe(true);
    fire();
    expect(onActivate).not.toHaveBeenCalled();
    expect(onEnd).not.toHaveBeenCalled();
    expect(doc.listenerCount()).toBe(0);
  });

  it('a tap (release before the hold) reports activated:false and does not prevent the click', () => {
    const doc = fakeDoc();
    const onEnd = vi.fn();
    start(doc, 1, { onEnd });
    const end = doc.dispatch('touchend');
    expect(end.preventDefault).not.toHaveBeenCalled();
    expect(onEnd).toHaveBeenCalledWith({ activated: false, fromIdx: 1, overIdx: null });
    expect(doc.listenerCount()).toBe(0);
  });

  it('suppresses the browser drag and context menu for the duration of the gesture', () => {
    const doc = fakeDoc();
    start(doc, 0);
    expect(doc.dispatch('dragstart').preventDefault).toHaveBeenCalled();
    expect(doc.dispatch('contextmenu').preventDefault).toHaveBeenCalled();
    doc.dispatch('touchend');
    expect(doc.dispatch('dragstart').preventDefault).not.toHaveBeenCalled();
  });

  it('touchcancel after activation ends with no target so the caller resets its highlight', () => {
    const doc = fakeDoc();
    const onEnd = vi.fn();
    const { fire } = start(doc, 3, { onEnd });
    fire();
    doc.hit = row(1);
    doc.dispatch('touchmove', touchAt(10, 60));
    doc.dispatch('touchcancel');
    expect(onEnd).toHaveBeenCalledWith({ activated: true, fromIdx: 3, overIdx: null });
    expect(doc.listenerCount()).toBe(0);
  });

  it('ignores multi-touch starts and returns a no-op cancel', () => {
    const doc = fakeDoc();
    const cancel = beginLongPressReorder(
      { touches: [{ clientX: 0, clientY: 0 }, { clientX: 5, clientY: 5 }] },
      { idx: 0, doc },
    );
    expect(doc.listenerCount()).toBe(0);
    expect(() => cancel()).not.toThrow();
  });

  it('the returned cancel tears down without an onEnd', () => {
    const doc = fakeDoc();
    const onEnd = vi.fn();
    const { cancel } = start(doc, 0, { onEnd });
    cancel();
    expect(doc.listenerCount()).toBe(0);
    expect(onEnd).not.toHaveBeenCalled();
  });
});
