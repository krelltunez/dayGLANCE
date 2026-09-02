import { describe, it, expect } from 'vitest';
import { parseTasksFromMarkdown } from '@glance-apps/obsidian-format';
import { buildExistingObsidianTaskContext, mergeParsedObsidianTasks, syncObsidianVault } from './obsidian.js';
import { writebackSnapshotEntry } from './utils/obsidianWritebackSnapshot.js';

// OWNED-SCHEDULE ENFORCEMENT (§3.10, 2026-09-02). DG owns scheduling once a
// task is imported. The merge enforced that in MEMORY (DG's time copied over
// the line's), but the post-scan snapshot was built from the merged task, so
// the writeback diff saw "no change" and never wrote DG's time back to a
// line that disagreed — a lost writeback left the y0bm31lo line at 10:15
// while DG held 09:30, silently, forever. Now the pipeline reports a line
// whose time differs from DG's, the snapshot records the LINE's time, and
// the ordinary writeback diff writes DG's time. No new write code.

const ID = 'obsidian-dg-y0bm31lo';
const LINE = '- [x] 10:15-10:30 BDO: Assurance payment term approvals #work ✅ 2026-09-01 ^dg-y0bm31lo';
const dgTask = (over = {}) => ({
  id: ID, importSource: 'obsidian', obsidianBlockId: 'y0bm31lo', obsidianFileDate: '2026-09-01',
  obsidianRawTitle: 'BDO: Assurance payment term approvals #work',
  title: 'BDO: Assurance payment term approvals #work #obsidian',
  completed: true, date: '2026-09-01', startTime: '09:30', duration: 30, isAllDay: false,
  lastModified: '2026-09-01T18:42:41.087Z', ...over,
});

function merge(line, tasks, inbox = []) {
  const parsed = parseTasksFromMarkdown(`## Tasks\n${line}\n`, '2026-09-01');
  const ctx = buildExistingObsidianTaskContext(tasks, inbox);
  const out = { allScheduled: [], allInbox: [], lineSchedule: {} };
  mergeParsedObsidianTasks(parsed, ctx, null, out);
  return out;
}

describe('the merge reports a line whose time differs from DG\'s', () => {
  it('THE FIELD PIN: line 10:15, DG 09:30 → DG\'s time wins in memory AND the line\'s time is reported for the snapshot', () => {
    const out = merge(LINE, [dgTask()]);
    expect(out.allScheduled[0].startTime).toBe('09:30'); // ownership in memory, unchanged
    expect(out.lineSchedule).toEqual({ [ID]: { startTime: '10:15' } });
  });

  it('an agreeing line reports nothing (the common path stays zero-cost)', () => {
    const out = merge(LINE, [dgTask({ startTime: '10:15' })]);
    expect(out.lineSchedule).toEqual({});
  });

  it('narrow on purpose: an UNTIMED line of a DG-scheduled task is not "a different time" and is left alone', () => {
    const untimed = '- [x] BDO: Assurance payment term approvals #work ✅ 2026-09-01 ^dg-y0bm31lo';
    const out = merge(untimed, [dgTask()]);
    expect(out.lineSchedule).toEqual({});
  });

  it('a vault ⏳ edit the merge ADOPTS (ruling 2) makes the two agree and reports nothing — adoption and enforcement never fight', () => {
    // The vault demonstrably rescheduled via ⏳ since our last observation
    // (the raw title differs in the scheduled field): the merge adopts the
    // line's schedule, so DG's copy now carries the line's time.
    const rescheduled = '- [ ] 11:00 Plan the week ⏳ 2026-09-03 ^dg-abcd1234';
    const prior = dgTask({
      id: 'obsidian-dg-abcd1234', obsidianBlockId: 'abcd1234', completed: false,
      obsidianRawTitle: 'Plan the week ⏳ 2026-09-02', title: 'Plan the week #obsidian', startTime: '09:00', date: '2026-09-02',
    });
    const out = merge(rescheduled, [prior]);
    expect(out.allScheduled[0].startTime).toBe('11:00');
    expect(out.lineSchedule).toEqual({});
  });

  it('a task the merge does not know (fresh import) reports nothing — there is no DG value to enforce', () => {
    const out = merge(LINE, []);
    expect(out.lineSchedule).toEqual({});
  });
});

describe('the writeback snapshot records the LINE\'s time so the ordinary diff fires', () => {
  it('with a reported divergence the entry carries the line\'s time; without one, DG\'s', () => {
    const t = dgTask();
    const diverged = writebackSnapshotEntry(t, { [ID]: { startTime: '10:15' } });
    expect(diverged).toEqual({ completed: true, startTime: '10:15', duration: 30, title: t.title, date: '2026-09-01' });
    // The writeback's own comparison — p.startTime !== task.startTime — now
    // sees a change, and writes DG's 09:30 through the existing path.
    expect(diverged.startTime).not.toBe(t.startTime);
    const agreed = writebackSnapshotEntry(t, {});
    expect(agreed.startTime).toBe('09:30');
    expect(writebackSnapshotEntry(t, null).startTime).toBe('09:30');
  });
});

describe('the FSA scan surfaces lineSchedule end to end', () => {
  it('syncObsidianVault returns the divergence map alongside the lists', async () => {
    const files = { '2026-09-01.md': `## Tasks\n${LINE}\n` };
    const dir = {
      kind: 'directory',
      async *[Symbol.asyncIterator]() {
        for (const [name] of Object.entries(files)) {
          yield [name, {
            kind: 'file', name,
            async getFile() { return { text: async () => files[name], lastModified: 1 }; },
          }];
        }
      },
      async getDirectoryHandle() { throw Object.assign(new Error('nf'), { name: 'NotFoundError' }); },
    };
    const result = await syncObsidianVault(dir, '', 0, [dgTask()], []);
    expect(result.lineSchedule).toEqual({ [ID]: { startTime: '10:15' } });
    expect(result.scheduledTasks[0].startTime).toBe('09:30');
  });
});
