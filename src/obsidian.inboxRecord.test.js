// THE INBOX RECORD KEEPS ITS SHAPE — the 2026-09-06 ruling (option 3 of the
// field record in docs/obsidian-buildout-spec.md §3.10).
//
// The night of the SSE re-arm, six inbox tasks scheduled on the Mac flipped
// back to the inbox fleet-wide. The Mac wrote their lines with a time; a
// second desktop's plugin reported the note before that desktop's DB pull
// had delivered the schedule, so its merge met a timed line with an inbox
// copy, kept the task in the inbox (the user-move rule, unchanged here) —
// and built the inbox copy FROM THE TIMED LINE. That record carried a date
// and a start time the stored copy lacked, so it was re-stamped with a
// fresh lastModified, pushed, and outranked the real schedule.
//
// The ruling keeps the decision and fixes the record: the inbox copy keeps
// the stored copy's shape, byte for byte, so nothing re-stamps and the DB
// tier delivers the answer. The mirror case (a fresh unschedule meeting a
// stale read of the still-timed line) is a no-op for the same reason.
import { describe, it, expect } from 'vitest';
import { parseTasksFromMarkdown } from '@glance-apps/obsidian-format';
import { buildExistingObsidianTaskContext, mergeParsedObsidianTasks } from './obsidian.js';
import { mergeObsidianTasks, preserveObsidianAppFields } from './utils/mergeObsidianTasks.js';
import { stampTimestamps } from './utils/stampTimestamps.js';

const DATE = '2026-09-06';
const NOW = '2026-09-07T04:20:00.000Z';

function inbound(noteText, tasks, inbox) {
  const ctx = buildExistingObsidianTaskContext(tasks, inbox);
  const out = { allScheduled: [], allInbox: [], lineSchedule: {} };
  mergeParsedObsidianTasks(parseTasksFromMarkdown(noteText, DATE, new Set()), ctx, null, out);
  const scannedIds = new Set([...out.allScheduled, ...out.allInbox].map((t) => String(t.id)));
  return {
    tasks: mergeObsidianTasks(tasks, out.allScheduled, scannedIds, preserveObsidianAppFields),
    inbox: mergeObsidianTasks(inbox, out.allInbox, scannedIds, preserveObsidianAppFields),
  };
}
const plain = (t) => JSON.parse(JSON.stringify(t));
const UNTIMED = '## Tasks\n- [ ] Other dayGLANCE fixes and enhancements ^dg-fln9z7hj\n';
const TIMED = '## Tasks\n- [ ] 13:00-13:30 Other dayGLANCE fixes and enhancements ^dg-fln9z7hj\n';
const DATED = '## Tasks\n- [ ] 2026-09-07 13:00-13:30 Other dayGLANCE fixes and enhancements ^dg-fln9z7hj\n';

describe('a timed line meeting an inbox copy (the user-move rule, scoped by the §8 ruling of 2026-09-08)', () => {
  const stored = () => ({ ...plain(inbound(UNTIMED, [], []).inbox[0]), lastModified: '2026-09-07T03:00:00.000Z' });
  // The stale read: dayGLANCE moved the task to the inbox and its line still
  // carries the time that move removed (utils/inboxMove.js records it).
  const stale = () => ({ ...stored(), obsidianClearedTime: '13:00' });

  it('THE STALE READ: a line still carrying the time dayGLANCE removed keeps the task in the inbox AND keeps the inbox record byte-identical: no date, no start time, no re-stamp', () => {
    const before = stale();
    const after = inbound(TIMED, [], [before]);
    expect(after.tasks).toHaveLength(0);
    expect(after.inbox).toHaveLength(1);
    expect(plain(after.inbox[0])).toEqual(before);
    const changed = [];
    const stamped = stampTimestamps(after.inbox, [before], NOW, ({ changedKeys }) => changed.push(...changedKeys));
    expect(changed).toEqual([]);
    expect(stamped[0].lastModified).toBe(before.lastModified);
  });

  it('the same for a stale line carrying an inline date with that time (the prefix fix writes one for another day)', () => {
    const before = stale();
    const after = inbound(DATED, [], [before]);
    expect(after.tasks).toHaveLength(0);
    expect(plain(after.inbox[0])).toEqual(before);
  });

  it('§8: a time the VAULT added (no cleared-time marker: the task was never unscheduled from a time) schedules the task at the line\'s time on the note\'s date, stamped as a real edit', () => {
    const before = stored();
    const after = inbound(TIMED, [], [before]);
    expect(after.inbox).toHaveLength(0);
    expect(after.tasks).toHaveLength(1);
    expect(after.tasks[0]).toMatchObject({ id: before.id, date: DATE, startTime: '13:00', isAllDay: false, duration: 30 });
    expect(after.tasks[0].obsidianClearedTime).toBeUndefined();
    expect(Date.parse(after.tasks[0].lastModified)).toBeGreaterThan(Date.parse(before.lastModified));
  });

  it('§8: a DIFFERENT time from the one dayGLANCE removed is the vault\'s own statement and schedules the task', () => {
    const before = { ...stored(), obsidianClearedTime: '09:00' };
    const after = inbound(TIMED, [], [before]);
    expect(after.inbox).toHaveLength(0);
    expect(after.tasks[0]).toMatchObject({ startTime: '13:00', date: DATE });
    expect(after.tasks[0].obsidianClearedTime).toBeUndefined();
  });

  it('§8: with an inline date the task schedules onto the LINE\'s date', () => {
    const after = inbound(DATED, [], [stored()]);
    expect(after.tasks[0]).toMatchObject({ date: '2026-09-07', startTime: '13:00' });
  });

  it('a date-only line (no time) still respects the move: dayGLANCE\'s own reschedule channel, unchanged', () => {
    const before = stored();
    const after = inbound('## Tasks\n- [ ] 2026-09-07 Other dayGLANCE fixes and enhancements ^dg-fln9z7hj\n', [], [before]);
    expect(after.tasks).toHaveLength(0);
    expect(plain(after.inbox[0])).toEqual(before);
  });

  it('the marker is spent when the line is next observed WITHOUT a time (the writeback landed), and dropping it is not a compared change', () => {
    const before = stale();
    const after = inbound(UNTIMED, [], [before]);
    expect(after.inbox).toHaveLength(1);
    expect(after.inbox[0].obsidianClearedTime).toBeUndefined();
    const changed = [];
    const stamped = stampTimestamps(after.inbox, [before], NOW, ({ changedKeys }) => changed.push(...changedKeys));
    expect(changed).toEqual([]);
    expect(stamped[0].lastModified).toBe(before.lastModified);
  });

  it('control: with no inbox copy the timed line is a scheduled task, as ever', () => {
    const fresh = inbound(TIMED, [], []);
    expect(fresh.tasks).toHaveLength(1);
    expect(fresh.tasks[0].startTime).toBe('13:00');
    expect(fresh.inbox).toHaveLength(0);
  });

  it('control: a scheduled copy meeting the timed line stays scheduled with its own schedule (DG owns scheduling)', () => {
    const scheduled = { ...stored(), date: '2026-09-07', startTime: '13:00', isAllDay: false };
    delete scheduled.priority;
    const after = inbound(TIMED, [scheduled], []);
    expect(after.tasks).toHaveLength(1);
    expect(after.tasks[0].date).toBe('2026-09-07');
    expect(after.inbox).toHaveLength(0);
  });
});
