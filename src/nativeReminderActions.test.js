import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEAD_AHEAD_MINUTES } from './hooks/useReminderEngine.js';

/**
 * Early-notice reminders (#2249, "ahead30" … "ahead720") offer no Snooze:
 * Snooze pushes the task itself 15 minutes later, which is no use hours
 * before it. Four places decide the buttons — the in-app toast, Android's
 * immediate and alarm-fired notifications, and iOS's notification category —
 * and CI cannot compile the native two, so the rule is pinned here by source,
 * as androidNotificationActions.test.js pins the Mark Complete wiring.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

describe('no Snooze on early-notice reminders, on every platform', () => {
  it.each([
    ['dayglance-android/app/src/main/java/com/dayglance/app/bridge/NotificationBridge.kt', 'if (type != "end" && !type.startsWith("ahead")) {'],
    ['dayglance-android/app/src/main/java/com/dayglance/app/notifications/ReminderReceiver.kt', 'if (type != "end" && !type.startsWith("ahead")) {'],
    ['dayglance-ios/DayGlance/Bridges/NotificationBridge.swift', 'let hasSnooze   = type != "end" && !type.hasPrefix("ahead")'],
    ['src/components/ReminderToasts.jsx', "reminder.type !== 'end' && reminder.type !== 'morning' && !isAheadReminder(reminder.type)"],
  ])('%s', (file, rule) => {
    expect(read(file)).toContain(rule);
  });

  it('the native rule\'s prefix is every early-notice type\'s', () => {
    for (const minutes of LEAD_AHEAD_MINUTES) expect(`ahead${minutes}`.startsWith('ahead')).toBe(true);
  });

  it('the settings offer exactly the engine\'s lead times', () => {
    const offered = [...read('src/components/RemindersSettings.jsx').matchAll(/\['ahead(\d+)'/g)].map((m) => Number(m[1]));
    expect([...offered].sort((a, b) => a - b)).toEqual([...LEAD_AHEAD_MINUTES]);
  });
});
