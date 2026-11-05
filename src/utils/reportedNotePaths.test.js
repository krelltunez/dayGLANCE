import { describe, it, expect } from 'vitest';
import {
  reportedNoteIndexKey, emptyReportedNoteIndex, readableReportedNoteIndex, observationPathReport,
  mergeReportedNotePaths, resolveIndexedTaskNote, REPORTED_NOTE_INDEX_VERSION,
} from './reportedNotePaths.js';
import { parseTaskNoteLink } from './taskNoteSources.js';

// The index of reported note paths (#2291 follow-up: task notes): the
// structure, how listings update it, and how a task's link resolves against
// it. Each guard was mutation-checked: break it and a test below fails.

const KEY = 'https://vault.test|acc-1|gen-1|c2FsdA==';
const note = (path, seq) => ({ path, seq, state: 'n' });
const deleted = (path, seq) => ({ path, seq, state: 'd' });
const withdrawn = (path, seq) => ({ path, seq, state: 'w' });
/** A complete index holding these reports. */
const indexOf = (...reports) => mergeReportedNotePaths(null, { key: KEY, since: 0, maxSeq: 100, reports, full: true }).index;
const resolve = (name, index) => resolveIndexedTaskNote(parseTaskNoteLink(name), index);

describe('reportedNoteIndexKey (the pairing an index belongs to)', () => {
  it('names the server, the account and the pairing; a re-pair, another account or server is another key', () => {
    const cfg = { vaultUrl: 'https://vault.test/', accountId: 'acc-1' };
    const meta = { generation: 'gen-1', pairingSalt: 'c2FsdA==' };
    expect(reportedNoteIndexKey(cfg, meta)).toBe(KEY);
    expect(reportedNoteIndexKey(cfg, { ...meta, generation: 'gen-2' })).not.toBe(KEY);
    expect(reportedNoteIndexKey(cfg, { ...meta, pairingSalt: 'b3RoZXI=' })).not.toBe(KEY);
    expect(reportedNoteIndexKey({ ...cfg, accountId: 'acc-2' }, meta)).not.toBe(KEY);
    expect(reportedNoteIndexKey({ ...cfg, vaultUrl: 'https://other.test' }, meta)).not.toBe(KEY);
  });
  it('no key without a server, an account or a pairing', () => {
    expect(reportedNoteIndexKey(null, { pairingSalt: 'x' })).toBe(null);
    expect(reportedNoteIndexKey({ vaultUrl: 'u', accountId: 'a' }, null)).toBe(null);
    expect(reportedNoteIndexKey({ vaultUrl: 'u' }, { pairingSalt: 'x' })).toBe(null);
  });
});

describe('readableReportedNoteIndex (NOT LOADED IS NOT EMPTY)', () => {
  it('an index for this pairing reads back as it was stored', () => {
    const index = indexOf(note('A.md', 3));
    expect(readableReportedNoteIndex(structuredClone(index), KEY)).toEqual(index);
  });
  it('nothing stored, a value for another pairing, another version or a malformed one: no index (incomplete), never an empty one', () => {
    const index = indexOf(note('A.md', 3));
    expect(readableReportedNoteIndex(undefined, KEY)).toBe(null);
    expect(readableReportedNoteIndex(index, 'another|pairing')).toBe(null);
    expect(readableReportedNoteIndex({ ...index, v: REPORTED_NOTE_INDEX_VERSION + 1 }, KEY)).toBe(null);
    expect(readableReportedNoteIndex({ ...index, paths: null }, KEY)).toBe(null);
    expect(readableReportedNoteIndex({ ...index, paths: [] }, KEY)).toBe(null);
    expect(readableReportedNoteIndex({ ...index, complete: 'yes' }, KEY)).toBe(null);
    expect(readableReportedNoteIndex({ ...index, seq: 'x' }, KEY)).toBe(null);
    expect(readableReportedNoteIndex(index, null)).toBe(null);
  });
});

describe('observationPathReport (what one row says about its path)', () => {
  it('a note with content, a deletion, a withdrawal; a report with no content is gone', () => {
    expect(observationPathReport({ kind: 'observation', path: 'A.md', content: 'x' }, 4)).toEqual({ path: 'A.md', seq: 4, state: 'n' });
    expect(observationPathReport({ kind: 'observation', path: 'A.md', deleted: true }, 5)).toEqual({ path: 'A.md', seq: 5, state: 'd' });
    expect(observationPathReport({ kind: 'observation', path: 'A.md', withdrawn: true }, 6)).toEqual({ path: 'A.md', seq: 6, state: 'w' });
    expect(observationPathReport({ kind: 'observation', path: 'A.md' }, 7)).toEqual({ path: 'A.md', seq: 7, state: 'd' });
  });
  it('a project-note LINK row is not a note; an unreadable row, another kind or no path says nothing', () => {
    expect(observationPathReport({ kind: 'observation', link: true, path: 'Projects/House.md', targetId: 'p1' }, 4)).toBe(null);
    expect(observationPathReport(null, 4)).toBe(null);
    expect(observationPathReport({ kind: 'intent', path: 'A.md', content: 'x' }, 4)).toBe(null);
    expect(observationPathReport({ kind: 'observation', content: 'x' }, 4)).toBe(null);
  });
});

describe('mergeReportedNotePaths (applying a listing)', () => {
  it('a FULL listing completes the index; its seq is the listing\'s', () => {
    const { index, applied } = mergeReportedNotePaths(null, { key: KEY, since: 0, maxSeq: 9, reports: [note('A.md', 3)], full: true });
    expect(applied).toBe(true);
    expect(index).toMatchObject({ key: KEY, complete: true, seq: 9, paths: { 'A.md': [3, 'n'] } });
  });
  it('an incremental listing applies only where it CONTINUES a complete index; a gap, or no complete index, leaves it as it was', () => {
    const base = indexOf(note('A.md', 3)); // seq 100
    const next = mergeReportedNotePaths(base, { key: KEY, since: 100, maxSeq: 120, reports: [note('B.md', 110)] });
    expect(next.applied).toBe(true);
    expect(next.index).toMatchObject({ seq: 120, paths: { 'A.md': [3, 'n'], 'B.md': [110, 'n'] } });
    // Starting below the index's seq overlaps it: still continuous.
    expect(mergeReportedNotePaths(base, { key: KEY, since: 50, maxSeq: 120, reports: [] }).applied).toBe(true);
    // Starting above it leaves rows 101..150 unread: not applied.
    const gap = mergeReportedNotePaths(base, { key: KEY, since: 150, maxSeq: 160, reports: [note('C.md', 155)] });
    expect(gap).toEqual({ index: base, applied: false });
    // An index never completed is not continued by a partial listing.
    const partial = { ...emptyReportedNoteIndex(KEY), seq: 10 };
    expect(mergeReportedNotePaths(partial, { key: KEY, since: 10, maxSeq: 20, reports: [note('C.md', 15)] }).applied).toBe(false);
    expect(mergeReportedNotePaths(null, { key: KEY, since: 0, maxSeq: 20, reports: [note('C.md', 15)] }).applied).toBe(false);
  });
  it('a listing under ANOTHER pairing starts the index afresh: the old pairing\'s paths are gone, and only a full listing builds it', () => {
    const old = indexOf(note('Old.md', 3));
    const other = 'https://vault.test|acc-1|gen-2|b3RoZXI=';
    expect(mergeReportedNotePaths(old, { key: other, since: 100, maxSeq: 120, reports: [note('New.md', 110)] }).applied).toBe(false);
    const rebuilt = mergeReportedNotePaths(old, { key: other, since: 0, maxSeq: 5, reports: [note('New.md', 4)], full: true });
    expect(rebuilt.index).toMatchObject({ key: other, complete: true, seq: 5, paths: { 'New.md': [4, 'n'] } });
    expect(rebuilt.index.paths['Old.md']).toBeUndefined();
  });
  it('per path, the newer row stands: an older copy never brings a deleted note back, so listings may land in either order', () => {
    const later = [deleted('A.md', 20)];
    const earlier = [note('A.md', 10), note('B.md', 11)];
    const one = mergeReportedNotePaths(mergeReportedNotePaths(null, { key: KEY, maxSeq: 20, reports: later, full: true }).index, { key: KEY, since: 0, maxSeq: 11, reports: earlier, full: true }).index;
    const two = mergeReportedNotePaths(mergeReportedNotePaths(null, { key: KEY, maxSeq: 11, reports: earlier, full: true }).index, { key: KEY, since: 0, maxSeq: 20, reports: later, full: true }).index;
    expect(one.paths).toEqual({ 'A.md': [20, 'd'], 'B.md': [11, 'n'] });
    expect(two.paths).toEqual(one.paths);
    expect(one.seq).toBe(20);
    // Idempotent: the same listing again changes nothing.
    expect(mergeReportedNotePaths(one, { key: KEY, since: 0, maxSeq: 20, reports: later, full: true }).index).toEqual(one);
  });
  it('a DELETION and a WITHDRAWAL take the path out of the shared notes; a RENAME is the old path deleted and the new one reported', () => {
    let index = indexOf(note('Projects/Plan.md', 3), note('Areas/Budget.md', 4));
    expect(resolve('Plan', index)).toEqual({ path: 'Projects/Plan.md' });
    index = mergeReportedNotePaths(index, { key: KEY, since: 100, maxSeq: 102, reports: [deleted('Projects/Plan.md', 101), note('Projects/Roadmap.md', 102)] }).index;
    expect(resolve('Plan', index)).toEqual({ none: 'deleted' });
    expect(resolve('Roadmap', index)).toEqual({ path: 'Projects/Roadmap.md' });
    index = mergeReportedNotePaths(index, { key: KEY, since: 102, maxSeq: 103, reports: [withdrawn('Areas/Budget.md', 103)] }).index;
    expect(resolve('Budget', index)).toEqual({ none: 'withdrawn' });
    // Back in the scope: reported again.
    index = mergeReportedNotePaths(index, { key: KEY, since: 103, maxSeq: 104, reports: [note('Areas/Budget.md', 104)] }).index;
    expect(resolve('Budget', index)).toEqual({ path: 'Areas/Budget.md' });
  });
});

describe('resolveIndexedTaskNote (as Obsidian resolves a link)', () => {
  const index = indexOf(
    note('Work/Alpha/Plan.md', 1),
    note('Tags anywhere/Deep/Gutter repair.md', 2),
    note('Daily/2026-09-04.md', 3),
    note('Root note.md', 4),
  );
  it('an EXACT path', () => {
    expect(resolve('Work/Alpha/Plan', index)).toEqual({ path: 'Work/Alpha/Plan.md' });
    expect(resolve('Daily/2026-09-04', index)).toEqual({ path: 'Daily/2026-09-04.md' });
  });
  it('a BARE name by basename, in any folder: a note shared by a tag, a daily note, a root note', () => {
    expect(resolve('Gutter repair', index)).toEqual({ path: 'Tags anywhere/Deep/Gutter repair.md' });
    expect(resolve('2026-09-04', index)).toEqual({ path: 'Daily/2026-09-04.md' });
    expect(resolve('Root note', index)).toEqual({ path: 'Root note.md' });
    expect(resolve('Plan', index)).toEqual({ path: 'Work/Alpha/Plan.md' });
  });
  it('a PARTIAL path by suffix on SEGMENT boundaries only', () => {
    expect(resolve('Alpha/Plan', index)).toEqual({ path: 'Work/Alpha/Plan.md' });
    expect(resolve('Deep/Gutter repair', index)).toEqual({ path: 'Tags anywhere/Deep/Gutter repair.md' });
    expect(resolve('lpha/Plan', index)).toEqual({ none: 'unreported' });
    expect(resolve('ork/Alpha/Plan', index)).toEqual({ none: 'unreported' });
    expect(resolve('Beta/Plan', index)).toEqual({ none: 'unreported' });
    // A bare name is a whole basename too.
    expect(resolve('lan', index)).toEqual({ none: 'unreported' });
  });
  it('CASE and NFC fold: a link in either case or normalization finds the note under the path the plugin reported', () => {
    expect(resolve('alpha/PLAN', index)).toEqual({ path: 'Work/Alpha/Plan.md' });
    const nfd = indexOf(note('Notes/Café.md'.normalize('NFD'), 1));
    expect(resolve('café', nfd)).toEqual({ path: 'Notes/Café.md'.normalize('NFD') });
    expect(resolve('Notes/CAFÉ'.normalize('NFD'), nfd)).toEqual({ path: 'Notes/Café.md'.normalize('NFD') });
  });
  it('spellings of ONE path (case, normalization) are one note in the state of its newest row, not two', () => {
    const twice = indexOf(note('Notes/Café.md'.normalize('NFD'), 1), note('Notes/Café.md'.normalize('NFC'), 2));
    expect(resolve('Café', twice)).toEqual({ path: 'Notes/Café.md'.normalize('NFC') });
    const goneSince = indexOf(note('Notes/Plan.md', 1), deleted('notes/plan.md', 2));
    expect(resolve('Plan', goneSince)).toEqual({ none: 'deleted' });
  });
  it('AMBIGUOUS: two reported notes of the name, or two partial-path matches; an exact path wins over suffix matches', () => {
    const two = indexOf(note('Projects/Gutter repair.md', 1), note('Areas/Gutter repair.md', 2));
    expect(resolve('Gutter repair', two)).toEqual({ ambiguous: true });
    expect(resolve('Areas/Gutter repair', two)).toEqual({ path: 'Areas/Gutter repair.md' });
    const suffixes = indexOf(note('Work/Alpha/Plan.md', 1), note('Home/Alpha/Plan.md', 2));
    expect(resolve('Alpha/Plan', suffixes)).toEqual({ ambiguous: true });
    const withExact = indexOf(note('Alpha/Plan.md', 1), note('Work/Alpha/Plan.md', 2));
    expect(resolve('Alpha/Plan', withExact)).toEqual({ path: 'Alpha/Plan.md' });
    // A bare name has no exact path to prefer: a root note and a nested one are two notes.
    const rootAndNested = indexOf(note('Plan.md', 1), note('Work/Plan.md', 2));
    expect(resolve('Plan', rootAndNested)).toEqual({ ambiguous: true });
  });
  it('a deleted or withdrawn note does not count toward ambiguity; with nothing reported, withdrawn says more than deleted', () => {
    const one = indexOf(note('Projects/Gutter repair.md', 1), deleted('Areas/Gutter repair.md', 2), withdrawn('Old/Gutter repair.md', 3));
    expect(resolve('Gutter repair', one)).toEqual({ path: 'Projects/Gutter repair.md' });
    const none = indexOf(deleted('Areas/Gutter repair.md', 2), withdrawn('Old/Gutter repair.md', 3));
    expect(resolve('Gutter repair', none)).toEqual({ none: 'withdrawn' });
    expect(resolve('Areas/Gutter repair', none)).toEqual({ none: 'deleted' });
    expect(resolve('Nothing like it', none)).toEqual({ none: 'unreported' });
  });
});
