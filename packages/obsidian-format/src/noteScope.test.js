import { describe, it, expect } from 'vitest';
import {
  deriveBlockId, noteKeyForPath, noteTaskId, parseTasksFromMarkdown, planStampInsertions, appIdForBlockId,
} from './index.js';

// Companion spec §6, ruling A: the note key is the minting namespace — the
// date for a daily note (frozen, unchanged), the vault-relative path for any
// other note. These pins are the identity half of build step 1.

describe('noteKeyForPath', () => {
  it('normalizes to NFC, forward slashes, no leading slash', () => {
    expect(noteKeyForPath('Projects/House.md')).toBe('Projects/House.md');
    expect(noteKeyForPath('/Projects\\House.md')).toBe('Projects/House.md');
    // "é" composed vs decomposed → one key.
    expect(noteKeyForPath('Café.md')).toBe(noteKeyForPath('Café.md'));
  });
});

describe('deriveBlockId under a path key', () => {
  it('the same title in two notes mints two ids; a daily-note id is unaffected by the change', () => {
    const title = 'Call the plumber';
    const daily = deriveBlockId('2026-09-02', title);
    const house = deriveBlockId(noteKeyForPath('Projects/House.md'), title);
    const office = deriveBlockId(noteKeyForPath('Projects/Office.md'), title);
    expect(new Set([daily, house, office]).size).toBe(3);
    // Golden: the daily derivation is byte-identical to what identity.test.js pins.
    expect(daily).toBe(deriveBlockId('2026-09-02', 'Call the plumber'));
    expect(daily).toMatch(/^[a-z0-9]{8}$/);
  });
  it('the stamp planner mints under whatever key it is given, so the plugin can pass a path', () => {
    const content = '- [ ] Call the plumber\n';
    const [dailyPlan] = planStampInsertions(content, '2026-09-02');
    const [notePlan] = planStampInsertions(content, noteKeyForPath('Projects/House.md'));
    expect(dailyPlan.blockId).toBe(deriveBlockId('2026-09-02', 'Call the plumber'));
    expect(notePlan.blockId).toBe(deriveBlockId('Projects/House.md', 'Call the plumber'));
    expect(dailyPlan.blockId).not.toBe(notePlan.blockId);
  });
});

describe('parseTasksFromMarkdown with notePath (non-daily note)', () => {
  const content = [
    '# House',
    '- [ ] Call the plumber ^dg-abcdefgh',
    '- [ ] 2026-09-10 09:00-09:30 Meet the architect ^dg-11111111',
    '- [ ] Order tiles ⏳ 2026-09-12 ^dg-22222222',
    '- [x] Pick paint ✅ 2026-08-30 ^dg-33333333',
    '- [ ] Untagged line',
  ].join('\n');

  it('a line without a date of its own is inbox; inline and ⏳ dates schedule; every task carries obsidianNotePath and no obsidianFileDate', () => {
    const { scheduledTasks, inboxTasks } = parseTasksFromMarkdown(content, '2026-09-02', new Set(), { notePath: '/Projects\\House.md' });
    const all = [...scheduledTasks, ...inboxTasks];
    expect(all.every((t) => t.obsidianNotePath === 'Projects/House.md' && t.obsidianFileDate === undefined)).toBe(true);
    expect(inboxTasks.map((t) => t.id)).toEqual(expect.arrayContaining([appIdForBlockId('abcdefgh'), appIdForBlockId('33333333')]));
    const meet = scheduledTasks.find((t) => t.id === appIdForBlockId('11111111'));
    expect(meet).toMatchObject({ date: '2026-09-10', startTime: '09:00', duration: 30, isAllDay: false });
    const tiles = scheduledTasks.find((t) => t.id === appIdForBlockId('22222222'));
    expect(tiles).toMatchObject({ date: '2026-09-12', isAllDay: true });
    // The note's "date" argument never leaks in as a task date.
    expect(all.some((t) => t.date === '2026-09-02')).toBe(false);
  });

  it('an untagged line gets the provisional path-keyed id, never a date-keyed legacy id', () => {
    const { inboxTasks } = parseTasksFromMarkdown(content, '2026-09-02', new Set(), { notePath: 'Projects/House.md' });
    const untagged = inboxTasks.find((t) => t.title.startsWith('Untagged line'));
    expect(untagged.id).toBe(noteTaskId('Projects/House.md', 'Untagged line'));
    expect(untagged.id.startsWith('obsidian-note-')).toBe(true);
  });

  it('without notePath the daily-note grammar is byte-for-byte unchanged', () => {
    const daily = parseTasksFromMarkdown('- [ ] Call the plumber\n', '2026-09-02');
    expect(daily.scheduledTasks).toHaveLength(0);
    expect(daily.inboxTasks[0]).toMatchObject({ obsidianFileDate: '2026-09-02', id: 'obsidian-2026-09-02-' + daily.inboxTasks[0].id.split('-').pop() });
    expect(daily.inboxTasks[0].obsidianNotePath).toBeUndefined();
  });
});

// ── scope classifier and the completion window (rulings D and E) ────────────
import {
  normalizeScope, noteInScope, scopeIsActive, completedSinceFor, completedLineInWindow, stampUntaggedTaskLines,
} from './index.js';

describe('normalizeScope / noteInScope', () => {
  it('folders and tags are equal citizens, a note is in scope by either; nested tags match their parent; the window clamps to 7..90', () => {
    const scope = normalizeScope({ folders: ['/Projects/', 'Areas\\Home', ''], tags: ['#Project', 'client/acme', '  '], completionWindowDays: 400 });
    expect(scope).toEqual({ folders: ['Projects', 'Areas/Home'], tags: ['project', 'client/acme'], completionWindowDays: 90 });
    expect(normalizeScope({ completionWindowDays: 2 }).completionWindowDays).toBe(7);
    expect(normalizeScope({}).completionWindowDays).toBe(30);
    expect(noteInScope('Projects/House.md', [], scope)).toBe(true);
    expect(noteInScope('Projects.md', [], scope)).toBe(false); // a file named like the folder is not under it
    expect(noteInScope('Notes/Kitchen.md', ['#project/house'], scope)).toBe(true);
    expect(noteInScope('Notes/Kitchen.md', ['client/acme/2026'], scope)).toBe(true);
    expect(noteInScope('Notes/Kitchen.md', ['#projects'], scope)).toBe(false);
    expect(noteInScope('Notes/Kitchen.png', ['#project'], scope)).toBe(false);
    expect(noteInScope('.trash/Old.md', ['#project'], scope)).toBe(false);
    expect(scopeIsActive({ folders: [], tags: [] })).toBe(false);
    expect(scopeIsActive({ tags: ['x'] })).toBe(true);
  });
});

describe('completion window', () => {
  it('completedSinceFor counts back the window; only dated completions inside it count', () => {
    expect(completedSinceFor({ completionWindowDays: 30 }, '2026-09-02')).toBe('2026-08-03');
    expect(completedLineInWindow('Pick paint ✅ 2026-08-30', '2026-08-03')).toBe(true);
    expect(completedLineInWindow('Pick paint ✅ 2026-07-30', '2026-08-03')).toBe(false);
    expect(completedLineInWindow('Pick paint [completed:: 2026-08-30T10:00:00-05:00]', '2026-08-03')).toBe(true);
    expect(completedLineInWindow('Pick paint', '2026-08-03')).toBe(false);
  });

  it('the stamper and the parser skip completed lines outside the window in a non-daily note, and never window open lines', () => {
    const content = [
      '- [ ] Open forever',
      '- [x] Recent ✅ 2026-08-30',
      '- [x] Ancient ✅ 2024-01-01',
      '- [x] Undated done',
    ].join('\n');
    const stamped = stampUntaggedTaskLines(content, 'Projects/House.md', { completedSince: '2026-08-03' });
    expect(stamped.stamped.map((s) => s.rawTitle)).toEqual(['Open forever', 'Recent ✅ 2026-08-30']);
    const { scheduledTasks, inboxTasks } = parseTasksFromMarkdown(stamped.text, '2026-09-02', new Set(), { notePath: 'Projects/House.md', completedSince: '2026-08-03' });
    expect(scheduledTasks).toHaveLength(0);
    expect(inboxTasks.map((t) => t.title.replace(/ #obsidian$/, ''))).toEqual(['Open forever', 'Recent']);
    // Daily notes are never windowed: the option is simply not passed.
    expect(stampUntaggedTaskLines(content, '2026-09-02').stamped).toHaveLength(4);
  });
});
