import { describe, expect, it } from 'vitest';
import { DURATION_PRESETS, durationChoices, durationUntil, endOf, parseDurationInput } from './taskDuration.js';

// #2249: any duration, and an end time, in the task dialogs.
describe('durationChoices', () => {
  it('the presets, with the task\'s own duration among them when it is not one', () => {
    expect(durationChoices(45)).toEqual([...DURATION_PRESETS]);
    expect(durationChoices(75)).toEqual([15, 30, 45, 60, 75, 90, 120, 180, 240]);
    expect(durationChoices(22)[1]).toBe(22);
    expect(durationChoices(600).at(-1)).toBe(600);
  });
  it('nothing odd joins them', () => {
    expect(durationChoices(undefined)).toEqual([...DURATION_PRESETS]);
    expect(durationChoices(0)).toEqual([...DURATION_PRESETS]);
    expect(durationChoices(12.5)).toEqual([...DURATION_PRESETS]);
  });
});

describe('parseDurationInput', () => {
  it.each([
    ['22', 22], [' 22 ', 22], ['1:30', 90], ['0:45', 45], ['90m', 90], ['90 min', 90], ['15 minutes', 15],
    ['1h', 60], ['2 hours', 120], ['1h 30', 90], ['1h30m', 90], ['1h 30 min', 90], ['1.5h', 90], ['1,5h', 90], ['2H', 120],
  ])('%s → %i minutes', (text, minutes) => {
    expect(parseDurationInput(text)).toBe(minutes);
  });
  it.each(['', '  ', '0', 'abc', '1:75', '-5', '5 days', '1h-30'])('%s is not a duration', (text) => {
    expect(parseDurationInput(text)).toBeNull();
  });
  it('a whole day at most', () => {
    expect(parseDurationInput('2000')).toBe(1440);
    expect(parseDurationInput('30h')).toBe(1440);
  });
});

describe('endOf and durationUntil', () => {
  it('the end follows the start and the duration', () => {
    expect(endOf('16:53', 22)).toEqual({ time: '17:15', nextDay: false });
    expect(endOf('09:00', 45)).toEqual({ time: '09:45', nextDay: false });
  });
  it('past midnight is the next day', () => {
    expect(endOf('23:00', 120)).toEqual({ time: '01:00', nextDay: true });
    expect(endOf('23:30', 30)).toEqual({ time: '00:00', nextDay: true });
  });
  it('an end sets the duration; at or before the start, it is the next day (as "11pm-1am" types)', () => {
    expect(durationUntil('16:53', '17:15')).toBe(22);
    expect(durationUntil('23:00', '01:00')).toBe(120);
    expect(durationUntil('09:00', '09:00')).toBe(1440);
  });
  it('the two agree', () => {
    for (const [start, minutes] of [['08:10', 5], ['12:00', 95], ['22:45', 200]]) {
      expect(durationUntil(start, endOf(start, minutes).time)).toBe(minutes);
    }
  });
  it('no start, no end', () => {
    expect(endOf(undefined, 30)).toBeNull();
    expect(durationUntil('', '10:00')).toBeNull();
  });
});
