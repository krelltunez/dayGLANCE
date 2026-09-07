import { describe, it, expect } from 'vitest';
import { parseTasksFromMarkdown } from '@glance-apps/obsidian-format';
import { buildExistingObsidianTaskContext, mergeParsedObsidianTasks } from './obsidian.js';
import { mergeObsidianTasks } from './utils/mergeObsidianTasks.js';
import { reconcileCrossList } from './sync/dbAdapter.js';
import { restoreBinnedVaultTasks } from './utils/obsidianBinRestore.js';

// THE y0bm31lo WAR (2026-09-01), replayed from the field data. §3.10 ruling 5
// correction: the cross-list SURVIVOR RULE.
//
// Two live copies of one Obsidian task — a scheduled copy the bin-vs-vault
// restore resurrected with a fresh stamp (18:42:41Z) and the inbox copy the
// user actually kept (18:40:01Z) — and two tiers resolving the collision in
// OPPOSITE directions: the DB tier's reconcileCrossList keeps the newest
// (scheduled) and deletes the inbox copy; the scan's merge context, with the
// id in BOTH move-sets after a two-pass map overwrite, routed the scheduled-
// shaped line to the inbox list and the outer merge dropped the scheduled
// copy. Each cycle undid the other's resolution, on one machine, forever.
//
// The rule now: the scan resolves a both-lists collision exactly as the DB
// tier does — newest lastModified wins, ties to the scheduled list — so the
// tiers pick the same copy and the state converges in ONE cycle. And the
// trigger is closed at the source: the restore never manufactures a second
// live copy.

const LINE = '- [x] 10:15-10:30 BDO: Assurance payment term approvals #work ✅ 2026-09-01 ^dg-y0bm31lo';
const NOTE = `# 2026-09-01\n\n## Tasks\n${LINE}\n`;
const ID = 'obsidian-dg-y0bm31lo';

const base = {
  id: ID, importSource: 'obsidian', obsidianBlockId: 'y0bm31lo', obsidianFileDate: '2026-09-01',
  obsidianRawTitle: 'BDO: Assurance payment term approvals #work',
  title: 'BDO: Assurance payment term approvals #work #obsidian',
  completed: true, date: '2026-09-01', startTime: '09:30', duration: 30, isAllDay: false,
  color: 'bg-purple-600', priority: 0, subtasks: [],
};
// The field objects, as captured from localStorage on the warring machine.
const scheduledCopy = () => ({
  ...base, lastModified: '2026-09-01T18:42:41.087Z', completedAt: '2026-09-01T12:39:00-06:00',
  notes: 'Restored from the recycle bin. This task\'s line still exists in the 2026-09-01 daily note.',
});
const inboxCopy = () => ({ ...base, lastModified: '2026-09-01T18:40:01.473Z', completedAt: '2026-09-01', notes: '' });

const preserve = (old) => ({ completedAt: old.completedAt, projectId: old.projectId });

// One full scan cycle against the given app state; returns the merged state.
function scanCycle(tasks, unscheduledTasks) {
  const parsed = parseTasksFromMarkdown(NOTE, '2026-09-01');
  const ctx = buildExistingObsidianTaskContext(tasks, unscheduledTasks);
  const out = { allScheduled: [], allInbox: [] };
  mergeParsedObsidianTasks(parsed, ctx, null, out);
  const scannedIds = new Set([...out.allScheduled, ...out.allInbox].map((t) => String(t.id)));
  return {
    ctx, out,
    tasks: mergeObsidianTasks(tasks, out.allScheduled, scannedIds, preserve),
    unscheduledTasks: mergeObsidianTasks(unscheduledTasks, out.allInbox, scannedIds, preserve),
  };
}

// The DB tier's view of the same state: does reconcileCrossList see a collision?
function dbCollisions(tasks, unscheduledTasks) {
  const collisions = [];
  reconcileCrossList(
    { recycleBin: [], recurringTasks: [], tasks: [...tasks], unscheduledTasks: [...unscheduledTasks], todayRoutines: [] },
    () => {}, (c) => collisions.push(c),
  );
  return collisions;
}

describe('the cross-list survivor rule (ruling 5 correction) — the y0bm31lo war replayed', () => {
  it('the line parses as the field data says: scheduled-shaped, completed, under its ^dg- id', () => {
    const parsed = parseTasksFromMarkdown(NOTE, '2026-09-01');
    expect(parsed.scheduledTasks).toHaveLength(1);
    expect(parsed.inboxTasks).toHaveLength(0);
    expect(parsed.scheduledTasks[0]).toMatchObject({ id: ID, completed: true, startTime: '10:15' });
  });

  it('THE WAR PIN: both copies live → the scan picks the NEWEST (scheduled), routes the line there, drops the inbox copy, and the DB tier AGREES — converged in one cycle', () => {
    const { ctx, out, tasks, unscheduledTasks } = scanCycle([scheduledCopy()], [inboxCopy()]);
    // The context puts the id in exactly ONE move-set — the survivor's.
    expect(ctx.userScheduledIds.has(ID)).toBe(true);
    expect(ctx.userInboxIds.has(ID)).toBe(false);
    expect(ctx.existingTaskMap[ID].lastModified).toBe('2026-09-01T18:42:41.087Z');
    // The scheduled-shaped line stays scheduled (the pre-fix shape sent it
    // to the inbox with the inbox copy's fields — an inbox record carrying
    // a startTime, exactly what the field data showed).
    expect(out.allScheduled.map((t) => t.id)).toEqual([ID]);
    expect(out.allInbox).toEqual([]);
    // The outer merge drops the counterpart: one copy, in the list the DB
    // tier keeps.
    expect(tasks.filter((t) => t.id === ID)).toHaveLength(1);
    expect(unscheduledTasks.filter((t) => t.id === ID)).toHaveLength(0);
    expect(dbCollisions(tasks, unscheduledTasks)).toEqual([]);
    // And the next cycle is a fixed point — nothing resupplies.
    const again = scanCycle(tasks, unscheduledTasks);
    expect(again.tasks.filter((t) => t.id === ID)).toHaveLength(1);
    expect(again.unscheduledTasks.filter((t) => t.id === ID)).toHaveLength(0);
  });

  it('the rule is symmetric: when the INBOX copy is newer, the scan honors it, drops the scheduled copy, and the DB tier agrees', () => {
    const newerInbox = { ...inboxCopy(), lastModified: '2026-09-01T19:00:00.000Z' };
    const { ctx, out, tasks, unscheduledTasks } = scanCycle([scheduledCopy()], [newerInbox]);
    expect(ctx.userInboxIds.has(ID)).toBe(true);
    expect(ctx.userScheduledIds.has(ID)).toBe(false);
    expect(out.allInbox.map((t) => t.id)).toEqual([ID]); // user's move honored
    expect(tasks.filter((t) => t.id === ID)).toHaveLength(0);
    expect(unscheduledTasks.filter((t) => t.id === ID)).toHaveLength(1);
    expect(dbCollisions(tasks, unscheduledTasks)).toEqual([]);
  });

  it('ties go to the scheduled list, matching CROSS_LIST_PRIORITY, so equal stamps never split the tiers either', () => {
    const tie = { ...inboxCopy(), lastModified: scheduledCopy().lastModified };
    const { ctx } = scanCycle([scheduledCopy()], [tie]);
    expect(ctx.userScheduledIds.has(ID)).toBe(true);
    expect(ctx.userInboxIds.has(ID)).toBe(false);
  });

  it('THE PRE-FIX COUNTERFACTUAL, kept as documentation: the DB tier alone always chose the scheduled copy — the war was the scan disagreeing', () => {
    const collisions = dbCollisions([scheduledCopy()], [inboxCopy()]);
    expect(collisions).toHaveLength(1);
    expect(collisions[0]).toMatchObject({ winner: 'tasks', losers: ['unscheduledTasks'] });
  });

  it('THE TRIGGER, closed: binning one of two copies no longer resurrects it beside the live one', () => {
    // The user's own account: "I tried to delete the Inbox copy and it
    // flashed the message and then completely disappeared" — the restore
    // fired against the live scheduled copy and manufactured the duplicate.
    const binned = { ...inboxCopy(), _deletedFrom: 'inbox', deletedAt: '2026-09-01T18:41:00.000Z' };
    const parsed = parseTasksFromMarkdown(NOTE, '2026-09-01');
    const out = restoreBinnedVaultTasks({
      recycleBin: [binned], scheduledTasks: parsed.scheduledTasks, inboxTasks: [],
      liveIds: new Set([ID]), // the scheduled copy is live in app state
      nowMs: Date.parse('2026-09-01T18:42:41.087Z'),
    });
    expect(out.restored).toEqual([]);
    expect(out.superseded.map((s) => s.id)).toEqual([ID]);
    expect(out.inboxTasks).toEqual([]);
    expect(out.recycleBin).toEqual([]);
  });
});
