import React from 'react';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

// A calendar event's notes open in the app's own notes panel in every view,
// as a task's do: the same editor, formatting and Shift+Enter. The separate
// panel here is only for an event from the device's own calendar in the phone
// app, whose description is edited and written back to that calendar.

let native = false;
vi.mock('../native.js', () => ({ isNativeApp: () => native, nativeUpdateEvent: vi.fn() }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k) => k }) }));
vi.mock('../context/DayPlannerContext.jsx', () => ({ useDayPlannerCtx: () => ({ setTasks: vi.fn(), timeToMinutes: () => 0, minutesToTime: () => '00:00', darkMode: false }) }));
const { default: EventNotesPanel, editsDeviceCalendar, deviceEventNotesWrite } = await import('./EventNotesPanel.jsx');

const event = (over = {}) => ({ id: 'uid-1-2026-09-30', title: 'Busy', date: '2026-09-30', startTime: '13:00', duration: 45, imported: true, notes: 'Room 4B', ...over });

beforeEach(() => { native = false; });

describe('which notes panel an event gets', () => {
  it('a feed event takes the app\'s notes panel, like a task', () => {
    expect(editsDeviceCalendar(event())).toBe(false);
    native = true;
    expect(editsDeviceCalendar(event())).toBe(false);
  });
  it('an event from the device calendar, in the phone app, edits its description there', () => {
    native = true;
    expect(editsDeviceCalendar(event({ nativeEventId: 'dev-1' }))).toBe(true);
  });
  it('the same event on desktop, with no device calendar, takes the app\'s notes panel', () => {
    expect(editsDeviceCalendar(event({ nativeEventId: 'dev-1' }))).toBe(false);
  });

  // MUTATION: gate a mount on `imported` again and that view goes back to a
  // plain field with no formatting or Shift+Enter, and a task-calendar item's
  // note is stored where nothing shows it.
  it.each([
    'TimelineTaskCardContent.jsx', 'AllDayTaskCard.jsx', 'MobileLayout.jsx', 'MobileGlanceSection.jsx',
  ])('%s opens the device panel only for a device-calendar event', (file) => {
    const source = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');
    const mounts = [...source.matchAll(/<EventNotesPanel\b/g)].map((m) => m.index);
    expect(mounts.length).toBeGreaterThan(0);
    // Each mount's own gate is the one decision, not negated, and nothing
    // between that gate and the mount routes on `imported` instead.
    for (const at of mounts) {
      const before = source.slice(Math.max(0, at - 900), at);
      const gate = before.lastIndexOf('editsDeviceCalendar(');
      expect(gate, 'mount without the editsDeviceCalendar gate').toBeGreaterThan(-1);
      expect(before[gate - 1], 'mount behind a negated gate').not.toBe('!');
      expect(before.slice(gate)).not.toMatch(/isImported &&|\.imported &&/);
    }
  });

  // MUTATION: gate a card's own notes panel on `!isImported` again and a
  // calendar event on that card loses the app's notes panel altogether.
  it.each(['TimelineTaskCardContent.jsx', 'AllDayTaskCard.jsx'])('%s gives an event the app\'s notes panel', (file) => {
    const source = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');
    expect(source).toMatch(/expandedNotesTaskId === task\.id && !editsDeviceCalendar\(task\) && \(/);
    expect(source).not.toMatch(/expandedNotesTaskId === task\.id && !isImported/);
  });
});

describe('EventNotesPanel (device calendar)', () => {
  it('edits the event\'s own description, written back to the device calendar', () => {
    native = true;
    const html = renderToStaticMarkup(<EventNotesPanel task={event({ nativeEventId: 'dev-1' })} />);
    expect(html).toContain('data-event-notes="device"');
    expect(html).toMatch(/<textarea[^>]*>Room 4B<\/textarea>/);
  });
});

describe('the description write-back', () => {
  it('sends the event as it stands, with its new notes', () => {
    expect(deviceEventNotesWrite(event({ nativeEventId: 'dev-1', location: 'HQ' }), 'Room 5')).toEqual({
      id: 'dev-1', title: 'Busy', start: '2026-09-30T13:00:00', end: '2026-09-30T13:45:00', allDay: false, notes: 'Room 5', location: 'HQ',
    });
  });

  // #2278. MUTATION: write the end as date + minutes again and it reads
  // "2026-09-30T25:00:00", which the device calendar cannot read.
  it('an event running past midnight ends on the next date', () => {
    const write = deviceEventNotesWrite(event({ nativeEventId: 'dev-1', startTime: '23:00', duration: 120 }), 'x');
    expect(write.start).toBe('2026-09-30T23:00:00');
    expect(write.end).toBe('2026-10-01T01:00:00');
  });
});
