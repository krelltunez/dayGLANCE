import React from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, create } from 'react-test-renderer';
import {
  consumeSwallowedClick, getTimelineSelection, resetTimelineSelectionForTests,
  useTimelineSelection, useTimelineSweep,
} from './useTimelineSelection.js';

// #2366: a drag on empty timeline space sweeps a range; the click that ends
// it, or clears it, adds nothing; a press on it keeps it; Escape clears it.

let doc;
beforeEach(() => {
  resetTimelineSelectionForTests();
  const handlers = { capture: {}, bubble: {} };
  doc = {
    handlers,
    body: { style: {} },
    addEventListener: (type, fn, capture) => { ((capture ? handlers.capture : handlers.bubble)[type] ||= new Set()).add(fn); },
    removeEventListener: (type, fn) => { handlers.capture[type]?.delete(fn); handlers.bubble[type]?.delete(fn); },
    fire(type, e, { capture = false } = {}) {
      for (const fn of [...((capture ? handlers.capture : handlers.bubble)[type] || [])]) fn(e);
    },
  };
  globalThis.document = doc;
  globalThis.window = { getSelection: () => ({ removeAllRanges: () => {} }) };
});
afterEach(() => { delete globalThis.document; delete globalThis.window; resetTimelineSelectionForTests(); });

// A target that answers closest() for the attributes it is given.
const target = ({ slot = false, task = false, onRange = false } = {}) => ({
  classList: { contains: (c) => c === 'slot' && slot },
  closest: (sel) => (task && sel.includes('data-task-id')) || (onRange && sel.includes('data-timeline-selection')) || (slot && sel.includes('slot')) ? {} : null,
});

// 1px per minute from 08:00 at y = 0.
const column = { dateStr: '2026-11-11', minuteAt: (y) => 480 + y, min: 480, max: 960 };

function mount({ enabled = true } = {}) {
  let start;
  let seen;
  function Harness() {
    start = useTimelineSweep({ enabled, canStart: (t) => t.classList.contains('slot') && !t.closest('[data-task-id]') });
    seen = useTimelineSelection(column.dateStr, { min: column.min, max: column.max });
    return null;
  }
  act(() => { create(<Harness />); });
  const press = (y, t = target({ slot: true }), button = 0) => {
    act(() => { doc.fire('mousedown', { target: t, button, clientY: y }, { capture: true }); });
    act(() => { start({ target: t, button, clientY: y }, column); });
  };
  const move = (y) => act(() => { doc.fire('mousemove', { clientY: y }); });
  const up = () => act(() => { doc.fire('mouseup', {}); });
  return { press, move, up, seen: () => seen };
}

describe('sweeping a range', () => {
  it('a drag highlights the range, snapped to 15 minutes, and stays once released', () => {
    const p = mount();
    p.press(65); // 09:05
    p.move(140); // 10:20
    expect(p.seen()).toMatchObject({ start: 540, end: 630, dragging: true });
    p.up();
    expect(p.seen()).toMatchObject({ start: 540, end: 630, dragging: false });
  });

  // MUTATION: drop the swallow and the drag's own click opens the new-task form.
  it('the click that ends the drag adds nothing; the next one does', () => {
    const p = mount();
    p.press(65); p.move(140); p.up();
    expect(consumeSwallowedClick()).toBe(true);
    expect(consumeSwallowedClick()).toBe(false);
  });

  it('a press that barely moves is a click, not a drag: nothing is highlighted, and the click adds', () => {
    const p = mount();
    p.press(65); p.move(67); p.up();
    expect(p.seen()).toBeNull();
    expect(consumeSwallowedClick()).toBe(false);
  });

  it('never starts on a task, a handle or a frame\'s edge, and not on a touch device', () => {
    const p = mount();
    p.press(65, target({ slot: true, task: true })); p.move(140); p.up();
    expect(p.seen()).toBeNull();
    const touch = mount({ enabled: false });
    touch.press(65); touch.move(140); touch.up();
    expect(touch.seen()).toBeNull();
  });

  it('stays in its column', () => {
    const p = mount();
    p.press(400); p.move(900); p.up(); // 14:40 dragged past 16:00
    expect(p.seen()).toMatchObject({ start: 870, end: 960 });
  });
});

describe('a highlighted range', () => {
  const swept = () => { const p = mount(); p.press(65); p.move(140); p.up(); consumeSwallowedClick(); return p; };

  it('a press on it keeps it (its click and right click are its own)', () => {
    const p = swept();
    act(() => { doc.fire('mousedown', { target: target({ onRange: true }), button: 0 }, { capture: true }); });
    expect(p.seen()).not.toBeNull();
    expect(consumeSwallowedClick()).toBe(false);
  });

  // MUTATION: keep the swallow off and clearing a range also opens the form.
  it('a left press anywhere else clears it, and that click adds nothing', () => {
    const p = swept();
    act(() => { doc.fire('mousedown', { target: target({ slot: true }), button: 0 }, { capture: true }); });
    expect(p.seen()).toBeNull();
    expect(consumeSwallowedClick()).toBe(true);
  });

  it('a right press elsewhere clears it and leaves that right click to do what it does', () => {
    const p = swept();
    act(() => { doc.fire('mousedown', { target: target({ slot: true }), button: 2 }, { capture: true }); });
    expect(p.seen()).toBeNull();
    expect(consumeSwallowedClick()).toBe(false);
  });

  it('Escape clears it', () => {
    const p = swept();
    act(() => { doc.fire('keydown', { key: 'Escape' }); });
    expect(p.seen()).toBeNull();
    expect(getTimelineSelection()).toBeNull();
  });

  it('a new drag replaces it', () => {
    const p = swept();
    p.press(300); p.move(360); p.up();
    expect(p.seen()).toMatchObject({ start: 780, end: 840 });
  });
});
