import { describe, it, expect } from 'vitest';
import {
  inferNoteScopedDeletionCandidates,
  reconcileNoteScopedDeletions,
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

describe('reconcileNoteScopedDeletions (one-cycle confirmation hold)', () => {
  const live = new Set([ORPHAN_ID]);
  const cand = { id: ORPHAN_ID, noteDate: DATE, deletedAt: MTIME };

  it('pends a fresh candidate; commits it on the NEXT successful fetch when it never reappeared', () => {
    const first = reconcileNoteScopedDeletions({
      pending: {}, candidates: [cand], scannedIds: new Set(), liveIds: live,
    });
    expect(first.commits).toEqual([]);
    expect(first.nextPending).toEqual({ [ORPHAN_ID]: { noteDate: DATE, deletedAt: MTIME } });

    // Next fetch: empty batch — complete knowledge that the id never came back.
    const second = reconcileNoteScopedDeletions({
      pending: first.nextPending, candidates: [], scannedIds: new Set(), liveIds: live,
    });
    expect(second.commits).toEqual([{ id: ORPHAN_ID, noteDate: DATE, deletedAt: MTIME }]);
    expect(second.nextPending).toEqual({});
  });

  it('rescues a pended id that reappears in the next batch (the other half of a cross-note move)', () => {
    const { commits, nextPending } = reconcileNoteScopedDeletions({
      pending: { [ORPHAN_ID]: { noteDate: DATE, deletedAt: MTIME } },
      candidates: [], scannedIds: new Set([ORPHAN_ID]), liveIds: live,
    });
    expect(commits).toEqual([]);
    expect(nextPending).toEqual({});
  });

  it('drops a pended id whose task is no longer live (someone else recorded its removal)', () => {
    const { commits, nextPending } = reconcileNoteScopedDeletions({
      pending: { [ORPHAN_ID]: { noteDate: DATE, deletedAt: MTIME } },
      candidates: [], scannedIds: new Set(), liveIds: new Set(),
    });
    expect(commits).toEqual([]);
    expect(nextPending).toEqual({});
  });

  it('absent twice commits with the NEWEST evidence stamp and does not re-pend', () => {
    const newer = { id: ORPHAN_ID, noteDate: DATE, deletedAt: '2026-08-30T18:00:00.000Z' };
    const { commits, nextPending } = reconcileNoteScopedDeletions({
      pending: { [ORPHAN_ID]: { noteDate: DATE, deletedAt: MTIME } },
      candidates: [newer], scannedIds: new Set(), liveIds: live,
    });
    expect(commits).toEqual([newer]);
    expect(nextPending).toEqual({});
  });
});
