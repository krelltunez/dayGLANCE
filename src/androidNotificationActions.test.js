import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * CI cannot compile the Android app, so the wiring behind the notification
 * "Mark Complete" button is guarded here.
 *
 * The button used to be a getBroadcast PendingIntent into
 * NotificationActionReceiver, which then called startActivity() to bring the app
 * forward. Targeting SDK 34+, an app no longer grants its background-activity-
 * launch privileges when sending a PendingIntent, so that second hop could be
 * dropped and tapping the button did nothing at all. Snooze was unaffected
 * because it only sets an alarm, which is why the two behaved differently.
 *
 * It is now a getActivity PendingIntent into MainActivity, a system-sent launch
 * that needs no such privilege. Two things can silently undo that: someone
 * reverting to getBroadcast, or the extra keys drifting apart between the two
 * builders and MainActivity, which the compiler cannot catch because they are
 * plain strings read back with getStringExtra.
 */
const ANDROID = join(
  dirname(fileURLToPath(import.meta.url)),
  '../dayglance-android/app/src/main/java/com/dayglance/app',
);

const read = (rel) => readFileSync(join(ANDROID, rel), 'utf8');

const MAIN_ACTIVITY = read('MainActivity.kt');
// The two places that build the Mark Complete button.
const BUILDERS = [
  ['NotificationBridge.kt', read('bridge/NotificationBridge.kt'), 'completePendingIntent'],
  ['ReminderReceiver.kt', read('notifications/ReminderReceiver.kt'), 'completeIntent'],
];

/** Value of a `const val NAME = "..."` in MainActivity's companion object. */
function constant(name) {
  const m = MAIN_ACTIVITY.match(new RegExp(`const val ${name}\\s*=\\s*"([^"]+)"`));
  expect(m, `MainActivity is missing const val ${name}`).not.toBeNull();
  return m[1];
}

describe('Android notification Mark Complete action', () => {
  it('declares the action and its two extras on MainActivity', () => {
    expect(constant('ACTION_COMPLETE_TASK')).toBeTruthy();
    expect(constant('EXTRA_COMPLETE_TASK_ID')).toBeTruthy();
    expect(constant('EXTRA_COMPLETE_NOTIF_ID')).toBeTruthy();
  });

  it('handles the action on both cold start and warm resume', () => {
    // onCreate covers a tap while the app is dead, onNewIntent while it is
    // backgrounded. Dropping either loses the completion on that path alone,
    // which is the kind of half-working that is easy to miss by hand.
    const branches = [...MAIN_ACTIVITY.matchAll(/ACTION_COMPLETE_TASK\s*->/g)];
    expect(
      branches.length,
      'expected an ACTION_COMPLETE_TASK branch in BOTH onCreate and onNewIntent',
    ).toBe(2);
  });

  it('reads back exactly the extras the builders write', () => {
    const taskIdKey = constant('EXTRA_COMPLETE_TASK_ID');
    const notifIdKey = constant('EXTRA_COMPLETE_NOTIF_ID');

    // MainActivity must read both by their constants, not by a copied literal.
    expect(MAIN_ACTIVITY).toMatch(/getStringExtra\(EXTRA_COMPLETE_TASK_ID\)/);
    expect(MAIN_ACTIVITY).toMatch(/getIntExtra\(EXTRA_COMPLETE_NOTIF_ID/);

    // Guard the values themselves against a rename on one side only.
    expect(taskIdKey).not.toBe(notifIdKey);
  });

  it.each(BUILDERS)('%s launches the Activity rather than broadcasting', (_name, src) => {
    const block = src.slice(src.indexOf('MainActivity.ACTION_COMPLETE_TASK'));
    expect(
      block,
      'the Mark Complete PendingIntent must be getActivity: a getBroadcast whose ' +
        'receiver calls startActivity() is a background activity launch the platform ' +
        'drops on SDK 34+, and the button silently does nothing',
    ).toMatch(/PendingIntent\.getActivity\(/);
  });

  it.each(BUILDERS)('%s addresses MainActivity with both extras', (_name, src) => {
    const start = src.indexOf('MainActivity.ACTION_COMPLETE_TASK');
    const block = src.slice(start, start + 500);
    expect(block).toMatch(/Intent\(context, MainActivity::class\.java\)|MainActivity::class\.java/);
    expect(block).toMatch(/MainActivity\.EXTRA_COMPLETE_TASK_ID/);
    expect(block).toMatch(/MainActivity\.EXTRA_COMPLETE_NOTIF_ID/);
  });

  it('no longer builds an ACTION_COMPLETE broadcast anywhere', () => {
    // The receiver branch stays as a fallback for notifications still on screen
    // from a pre-upgrade build, but nothing may create one afresh.
    for (const [name, src] of BUILDERS) {
      expect(
        src.includes('NotificationActionReceiver.ACTION_COMPLETE'),
        `${name} still builds a Mark Complete broadcast`,
      ).toBe(false);
    }
  });

  it('still routes Snooze through the broadcast receiver', () => {
    // Snooze only sets an alarm, so it never needed the Activity launch. If this
    // ever flips it means a refactor swept it along by accident.
    const reminder = read('notifications/ReminderReceiver.kt');
    expect(reminder).toMatch(/NotificationActionReceiver\.ACTION_SNOOZE/);
  });
});
