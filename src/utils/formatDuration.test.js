import { describe, it, expect } from 'vitest';
import { formatDuration, formatTaskDuration } from './formatDuration.js';

// A stub translator that mirrors the real key shapes (public/locales/en/translation.json)
// closely enough to assert which key formatDuration picked, and with what params.
const t = (key, params) => `${key}:${JSON.stringify(params)}`;

describe('formatDuration', () => {
  it('uses the minutes-only key under an hour', () => {
    expect(formatDuration(0, t)).toBe('common.durationMinutes:{"minutes":0}');
    expect(formatDuration(45, t)).toBe('common.durationMinutes:{"minutes":45}');
  });

  it('uses the hours-only key on an exact hour, never rendering "0m"', () => {
    expect(formatDuration(60, t)).toBe('common.durationHours:{"hours":1}');
    expect(formatDuration(180, t)).toBe('common.durationHours:{"hours":3}');
  });

  it('uses the hours+minutes key otherwise', () => {
    expect(formatDuration(135, t)).toBe('common.durationHoursMinutes:{"hours":2,"minutes":15}');
  });

  it('rounds fractional minutes before splitting into hours/minutes', () => {
    // A naive Math.floor(m/60) / Math.round(m%60) split can independently round
    // the remainder up to 60, producing "1h 60m". Rounding the total first avoids it.
    expect(formatDuration(119.6, t)).toBe('common.durationHours:{"hours":2}');
  });

  it('never renders a negative duration', () => {
    expect(formatDuration(-30, t)).toBe('common.durationMinutes:{"minutes":0}');
  });

  it('treats non-numeric input as zero', () => {
    expect(formatDuration(NaN, t)).toBe('common.durationMinutes:{"minutes":0}');
    expect(formatDuration(undefined, t)).toBe('common.durationMinutes:{"minutes":0}');
  });
});

// #2388: a 308-minute task read "308 min" on its timeline card.
describe('formatTaskDuration', () => {
  it('keeps the minute count the cards have always shown under an hour', () => {
    expect(formatTaskDuration(45, t)).toBe('common.minutesShort:{"count":45,"defaultValue":"{{count}} min"}');
    expect(formatTaskDuration(59, t)).toBe('common.minutesShort:{"count":59,"defaultValue":"{{count}} min"}');
  });

  it('reads in hours from an hour up', () => {
    expect(formatTaskDuration(60, t)).toBe('common.durationHours:{"hours":1}');
    expect(formatTaskDuration(308, t)).toBe('common.durationHoursMinutes:{"hours":5,"minutes":8}');
  });

  it('rounds before choosing, so 59.6 minutes is an hour and not "60 min"', () => {
    expect(formatTaskDuration(59.6, t)).toBe('common.durationHours:{"hours":1}');
  });

  it('a missing duration is zero minutes', () => {
    expect(formatTaskDuration(undefined, t)).toBe('common.minutesShort:{"count":0,"defaultValue":"{{count}} min"}');
  });
});
