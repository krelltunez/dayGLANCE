import { describe, it, expect } from 'vitest';
import { mergeSubtaskCompletions, withMergedSubtaskCompletions, stampSubtaskCompletionDates, sameSubtaskCompletions } from '../src/recurringExceptions.js';

// Which subtasks were ticked on which occurrence of a series, merged per date
// by their own stamps, as the occurrence edits are.

const T = (m) => `2026-11-10T10:${String(m).padStart(2, '0')}:00.000Z`;
const row = (lastModified, subtaskCompletions, subtaskCompletionsTimestamps) => ({
  id: 'r1', lastModified, ...(subtaskCompletions ? { subtaskCompletions } : {}), ...(subtaskCompletionsTimestamps ? { subtaskCompletionsTimestamps } : {}),
});

describe('mergeSubtaskCompletions', () => {
  it('each date by its newer stamp, whichever row is newer', () => {
    const a = row(T(5), { '2026-11-10': ['w'] }, { '2026-11-10': T(1) });
    const b = row(T(9), { '2026-11-11': ['l'] }, { '2026-11-11': T(2) });
    expect(mergeSubtaskCompletions(a, b)).toEqual({
      subtaskCompletions: { '2026-11-10': ['w'], '2026-11-11': ['l'] },
      subtaskCompletionsTimestamps: { '2026-11-10': T(1), '2026-11-11': T(2) },
    });
  });

  it('an untick (a stamp with no ticks) wins over an older copy that still has them', () => {
    const unticked = row(T(1), {}, { '2026-11-10': T(8) });
    const older = row(T(9), { '2026-11-10': ['w'] }, { '2026-11-10': T(3) });
    expect(mergeSubtaskCompletions(unticked, older).subtaskCompletions).toEqual({});
  });

  it('is order-independent and idempotent', () => {
    const a = row(T(5), { '2026-11-10': ['w'], '2026-11-12': ['x'] }, { '2026-11-10': T(1), '2026-11-12': T(6) });
    const b = row(T(9), { '2026-11-10': ['l'], '2026-11-11': ['l'] }, { '2026-11-10': T(4) });
    const ab = withMergedSubtaskCompletions({ ...b }, a, b);
    const ba = withMergedSubtaskCompletions({ ...b }, b, a);
    expect(sameSubtaskCompletions(ab, ba)).toBe(true);
    expect(sameSubtaskCompletions(withMergedSubtaskCompletions({ ...ab }, ab, ab), ab)).toBe(true);
  });

  it('without stamps, the row winner\'s ticks stand, as before', () => {
    const a = row(T(5), { '2026-11-10': ['w'] });
    const b = row(T(9), { '2026-11-10': ['l'] });
    expect(mergeSubtaskCompletions(a, b).subtaskCompletions).toEqual({ '2026-11-10': ['l'] });
  });

  it('a series with no ticks on either side gets no map at all', () => {
    const merged = withMergedSubtaskCompletions({ id: 'r1' }, row(T(1)), row(T(2)));
    expect(merged).not.toHaveProperty('subtaskCompletions');
    expect(merged).not.toHaveProperty('subtaskCompletionsTimestamps');
  });
});

describe('stampSubtaskCompletionDates', () => {
  it('stamps the dates whose ticks changed against the stored copy, and nothing when none did', () => {
    const before = row(T(0), { '2026-11-10': ['l', 'w'] });
    const after = { ...before, subtaskCompletions: { '2026-11-10': ['l', 'w'], '2026-11-11': ['w'] } };
    expect(stampSubtaskCompletionDates(after, before, T(7)).subtaskCompletionsTimestamps).toEqual({ '2026-11-11': T(7) });
    expect(stampSubtaskCompletionDates(before, before, T(7))).toBe(before);
  });
});
