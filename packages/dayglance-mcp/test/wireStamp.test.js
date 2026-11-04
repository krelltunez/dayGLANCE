// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { wireStamp } from '../src/wireStamp.js';

// The suite runs with TZ=UTC (vitest.config.js), so "this machine's clock" is
// UTC here; the zone cases are the ones a host on a UTC server depends on.

describe('wireStamp', () => {
  it('gives the local date and HH:MM, or a null time for a bare date', () => {
    expect(wireStamp('2026-10-19T09:14:59')).toEqual({ date: '2026-10-19', time: '09:14' });
    expect(wireStamp('2026-08-01')).toEqual({ date: '2026-08-01', time: null });
    expect(wireStamp(undefined)).toBeNull();
  });
});

describe("wireStamp in the user's zone (a host whose clock is not the user's)", () => {
  it('reads an instant in the given IANA zone, crossing the date line where the zone does', () => {
    expect(wireStamp('2026-10-21T23:30:00.000Z', 'Pacific/Auckland')).toEqual({ date: '2026-10-22', time: '12:30' });
    expect(wireStamp('2026-10-22T03:00:00.000Z', 'America/Los_Angeles')).toEqual({ date: '2026-10-21', time: '20:00' });
    expect(wireStamp('2026-10-21T09:14:00-05:00', 'America/Chicago')).toEqual({ date: '2026-10-21', time: '09:14' });
  });

  it("without a zone, reads the same instant on this machine's clock, as the app does", () => {
    expect(wireStamp('2026-10-21T23:30:00.000Z')).toEqual({ date: '2026-10-21', time: '23:30' });
  });

  it('leaves a bare date as the calendar day it names, in any zone', () => {
    expect(wireStamp('2026-08-01', 'Pacific/Auckland')).toEqual({ date: '2026-08-01', time: null });
    expect(wireStamp('2026-08-01', 'America/Los_Angeles')).toEqual({ date: '2026-08-01', time: null });
  });

  it('is null for nothing to read, zone or not', () => {
    expect(wireStamp(undefined, 'Pacific/Auckland')).toBeNull();
    expect(wireStamp('soon', 'Pacific/Auckland')).toBeNull();
  });
});
