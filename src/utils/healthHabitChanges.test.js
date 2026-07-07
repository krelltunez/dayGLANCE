import { describe, it, expect } from 'vitest';
import { changedHealthHabitIds } from './healthHabitChanges.js';

describe('changedHealthHabitIds', () => {
  it('returns EMPTY when every read matches the stored count (idle → no loop)', () => {
    const stored = { '2026-07-07': { steps: 5000, sleep: 420 } };
    const updates = { '2026-07-07': { steps: 5000, sleep: 420 } };
    expect(changedHealthHabitIds(updates, stored).size).toBe(0);
  });

  it('reports only the habit whose count increased', () => {
    const stored = { '2026-07-07': { steps: 5000, sleep: 420 } };
    const updates = { '2026-07-07': { steps: 5200, sleep: 420 } }; // steps up, sleep same
    expect([...changedHealthHabitIds(updates, stored)]).toEqual(['steps']);
  });

  it('does NOT report a downgraded read (Math.max floor — never counts as change)', () => {
    const stored = { '2026-07-07': { steps: 5000 } };
    const updates = { '2026-07-07': { steps: 4999 } }; // health store briefly lower
    expect(changedHealthHabitIds(updates, stored).size).toBe(0);
  });

  it('reports a first-of-day read (no prior value)', () => {
    expect([...changedHealthHabitIds({ '2026-07-07': { steps: 100 } }, {})]).toEqual(['steps']);
  });

  it('considers all days in the window, not just today', () => {
    const stored = { '2026-07-06': { steps: 3000 }, '2026-07-07': { steps: 100 } };
    const updates = { '2026-07-06': { steps: 3500 }, '2026-07-07': { steps: 100 } };
    expect([...changedHealthHabitIds(updates, stored)]).toEqual(['steps']); // 07-06 increased
  });

  it('tolerates empty / missing inputs', () => {
    expect(changedHealthHabitIds({}, {}).size).toBe(0);
    expect(changedHealthHabitIds(undefined, undefined).size).toBe(0);
    expect([...changedHealthHabitIds({ d: { s: 1 } }, undefined)]).toEqual(['s']);
  });
});
