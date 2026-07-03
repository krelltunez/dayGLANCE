import { describe, it, expect } from 'vitest';
import { resetRoutineCompletionsForToday, startOfTodayIso } from './useRoutines.js';

const TODAY = '2026-07-03';
const MIDNIGHT = '2026-07-03T00:00:00.000Z'; // local-midnight stand-in for the tests
const YESTERDAY = '2026-07-02';
const YESTERDAY_TS = '2026-07-02T21:00:00.000Z';
const TODAY_MORNING_TS = '2026-07-03T09:00:00.000Z';

describe('resetRoutineCompletionsForToday', () => {
  it("drops a prior-day completion and stamps a midnight tombstone (the added-already-completed bug)", () => {
    const { completions, timestamps } = resetRoutineCompletionsForToday(
      { chip1: YESTERDAY }, { chip1: YESTERDAY_TS }, TODAY, MIDNIGHT,
    );
    // Completion cleared for the new day...
    expect(completions.chip1).toBeUndefined();
    // ...but a tombstone timestamp remains, and it out-dates the stale completion.
    expect(timestamps.chip1).toBe(MIDNIGHT);
    expect(new Date(timestamps.chip1).getTime()).toBeGreaterThan(new Date(YESTERDAY_TS).getTime());
  });

  it("keeps a genuine completion made today, with its real timestamp", () => {
    const { completions, timestamps } = resetRoutineCompletionsForToday(
      { chip1: TODAY }, { chip1: TODAY_MORNING_TS }, TODAY, MIDNIGHT,
    );
    expect(completions.chip1).toBe(TODAY);
    expect(timestamps.chip1).toBe(TODAY_MORNING_TS);
  });

  it("tombstone does not clobber a completion made earlier today on another device", () => {
    // Local device has only yesterday's data (was closed overnight); it emits a
    // midnight tombstone. A completion made today at 09:00 (on another device)
    // has a later timestamp, so it must still win the LWW merge.
    const { timestamps } = resetRoutineCompletionsForToday(
      { chip1: YESTERDAY }, { chip1: YESTERDAY_TS }, TODAY, MIDNIGHT,
    );
    expect(new Date(TODAY_MORNING_TS).getTime()).toBeGreaterThan(new Date(timestamps.chip1).getTime());
  });

  it("resets a prior-day completion that has no timestamp (legacy data)", () => {
    const { completions, timestamps } = resetRoutineCompletionsForToday(
      { chip1: YESTERDAY }, {}, TODAY, MIDNIGHT,
    );
    expect(completions.chip1).toBeUndefined();
    expect(timestamps.chip1).toBe(MIDNIGHT);
  });

  it("handles empty maps", () => {
    expect(resetRoutineCompletionsForToday({}, {}, TODAY, MIDNIGHT)).toEqual({ completions: {}, timestamps: {} });
  });
});

describe('startOfTodayIso', () => {
  it('returns local midnight of the given day', () => {
    const iso = startOfTodayIso(new Date('2026-07-03T14:30:00'));
    const d = new Date(iso);
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
    expect(d.getSeconds()).toBe(0);
    expect(d.getMilliseconds()).toBe(0);
  });
});
