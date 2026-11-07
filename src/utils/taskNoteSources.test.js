import { describe, it, expect } from 'vitest';
import { noteTextHash } from '@glance-apps/obsidian-format';
import {
  parseTaskNoteLink, knownTaskNotePaths, taskNoteCandidates, resolveReportedTaskNote, indexedTaskNote,
  newestTaskNote, newNotesFolderOutsideScope, TASK_NOTE_MAX_CANDIDATES,
} from './taskNoteSources.js';

// A task's linked note on a device that may not read the vault folder
// (#2291 follow-up): the name-to-path resolution and the newest-source rule.
// Each guard was mutation-checked: break it and a test below fails.

const note = (path, text = `Notes for ${path}`, extra = {}) => ({
  status: 'note', path, text, base: noteTextHash(text), lastModified: '2026-11-05T09:00:00.000Z', observedAt: '2026-11-05T09:00:05.000Z', ...extra,
});
const NEVER = { status: 'never' };

describe('parseTaskNoteLink', () => {
  it('a link with a folder names its path; a bare name is a basename', () => {
    expect(parseTaskNoteLink('Projects/House/Gutter repair')).toEqual({ path: 'Projects/House/Gutter repair.md', qualified: true, basename: 'Gutter repair' });
    expect(parseTaskNoteLink('Gutter repair')).toEqual({ path: 'Gutter repair.md', qualified: false, basename: 'Gutter repair' });
  });
  it('drops the heading, the alias, the brackets and a typed .md', () => {
    expect(parseTaskNoteLink('[[Gutter repair#Quotes|the gutters]]')).toMatchObject({ path: 'Gutter repair.md', basename: 'Gutter repair' });
    expect(parseTaskNoteLink('Projects/House.md#^abc')).toMatchObject({ path: 'Projects/House.md', qualified: true });
    expect(parseTaskNoteLink(' /Projects\\House/ ')).toMatchObject({ path: 'Projects/House.md', qualified: true });
  });
  it('is NFC, so a decomposed name and a composed one are one link', () => {
    expect(parseTaskNoteLink('Café'.normalize('NFD')).path).toBe('Café.md'.normalize('NFC'));
  });
  it('nothing left, or a path out of the vault, is no link', () => {
    expect(parseTaskNoteLink('')).toBe(null);
    expect(parseTaskNoteLink('#Heading')).toBe(null);
    expect(parseTaskNoteLink('../Secrets')).toBe(null);
    expect(parseTaskNoteLink('Projects//House')).toBe(null);
  });
});

describe('knownTaskNotePaths', () => {
  it('the notes synced state says exist: imported tasks\' notes, migration targets, linked project and goal notes', () => {
    const paths = knownTaskNotePaths({
      tasks: [{ obsidianNotePath: 'Projects/Gutter repair.md' }, { obsidianNoteTarget: 'Projects/House/Quotes' }, { obsidianNotePath: 'projects/gutter repair.md' }, null],
      projects: [{ obsidianNotePath: 'Projects/House.md' }, { obsidianNotePath: 'Projects/Gone.md', obsidianNoteMissingAt: 'x' }, { obsidianNotePath: 'Bare', obsidianNoteLinkPending: true }],
      goals: [{ obsidianNotePath: 'Goals/Home.md' }],
    });
    expect(paths).toEqual(['Projects/Gutter repair.md', 'Projects/House/Quotes.md', 'Projects/House.md', 'Goals/Home.md']);
  });
});

describe('taskNoteCandidates', () => {
  it('a link with a folder asks for its own path and nothing else', () => {
    const plan = taskNoteCandidates(parseTaskNoteLink('Projects/House/Gutter repair'), { knownPaths: ['Archive/Gutter repair.md'], newNotesFolder: 'dayGLANCE', scopeFolders: ['Projects'] });
    expect(plan.paths).toEqual(['Projects/House/Gutter repair.md']);
  });
  it('a bare name asks for the known notes of that basename (any case), then the likely homes, once each', () => {
    const plan = taskNoteCandidates(parseTaskNoteLink('Gutter repair'), {
      knownPaths: ['Projects/House/gutter repair.md', 'Projects/House.md'], newNotesFolder: '/dayGLANCE/', scopeFolders: ['Projects', 'dayGLANCE'],
    });
    expect(plan.paths).toEqual(['Projects/House/gutter repair.md', 'Gutter repair.md', 'dayGLANCE/Gutter repair.md', 'Projects/Gutter repair.md']);
    expect([...plan.known]).toEqual(['projects/house/gutter repair.md']);
  });
  it('while the index is incomplete, the daily-notes folder is a likely home too', () => {
    const plan = taskNoteCandidates(parseTaskNoteLink('2026-09-04'), { newNotesFolder: 'dayGLANCE', dailyNotesFolder: '/Daily/', scopeFolders: ['Projects'] });
    expect(plan.paths).toEqual(['2026-09-04.md', 'dayGLANCE/2026-09-04.md', 'Daily/2026-09-04.md', 'Projects/2026-09-04.md']);
  });
  it('is bounded: never more than the cap; more known notes of the name than the cap is ambiguous outright', () => {
    const scopeFolders = Array.from({ length: 20 }, (_, i) => `Area ${i}`);
    expect(taskNoteCandidates(parseTaskNoteLink('Plan'), { scopeFolders }).paths).toHaveLength(TASK_NOTE_MAX_CANDIDATES);
    const knownPaths = Array.from({ length: TASK_NOTE_MAX_CANDIDATES + 1 }, (_, i) => `Area ${i}/Plan.md`);
    expect(taskNoteCandidates(parseTaskNoteLink('Plan'), { knownPaths })).toEqual({ ambiguous: true });
  });
});

describe('resolveReportedTaskNote', () => {
  const bare = (opts) => taskNoteCandidates(parseTaskNoteLink('Gutter repair'), { newNotesFolder: 'dayGLANCE', ...opts });
  it('exactly one note of the name reported: that note, from the report, under the path Obsidian named it by', () => {
    const plan = bare();
    const readings = plan.paths.map((p) => (p === 'dayGLANCE/Gutter repair.md' ? note(p, 'Call the roofer.') : NEVER));
    expect(resolveReportedTaskNote(plan, readings)).toEqual({
      text: 'Call the roofer.', base: noteTextHash('Call the roofer.'), lastModified: '2026-11-05T09:00:00.000Z',
      observedAt: '2026-11-05T09:00:05.000Z', path: 'dayGLANCE/Gutter repair.md', source: 'report',
    });
  });
  it('AMBIGUOUS: two notes of the name exist, and neither is shown', () => {
    const plan = bare({ scopeFolders: ['Projects'] });
    const readings = plan.paths.map((p) => (p === 'Gutter repair.md' || p === 'Projects/Gutter repair.md' ? note(p) : NEVER));
    expect(resolveReportedTaskNote(plan, readings)).toEqual({ unavailable: 'ambiguous' });
  });
  it('a note withdrawn from the scope still exists: with a reported one beside it, ambiguous; alone, not shared', () => {
    const plan = bare({ scopeFolders: ['Projects'] });
    const both = plan.paths.map((p) => (p === 'Projects/Gutter repair.md' ? note(p) : p === 'Gutter repair.md' ? { status: 'withdrawn' } : NEVER));
    expect(resolveReportedTaskNote(plan, both)).toEqual({ unavailable: 'ambiguous' });
    const alone = plan.paths.map((p) => (p === 'Gutter repair.md' ? { status: 'withdrawn' } : NEVER));
    expect(resolveReportedTaskNote(plan, alone)).toEqual({ unavailable: 'not_shared' });
  });
  it('a known note never reported counts as existing (ambiguity), a likely home never reported does not', () => {
    const plan = bare({ knownPaths: ['Archive/Gutter repair.md'] });
    const readings = plan.paths.map((p) => (p === 'dayGLANCE/Gutter repair.md' ? note(p) : NEVER));
    expect(resolveReportedTaskNote(plan, readings)).toEqual({ unavailable: 'ambiguous' });
    const onlyKnown = plan.paths.map(() => NEVER);
    expect(resolveReportedTaskNote(plan, onlyKnown)).toEqual({ unavailable: 'not_shared' });
  });
  it('a request that failed leaves uniqueness unproven: unreachable, not the one that answered', () => {
    const plan = bare();
    const readings = plan.paths.map((p, i) => (i === 0 ? { status: 'unavailable' } : p === 'dayGLANCE/Gutter repair.md' ? note(p) : NEVER));
    expect(resolveReportedTaskNote(plan, readings)).toEqual({ unavailable: 'unreachable' });
  });
  it('DELETED is not found; NEVER REPORTED is not shared (no information, never "deleted")', () => {
    const plan = bare();
    expect(resolveReportedTaskNote(plan, plan.paths.map((p) => (p === 'dayGLANCE/Gutter repair.md' ? { status: 'deleted' } : NEVER)))).toEqual({ unavailable: 'deleted' });
    expect(resolveReportedTaskNote(plan, plan.paths.map(() => NEVER))).toEqual({ unavailable: 'not_shared' });
    // A deleted copy beside one that exists: the one that exists.
    expect(resolveReportedTaskNote(plan, plan.paths.map((p) => (p === 'Gutter repair.md' ? { status: 'deleted' } : note(p))))).toMatchObject({ source: 'report', path: 'dayGLANCE/Gutter repair.md' });
  });
  it('a link with a folder: its one report decides, with no ambiguity check', () => {
    const plan = taskNoteCandidates(parseTaskNoteLink('Projects/House/Gutter repair'), { knownPaths: ['Archive/Gutter repair.md'] });
    expect(resolveReportedTaskNote(plan, [note('Projects/House/Gutter repair.md')])).toMatchObject({ source: 'report' });
    expect(resolveReportedTaskNote(plan, [NEVER])).toEqual({ unavailable: 'not_shared' });
    expect(resolveReportedTaskNote(plan, [{ status: 'deleted' }])).toEqual({ unavailable: 'deleted' });
  });
});

describe('indexedTaskNote (a name resolved through the index of reported note paths)', () => {
  it('the one matching note: its report, under the path Obsidian named it by', () => {
    expect(indexedTaskNote({ path: 'Tags/Gutter repair.md' }, note('Tags/Gutter repair.md', 'Call the roofer.'))).toEqual({
      text: 'Call the roofer.', base: noteTextHash('Call the roofer.'), lastModified: '2026-11-05T09:00:00.000Z',
      observedAt: '2026-11-05T09:00:05.000Z', path: 'Tags/Gutter repair.md', source: 'report',
    });
  });
  it('the match read now says otherwise (the index was behind): deleted, not shared, or could not ask', () => {
    expect(indexedTaskNote({ path: 'A.md' }, { status: 'deleted' })).toEqual({ unavailable: 'deleted' });
    expect(indexedTaskNote({ path: 'A.md' }, { status: 'withdrawn' })).toEqual({ unavailable: 'not_shared' });
    expect(indexedTaskNote({ path: 'A.md' }, NEVER)).toEqual({ unavailable: 'not_shared' });
    expect(indexedTaskNote({ path: 'A.md' }, { status: 'unavailable' })).toEqual({ unavailable: 'unreachable' });
  });
  it('ambiguous whatever was read', () => {
    expect(indexedTaskNote({ ambiguous: true }, null)).toEqual({ unavailable: 'ambiguous' });
    expect(indexedTaskNote({ ambiguous: true }, note('A.md'))).toEqual({ unavailable: 'ambiguous' });
  });
  it('no match: the index says why; a note at the link\'s own path reported since the index was brought up is shown', () => {
    expect(indexedTaskNote({ none: 'unreported' }, null)).toEqual({ unavailable: 'not_shared' });
    expect(indexedTaskNote({ none: 'withdrawn' }, null)).toEqual({ unavailable: 'not_shared' });
    expect(indexedTaskNote({ none: 'deleted' }, null)).toEqual({ unavailable: 'deleted' });
    expect(indexedTaskNote({ none: 'unreported' }, note('Gutter repair.md'))).toMatchObject({ source: 'report', path: 'Gutter repair.md' });
    // The direct read adds what the index lacked; a failed one changes nothing.
    expect(indexedTaskNote({ none: 'unreported' }, { status: 'deleted' })).toEqual({ unavailable: 'deleted' });
    expect(indexedTaskNote({ none: 'deleted' }, { status: 'unavailable' })).toEqual({ unavailable: 'deleted' });
    expect(indexedTaskNote({ none: 'withdrawn' }, { status: 'deleted' })).toEqual({ unavailable: 'not_shared' });
  });
});

describe('newestTaskNote (the folder\'s copy and the report of the same path)', () => {
  const file = (text, lastModified) => ({ text, lastModified, path: 'Projects/Gutter repair.md' });
  it('both: the provably newer wins, file mtime to file mtime; a tie or a missing time keeps the file', () => {
    const r = note('Projects/Gutter repair.md', 'Edited in Obsidian.', { lastModified: '2026-11-05T10:00:00.000Z' });
    expect(newestTaskNote(file('Stale copy.', '2026-11-05T09:00:00.000Z'), r)).toMatchObject({ text: 'Edited in Obsidian.', source: 'report' });
    expect(newestTaskNote(file('Edited here.', '2026-11-05T11:00:00.000Z'), r)).toMatchObject({ text: 'Edited here.', source: 'file' });
    expect(newestTaskNote(file('Same time.', '2026-11-05T10:00:00.000Z'), r)).toMatchObject({ source: 'file' });
    expect(newestTaskNote(file('No time.', null), r)).toMatchObject({ source: 'file' });
    // A newer report with the same text: the local reading, with no age on it.
    expect(newestTaskNote(file('Edited in Obsidian.', '2026-11-05T09:00:00.000Z'), r)).toMatchObject({ source: 'file' });
  });
  it('a reported deletion is not found over a local copy; where the folder lacks the note too, its create editor stands', () => {
    expect(newestTaskNote(file('Stale copy.', '2026-11-05T12:00:00.000Z'), { status: 'deleted' })).toEqual({ unavailable: 'deleted' });
    expect(newestTaskNote({ notFound: true }, { status: 'deleted' })).toEqual({ notFound: true });
  });
  it('withdrawn, never reported or not asked: no information, the folder stands', () => {
    for (const reported of [{ status: 'withdrawn' }, NEVER, { status: 'unavailable' }, null]) {
      expect(newestTaskNote(file('Mine.', 'L'), reported)).toMatchObject({ text: 'Mine.', source: 'file' });
    }
  });
});

describe('newNotesFolderOutsideScope', () => {
  const link = parseTaskNoteLink;
  it('says so for a bare name, or a link into that folder, when no scope folder holds it', () => {
    expect(newNotesFolderOutsideScope(link('Idea'), 'dayGLANCE', { folders: ['Projects'] })).toBe(true);
    expect(newNotesFolderOutsideScope(link('Idea'), 'dayGLANCE', null)).toBe(true);
    expect(newNotesFolderOutsideScope(link('dayGLANCE/Idea'), 'dayGLANCE', { folders: ['Projects'] })).toBe(true);
  });
  it('quiet when a scope folder holds it, for a link elsewhere, or with no such folder', () => {
    expect(newNotesFolderOutsideScope(link('Idea'), 'dayGLANCE', { folders: ['dayGLANCE'] })).toBe(false);
    expect(newNotesFolderOutsideScope(link('Idea'), 'Work/dayGLANCE', { folders: ['Work'] })).toBe(false);
    expect(newNotesFolderOutsideScope(link('Projects/Idea'), 'dayGLANCE', { folders: [] })).toBe(false);
    expect(newNotesFolderOutsideScope(link('Idea'), '', { folders: [] })).toBe(false);
  });
});
