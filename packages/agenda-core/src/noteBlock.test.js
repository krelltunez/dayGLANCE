import { describe, it, expect } from 'vitest';
import { projectNoteBlock, goalNoteBlock, noteBlockChanged, noteWikilink } from './noteBlock.js';

describe('the maintained map (rulings B and C, shrunk)', () => {
  it('a project carries kind, status and its goal as a wikilink when the goal note is linked, its title otherwise, nothing when standalone', () => {
    const goal = { id: 'g1', title: 'Home', status: 'active' };
    expect(projectNoteBlock({ id: 'p1', status: 'active', goalId: 'g1' }, { goal, goalNotePath: 'Goals/Home.md' }))
      .toEqual({ kind: 'project', status: 'active', goal: '[[Goals/Home]]' });
    expect(projectNoteBlock({ id: 'p1', status: 'completed', goalId: 'g1' }, { goal, goalNotePath: 'Areas/Home stuff.md' }))
      .toEqual({ kind: 'project', status: 'completed', goal: '[[Areas/Home stuff|Home]]' });
    expect(projectNoteBlock({ id: 'p1' }, { goal })).toEqual({ kind: 'project', status: 'active', goal: 'Home' });
    expect(projectNoteBlock({ id: 'p1' })).toEqual({ kind: 'project', status: 'active' });
    expect(goalNoteBlock({ id: 'g1', status: 'archived' })).toEqual({ kind: 'goal', status: 'archived' });
  });
  it('no counts, no dates: a task change never changes the map; a status or goal change does', () => {
    const a = projectNoteBlock({ id: 'p1', status: 'active' });
    expect(noteBlockChanged(a, projectNoteBlock({ id: 'p1', status: 'active' }))).toBe(false);
    expect(noteBlockChanged({ status: 'active', kind: 'project' }, a)).toBe(false);
    expect(noteBlockChanged(a, projectNoteBlock({ id: 'p1', status: 'completed' }))).toBe(true);
    expect(noteBlockChanged(a, projectNoteBlock({ id: 'p1' }, { goal: { title: 'Home' } }))).toBe(true);
    expect(noteBlockChanged(null, a)).toBe(true);
    // An old block with counts differs from the new shape exactly once (the upgrade write).
    expect(noteBlockChanged({ kind: 'project', status: 'active', open: 3, updated: 'x' }, a)).toBe(true);
  });
  it('noteWikilink aliases only when the basename differs from the title', () => {
    expect(noteWikilink('Projects/House.md', 'House')).toBe('[[Projects/House]]');
    expect(noteWikilink('Projects/House.md', 'The house')).toBe('[[Projects/House|The house]]');
    expect(noteWikilink('', 'Loose')).toBe('Loose');
  });
});
