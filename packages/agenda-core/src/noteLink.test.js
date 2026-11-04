import { describe, it, expect } from 'vitest';
import { noteDisplayName, noteLinkOf } from './noteLink.js';

describe('noteDisplayName / noteLinkOf', () => {
  it('names the note as Obsidian does: the path without .md', () => {
    expect(noteDisplayName('Projects/House.md')).toBe('Projects/House');
  });
  it('noteLinkOf reads the locator, the missing mark and the pending mark', () => {
    expect(noteLinkOf({})).toBe(null);
    expect(noteLinkOf({ obsidianNotePath: 'Projects/House.md' })).toEqual({ path: 'Projects/House.md', name: 'Projects/House', missing: false, pending: false });
    expect(noteLinkOf({ obsidianNotePath: 'Projects/House.md', obsidianNoteMissingAt: '2026-09-03T10:00:00.000Z' }).missing).toBe(true);
    expect(noteLinkOf({ obsidianNotePath: 'Projects/House.md', obsidianNoteLinkPending: '2026-10-03T10:00:00.000Z' }).pending).toBe(true);
  });
});
