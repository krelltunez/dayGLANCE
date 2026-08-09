import { describe, it, expect } from 'vitest';
import { isValidLocalDate, localDateOf, dateEnvelope } from './mcpDates.js';

// §5.3 is the correctness core of Phase 2: local calendar dates only, resolved
// server-side, correct across DST boundaries in both directions. These tests
// pin the boundaries with fixed UTC instants so they never depend on the
// machine's own clock or zone.

const utc = (s: string) => Date.parse(s);

describe('isValidLocalDate', () => {
  it('accepts real local calendar dates', () => {
    expect(isValidLocalDate('2026-08-09')).toBe(true);
    expect(isValidLocalDate('2026-01-01')).toBe(true);
    expect(isValidLocalDate('2026-12-31')).toBe(true);
  });

  it('accepts Feb 29 only in leap years (divisible-by-4, century, 400 rules)', () => {
    expect(isValidLocalDate('2028-02-29')).toBe(true);  // ordinary leap year
    expect(isValidLocalDate('2026-02-29')).toBe(false); // not a leap year
    expect(isValidLocalDate('2100-02-29')).toBe(false); // century, not /400
    expect(isValidLocalDate('2000-02-29')).toBe(true);  // /400
    expect(isValidLocalDate('2200-02-29')).toBe(false); // /200 but not /400 — pins the exact rule
  });

  it('rejects dates that do not exist', () => {
    expect(isValidLocalDate('2026-02-30')).toBe(false);
    expect(isValidLocalDate('2026-04-31')).toBe(false);
    expect(isValidLocalDate('2026-13-01')).toBe(false);
    expect(isValidLocalDate('2026-00-10')).toBe(false);
    expect(isValidLocalDate('2026-06-00')).toBe(false);
    expect(isValidLocalDate('2026-06-32')).toBe(false);
  });

  it('rejects anything with a time component, offset, or Z (§5.3: no UTC, no offsets)', () => {
    expect(isValidLocalDate('2026-08-09T00:00:00Z')).toBe(false);
    expect(isValidLocalDate('2026-08-09T12:00')).toBe(false);
    expect(isValidLocalDate('2026-08-09+02:00')).toBe(false);
    expect(isValidLocalDate('2026-08-09 ')).toBe(false);
    expect(isValidLocalDate(' 2026-08-09')).toBe(false);
  });

  it('rejects non-canonical shapes and non-strings', () => {
    expect(isValidLocalDate('2026-8-9')).toBe(false);
    expect(isValidLocalDate('26-08-09')).toBe(false);
    expect(isValidLocalDate('20260809')).toBe(false);
    expect(isValidLocalDate('')).toBe(false);
    expect(isValidLocalDate(undefined)).toBe(false);
    expect(isValidLocalDate(null)).toBe(false);
    expect(isValidLocalDate(20260809)).toBe(false);
    expect(isValidLocalDate(new Date())).toBe(false);
  });

  it('accepts a date whose 2am does not exist — DST shortens hours, never the calendar', () => {
    expect(isValidLocalDate('2026-03-08')).toBe(true); // US spring-forward day
    expect(isValidLocalDate('2026-11-01')).toBe(true); // US fall-back day
  });
});

describe('localDateOf — DST boundaries in both directions', () => {
  // US spring forward: America/Chicago jumps 01:59:59 CST -> 03:00:00 CDT at
  // 2026-03-08T08:00:00Z. The calendar date must not skip or repeat.
  it('spring forward (America/Chicago, 2026-03-08)', () => {
    expect(localDateOf(utc('2026-03-08T07:59:59Z'), 'America/Chicago')).toBe('2026-03-08'); // 01:59:59 CST
    expect(localDateOf(utc('2026-03-08T08:00:00Z'), 'America/Chicago')).toBe('2026-03-08'); // 03:00:00 CDT
    expect(localDateOf(utc('2026-03-08T05:59:59Z'), 'America/Chicago')).toBe('2026-03-07'); // 23:59:59 CST
    expect(localDateOf(utc('2026-03-08T06:00:00Z'), 'America/Chicago')).toBe('2026-03-08'); // midnight CST
    expect(localDateOf(utc('2026-03-09T04:59:59Z'), 'America/Chicago')).toBe('2026-03-08'); // 23:59:59 CDT — day ends an hour earlier in UTC
    expect(localDateOf(utc('2026-03-09T05:00:00Z'), 'America/Chicago')).toBe('2026-03-09');
  });

  // US fall back: 01:59:59 CDT -> 01:00:00 CST at 2026-11-01T07:00:00Z.
  // The 1am hour happens twice; the date stays 2026-11-01 throughout.
  it('fall back (America/Chicago, 2026-11-01)', () => {
    expect(localDateOf(utc('2026-11-01T06:59:59Z'), 'America/Chicago')).toBe('2026-11-01'); // 01:59:59 CDT (first 1am)
    expect(localDateOf(utc('2026-11-01T07:00:00Z'), 'America/Chicago')).toBe('2026-11-01'); // 01:00:00 CST (second 1am)
    expect(localDateOf(utc('2026-11-01T04:59:59Z'), 'America/Chicago')).toBe('2026-10-31'); // 23:59:59 CDT
    expect(localDateOf(utc('2026-11-01T05:00:00Z'), 'America/Chicago')).toBe('2026-11-01'); // midnight CDT
    expect(localDateOf(utc('2026-11-02T05:59:59Z'), 'America/Chicago')).toBe('2026-11-01'); // 23:59:59 CST — day ends an hour later in UTC
    expect(localDateOf(utc('2026-11-02T06:00:00Z'), 'America/Chicago')).toBe('2026-11-02');
  });

  // Southern hemisphere runs the opposite direction on different dates —
  // Australia/Sydney falls back 2026-04-05 and springs forward 2026-10-04.
  it('southern hemisphere (Australia/Sydney)', () => {
    expect(localDateOf(utc('2026-04-04T15:59:59Z'), 'Australia/Sydney')).toBe('2026-04-05'); // 02:59:59 AEDT (first pass)
    expect(localDateOf(utc('2026-04-04T16:00:00Z'), 'Australia/Sydney')).toBe('2026-04-05'); // 02:00:00 AEST
    expect(localDateOf(utc('2026-10-03T15:59:59Z'), 'Australia/Sydney')).toBe('2026-10-04'); // 01:59:59 AEST
    expect(localDateOf(utc('2026-10-03T16:00:00Z'), 'Australia/Sydney')).toBe('2026-10-04'); // 03:00:00 AEDT
  });

  it('the same instant is different calendar dates in different zones', () => {
    const t = utc('2026-08-09T03:00:00Z');
    expect(localDateOf(t, 'America/Chicago')).toBe('2026-08-08'); // 22:00 the day before
    expect(localDateOf(t, 'Asia/Tokyo')).toBe('2026-08-09');      // 12:00 that day
    expect(localDateOf(t, 'UTC')).toBe('2026-08-09');
  });

  it('output is always the strict YYYY-MM-DD shape its own validator accepts', () => {
    for (const tz of ['America/Chicago', 'Asia/Tokyo', 'Pacific/Kiritimati', 'Pacific/Niue']) {
      const d = localDateOf(utc('2026-01-01T11:00:00Z'), tz);
      expect(isValidLocalDate(d)).toBe(true);
    }
  });
});

describe('dateEnvelope', () => {
  it('echoes the resolved date and IANA timezone (§5.3)', () => {
    expect(dateEnvelope('2026-08-09', 'America/Chicago')).toEqual({
      date: '2026-08-09',
      timezone: 'America/Chicago',
    });
  });
});
