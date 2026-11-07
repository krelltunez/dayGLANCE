import { describe, it, expect } from 'vitest';
import { focusBlockAt, focusModeAvailableAt } from './focusBlock.js';

// Characterization: the rule App.jsx's focusModeAvailable and
// computeFocusBlockTasks each carried inline before the move.

const t = (id, startTime, duration, extra = {}) => ({ id, title: id, startTime, duration, ...extra });
const at = (hh, mm = 0) => hh * 60 + mm;
const ids = (block) => (block ? block.tasks.map((x) => x.id) : null);

describe('focusBlockAt', () => {
  it('is null when nothing is in progress', () => {
    expect(focusBlockAt([t('a', '09:00', 60)], at(11))).toBeNull();
    expect(focusBlockAt([], at(11))).toBeNull();
    expect(focusBlockAt(undefined, at(11))).toBeNull();
  });

  it('holds the task in progress, from its start to its end', () => {
    expect(focusBlockAt([t('a', '09:00', 60)], at(9, 30))).toEqual({ tasks: [t('a', '09:00', 60)], start: at(9), end: at(10) });
  });

  it('runs on through back-to-back and overlapping tasks, in start order', () => {
    const day = [t('c', '10:30', 30), t('a', '09:00', 60), t('b', '10:00', 30), t('later', '12:00', 30)];
    const block = focusBlockAt(day, at(9, 15));
    expect(ids(block)).toEqual(['a', 'b', 'c']);
    expect(block.end).toBe(at(11));
  });

  it('leaves out completed, all-day and untimed tasks', () => {
    const day = [
      t('a', '09:00', 60),
      t('done', '10:00', 60, { completed: true }),
      t('allday', '09:00', 60, { isAllDay: true }),
      t('untimed', null, 60),
    ];
    const block = focusBlockAt(day, at(9, 30));
    expect(ids(block)).toEqual(['a']);
    expect(block.end).toBe(at(10));
  });

  it('takes a task that started before the block yet overlaps it', () => {
    const day = [t('long', '08:00', 180), t('short', '09:00', 30)];
    expect(ids(focusBlockAt(day, at(9, 10)))).toEqual(['long', 'short']);
  });
});

describe('focusModeAvailableAt', () => {
  it('needs 45 minutes or more left in the block', () => {
    const day = [t('a', '09:00', 60)];
    expect(focusModeAvailableAt(day, at(9, 15))).toBe(true);
    expect(focusModeAvailableAt(day, at(9, 16))).toBe(false);
    expect(focusModeAvailableAt([], at(9))).toBe(false);
  });
});
