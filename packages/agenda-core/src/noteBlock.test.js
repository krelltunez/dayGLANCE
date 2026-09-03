import { describe, it, expect } from 'vitest';
import { projectNoteBlock, goalNoteBlock, noteBlockChanged, withUpdatedStamp, noteWikilink } from './noteBlock.js';

const P = { id: 'p1', title: 'House', status: 'active', goalId: 'g1' };
const Q = { id: 'p2', title: 'Garden', status: 'active', goalId: 'g1', sortOrder: -1 };
const G = { id: 'g1', title: 'Home', status: 'active' };
const tasks = [
  { id: 't1', projectId: 'p1', completed: true, duration: 60, date: '2026-09-01' },
  { id: 't2', projectId: 'p1', completed: false, duration: 30, date: '2026-09-10' },
  { id: 't3', projectId: 'p1', completed: false, duration: 30, date: '2026-09-05' },
  { id: 't4', projectId: 'p1', completed: false, archived: true, date: '2026-09-02' },
  { id: 't5', projectId: 'p2', completed: false },
];

describe('projectNoteBlock', () => {
  it('counts active tasks, weights percent by duration, and picks the earliest upcoming date', () => {
    expect(projectNoteBlock(P, { tasks, today: '2026-09-03' })).toEqual({
      kind: 'project', status: 'active', open: 2, done: 1, total: 3, percent: 50, next: '2026-09-05',
    });
    // Nothing to measure → percent null, next null.
    expect(projectNoteBlock({ id: 'zz' }, { tasks, today: '2026-09-03' })).toMatchObject({ total: 0, percent: null, next: null });
  });
});

describe('goalNoteBlock', () => {
  it('lists child projects as wikilinks when linked, titles otherwise, in sort order', () => {
    const b = goalNoteBlock(G, { projects: [P, Q], tasks, notePathOf: (id) => (id === 'p1' ? 'Projects/House.md' : null) });
    expect(b.projects).toEqual(['Garden', '[[Projects/House]]']);
    expect(b).toMatchObject({ kind: 'goal', open: 3, done: 1, total: 4 });
    expect(typeof b.percent).toBe('number');
  });
});

describe('noteWikilink / noteBlockChanged / withUpdatedStamp', () => {
  it('aliases only when the basename differs from the title', () => {
    expect(noteWikilink('Projects/House.md', 'House')).toBe('[[Projects/House]]');
    expect(noteWikilink('Projects/House.md', 'The house')).toBe('[[Projects/House|The house]]');
    expect(noteWikilink('', 'Loose')).toBe('Loose');
  });
  it('an unchanged block keeps its updated stamp (no write); a change takes the new stamp', () => {
    const prev = { kind: 'project', open: 1, done: 0, total: 1, percent: 0, next: null, status: 'active', updated: '2026-09-01T00:00:00Z' };
    const same = { status: 'active', kind: 'project', open: 1, done: 0, total: 1, percent: 0, next: null };
    expect(noteBlockChanged(prev, same)).toBe(false);
    expect(withUpdatedStamp(prev, same, '2026-09-03T00:00:00Z').updated).toBe('2026-09-01T00:00:00Z');
    expect(noteBlockChanged(prev, { ...same, open: 2 })).toBe(true);
    expect(withUpdatedStamp(prev, { ...same, open: 2 }, '2026-09-03T00:00:00Z').updated).toBe('2026-09-03T00:00:00Z');
    expect(noteBlockChanged(null, same)).toBe(true);
  });
});
