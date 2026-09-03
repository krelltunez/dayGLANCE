import { describe, it, expect } from 'vitest';
import { normalizeNotePath, noteDisplayName, noteLinkOf, planNoteLinkUpdates, projectLogName, projectByNotePath } from './obsidianProjectNotes.js';

describe('normalizeNotePath / noteDisplayName / noteLinkOf', () => {
  it('accepts a bare name, a wikilink, a heading suffix, and a path; adds .md; normalizes slashes', () => {
    expect(normalizeNotePath('Projects/House')).toBe('Projects/House.md');
    expect(normalizeNotePath('[[House]]')).toBe('House.md');
    expect(normalizeNotePath('[[Projects/House#Plan]]')).toBe('Projects/House.md');
    expect(normalizeNotePath('/Projects\\House.md')).toBe('Projects/House.md');
    expect(normalizeNotePath('   ')).toBe('');
    expect(noteDisplayName('Projects/House.md')).toBe('Projects/House');
  });
  it('noteLinkOf reads the locator and the missing mark', () => {
    expect(noteLinkOf({})).toBe(null);
    expect(noteLinkOf({ obsidianNotePath: 'Projects/House.md' })).toEqual({ path: 'Projects/House.md', name: 'Projects/House', missing: false });
    expect(noteLinkOf({ obsidianNotePath: 'Projects/House.md', obsidianNoteMissingAt: '2026-09-03T10:00:00.000Z' }).missing).toBe(true);
  });
});

describe('planNoteLinkUpdates (rulings A and F)', () => {
  const P = { id: 'p1', title: 'House' };
  const G = { id: 'g1', title: 'Home' };

  it('a link sets the locator on the project OR the goal the id names; an unknown id is ignored', () => {
    const plan = planNoteLinkUpdates(
      [{ targetId: 'p1', path: 'Projects/House.md' }, { targetId: 'g1', path: 'Goals/Home.md' }, { targetId: 'zzz', path: 'X.md' }],
      { projects: [P], goals: [G] },
    );
    expect(plan.projects).toEqual([{ id: 'p1', updates: { obsidianNotePath: 'Projects/House.md', obsidianNoteMissingAt: null } }]);
    expect(plan.goals).toEqual([{ id: 'g1', updates: { obsidianNotePath: 'Goals/Home.md', obsidianNoteMissingAt: null } }]);
  });

  it('an identical link is a no-op; a rename (new path, same id) moves the locator', () => {
    const linked = { ...P, obsidianNotePath: 'Projects/House.md' };
    expect(planNoteLinkUpdates([{ targetId: 'p1', path: 'Projects/House.md' }], { projects: [linked] }).projects).toEqual([]);
    expect(planNoteLinkUpdates([{ targetId: 'p1', path: 'Archive/House.md', previousPath: 'Projects/House.md' }], { projects: [linked] }).projects)
      .toEqual([{ id: 'p1', updates: { obsidianNotePath: 'Archive/House.md', obsidianNoteMissingAt: null } }]);
  });

  it('deleted marks the note missing and KEEPS the path (ruling F); a later link clears the mark; a stale delete for another path is ignored', () => {
    const linked = { ...P, obsidianNotePath: 'Projects/House.md' };
    const gone = planNoteLinkUpdates([{ targetId: 'p1', path: 'Projects/House.md', deleted: true, observedAt: '2026-09-03T10:00:00.000Z' }], { projects: [linked] });
    expect(gone.projects).toEqual([{ id: 'p1', updates: { obsidianNoteMissingAt: '2026-09-03T10:00:00.000Z' } }]);
    const missing = { ...linked, obsidianNoteMissingAt: '2026-09-03T10:00:00.000Z' };
    expect(planNoteLinkUpdates([{ targetId: 'p1', path: 'Projects/House.md' }], { projects: [missing] }).projects)
      .toEqual([{ id: 'p1', updates: { obsidianNotePath: 'Projects/House.md', obsidianNoteMissingAt: null } }]);
    expect(planNoteLinkUpdates([{ targetId: 'p1', path: 'Old/House.md', deleted: true }], { projects: [linked] }).projects).toEqual([]);
    // Already marked: no churn.
    expect(planNoteLinkUpdates([{ targetId: 'p1', path: 'Projects/House.md', deleted: true }], { projects: [missing] }).projects).toEqual([]);
  });

  it('unlinked clears both fields only when the record still points at that path', () => {
    const linked = { ...P, obsidianNotePath: 'Projects/House.md', obsidianNoteMissingAt: '2026-09-03T10:00:00.000Z' };
    expect(planNoteLinkUpdates([{ targetId: 'p1', path: 'Projects/House.md', unlinked: true }], { projects: [linked] }).projects)
      .toEqual([{ id: 'p1', updates: { obsidianNotePath: null, obsidianNoteMissingAt: null } }]);
    expect(planNoteLinkUpdates([{ targetId: 'p1', path: 'Elsewhere.md', unlinked: true }], { projects: [linked] }).projects).toEqual([]);
  });

  it('applies in observedAt order and folds updates per entity', () => {
    const plan = planNoteLinkUpdates([
      { targetId: 'p1', path: 'B.md', observedAt: '2026-09-03T10:00:02.000Z' },
      { targetId: 'p1', path: 'A.md', observedAt: '2026-09-03T10:00:01.000Z' },
    ], { projects: [P] });
    expect(plan.projects).toEqual([{ id: 'p1', updates: { obsidianNotePath: 'B.md', obsidianNoteMissingAt: null } }]);
  });
});

describe('projectLogName / projectByNotePath (rulings G and H)', () => {
  it('names a linked project as a wikilink, a missing or unlinked one by title; maps present notes to project ids', () => {
    const linked = { id: 'p1', title: 'House', obsidianNotePath: 'Projects/House.md' };
    const aliased = { id: 'p2', title: 'The garden', obsidianNotePath: 'Projects/Garden.md' };
    const missing = { id: 'p3', title: 'Attic', obsidianNotePath: 'Projects/Attic.md', obsidianNoteMissingAt: '2026-09-03T10:00:00.000Z' };
    const bare = { id: 'p4', title: 'Loose' };
    expect(projectLogName(linked)).toBe('[[Projects/House]]');
    expect(projectLogName(aliased)).toBe('[[Projects/Garden|The garden]]');
    expect(projectLogName(missing)).toBe('Attic');
    expect(projectLogName(bare)).toBe('Loose');
    expect(projectLogName(null)).toBe(null);
    expect(projectByNotePath([linked, aliased, missing, bare])).toEqual({ 'Projects/House.md': 'p1', 'Projects/Garden.md': 'p2' });
  });
});
