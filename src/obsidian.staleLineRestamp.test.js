// THE PHANTOM RE-STAMP — 2026-09-06 field finding, pinned on the real
// app-side pipeline: parse → per-note merge → list merge (with the app's
// field carry) → stampTimestamps, exactly as a direct scan or an observation
// runs it.
//
// The field case: "Re-arm SSE nudges on Mac", added to the daily note,
// scheduled onto the timeline in dayGLANCE (which strips the priority key
// and times the line), completed from the plugin's sidebar. A phone whose
// vault copy was stale (Obsidian backgrounded, so its line was still untimed
// and unchecked) scanned that line every five minutes; the re-parse said
// `priority: 0` and dropped the completion's `transitionId`, the compare read
// both as edits, and the phone re-stamped a task nobody had touched with a
// fresh lastModified — which outranked the desktop's completion under
// DB-tier last-write-wins. The sidebar completion vanished twice in a row.
//
// A stale copy still tells other lies (a line the fleet deleted is
// re-created, a line the fleet added is tombstoned) — those are the
// stale-copy posture ruling, not this test. This test pins only that an
// UNCHANGED task is never re-stamped by a re-parse, whatever the app set on
// it since.
import { describe, it, expect } from 'vitest';
import { parseTasksFromMarkdown } from '@glance-apps/obsidian-format';
import { buildExistingObsidianTaskContext, mergeParsedObsidianTasks } from './obsidian.js';
import { mergeObsidianTasks, preserveObsidianAppFields } from './utils/mergeObsidianTasks.js';
import { stampTimestamps } from './utils/stampTimestamps.js';

const DATE = '2026-09-06';
const NOW = '2026-09-06T20:00:00.000Z';

/** One inbound pass, as the hook runs it: the per-note merge, then the list merge with the app's carry. */
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

/** The keys stampTimestamps would report as changed for the ONE task, and its resulting lastModified. */
function restamp(list, stored) {
  const changed = [];
  const out = stampTimestamps(list, stored, NOW, ({ changedKeys }) => changed.push(...changedKeys));
  return { changed, lastModified: out[0]?.lastModified };
}

const UNTIMED = `# Tasks\n- [ ] Re-arm SSE nudges on Mac ^dg-8w230vhc\n`;
const TIMED = `# Tasks\n- [ ] 14:00 Re-arm SSE nudges on Mac ^dg-8w230vhc\n`;

/** Import the line fresh, then schedule it in the app the way useTaskActions does (priority stripped, fresh stamp). */
function scheduledInApp() {
  const fresh = inbound(UNTIMED, [], []);
  expect(fresh.inbox).toHaveLength(1);
  const { priority: _p, deadline: _d, ...preserved } = fresh.inbox[0];
  return { ...preserved, startTime: '14:00', date: DATE, isAllDay: false, lastModified: '2026-09-06T19:00:00.000Z' };
}

describe('a re-parse never re-stamps an unchanged task', () => {
  it('scheduled in the app, the stale line still untimed: no re-stamp (the priority key)', () => {
    const stored = scheduledInApp();
    expect(stored).not.toHaveProperty('priority');
    const after = inbound(UNTIMED, [stored], []);
    expect(after.tasks).toHaveLength(1);
    expect(after.inbox).toHaveLength(0);
    const r = restamp(after.tasks, [stored]);
    expect(r.changed).toEqual([]);
    expect(r.lastModified).toBe(stored.lastModified);
  });

  it('completed in the app, the stale line still unchecked: no re-stamp (transitionId), and the completion holds', () => {
    const stored = { ...scheduledInApp(), completed: true, completedAt: '2026-09-06T13:33:33-06:00', transitionId: 'a5b3', lastModified: '2026-09-06T19:33:33.547Z' };
    const after = inbound(UNTIMED, [stored], []);
    const r = restamp(after.tasks, [stored]);
    expect(after.tasks[0].completed).toBe(true);
    expect(after.tasks[0].transitionId).toBe('a5b3');
    expect(r.changed).toEqual([]);
    expect(r.lastModified).toBe(stored.lastModified);
  });

  it('the current line (timed, checked, with the marker) against the completed copy: no re-stamp either', () => {
    const stored = { ...scheduledInApp(), completed: true, completedAt: '2026-09-06', transitionId: 'a5b3', lastModified: '2026-09-06T19:37:01.125Z' };
    const current = `# Tasks\n- [x] 14:00 Re-arm SSE nudges on Mac ✅ 2026-09-06 ^dg-8w230vhc\n`;
    const after = inbound(current, [stored], []);
    const r = restamp(after.tasks, [stored]);
    expect(r.changed).toEqual([]);
    expect(r.lastModified).toBe(stored.lastModified);
  });

  it('control: a retitle in the vault still re-stamps', () => {
    const stored = scheduledInApp();
    const after = inbound(TIMED.replace('Re-arm SSE nudges on Mac', 'Re-arm SSE nudges on the Mac'), [stored], []);
    const r = restamp(after.tasks, [stored]);
    expect(r.changed).toContain('title');
    expect(r.lastModified).toBe(NOW);
  });
});
