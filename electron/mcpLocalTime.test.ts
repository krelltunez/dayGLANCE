import { describe, it, expect } from 'vitest';
import {
  isValidWallTime,
  resolveLocalTime,
  validateStartTime,
  validateDurationMinutes,
} from './mcpLocalTime.js';

// §5.3's write-side rule: a start landing in a nonexistent or ambiguous local
// hour is a validation error, never silently resolved. America/Chicago 2026:
// spring forward 2026-03-08 (02:00→03:00 CST→CDT), fall back 2026-11-01
// (02:00→01:00 CDT→CST).

describe('isValidWallTime', () => {
  it('accepts strict 24h HH:MM', () => {
    for (const t of ['00:00', '09:30', '23:59', '13:05']) expect(isValidWallTime(t)).toBe(true);
  });
  it('rejects loose or non-time shapes', () => {
    for (const t of ['9:30', '24:00', '12:60', '12:5', '12:30:00', '12.30', '', undefined, 930]) {
      expect(isValidWallTime(t), String(t)).toBe(false);
    }
  });
});

describe('resolveLocalTime — DST classification', () => {
  const CHI = 'America/Chicago';

  it('classifies the spring-forward gap as nonexistent', () => {
    expect(resolveLocalTime('2026-03-08', '02:00', CHI)).toEqual({ kind: 'nonexistent' });
    expect(resolveLocalTime('2026-03-08', '02:30', CHI)).toEqual({ kind: 'nonexistent' });
    expect(resolveLocalTime('2026-03-08', '02:59', CHI)).toEqual({ kind: 'nonexistent' });
  });

  it('the edges of the gap are unique', () => {
    expect(resolveLocalTime('2026-03-08', '01:59', CHI)).toEqual({ kind: 'unique' });
    expect(resolveLocalTime('2026-03-08', '03:00', CHI)).toEqual({ kind: 'unique' });
  });

  it('classifies the fall-back repeated hour as ambiguous', () => {
    expect(resolveLocalTime('2026-11-01', '01:00', CHI)).toEqual({ kind: 'ambiguous' });
    expect(resolveLocalTime('2026-11-01', '01:30', CHI)).toEqual({ kind: 'ambiguous' });
    expect(resolveLocalTime('2026-11-01', '01:59', CHI)).toEqual({ kind: 'ambiguous' });
  });

  it('the edges of the repeat are unique', () => {
    expect(resolveLocalTime('2026-11-01', '00:59', CHI)).toEqual({ kind: 'unique' });
    expect(resolveLocalTime('2026-11-01', '02:00', CHI)).toEqual({ kind: 'unique' });
  });

  it('ordinary times on transition days and all times on ordinary days are unique', () => {
    expect(resolveLocalTime('2026-03-08', '09:00', CHI)).toEqual({ kind: 'unique' });
    expect(resolveLocalTime('2026-11-01', '13:30', CHI)).toEqual({ kind: 'unique' });
    expect(resolveLocalTime('2026-08-10', '02:30', CHI)).toEqual({ kind: 'unique' });
    expect(resolveLocalTime('2026-08-10', '00:00', 'UTC')).toEqual({ kind: 'unique' });
  });

  it('southern hemisphere: Sydney skips 02:30 on 2026-10-04 and repeats it on 2026-04-05', () => {
    expect(resolveLocalTime('2026-10-04', '02:30', 'Australia/Sydney')).toEqual({ kind: 'nonexistent' });
    expect(resolveLocalTime('2026-04-05', '02:30', 'Australia/Sydney')).toEqual({ kind: 'ambiguous' });
  });

  it('handles a zone with a 30-minute offset (Adelaide) at its 2026-10-04 gap', () => {
    expect(resolveLocalTime('2026-10-04', '02:30', 'Australia/Adelaide')).toEqual({ kind: 'nonexistent' });
    expect(resolveLocalTime('2026-10-04', '03:30', 'Australia/Adelaide')).toEqual({ kind: 'unique' });
  });

  it('a skipped-entirely calendar day is nonexistent at every hour (Kiribati, 1994-12-31)', () => {
    // Pacific/Kiritimati jumped from UTC-10:40-adjacent to UTC+14 across
    // 1994-12-31, so that date never happened there. This pins the candidate
    // check's DATE clause: an instant showing the right wall TIME on the
    // wrong DATE must not count as an occurrence.
    expect(resolveLocalTime('1994-12-31', '12:00', 'Pacific/Kiritimati')).toEqual({ kind: 'nonexistent' });
  });
});

describe('validateStartTime', () => {
  it('null for a normal time; names the failure otherwise', () => {
    expect(validateStartTime('2026-08-10', '09:00', 'America/Chicago')).toBeNull();
    expect(validateStartTime('2026-03-08', '02:30', 'America/Chicago')).toContain('does not exist');
    expect(validateStartTime('2026-11-01', '01:30', 'America/Chicago')).toContain('occurs twice');
    expect(validateStartTime('2026-08-10', '9:00', 'America/Chicago')).toContain('HH:MM');
  });
});

describe('validateDurationMinutes', () => {
  it('accepts 1..1440 integers', () => {
    expect(validateDurationMinutes(1)).toBeNull();
    expect(validateDurationMinutes(60)).toBeNull();
    expect(validateDurationMinutes(1440)).toBeNull();
  });
  it('rejects zero, negatives, fractions, overflows, and non-numbers', () => {
    for (const v of [0, -30, 2.5, 1441, '60', null, undefined, NaN]) {
      expect(validateDurationMinutes(v), String(v)).not.toBeNull();
    }
  });
});
