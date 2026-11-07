import { describe, it, expect } from 'vitest';
import { normalizeNotePath, noteDisplayName, noteLinkOf, noteLinkFromTitle, planNoteLinkUpdates, projectLogName, projectByNotePath } from './obsidianProjectNotes.js';

// noteDisplayName and noteLinkOf are tested with agenda-core (noteLink.test.js);
// these pin that this module still re-exports them for its importers.
describe('normalizeNotePath / noteDisplayName / noteLinkOf', () => {
  it('accepts a bare name, a wikilink, a heading suffix, and a path; adds .md; normalizes slashes', () => {
    expect(normalizeNotePath('Projects/House')).toBe('Projects/House.md');
    expect(normalizeNotePath('[[House]]')).toBe('House.md');
    expect(normalizeNotePath('[[Projects/House#Plan]]')).toBe('Projects/House.md');
    expect(normalizeNotePath('/Projects\\House.md')).toBe('Projects/House.md');
    expect(normalizeNotePath('   ')).toBe('');
    expect(noteDisplayName('Projects/House.md')).toBe('Projects/House');
  });
  it('re-exports noteLinkOf from agenda-core', () => {
    expect(noteLinkOf({ obsidianNotePath: 'Projects/House.md' })).toEqual({ path: 'Projects/House.md', name: 'Projects/House', missing: false, pending: false });
  });
});

describe('noteLinkFromTitle (a wikilink in the title names the note, owner 2026-10-03)', () => {
  it('takes the first link as the note and leaves the title without it; a heading suffix and an alias are dropped', () => {
    expect(noteLinkFromTitle('Fix the roof [[Projects/House]]')).toEqual({ title: 'Fix the roof', path: 'Projects/House.md' });
    expect(noteLinkFromTitle('[[Projects/House#Plan|the house]] this autumn')).toEqual({ title: 'this autumn', path: 'Projects/House.md' });
    expect(noteLinkFromTitle('[[A]] and [[B]]')).toEqual({ title: 'and', path: 'A.md' });
  });
  it('a title that is nothing but the link keeps the note\'s name as the title', () => {
    expect(noteLinkFromTitle('[[Projects/House]]')).toEqual({ title: 'House', path: 'Projects/House.md' });
    expect(noteLinkFromTitle('[[Projects/House|Our house]]')).toEqual({ title: 'Our house', path: 'Projects/House.md' });
  });
  it('no link, no result', () => {
    expect(noteLinkFromTitle('House')).toBe(null);
    expect(noteLinkFromTitle('')).toBe(null);
    expect(noteLinkFromTitle(null)).toBe(null);
    expect(noteLinkFromTitle('[[ ]]')).toBe(null);
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

  it('a pending mark (the record linked alone) clears on the first word from the vault: a link for the same path, a delete, an unlink', () => {
    const pending = { ...P, obsidianNotePath: 'Projects/House.md', obsidianNoteLinkPending: '2026-10-03T10:00:00.000Z' };
    expect(planNoteLinkUpdates([{ targetId: 'p1', path: 'Projects/House.md' }], { projects: [pending] }).projects)
      .toEqual([{ id: 'p1', updates: { obsidianNotePath: 'Projects/House.md', obsidianNoteMissingAt: null, obsidianNoteLinkPending: null } }]);
    expect(planNoteLinkUpdates([{ targetId: 'p1', path: 'Projects/House.md', deleted: true, observedAt: 'T' }], { projects: [pending] }).projects)
      .toEqual([{ id: 'p1', updates: { obsidianNoteMissingAt: 'T', obsidianNoteLinkPending: null } }]);
    expect(planNoteLinkUpdates([{ targetId: 'p1', path: 'Projects/House.md', unlinked: true }], { projects: [pending] }).projects)
      .toEqual([{ id: 'p1', updates: { obsidianNotePath: null, obsidianNoteMissingAt: null, obsidianNoteLinkPending: null } }]);
    // Without the mark, the update shapes are as before.
    expect(planNoteLinkUpdates([{ targetId: 'p1', path: 'Projects/House.md' }], { projects: [{ ...P, obsidianNotePath: 'Projects/House.md' }] }).projects).toEqual([]);
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

import { projectRefFor, resolveProjectRef } from './obsidianProjectNotes.js';

describe('the project field (ruling G as amended): projectRefFor / resolveProjectRef', () => {
  const house = { id: 'p1', title: 'House', obsidianNotePath: 'Projects/House.md' };
  const garden = { id: 'p2', title: 'Garden' };
  const missing = { id: 'p3', title: 'Attic', obsidianNotePath: 'Projects/Attic.md', obsidianNoteMissingAt: '2026-09-04T10:00:00Z' };
  const projects = [house, garden, missing];

  it('writes a wikilink for a linked project, the title for an unlinked or missing one, null for none', () => {
    expect(projectRefFor(house)).toBe('[[Projects/House]]');
    expect(projectRefFor({ ...house, title: 'The house' })).toBe('[[Projects/House|The house]]');
    expect(projectRefFor(garden)).toBe('Garden');
    expect(projectRefFor(missing)).toBe('Attic');
    expect(projectRefFor(null)).toBe(null);
  });

  it('resolves a wikilink by note path (alias ignored), a bare name by a unique title, and refuses ambiguity', () => {
    expect(resolveProjectRef('[[Projects/House|House]]', projects)).toBe('p1');
    expect(resolveProjectRef('[[Projects/House]]', projects)).toBe('p1');
    expect(resolveProjectRef('[[Projects/House#Plan|x]]', projects)).toBe('p1');
    expect(resolveProjectRef('Garden', projects)).toBe('p2');
    expect(resolveProjectRef('garden', projects)).toBe('p2');
    // A link to a note nobody is linked to falls back to its alias, then basename, as a title.
    expect(resolveProjectRef('[[Notes/Somewhere|Garden]]', projects)).toBe('p2');
    expect(resolveProjectRef('[[Notes/Garden]]', projects)).toBe('p2');
    expect(resolveProjectRef('Nope', projects)).toBe(null);
    expect(resolveProjectRef('House', [house, { id: 'p9', title: 'House' }])).toBe(null);
    expect(resolveProjectRef('House', [house, { id: 'p9', title: 'House', status: 'archived' }])).toBe('p1');
    expect(resolveProjectRef('', projects)).toBe(null);
  });
});

import { noteCreateFields } from './obsidianProjectNotes.js';

describe('noteCreateFields (Create in Obsidian on an existing entity, owner 2026-10-19)', () => {
  it('reads title, goal and description from the record, in the shape the new-entity path sends', () => {
    expect(noteCreateFields('project', { id: 'p1', title: 'Roof', goalId: 'g1', description: 'Dry by spring.' }))
      .toEqual({ title: 'Roof', goalId: 'g1', description: 'Dry by spring.' });
    expect(noteCreateFields('project', { id: 'p2', title: 'Shed' })).toEqual({ title: 'Shed', goalId: null, description: '' });
    // A goal nests under nothing, whatever the record carries.
    expect(noteCreateFields('goal', { id: 'g1', title: 'Home', goalId: 'x', description: 7 })).toEqual({ title: 'Home', goalId: null, description: '' });
    expect(noteCreateFields('project', undefined)).toEqual({ title: '', goalId: null, description: '' });
  });
});
