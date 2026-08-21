import { describe, it, expect } from 'vitest';
import { nextPerUserCalendarEntry } from './perUserCalendarEntry.js';

const NOW = '2026-08-20T12:00:00.000Z';
const CAL2 = { id: 'ics-1', name: 'Beta', url: 'https://dav.example.com/beta', color: 'bg-blue-600', enabled: true };
const STUB = { id: 'primary', name: '', color: 'bg-gray-600', enabled: true };

const entry = (over = {}) => ({
  syncUrl: 'https://dav.example.com/primary',
  taskCalendarUrl: '',
  icsCalendars: [STUB, CAL2],
  updatedAt: '2026-08-19T00:00:00.000Z',
  ...over,
});

describe('nextPerUserCalendarEntry', () => {
  it('writes a changed config with the new timestamp', () => {
    const cur = entry({ icsCalendars: [STUB] });
    const desired = { syncUrl: cur.syncUrl, taskCalendarUrl: '', icsCalendars: [STUB, CAL2] };
    expect(nextPerUserCalendarEntry(cur, desired, NOW)).toEqual({ ...desired, updatedAt: NOW });
  });

  it('writes a first entry when the device has real config', () => {
    const desired = { syncUrl: 'https://dav.example.com/primary', taskCalendarUrl: '', icsCalendars: [] };
    expect(nextPerUserCalendarEntry(undefined, desired, NOW)).toEqual({ ...desired, updatedAt: NOW });
  });

  // Restamping equal content would advance updatedAt and let stale content
  // win LWW against a genuinely newer entry from another device.
  it('does not restamp when the content is unchanged', () => {
    const cur = entry();
    const desired = { syncUrl: cur.syncUrl, taskCalendarUrl: '', icsCalendars: [STUB, CAL2] };
    expect(nextPerUserCalendarEntry(cur, desired, NOW)).toBeNull();
    // absent auth on both sides is the same content
    expect(nextPerUserCalendarEntry({ ...cur, auth: undefined }, desired, NOW)).toBeNull();
  });

  // The fresh-install clobber: a device with no entry and nothing configured
  // must stay silent, or its brand-new updatedAt wipes the fleet's calendars.
  it('never seeds an empty entry on a device with no stored entry', () => {
    const desired = { syncUrl: '', taskCalendarUrl: '', icsCalendars: [] };
    expect(nextPerUserCalendarEntry(undefined, desired, NOW)).toBeNull();
    expect(nextPerUserCalendarEntry(null, desired, NOW)).toBeNull();
  });

  it('still writes an intentional clear once an entry exists', () => {
    const cur = entry();
    const desired = { syncUrl: '', taskCalendarUrl: '', icsCalendars: [] };
    expect(nextPerUserCalendarEntry(cur, desired, NOW)).toEqual({ ...desired, updatedAt: NOW });
  });

  it('treats auth changes as content changes', () => {
    const cur = entry();
    const desired = {
      syncUrl: cur.syncUrl, taskCalendarUrl: '', icsCalendars: [STUB, CAL2],
      auth: { username: 'u', appPassword: 'p' },
    };
    expect(nextPerUserCalendarEntry(cur, desired, NOW)).toEqual({ ...desired, updatedAt: NOW });
  });
});
