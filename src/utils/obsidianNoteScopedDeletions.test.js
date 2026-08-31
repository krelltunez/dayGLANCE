import { describe, it, expect } from 'vitest';
import {
  inferNoteScopedDeletionCandidates,
  reconcileNoteScopedDeletions,
  NOTE_DELETION_HOLD_MS,
} from './obsidianNoteScopedDeletions.js';
import { legacyObsidianId, deriveBlockId, appIdForBlockId } from '@glance-apps/obsidian-format';

const DATE = '2026-08-30';
const MTIME = '2026-08-30T17:00:00.000Z';
const NOTE = { [DATE]: { lastModified: MTIME } };

const ORPHAN_RAW = 'Another test of dayGLANCE bridge';
const ORPHAN_ID = legacyObsidianId(DATE, ORPHAN_RAW);
const orphan = (over = {}) => ({
  id: ORPHAN_ID, importSource: 'obsidian', obsidianRawTitle: ORPHAN_RAW,
  obsidianFileDate: DATE, date: DATE, title: `${ORPHAN_RAW} #obsidian`,
  lastModified: '2026-08-30T12:00:00.000Z',
  ...over,
});

const BLOCK = deriveBlockId(DATE, ORPHAN_RAW);
const DG_ID = appIdForBlockId(BLOCK);

describe('inferNoteScopedDeletionCandidates', () => {
  it('flags a task whose observed home note no longer carries its id, stamped at the note mtime', () => {
    const out = inferNoteScopedDeletionCandidates({
      observedNotes: NOTE, scannedIds: new Set(), tasks: [orphan()], inbox: [],
    });
    expect(out).toEqual([{ id: ORPHAN_ID, noteDate: DATE, deletedAt: MTIME }]);
  });

  it('falls back to the date baked into a legacy id when obsidianFileDate is absent', () => {
    const out = inferNoteScopedDeletionCandidates({
      observedNotes: NOTE, scannedIds: new Set(),
      tasks: [orphan({ obsidianFileDate: undefined })], inbox: [],
    });
    expect(out.map(c => c.id)).toEqual([ORPHAN_ID]);
  });

  it('never flags: id present, hint advertising the id, own hint present, unobserved note, non-obsidian task, undatable dg id', () => {
    const base = { observedNotes: NOTE, tasks: [], inbox: [] };
    // id itself parsed from the note
    expect(inferNoteScopedDeletionCandidates({ ...base, scannedIds: new Set([ORPHAN_ID]), tasks: [orphan()] })).toEqual([]);
    // a tagged line advertises the legacy id as its obsidianLegacyId hint —
    // scannedIds carries hints, so the check is the same membership test
    expect(inferNoteScopedDeletionCandidates({ ...base, scannedIds: new Set([ORPHAN_ID]), tasks: [orphan()] })).toEqual([]);
    // the task's own hint is present (its line was stamped: id moved on)
    expect(inferNoteScopedDeletionCandidates({
      ...base, scannedIds: new Set([ORPHAN_ID]),
      tasks: [orphan({ id: DG_ID, obsidianBlockId: BLOCK, obsidianLegacyId: ORPHAN_ID })],
    })).toEqual([]);
    // home note not in this batch — no evidence either way
    expect(inferNoteScopedDeletionCandidates({
      ...base, observedNotes: { '2026-08-29': { lastModified: MTIME } },
      scannedIds: new Set(), tasks: [orphan()],
    })).toEqual([]);
    // not an obsidian task
    expect(inferNoteScopedDeletionCandidates({
      ...base, scannedIds: new Set(), tasks: [orphan({ importSource: undefined })],
    })).toEqual([]);
    // a dg id carries no date of its own; without obsidianFileDate it is
    // conservatively unjudgeable
    expect(inferNoteScopedDeletionCandidates({
      ...base, scannedIds: new Set(),
      tasks: [orphan({ id: DG_ID, obsidianBlockId: BLOCK, obsidianFileDate: undefined })],
    })).toEqual([]);
  });

  it('covers inbox tasks and tagged tasks with a matching obsidianFileDate', () => {
    const tagged = orphan({ id: DG_ID, obsidianBlockId: BLOCK });
    const out = inferNoteScopedDeletionCandidates({
      observedNotes: NOTE, scannedIds: new Set(), tasks: [], inbox: [tagged],
    });
    expect(out.map(c => c.id)).toEqual([DG_ID]);
  });
});

describe('reconcileNoteScopedDeletions (wall-clock confirmation hold)', () => {
  const live = new Set([ORPHAN_ID]);
  const cand = { id: ORPHAN_ID, noteDate: DATE, deletedAt: MTIME };
  const T0 = Date.parse('2026-08-31T09:00:00.000Z');
  const HOLD = NOTE_DELETION_HOLD_MS;

  it('THE TIMESCALE PIN (2026-08-31 war): a commit requires ≥90s of wall-clock absence — any number of faster fetches never concludes it sooner', () => {
    // Pend at T0.
    const first = reconcileNoteScopedDeletions({
      pending: {}, candidates: [cand], scannedIds: new Set(), liveIds: live, nowMs: T0,
    });
    expect(first.commits).toEqual([]);
    expect(first.nextPending).toEqual({ [ORPHAN_ID]: { noteDate: DATE, deletedAt: MTIME, pendedAt: T0 } });

    // The war's shape: SSE-speed fetches every ~2s. Each is a subsequent
    // complete fetch with the id absent — the OLD (cycle-counted) hold
    // committed on the very first of these. The wall clock refuses them all.
    let pending = first.nextPending;
    for (let t = T0 + 2_000; t < T0 + HOLD; t += 2_000 * 15) {
      const r = reconcileNoteScopedDeletions({
        pending, candidates: [], scannedIds: new Set(), liveIds: live, nowMs: t,
      });
      expect(r.commits).toEqual([]);
      // Carried forward with the ORIGINAL pendedAt — the clock never resets.
      expect(r.nextPending[ORPHAN_ID].pendedAt).toBe(T0);
      pending = r.nextPending;
    }

    // At T0+90s, a subsequent fetch with the id still absent commits.
    const done = reconcileNoteScopedDeletions({
      pending, candidates: [], scannedIds: new Set(), liveIds: live, nowMs: T0 + HOLD,
    });
    expect(done.commits).toEqual([{ id: ORPHAN_ID, noteDate: DATE, deletedAt: MTIME }]);
    expect(done.nextPending).toEqual({});
  });

  it('the evidencing batch itself never commits, even when 90s have somehow already passed — a SUBSEQUENT fetch is still required', () => {
    const r = reconcileNoteScopedDeletions({
      pending: {}, candidates: [cand], scannedIds: new Set(), liveIds: live, nowMs: T0 + 10 * HOLD,
    });
    expect(r.commits).toEqual([]);
    expect(r.nextPending[ORPHAN_ID]).toBeTruthy();
  });

  it('rescues a pended id that reappears (the other half of a cross-note move) — age is irrelevant to a rescue', () => {
    const { commits, nextPending } = reconcileNoteScopedDeletions({
      pending: { [ORPHAN_ID]: { noteDate: DATE, deletedAt: MTIME, pendedAt: T0 - 10 * HOLD } },
      candidates: [], scannedIds: new Set([ORPHAN_ID]), liveIds: live, nowMs: T0,
    });
    expect(commits).toEqual([]);
    expect(nextPending).toEqual({});
  });

  it('drops a pended id whose task is no longer live (someone else recorded its removal)', () => {
    const { commits, nextPending } = reconcileNoteScopedDeletions({
      pending: { [ORPHAN_ID]: { noteDate: DATE, deletedAt: MTIME, pendedAt: T0 - 10 * HOLD } },
      candidates: [], scannedIds: new Set(), liveIds: new Set(), nowMs: T0,
    });
    expect(commits).toEqual([]);
    expect(nextPending).toEqual({});
  });

  it('an aged-out entry re-evidenced this batch commits with the NEWEST evidence stamp and does not re-pend', () => {
    const newer = { id: ORPHAN_ID, noteDate: DATE, deletedAt: '2026-08-30T18:00:00.000Z' };
    const { commits, nextPending } = reconcileNoteScopedDeletions({
      pending: { [ORPHAN_ID]: { noteDate: DATE, deletedAt: MTIME, pendedAt: T0 - HOLD } },
      candidates: [newer], scannedIds: new Set(), liveIds: live, nowMs: T0,
    });
    expect(commits).toEqual([newer]);
    expect(nextPending).toEqual({});
  });

  it('a still-young entry re-evidenced this batch keeps its ORIGINAL pendedAt but takes the newest evidence stamp', () => {
    const newer = { id: ORPHAN_ID, noteDate: DATE, deletedAt: '2026-08-30T18:00:00.000Z' };
    const { commits, nextPending } = reconcileNoteScopedDeletions({
      pending: { [ORPHAN_ID]: { noteDate: DATE, deletedAt: MTIME, pendedAt: T0 - 60_000 } },
      candidates: [newer], scannedIds: new Set(), liveIds: live, nowMs: T0,
    });
    expect(commits).toEqual([]);
    expect(nextPending).toEqual({
      [ORPHAN_ID]: { noteDate: DATE, deletedAt: newer.deletedAt, pendedAt: T0 - 60_000 },
    });
  });

  it('MIGRATION: a persisted entry without pendedAt starts its clock NOW — never "assume it has already waited"', () => {
    const first = reconcileNoteScopedDeletions({
      pending: { [ORPHAN_ID]: { noteDate: DATE, deletedAt: MTIME } },
      candidates: [], scannedIds: new Set(), liveIds: live, nowMs: T0,
    });
    expect(first.commits).toEqual([]);
    expect(first.nextPending[ORPHAN_ID].pendedAt).toBe(T0);
    const later = reconcileNoteScopedDeletions({
      pending: first.nextPending, candidates: [], scannedIds: new Set(), liveIds: live, nowMs: T0 + HOLD,
    });
    expect(later.commits).toHaveLength(1);
  });
});
