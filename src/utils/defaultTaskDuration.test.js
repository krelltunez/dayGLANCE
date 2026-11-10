import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TASK_DURATION_KEY, DEFAULT_TASK_DURATION_OPTIONS, FALLBACK_TASK_DURATION,
  readDefaultTaskDuration, writeDefaultTaskDuration,
} from './defaultTaskDuration.js';

const memory = (init = {}) => {
  const rows = new Map(Object.entries(init));
  return {
    rows,
    getItem: (k) => (rows.has(k) ? rows.get(k) : null),
    setItem: (k, v) => { rows.set(k, String(v)); },
    removeItem: (k) => { rows.delete(k); },
  };
};

describe('the default task duration (#2367)', () => {
  it('is 30 minutes until one is chosen', () => {
    expect(FALLBACK_TASK_DURATION).toBe(30);
    expect(readDefaultTaskDuration(memory())).toBe(30);
  });

  it('is a per-device setting, captured by local backups (the day-planner- prefix)', () => {
    expect(DEFAULT_TASK_DURATION_KEY.startsWith('day-planner-')).toBe(true);
  });

  it('reads back what was saved, for every offered length', () => {
    for (const m of DEFAULT_TASK_DURATION_OPTIONS) {
      const s = memory();
      expect(writeDefaultTaskDuration(m, s)).toBe(m);
      expect(readDefaultTaskDuration(s)).toBe(m);
    }
  });

  it('30 needs no row: saving it clears the key', () => {
    const s = memory({ [DEFAULT_TASK_DURATION_KEY]: '60' });
    writeDefaultTaskDuration(30, s);
    expect(s.rows.has(DEFAULT_TASK_DURATION_KEY)).toBe(false);
  });

  it('anything that is not an offered length reads, and saves, as 30', () => {
    for (const raw of ['', 'abc', '0', '-15', '7', '1440', 'null']) {
      expect(readDefaultTaskDuration(memory({ [DEFAULT_TASK_DURATION_KEY]: raw }))).toBe(30);
    }
    const s = memory();
    expect(writeDefaultTaskDuration(7, s)).toBe(30);
    expect(s.rows.has(DEFAULT_TASK_DURATION_KEY)).toBe(false);
  });

  it('storage that throws or is missing is 30, and a save still answers', () => {
    const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); }, removeItem: () => { throw new Error('denied'); } };
    expect(readDefaultTaskDuration(broken)).toBe(30);
    expect(writeDefaultTaskDuration(60, broken)).toBe(60);
    expect(readDefaultTaskDuration(undefined)).toBe(30);
  });
});
