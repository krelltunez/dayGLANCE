import { describe, it, expect } from 'vitest';

// REVIVAL STAMPING (§3.10 ruling 6). The tombstone question is an EXISTENCE
// question, and the honest timestamp for "does the vault say this line
// exists" is the note's mtime — the vault's statement time. The task
// record's lastModified answers a different question (content LWW); the two
// sharing a field is what made the documented "a later re-creation in
// Obsidian wins" rule inert for tasks: fresh imports stamp epoch, so a
// verbatim retype lost to its tombstone until the 60-day GC. These pins
// cover the ruling's one narrow move — a scanned row about to be dropped by
// a tombstone OLDER than its note's mtime is admitted with lastModified
// lifted to that mtime — and the two guardrails that keep it narrow.

import { mergeObsidianTasks, noteMtimesFromDailyNotes } from './mergeObsidianTasks.js';
import { dropTombstonedObsidianTasks } from './obsidianDeletions.js';
import { legacyObsidianId, deriveBlockId, appIdForBlockId } from '@glance-apps/obsidian-format';

const D = '2026-08-30';
const RAW = 'Retype me exactly';
const L = legacyObsidianId(D, RAW);
const B = deriveBlockId(D, RAW);
const DG = appIdForBlockId(B);
const T1 = '2026-08-30T10:00:00.000Z'; // tombstone (deletion statement)
const T2 = '2026-08-30T11:00:00.000Z'; // note mtime, after the tombstone
const T0 = '2026-08-30T09:00:00.000Z'; // note mtime, before the tombstone
const EPOCH = '1970-01-01T00:00:00.000Z';

const noPreserve = () => ({});
const scannedRow = (over = {}) => ({
  id: L, importSource: 'obsidian', obsidianRawTitle: RAW, obsidianFileDate: D,
  title: `${RAW} #obsidian`, completed: false, lastModified: EPOCH,
  ...over,
});

describe('revival stamping (§3.10 ruling 6)', () => {
  it('a scanned row dropped by a tombstone OLDER than its note mtime is admitted, lastModified lifted to the note mtime', () => {
    const merged = mergeObsidianTasks(
      [], [scannedRow()], new Set([L]), noPreserve, { [L]: T1 }, { [D]: T2 });
    expect(merged.map(t => t.id)).toEqual([L]);
    expect(merged[0].lastModified).toBe(T2); // the lift IS the propagation
  });

  it('the re-derived-token variant: a stamped id whose tombstone predates the tagged note revives the same way', () => {
    // The retyped line was stamped back to the SAME deterministic token, so
    // the scanned row now carries the tombstoned dg id.
    const merged = mergeObsidianTasks(
      [], [scannedRow({ id: DG, obsidianBlockId: B, obsidianLegacyId: L })],
      new Set([DG, L]), noPreserve, { [DG]: T1 }, { [D]: T2 });
    expect(merged.map(t => t.id)).toEqual([DG]);
    expect(merged[0].lastModified).toBe(T2);
  });

  it('REGRESSION GUARD (epoch is load-bearing): a fresh import with NO tombstone keeps epoch even when note mtimes are supplied', () => {
    // A bare re-parse carries none of the app-only fields; if this pin ever
    // fails because someone widened the revival condition, a cold-open
    // device's default-filled copy can beat real records in row LWW and
    // wipe projectId/color/notes/assignedUserSyncIds/completedAt
    // fleet-wide. See the callsite comment and §3.10 ruling 6.
    const merged = mergeObsidianTasks(
      [], [scannedRow()], new Set([L]), noPreserve, {}, { [D]: T2 });
    expect(merged[0].lastModified).toBe(EPOCH);
  });

  it('a tombstone AS NEW AS or newer than the note mtime still suppresses', () => {
    // Newer: the deletion statement postdates the note state we read.
    expect(mergeObsidianTasks(
      [], [scannedRow()], new Set([L]), noPreserve, { [L]: T1 }, { [D]: T0 })).toEqual([]);
    // Tie: the channel's existing >= rule, unchanged.
    expect(mergeObsidianTasks(
      [], [scannedRow()], new Set([L]), noPreserve, { [L]: T2 }, { [D]: T2 })).toEqual([]);
    // No mtime evidence for the note at all: stays gone.
    expect(mergeObsidianTasks(
      [], [scannedRow()], new Set([L]), noPreserve, { [L]: T1 }, {})).toEqual([]);
  });

  it('a row that already beats its tombstone never has its content-LWW stamp regressed toward the note mtime', () => {
    const newer = '2026-08-30T12:00:00.000Z'; // app edit after the note write
    const merged = mergeObsidianTasks(
      [], [scannedRow({ lastModified: newer })], new Set([L]), noPreserve,
      { [L]: T1 }, { [D]: T2 });
    expect(merged[0].lastModified).toBe(newer);
  });

  it('the revived row survives the apply gate on a second device — the counterfactual epoch row does not', () => {
    const tomb = { [L]: T1 };
    const revived = scannedRow({ lastModified: T2 });
    const unlifted = scannedRow(); // epoch — what synced before ruling 6
    expect(dropTombstonedObsidianTasks([revived], tomb)).toEqual([revived]);
    expect(dropTombstonedObsidianTasks([unlifted], tomb)).toEqual([]);
  });

  it('retained rows are not revived — no fresh vault statement covers their notes', () => {
    const held = scannedRow({ lastModified: EPOCH });
    const merged = mergeObsidianTasks(
      [held], [], new Set(), noPreserve, { [L]: T1 }, { [D]: T2 });
    expect(merged).toEqual([]);
  });

  it('noteMtimesFromDailyNotes maps the scan/observation dailyNotes shape', () => {
    expect(noteMtimesFromDailyNotes({
      [D]: { text: 'x', lastModified: T2 },
      '2026-08-29': { text: 'y' },
    })).toEqual({ [D]: T2 });
    expect(noteMtimesFromDailyNotes(undefined)).toEqual({});
  });
});
