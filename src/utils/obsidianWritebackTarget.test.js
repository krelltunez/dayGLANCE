import { describe, it, expect } from 'vitest';
import { writebackTargetFor } from './obsidianWritebackTarget.js';

describe('writebackTargetFor', () => {
  const cfg = { dailyNotesPath: 'Daily/', dailyNotePattern: 'yyyy-MM-dd', taskHeading: '## Tasks' };

  it('daily-note task: located by date under the daily folder, sorted under the task heading, keyed by the date', () => {
    expect(writebackTargetFor({ id: 'obsidian-dg-abc', obsidianFileDate: '2026-09-02', date: '2026-09-05' }, cfg)).toEqual({
      isNoteTask: false, path: 'Daily/2026-09-02.md', date: '2026-09-02', noteKey: '2026-09-02', taskHeading: '## Tasks',
    });
    // Legacy id carries the date; the task's own date is the last resort.
    expect(writebackTargetFor({ id: 'obsidian-2026-08-30-x1', date: '2026-09-01' }, cfg).date).toBe('2026-08-30');
    expect(writebackTargetFor({ id: 'obsidian-dg-abc', date: '2026-09-01' }, cfg).date).toBe('2026-09-01');
    expect(writebackTargetFor({ id: 'obsidian-dg-abc' }, cfg)).toBe(null);
  });

  it('non-daily task: located by its path, no section sort, keyed by the path; the task date is the schedule, not the locator', () => {
    expect(writebackTargetFor({ id: 'obsidian-dg-def', obsidianNotePath: 'Projects/House.md', date: '2026-09-12' }, cfg)).toEqual({
      isNoteTask: true, path: 'Projects/House.md', date: '2026-09-12', noteKey: 'Projects/House.md', taskHeading: null,
    });
    expect(writebackTargetFor({ id: 'obsidian-dg-def', obsidianNotePath: 'Projects/House.md' }, cfg).date).toBe(null);
  });

  it('a task carrying both fields is a note task (the path wins)', () => {
    expect(writebackTargetFor({ id: 'x', obsidianNotePath: 'Notes/A.md', obsidianFileDate: '2026-09-02' }, cfg).isNoteTask).toBe(true);
  });
});
