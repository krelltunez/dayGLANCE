import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// #2346: while a task is held, the wheel scrolls the timeline, and the edge
// bands scroll it at a speed set by how deep the cursor is in them. Run
// through the real hook, with React's state, refs and effects stood in for
// (as useDragDrop.dropZones.test.js does), effects re-run when their deps change.

const stateCells = [];
const refCells = [];
const effects = [];
let cursor = { state: 0, ref: 0, effect: 0 };
vi.mock('react', () => ({
  useEffect: (fn, deps) => {
    const i = cursor.effect++;
    const prev = effects[i];
    const changed = !prev || !deps || deps.length !== prev.deps.length || deps.some((d, k) => !Object.is(d, prev.deps[k]));
    if (!changed) return;
    prev?.cleanup?.();
    effects[i] = { deps: deps || [], cleanup: fn() };
  },
  useState: (init) => {
    const i = cursor.state++;
    if (!(i in stateCells)) stateCells[i] = typeof init === 'function' ? init() : init;
    return [stateCells[i], (v) => { stateCells[i] = typeof v === 'function' ? v(stateCells[i]) : v; }];
  },
  useRef: (init) => {
    const i = cursor.ref++;
    if (!(i in refCells)) refCells[i] = { current: init };
    return refCells[i];
  },
}));

globalThis.document = globalThis.document || {};
globalThis.document.addEventListener = globalThis.document.addEventListener || (() => {});
globalThis.document.removeEventListener = globalThis.document.removeEventListener || (() => {});
globalThis.window = globalThis.window || {};
globalThis.window.addEventListener = globalThis.window.addEventListener || (() => {});
globalThis.window.removeEventListener = globalThis.window.removeEventListener || (() => {});

const { default: useDragDrop } = await import('./useDragDrop.js');

// The MULTI scroller: 800 px tall on screen from y=100, 2000 px of timeline.
function scroller() {
  const listeners = {};
  return {
    scrollTop: 600, scrollHeight: 2800, clientHeight: 800,
    getBoundingClientRect: () => ({ top: 100, bottom: 900 }),
    addEventListener: (type, fn, opts) => { listeners[type] = { fn, opts }; },
    removeEventListener: (type, fn) => { if (listeners[type]?.fn === fn) delete listeners[type]; },
    listeners,
  };
}

let el;
const calendarRef = { current: null };
const useRender = () => {
  cursor = { state: 0, ref: 0, effect: 0 };
  return useDragDrop({ setExpandedNotesTaskId: () => {}, calendarRef });
};
const useStartDrag = () => {
  useRender().handleDragStart({ id: 't', duration: 30 }, 'timeline', { dataTransfer: {}, currentTarget: null });
  return useRender();
};
const wheel = (over = {}) => ({ deltaY: 100, deltaMode: 0, ctrlKey: false, metaKey: false, preventDefault: vi.fn(), ...over });

beforeEach(() => {
  stateCells.length = 0; refCells.length = 0; effects.length = 0;
  el = scroller();
  calendarRef.current = el;
  vi.useFakeTimers();
});
afterEach(() => { vi.useRealTimers(); });

describe('scrolling the timeline while a task is dragged', () => {
  it('the wheel scrolls it only while a task is held, and is taken from the browser', () => {
    useRender();
    expect(el.listeners.wheel).toBeUndefined();
    useStartDrag();
    expect(el.listeners.wheel.opts).toEqual({ passive: false });
    const e = wheel();
    el.listeners.wheel.fn(e);
    expect(el.scrollTop).toBe(700);
    expect(e.preventDefault).toHaveBeenCalled();
    el.listeners.wheel.fn(wheel({ deltaY: -5000 }));
    expect(el.scrollTop).toBe(0);
    useRender().handleDragEnd();
    useRender();
    expect(el.listeners.wheel).toBeUndefined();
  });

  it('leaves Ctrl/Cmd + wheel to the timeline zoom', () => {
    useStartDrag();
    const e = wheel({ ctrlKey: true });
    el.listeners.wheel.fn(e);
    expect(el.scrollTop).toBe(600);
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it('the top band scrolls faster the deeper the cursor is in it', () => {
    const dd = useStartDrag();
    dd.updateDragAutoScroll({ clientY: 170 }); // near the band's inner edge
    vi.advanceTimersByTime(160);
    const slow = 600 - el.scrollTop;
    el.scrollTop = 600;
    dd.updateDragAutoScroll({ clientY: 102 }); // at the edge
    vi.advanceTimersByTime(160);
    const fast = 600 - el.scrollTop;
    expect(slow).toBeGreaterThan(0);
    expect(fast).toBeGreaterThan(slow * 3);
    dd.updateDragAutoScroll({ clientY: 500 });
    const still = el.scrollTop;
    vi.advanceTimersByTime(160);
    expect(el.scrollTop).toBe(still);
  });
});
