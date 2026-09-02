import { describe, it, expect } from 'vitest';
import {
  binRestoreNoteLine,
  appendBinRestoreNote,
  binRestoreNoticeText,
  restoreBinnedVaultTasks,
} from './obsidianBinRestore.js';
import { reconcileCrossList } from '../sync/dbAdapter.js';

// §3.10 RULING 5 — the vault wins, un-bin visibly. A binned task whose line
// the scan (or observation batch) still produces is restored from the bin,
// with the durable record on task.notes and a lastModified stamp strictly
// newer than the delete stamp so peers' cross-list reconciliation keeps the
// restore instead of re-binning it.

const NOW = Date.parse('2026-08-30T12:00:00.000Z');

const binnedTask = (over = {}) => ({
  id: 'obsidian-2026-08-29-abc123',
  title: 'Water the plants #obsidian',
  importSource: 'obsidian',
  obsidianRawTitle: 'Water the plants',
  completed: false,
  color: 'bg-purple-500', duration: 45, notes: 'my planning note', projectId: 'p1',
  date: '2026-08-29', startTime: '09:00',
  _deletedFrom: 'calendar',
  deletedAt: '2026-08-30T10:00:00.000Z',
  lastModified: '2026-08-30T10:00:00.000Z',
  ...over,
});

// The same line as the scan just parsed it: fresh import, epoch stamp,
// line-derived values only (this is what the war's per-cycle re-import
// actually looked like).
const scannedTask = (over = {}) => ({
  id: 'obsidian-2026-08-29-abc123',
  title: 'Water the plants #obsidian',
  importSource: 'obsidian',
  obsidianRawTitle: 'Water the plants',
  completed: false,
  date: '2026-08-29', obsidianFileDate: '2026-08-29', startTime: '09:00', duration: null,
  lastModified: new Date(0).toISOString(),
  ...over,
});

describe('the durable notes record', () => {
  it('uses the ruling wording, with the daily note named (no em dashes)', () => {
    const line = binRestoreNoteLine('2026-08-29');
    expect(line).toBe("Restored from the recycle bin. This task's line still exists in your 2026-08-29 daily note. Delete the line in Obsidian to remove it.");
    expect(line).not.toContain('—');
    expect(binRestoreNoteLine(null)).toContain('your Obsidian vault');
  });

  it('appends once ever: repeats and racing devices collapse on the deterministic line (the #1465 guard)', () => {
    const once = appendBinRestoreNote('existing note', '2026-08-29');
    expect(once).toBe(`existing note\n${binRestoreNoteLine('2026-08-29')}`);
    // Second bin/restore round, any device: same line, no stack.
    expect(appendBinRestoreNote(once, '2026-08-29')).toBe(once);
    // Empty/missing notes start clean.
    expect(appendBinRestoreNote(undefined, '2026-08-29')).toBe(binRestoreNoteLine('2026-08-29'));
  });
});

describe('restoreBinnedVaultTasks', () => {
  it('restores a binned task the scan still produces: out of the bin, app fields carried, record appended, stamp beats the delete stamp', () => {
    const bin = [binnedTask()];
    const out = restoreBinnedVaultTasks({
      recycleBin: bin, scheduledTasks: [scannedTask()], inboxTasks: [], nowMs: NOW,
    });
    expect(out.recycleBin).toHaveLength(0);
    expect(out.restored).toEqual([{ id: 'obsidian-2026-08-29-abc123', title: 'Water the plants #obsidian', dateStr: '2026-08-29' }]);
    expect(out.scheduledTasks).toHaveLength(1);
    const t = out.scheduledTasks[0];
    // App-owned fields survived the bin round-trip (§3.10 ruling 4).
    expect(t.color).toBe('bg-purple-500');
    expect(t.duration).toBe(45);
    expect(t.projectId).toBe('p1');
    // The durable record, appended under the user's own notes.
    expect(t.notes).toBe(`my planning note\n${binRestoreNoteLine('2026-08-29')}`);
    // No deletion metadata leaks onto the live task.
    expect(t._deletedFrom).toBeUndefined();
    expect(t.deletedAt).toBeUndefined();
    // Strictly newer than the delete stamp — the peer-re-bin guard.
    expect(Date.parse(t.lastModified)).toBeGreaterThan(Date.parse('2026-08-30T10:00:00.000Z'));
  });

  it('THE WAR PIN: the restored copy beats a lingering peer bin row in cross-list reconciliation (no re-bin, no loop)', () => {
    const out = restoreBinnedVaultTasks({
      recycleBin: [binnedTask()], scheduledTasks: [scannedTask()], inboxTasks: [], nowMs: NOW,
    });
    // A peer that hasn't pulled yet still holds the bin row; when both meet
    // in the merged mirror, the restore (fresher stamp) must win — the old
    // shape (epoch-stamped re-import vs fresh delete stamp) lost here every
    // cycle, which was the resupply war's engine.
    const mirror = { tasks: [out.scheduledTasks[0]], recycleBin: [binnedTask()] };
    const losers = [];
    reconcileCrossList(mirror, (id) => losers.push(id));
    expect(mirror.tasks).toHaveLength(1);
    expect(mirror.recycleBin).toHaveLength(0);
    expect(losers).toEqual(['recycleBin:obsidian-2026-08-29-abc123']);
  });

  it('honors _deletedFrom like undeleteTask: an inbox-binned task lands in the inbox even when the line parses scheduled', () => {
    const out = restoreBinnedVaultTasks({
      recycleBin: [binnedTask({ _deletedFrom: 'inbox' })],
      scheduledTasks: [scannedTask()], inboxTasks: [], nowMs: NOW,
    });
    expect(out.scheduledTasks).toHaveLength(0);
    expect(out.inboxTasks).toHaveLength(1);
    expect(out.inboxTasks[0].notes).toContain('Restored from the recycle bin.');
  });

  it('OR-merges completion: a task completed before binning stays completed on restore', () => {
    const out = restoreBinnedVaultTasks({
      recycleBin: [binnedTask({ completed: true })],
      scheduledTasks: [scannedTask({ completed: false })], inboxTasks: [], nowMs: NOW,
    });
    expect(out.scheduledTasks[0].completed).toBe(true);
  });

  it('bridges the block-id switch: a bin copy under the legacy id matches the line scanned under its ^dg- identity', () => {
    const out = restoreBinnedVaultTasks({
      recycleBin: [binnedTask()],
      scheduledTasks: [scannedTask({ id: 'obsidian-dg-aaaa1111', obsidianBlockId: 'aaaa1111', obsidianLegacyId: 'obsidian-2026-08-29-abc123' })],
      inboxTasks: [], nowMs: NOW,
    });
    expect(out.recycleBin).toHaveLength(0);
    expect(out.restored[0].id).toBe('obsidian-dg-aaaa1111');
    expect(out.scheduledTasks[0].color).toBe('bg-purple-500');
  });

  it('touches nothing else: non-obsidian bin entries and binned tasks the scan did NOT produce stay binned', () => {
    const manual = { id: 'manual-1', title: 'Manual task', _deletedFrom: 'calendar', deletedAt: '2026-08-30T10:00:00.000Z' };
    const goneFromVault = binnedTask({ id: 'obsidian-2026-08-20-gone99' });
    const out = restoreBinnedVaultTasks({
      recycleBin: [manual, goneFromVault, binnedTask()],
      scheduledTasks: [scannedTask()], inboxTasks: [], nowMs: NOW,
    });
    expect(out.recycleBin).toEqual([manual, goneFromVault]);
    expect(out.restored).toHaveLength(1);
  });

  it('a repeat round never stacks a second notes record — bin it thrice, one line', () => {
    const first = restoreBinnedVaultTasks({
      recycleBin: [binnedTask()], scheduledTasks: [scannedTask()], inboxTasks: [], nowMs: NOW,
    });
    // The user bins the restored task again; next scan restores again.
    const rebinned = { ...first.scheduledTasks[0], _deletedFrom: 'calendar', deletedAt: '2026-08-30T13:00:00.000Z', lastModified: '2026-08-30T13:00:00.000Z' };
    const second = restoreBinnedVaultTasks({
      recycleBin: [rebinned], scheduledTasks: [scannedTask()], inboxTasks: [], nowMs: NOW + 2 * 3600_000,
    });
    const notes = second.scheduledTasks[0].notes;
    expect(notes.match(/Restored from the recycle bin\./g)).toHaveLength(1);
    // And the stamp still beats the second delete stamp.
    expect(Date.parse(second.scheduledTasks[0].lastModified)).toBeGreaterThan(Date.parse('2026-08-30T13:00:00.000Z'));
  });

  it('THE LIVE-COPY GUARD (ruling 5 correction, the y0bm31lo war): a bin entry whose id is still live in app state is NOT restored — it is a binned duplicate, dropped and reported', () => {
    // The war's trigger replayed: the user binned one of two copies; the
    // other stayed live. The first shape restored the binned one by
    // _deletedFrom with a fresher-than-everything stamp, manufacturing a
    // second live copy that won every later cross-list reconciliation.
    const bin = [binnedTask({ _deletedFrom: 'inbox' })];
    const scanned = scannedTask();
    const out = restoreBinnedVaultTasks({
      recycleBin: bin, scheduledTasks: [scanned], inboxTasks: [],
      liveIds: new Set([scanned.id]), nowMs: NOW,
    });
    expect(out.restored).toEqual([]);
    expect(out.superseded).toEqual([{ id: scanned.id, title: bin[0].title }]);
    expect(out.recycleBin).toEqual([]); // the stale bin row goes, never lingers to fight the live copy
    expect(out.scheduledTasks).toEqual([scanned]); // the scan's copy passes through untouched
    expect(out.inboxTasks).toEqual([]); // and NO second copy appears anywhere
  });

  it('the guard is narrow: a binned task whose ONLY copy is gone still restores while its line exists (ruling 5 intact)', () => {
    const bin = [binnedTask()];
    const out = restoreBinnedVaultTasks({
      recycleBin: bin, scheduledTasks: [scannedTask()], inboxTasks: [],
      liveIds: new Set(['some-other-live-id']), nowMs: NOW,
    });
    expect(out.restored).toHaveLength(1);
    expect(out.superseded).toEqual([]);
    expect(out.scheduledTasks[0].notes).toContain('Restored from the recycle bin');
  });

  it('no binned matches → the exact same list references pass through (zero-cost on the common path)', () => {
    const scheduled = [scannedTask()];
    const inbox = [];
    const out = restoreBinnedVaultTasks({ recycleBin: [], scheduledTasks: scheduled, inboxTasks: inbox, nowMs: NOW });
    expect(out.scheduledTasks).toBe(scheduled);
    expect(out.inboxTasks).toBe(inbox);
    expect(out.restored).toEqual([]);
  });
});

describe('the transient toast', () => {
  it('single restore names the task (display tag stripped) and the note', () => {
    expect(binRestoreNoticeText([{ id: 'x', title: 'Water the plants #obsidian', dateStr: '2026-08-29' }]))
      .toBe('Restored "Water the plants" from the recycle bin. Its line still exists in your 2026-08-29 daily note.');
  });

  it('multiple restores point at each task\'s notes', () => {
    const text = binRestoreNoticeText([{ id: 'a', title: 'A', dateStr: null }, { id: 'b', title: 'B', dateStr: null }]);
    expect(text).toBe('2 tasks were restored from the recycle bin. Their lines still exist in your vault. See each task\'s notes.');
  });
});
