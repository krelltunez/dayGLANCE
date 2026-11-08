// Holds the JS side of the device-calendar contract to
// dayglance-ios/TestFixtures/launcherDeviceEvents.vectors.json; the Android
// provider's LauncherDeviceEventsTest holds the Kotlin side to the same file,
// so the launcher sees one event as one row whichever side read it. To
// regenerate the expected output after a deliberate change:
//   GEN_FIXTURE=1 npx vitest run src/utils/launcherDeviceEvents.fixture.test.js
import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildLauncherSnapshot, launcherDeviceCalendar, DEVICE_EVENT_WINDOW } from './launcherSnapshot.js';
import { nativeResultsToTasks } from './nativeCalendar.js';
import { groupWidgetNativeEvents } from './widgetNativeEvents.js';
import { RESTORE_KEYWORDS, RESTORE_PHRASES } from './energyAxis.js';
import { dateToString } from './taskUtils.js';

const path = fileURLToPath(new URL('../../dayglance-ios/TestFixtures/launcherDeviceEvents.vectors.json', import.meta.url));
const fixture = JSON.parse(readFileSync(path, 'utf8'));
const generate = process.env.GEN_FIXTURE === '1';

const windowDates = (today) => {
  const noon = new Date(`${today}T12:00:00`);
  const out = [];
  for (let d = -DEVICE_EVENT_WINDOW.daysBefore; d <= DEVICE_EVENT_WINDOW.daysAfter; d++) {
    const date = new Date(noon);
    date.setDate(noon.getDate() + d);
    out.push(dateToString(date));
  }
  return out;
};

/** The app's own path: the per-day fetch, the shared conversion, the snapshot's native rows. */
function jsRows({ today, filter, overrides, events }) {
  const dates = windowDates(today);
  const { tasks } = nativeResultsToTasks(dates.map((d) => events[d] ?? []), dates, { calendarFilter: filter, overrides });
  const snapshot = buildLauncherSnapshot({
    now: new Date(`${today}T12:00:00`), todayStr: today, timezone: 'UTC', updatedAt: 0,
    deviceEvents: groupWidgetNativeEvents(dates, tasks),
    deviceCalendar: { filter, overrides },
  });
  return { rows: snapshot.tasks.filter((t) => t.native), deviceCalendar: snapshot.deviceCalendar };
}

describe('launcherDeviceEvents fixture', () => {
  if (generate) {
    it('regenerates the expected output', () => {
      fixture.restoreKeywords = [...RESTORE_KEYWORDS];
      fixture.restorePhrases = [...RESTORE_PHRASES];
      for (const c of fixture.cases) Object.assign(c, jsRows(c));
      writeFileSync(path, `${JSON.stringify(fixture, null, 2)}\n`);
    });
    return;
  }

  it('the restore keywords are the ones the Kotlin side matches', () => {
    expect(fixture.restoreKeywords).toEqual([...RESTORE_KEYWORDS]);
  });

  it('the restore phrases (Chinese, matched as substrings) are the ones the Kotlin side matches', () => {
    expect(fixture.restorePhrases).toEqual([...RESTORE_PHRASES]);
  });

  for (const c of fixture.cases) {
    it(`${c.name}: the snapshot's block and rows`, () => {
      const { rows, deviceCalendar } = jsRows(c);
      expect(deviceCalendar).toEqual(c.deviceCalendar);
      expect(rows).toEqual(c.rows);
    });
  }

  it('the overrides block resolves the colour and drops what the conversion ignores', () => {
    expect(launcherDeviceCalendar({ filter: [1], overrides: { 7: { color: 'bg-emerald-500', foo: 1, startTime: null } } })).toEqual({
      filter: ['1'], overrides: { 7: { colorHex: expect.stringMatching(/^#/), startTime: null } },
      daysBefore: DEVICE_EVENT_WINDOW.daysBefore, daysAfter: DEVICE_EVENT_WINDOW.daysAfter,
    });
  });
});
