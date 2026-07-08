import { describe, it, expect } from 'vitest';
import { rescueUnsyncedTasks, isDefaultRescuable } from './rescueUnsyncedTasks.js';

const merged = (...ids) => ids.map((id) => ({ id, title: id }));
const imported = (id, extra = {}) => ({ id, title: id, imported: true, ...extra });
const native = (id) => ({ id, title: id, _native: true });
const intent = (id) => ({ id, title: id, _intentKey: `k-${id}` });
const plain = (id) => ({ id, title: id });
const obsidian = (id, lastModified) => ({ id, title: id, importSource: 'obsidian', lastModified });

describe('rescueUnsyncedTasks', () => {
  it('preserves an untombstoned local-only imported task (the race-add rescue is intact)', () => {
    const prev = [imported('imp-1')];
    const out = rescueUnsyncedTasks(merged('a'), prev, {});
    expect(out.map((t) => t.id)).toEqual(['a', 'imp-1']);
  });

  it('DROPS a tombstoned imported task — no resurrection (the seed-task fix)', () => {
    // The merge dropped imp-1 because a peer deleted it; deletedTaskIds carries the
    // tombstone. Without the guard the flag-based rescue would re-add it every sync.
    const prev = [imported('imp-1')];
    const deletedIds = { 'imp-1': '2026-07-01T00:00:00.000Z' };
    const out = rescueUnsyncedTasks(merged('a'), prev, deletedIds);
    expect(out.map((t) => t.id)).toEqual(['a']); // imp-1 stays gone
  });

  it('preserves a native task and drops a tombstoned one independently', () => {
    const prev = [native('nat-live'), native('nat-dead')];
    const out = rescueUnsyncedTasks(merged('a'), prev, { 'nat-dead': '2026-07-01T00:00:00.000Z' });
    expect(out.map((t) => t.id)).toEqual(['a', 'nat-live']);
  });

  it('never rescues a plain (unflagged) synced task, tombstoned or not', () => {
    // Plain tasks are governed entirely by the merge — absence means deleted.
    const prev = [plain('p-1')];
    expect(rescueUnsyncedTasks(merged('a'), prev, {}).map((t) => t.id)).toEqual(['a']);
    expect(rescueUnsyncedTasks(merged('a'), prev, { 'p-1': '2026-07-01T00:00:00.000Z' }).map((t) => t.id)).toEqual(['a']);
  });

  it('does not rescue a task already present in the merged list (no duplication)', () => {
    const prev = [imported('a')]; // same id as a merged item
    const out = rescueUnsyncedTasks(merged('a'), prev, {});
    expect(out.map((t) => t.id)).toEqual(['a']);
  });

  it('honors a custom rescuable predicate (recurring: _intentKey only) with the same tombstone guard', () => {
    const prev = [intent('int-live'), intent('int-dead'), imported('imp-x')];
    const isRescuable = (t) => !!t._intentKey;
    const out = rescueUnsyncedTasks(merged('a'), prev, { 'int-dead': '2026-07-01T00:00:00.000Z' }, isRescuable);
    // imp-x is not _intentKey → not eligible; int-dead is tombstoned → dropped.
    expect(out.map((t) => t.id)).toEqual(['a', 'int-live']);
  });

  it('KNOWN 60-DAY BOUNDARY: an offline-past-60 task has no tombstone, so it IS resurrected', () => {
    // Device offline > 60 days: the task is still in prev, its tombstone has been
    // GC'd (deletedIds no longer has it), and the fence-suppressed merge lacks it.
    // The guard cannot fire — the re-add resurrects it. This is the inherent limit
    // of a 60-day tombstone policy (same boundary as the resurrection fence), and is
    // asserted here so it reads as a documented boundary, not a future regression.
    const prev = [imported('imp-ancient')];
    const deletedIdsAfterGc = {}; // tombstone pruned at 60 days
    const out = rescueUnsyncedTasks(merged('a'), prev, deletedIdsAfterGc);
    expect(out.map((t) => t.id)).toEqual(['a', 'imp-ancient']); // resurrected — known limit
  });

  it('tolerates empty / null inputs', () => {
    expect(rescueUnsyncedTasks(null, null, null)).toEqual([]);
    expect(rescueUnsyncedTasks([], undefined)).toEqual([]);
    expect(rescueUnsyncedTasks(merged('a'), null).map((t) => t.id)).toEqual(['a']);
  });

  it('isDefaultRescuable flags native / imported / intent / obsidian, not plain', () => {
    expect(isDefaultRescuable(native('n'))).toBe(true);
    expect(isDefaultRescuable(imported('i'))).toBe(true);
    expect(isDefaultRescuable(intent('t'))).toBe(true);
    expect(isDefaultRescuable(obsidian('o', '2026-05-01T00:00:00.000Z'))).toBe(true);
    expect(isDefaultRescuable(plain('p'))).toBe(false);
    expect(isDefaultRescuable(null)).toBe(false);
  });

  describe('Obsidian tasks (the ala7ur flicker fix)', () => {
    it('RESCUES a live, note-backed Obsidian task the merge apply transiently omitted', () => {
      // The Obsidian scan added obsidian-2026-04-23-ala7ur to state; a DB-sync apply
      // then committed a merged set lacking it. It has no tombstone → keep it, so it
      // does not flicker out of state every cycle.
      const prev = [obsidian('obsidian-2026-04-23-ala7ur', '2026-04-23T09:30:00.000Z')];
      const out = rescueUnsyncedTasks(merged('a'), prev, {}, undefined, {});
      expect(out.map((t) => t.id)).toEqual(['a', 'obsidian-2026-04-23-ala7ur']);
    });

    it('does NOT rescue an Obsidian task deleted from the vault (deletedObsidianKeys wins)', () => {
      // The note line was removed; detectObsidianDeletions tombstoned it with a
      // deletion newer than the task. The rescue must leave it deleted.
      const prev = [obsidian('obsidian-2026-04-23-ala7ur', '2026-04-23T09:30:00.000Z')];
      const obsidianTombs = { 'obsidian-2026-04-23-ala7ur': '2026-06-01T00:00:00.000Z' };
      const out = rescueUnsyncedTasks(merged('a'), prev, {}, undefined, obsidianTombs);
      expect(out.map((t) => t.id)).toEqual(['a']); // stays deleted
    });

    it('RESCUES an Obsidian task re-created in the vault after its tombstone (LWW resurrect)', () => {
      // The user re-added the line; the fresh copy is newer than the deletion, so it
      // wins last-writer-wins and comes back — mirroring isObsidianTombstoned.
      const prev = [obsidian('obsidian-2026-04-23-ala7ur', '2026-07-05T00:00:00.000Z')];
      const obsidianTombs = { 'obsidian-2026-04-23-ala7ur': '2026-06-01T00:00:00.000Z' };
      const out = rescueUnsyncedTasks(merged('a'), prev, {}, undefined, obsidianTombs);
      expect(out.map((t) => t.id)).toEqual(['a', 'obsidian-2026-04-23-ala7ur']);
    });

    it('does NOT rescue an Obsidian task the user deleted in-app (deletedTaskIds guard still applies)', () => {
      // Deleting inside dayGLANCE writes deletedTaskIds; that shared guard covers
      // Obsidian tasks too, so an in-app delete is honored.
      const prev = [obsidian('obsidian-2026-04-23-ala7ur', '2026-04-23T09:30:00.000Z')];
      const out = rescueUnsyncedTasks(
        merged('a'), prev,
        { 'obsidian-2026-04-23-ala7ur': '2026-06-26T00:00:00.000Z' },
        undefined, {},
      );
      expect(out.map((t) => t.id)).toEqual(['a']);
    });

    it('rescues an Obsidian task already present in merged? no — no duplication', () => {
      const prev = [obsidian('dup', '2026-05-01T00:00:00.000Z')];
      const out = rescueUnsyncedTasks(merged('dup'), prev, {}, undefined, {});
      expect(out.map((t) => t.id)).toEqual(['dup']);
    });
  });
});
