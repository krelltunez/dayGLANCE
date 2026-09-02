import { describe, it, expect } from 'vitest';
import { buildCalendarProjection, calendarProjectionHash, isProjectedCalendarEvent } from './obsidianCalendarProjection.js';

// The projection carries EXACTLY the classes the sync payload excludes
// (payloadExclusions.keepImportedTask + _native), inside the sidebar window.

const feed = (over = {}) => ({ id: 'uid-1-2026-09-03', title: 'Dentist', date: '2026-09-03', startTime: '10:00', duration: 30, imported: true, importSource: 'sync', isTaskCalendar: false, color: 'bg-gray-600', ...over });

describe('isProjectedCalendarEvent', () => {
  it('projects subscription events and native rows; not task-calendar to-dos, ICS file imports, or ordinary tasks', () => {
    expect(isProjectedCalendarEvent(feed())).toBe(true);
    expect(isProjectedCalendarEvent({ id: 'n', date: '2026-09-03', title: 'Standup', _native: true, imported: true })).toBe(true);
    expect(isProjectedCalendarEvent(feed({ isTaskCalendar: true }))).toBe(false);
    expect(isProjectedCalendarEvent(feed({ importSource: 'file' }))).toBe(false);
    expect(isProjectedCalendarEvent({ id: 't', date: '2026-09-03', title: 'Write report' })).toBe(false);
    expect(isProjectedCalendarEvent(feed({ date: undefined }))).toBe(false);
  });
  it('in multi-user mode, every subscription-derived item is projected (it is excluded from sync there)', () => {
    expect(isProjectedCalendarEvent(feed({ isTaskCalendar: true }), { multiUserEnabled: true })).toBe(true);
  });
});

describe('buildCalendarProjection', () => {
  it('windows to ±35 days, keeps the display fields only, sorts by date then id, and stamps the device and time', () => {
    const now = new Date('2026-09-02T16:00:00Z');
    const payload = buildCalendarProjection([
      feed({ id: 'b', date: '2026-09-03' }),
      feed({ id: 'a', date: '2026-09-03', notes: 'private', icalUid: 'x' }),
      feed({ id: 'far', date: '2026-10-20' }),
      feed({ id: 'past', date: '2026-07-01' }),
      { id: 'n', date: '2026-09-02', title: 'Standup', _native: true, imported: true, isAllDay: false, startTime: '09:00', duration: 15, nativeCalendarColor: '#ff0000', calendarName: 'Work' },
      { id: 'plain', date: '2026-09-02', title: 'Mine' },
    ], { today: '2026-09-02', deviceId: 'dev-1', now });
    expect(payload).toMatchObject({ v: 1, kind: 'projection', type: 'calendar', deviceId: 'dev-1', from: '2026-07-29', to: '2026-10-07', publishedAt: '2026-09-02T16:00:00.000Z' });
    expect(payload.events.map((e) => e.id)).toEqual(['n', 'a', 'b']);
    expect(payload.events[1]).toEqual({ id: 'a', title: 'Dentist', date: '2026-09-03', startTime: '10:00', duration: 30, isAllDay: false, color: 'bg-gray-600', completed: false });
    expect(payload.events[0]).toMatchObject({ color: '#ff0000', calendarName: 'Work' });
  });

  it('carries the publishing device\'s user when given, and omits the field when single-user', () => {
    const withUser = buildCalendarProjection([feed()], { today: '2026-09-02', deviceId: 'd', userSyncId: 'u-me' });
    expect(withUser.userSyncId).toBe('u-me');
    const single = buildCalendarProjection([feed()], { today: '2026-09-02', deviceId: 'd', userSyncId: null });
    expect('userSyncId' in single).toBe(false);
    // A viewer change is a content change: the projection republishes.
    expect(calendarProjectionHash(withUser)).not.toBe(calendarProjectionHash(single));
  });

  it('hash ignores the publish stamp so an unchanged projection is not republished', () => {
    const a = buildCalendarProjection([feed()], { today: '2026-09-02', deviceId: 'd', now: new Date('2026-09-02T10:00:00Z') });
    const b = buildCalendarProjection([feed()], { today: '2026-09-02', deviceId: 'd', now: new Date('2026-09-02T11:00:00Z') });
    const c = buildCalendarProjection([feed({ title: 'Dentist (moved)' })], { today: '2026-09-02', deviceId: 'd' });
    expect(calendarProjectionHash(a)).toBe(calendarProjectionHash(b));
    expect(calendarProjectionHash(a)).not.toBe(calendarProjectionHash(c));
    // A new day slides the window, so the hash changes and the row republishes.
    const d = buildCalendarProjection([feed()], { today: '2026-09-03', deviceId: 'd' });
    expect(calendarProjectionHash(a)).not.toBe(calendarProjectionHash(d));
  });
});
