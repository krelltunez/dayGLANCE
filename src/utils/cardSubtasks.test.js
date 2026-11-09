import { describe, it, expect } from 'vitest';
import {
  cardSubtaskLayout, desktopCardReservedPx, mobileCardReservedPx, readShowCardSubtasks, CARD_SUBTASKS_KEY, SUBTASK_ROW_PX,
} from './cardSubtasks.js';

// Subtasks on timeline cards: how many fit, and the device setting.

const subtasks = (n) => Array.from({ length: n }, (_, i) => ({ id: `s${i}`, title: `Step ${i + 1}`, completed: false }));
// Room for exactly `rows` rows under `reserved` px of other rows (4px is the list's margin).
const heightFor = (rows, reserved = 30) => reserved + 4 + rows * SUBTASK_ROW_PX;

describe('cardSubtaskLayout', () => {
  it('shows them all when they fit', () => {
    const r = cardSubtaskLayout({ height: heightFor(3), reservedPx: 30, subtasks: subtasks(3) });
    expect(r.shown.map((s) => s.id)).toEqual(['s0', 's1', 's2']);
    expect(r).toMatchObject({ more: 0, rows: 3 });
  });

  it('when they do not, the last row that fits says how many more', () => {
    const r = cardSubtaskLayout({ height: heightFor(3), reservedPx: 30, subtasks: subtasks(5) });
    expect(r.shown.map((s) => s.id)).toEqual(['s0', 's1']);
    expect(r).toMatchObject({ more: 3, rows: 3 });
  });

  it('with room for one row and more than one subtask, that row is the count alone', () => {
    expect(cardSubtaskLayout({ height: heightFor(1), reservedPx: 30, subtasks: subtasks(4) })).toMatchObject({ shown: [], more: 4, rows: 1 });
  });

  it('nothing on a card without room for a row, or without subtasks', () => {
    expect(cardSubtaskLayout({ height: heightFor(1) - 1, reservedPx: 30, subtasks: subtasks(2) }).rows).toBe(0);
    expect(cardSubtaskLayout({ height: 400, reservedPx: 30, subtasks: [] }).rows).toBe(0);
    expect(cardSubtaskLayout({ height: 400, reservedPx: 30 }).rows).toBe(0);
  });

  it('keeps the task\'s own order, done ones included, and skips untitled rows', () => {
    const list = [{ id: 'a', title: 'A', completed: true }, { id: 'b', title: '  ' }, { id: 'c', title: 'C' }];
    expect(cardSubtaskLayout({ height: 400, reservedPx: 30, subtasks: list }).shown.map((s) => s.id)).toEqual(['a', 'c']);
  });
});

describe('what the other rows take', () => {
  it('desktop: the meta row and the time row (from 55px) when present', () => {
    expect(desktopCardReservedPx({ height: 50, hasMetaRow: false })).toBe(30);
    expect(desktopCardReservedPx({ height: 120, hasMetaRow: false })).toBe(48);
    expect(desktopCardReservedPx({ height: 120, hasMetaRow: true })).toBe(66);
  });

  it('phone: the project row carries the time, else the time row alone', () => {
    expect(mobileCardReservedPx({ height: 50, hasProjectRow: false })).toBe(30);
    expect(mobileCardReservedPx({ height: 120, hasProjectRow: false })).toBe(48);
    expect(mobileCardReservedPx({ height: 120, hasProjectRow: true })).toBe(50);
  });
});

describe('readShowCardSubtasks', () => {
  const storage = (value) => ({ getItem: (k) => (k === CARD_SUBTASKS_KEY ? value : null) });
  it('is on unless it was turned off', () => {
    expect(readShowCardSubtasks(storage(null))).toBe(true);
    expect(readShowCardSubtasks(storage('true'))).toBe(true);
    expect(readShowCardSubtasks(storage('false'))).toBe(false);
    expect(readShowCardSubtasks({ getItem: () => { throw new Error('blocked'); } })).toBe(true);
  });
});
