import { describe, it, expect } from 'vitest';
import {
  cleanTag, parseTags, parseSubtaskLines, normalizeTaskDefaults, taskDefaultsOf,
  withTags, withoutTrailingTags, projectTaskFields, draftWithProjectDefaults, DEFAULT_TASK_DURATION,
  seedTaskDefaults, seedTaskDefaultsFor, applyTargets, appliedTaskDefaults,
} from './projectTaskDefaults.js';

// #2336: a project's New task defaults, copied onto tasks created in it.

let n = 0;
const newId = () => `st-${++n}`;
const fitness = { id: 'p-fit', title: 'Fitness', color: 'bg-emerald-500', taskDefaults: { duration: 45, tags: ['health'], notes: 'Goal:\nResult:', subtasks: ['Warm up', 'Stretch'] } };
const writing = { id: 'p-wr', title: 'Writing', taskDefaults: { duration: 90, tags: ['deep'], notes: 'Summary:' } };
const plain = { id: 'p-plain', title: 'Plain', color: 'bg-blue-500' };

describe('reading what the form stores', () => {
  it('cleans tags the way a title reads them, and drops what a title could not hold', () => {
    expect(cleanTag('#health')).toBe('health');
    expect(cleanTag('  deep ')).toBe('deep');
    expect(cleanTag('')).toBeNull();
    expect(cleanTag('#')).toBeNull();
    expect(parseTags('#Health, deep  #health 运动')).toEqual(['Health', 'deep', '运动']);
  });

  it('reads subtask lines, empty ones dropped', () => {
    expect(parseSubtaskLines('Warm up\n\n  Stretch  \n')).toEqual(['Warm up', 'Stretch']);
  });

  it('keeps only what is set, and nothing at all for an empty form', () => {
    expect(normalizeTaskDefaults({ duration: '45', tags: '#a b', notes: 'N', subtasks: 'x\ny' }))
      .toEqual({ duration: 45, tags: ['a', 'b'], notes: 'N', subtasks: ['x', 'y'] });
    expect(normalizeTaskDefaults({ duration: '', tags: '', notes: '   ', subtasks: '\n' })).toBeUndefined();
    expect(normalizeTaskDefaults({ duration: 0 })).toBeUndefined();
    expect(normalizeTaskDefaults({ duration: 9999 }).duration).toBe(24 * 60);
    expect(normalizeTaskDefaults(null)).toBeUndefined();
    expect(taskDefaultsOf(plain)).toEqual({});
  });
});

describe('tags in the title', () => {
  it('appends the tags a title lacks, whatever their case', () => {
    expect(withTags('Run 5k', ['health'])).toBe('Run 5k #health');
    expect(withTags('Run #Health', ['health', 'deep'])).toBe('Run #Health #deep');
    expect(withTags('', ['health'])).toBe('#health');
    expect(withTags('Run ', ['health'])).toBe('Run #health');
  });

  it('takes back only tags that end the title, and leaves the title itself otherwise', () => {
    expect(withoutTrailingTags('Run 5k #health', ['health'])).toBe('Run 5k');
    // Typed after the tags: not the trailing run any more.
    expect(withoutTrailingTags('Run #health tomorrow', ['health'])).toBe('Run #health tomorrow');
    // Stops at a tag the user typed.
    expect(withoutTrailingTags('Run #health #mine', ['health'])).toBe('Run #health #mine');
    const title = 'Run 5k ';
    expect(withoutTrailingTags(title, ['health'])).toBe(title);
  });
});

describe('projectTaskFields: a row built in a project', () => {
  it('takes the defaults, plus the colour and users it always took', () => {
    const fields = projectTaskFields({ ...fitness, assignedUserSyncIds: ['u1'] }, null, { title: 'Run 5k' }, { newId });
    expect(fields).toMatchObject({ title: 'Run 5k #health', color: 'bg-emerald-500', duration: 45, notes: 'Goal:\nResult:', assignedUserSyncIds: ['u1'] });
    expect(fields.subtasks.map((s) => [s.title, s.completed])).toEqual([['Warm up', false], ['Stretch', false]]);
    expect(new Set(fields.subtasks.map((s) => s.id)).size).toBe(2);
  });

  it('what the caller gives wins over a default', () => {
    const given = { title: 'Run', duration: 20, notes: 'mine', subtasks: [{ id: 'x', title: 'own', completed: false }] };
    expect(projectTaskFields(fitness, null, given, { newId })).toMatchObject({ duration: 20, notes: 'mine', subtasks: [{ id: 'x' }] });
  });

  it('a project without defaults gives what it gave before: colour, 30 minutes, nothing else', () => {
    expect(projectTaskFields(plain, null, { title: 'Do it' })).toEqual({
      title: 'Do it', color: 'bg-blue-500', duration: DEFAULT_TASK_DURATION, notes: '', subtasks: [],
    });
  });

  it('the colour still falls back to the goal\'s', () => {
    expect(projectTaskFields({ id: 'p' }, { color: 'bg-rose-500' }).color).toBe('bg-rose-500');
  });
});

describe('draftWithProjectDefaults: the new-task form when its project changes', () => {
  const blank = { title: 'Run 5k', duration: 30, notes: '', subtasks: [] };

  it('fills an untouched draft from the project', () => {
    const d = draftWithProjectDefaults(blank, null, fitness, { newId });
    expect(d).toMatchObject({ title: 'Run 5k #health', duration: 45, notes: 'Goal:\nResult:' });
    expect(d.subtasks.map((s) => s.title)).toEqual(['Warm up', 'Stretch']);
  });

  it('switching projects swaps what the old one filled in, while it is still as it left it', () => {
    const a = draftWithProjectDefaults(blank, null, fitness, { newId });
    const b = draftWithProjectDefaults(a, fitness, writing, { newId });
    expect(b).toMatchObject({ title: 'Run 5k #deep', duration: 90, notes: 'Summary:', subtasks: [] });
  });

  // MUTATION: drop the "still as the old project left it" checks and a switch
  // wipes what the user typed.
  it('never replaces what the user changed', () => {
    const a = draftWithProjectDefaults(blank, null, fitness, { newId });
    const edited = { ...a, duration: 60, notes: 'my own note', subtasks: [...a.subtasks, { id: 'm', title: 'Mine', completed: false }] };
    const b = draftWithProjectDefaults(edited, fitness, writing, { newId });
    expect(b).toMatchObject({ duration: 60, notes: 'my own note' });
    expect(b.subtasks.map((s) => s.title)).toEqual(['Warm up', 'Stretch', 'Mine']);
  });

  it('a duration the user set before picking a project stays', () => {
    expect(draftWithProjectDefaults({ ...blank, duration: 15 }, null, fitness, { newId }).duration).toBe(15);
  });

  it('clearing the project takes the defaults back out', () => {
    const a = draftWithProjectDefaults(blank, null, fitness, { newId });
    expect(draftWithProjectDefaults(a, fitness, null, { newId })).toMatchObject({ title: 'Run 5k', duration: 30, notes: '', subtasks: [] });
  });

  it('a project without defaults leaves the draft as it is', () => {
    expect(draftWithProjectDefaults(blank, null, plain, { newId })).toEqual(blank);
  });
});

// The energy default (#2336 follow-up): a project of restoring things marks its
// new tasks Restore whatever their titles say, as the user's own word would.
describe('the energy default', () => {
  const calm = { id: 'p-calm', title: 'Unwind', color: 'bg-teal-500', taskDefaults: { energy: 'restore' } };
  const busy = { id: 'p-busy', title: 'Work', taskDefaults: { energy: 'effort' } };
  const blank = { title: 'Read a novel', duration: 30, notes: '', subtasks: [] };

  it('keeps effort or restore, and drops anything else', () => {
    expect(normalizeTaskDefaults({ energy: 'restore' })).toEqual({ energy: 'restore' });
    expect(normalizeTaskDefaults({ energy: 'effort' })).toEqual({ energy: 'effort' });
    expect(normalizeTaskDefaults({ energy: 'calm' })).toBeUndefined();
    expect(normalizeTaskDefaults({ energy: '' })).toBeUndefined();
  });

  it('a row built in the project takes it; a project without one adds no energy field', () => {
    expect(projectTaskFields(calm, null, { title: 'Read' })).toMatchObject({ energy: 'restore' });
    expect(projectTaskFields(plain, null, { title: 'Read' })).not.toHaveProperty('energy');
  });

  it('the new-task form takes it with the project, swaps it with the project, and drops it with the project', () => {
    const a = draftWithProjectDefaults(blank, null, calm, { newId });
    expect(a.energy).toBe('restore');
    expect(draftWithProjectDefaults(a, calm, busy, { newId }).energy).toBe('effort');
    expect(draftWithProjectDefaults(a, calm, plain, { newId })).not.toHaveProperty('energy');
    expect(draftWithProjectDefaults(a, calm, null, { newId })).not.toHaveProperty('energy');
  });

  it('a draft whose energy came from elsewhere keeps it', () => {
    expect(draftWithProjectDefaults({ ...blank, energy: 'effort' }, null, calm, { newId }).energy).toBe('effort');
  });
});

// Goal and area defaults (#2336, option 1): they seed NEW projects, one
// level at a time, and reach existing ones only through "Apply to projects".
describe('seeding a new project from its goal and area', () => {
  const area = { id: 'a1', taskDefaults: { duration: 20, energy: 'restore', notes: 'Why:' } };
  const goal = { id: 'g1', areaId: 'a1', taskDefaults: { duration: 45, tags: ['run'] } };

  it('each field from the goal, else from its area', () => {
    expect(seedTaskDefaults(goal, area)).toEqual({ duration: 45, tags: ['run'], notes: 'Why:', energy: 'restore' });
  });

  it('nothing when neither sets anything; the area alone when the goal sets nothing', () => {
    expect(seedTaskDefaults({ id: 'g' }, { id: 'a' })).toBeUndefined();
    expect(seedTaskDefaults({ id: 'g' }, area)).toEqual(area.taskDefaults);
  });

  it('looked up by goal id: a goal outside any area takes only its own, and no goal gives none', () => {
    expect(seedTaskDefaultsFor('g1', { goals: [goal], areas: [area] })).toMatchObject({ duration: 45, energy: 'restore' });
    expect(seedTaskDefaultsFor('g1', { goals: [{ ...goal, areaId: undefined }], areas: [area] })).toEqual({ duration: 45, tags: ['run'] });
    expect(seedTaskDefaultsFor(null, { goals: [goal], areas: [area] })).toBeUndefined();
    expect(seedTaskDefaultsFor('gone', { goals: [goal], areas: [area] })).toBeUndefined();
  });
});

describe('"Apply to projects" on a goal or an area', () => {
  const NOW = '2026-11-09T12:00:00.000Z';
  const areas = [{ id: 'a1', taskDefaults: { energy: 'restore' } }];
  const goals = [
    { id: 'g1', areaId: 'a1', status: 'active', taskDefaults: { duration: 45 } },
    { id: 'g2', areaId: 'a1', status: 'active', taskDefaults: { energy: 'effort' } },
    { id: 'g3', areaId: 'a1', status: 'archived' },
    { id: 'g4', status: 'active' },
  ];
  const projects = [
    { id: 'p1', goalId: 'g1', status: 'active', taskDefaults: { notes: 'mine' }, updatedAt: 'old' },
    { id: 'p2', goalId: 'g1', status: 'on-hold', updatedAt: 'old' },
    { id: 'p3', goalId: 'g1', status: 'completed', taskDefaults: { notes: 'done' }, updatedAt: 'old' },
    { id: 'p4', goalId: 'g1', status: 'archived', updatedAt: 'old' },
    { id: 'p5', goalId: 'g2', status: 'active', updatedAt: 'old' },
    { id: 'p6', goalId: 'g3', status: 'active', updatedAt: 'old' },
    { id: 'p7', goalId: 'g4', status: 'active', updatedAt: 'old' },
    { id: 'p8', status: 'active', updatedAt: 'old' },
  ];
  const byId = (list) => Object.fromEntries(list.map((p) => [p.id, p]));

  it('targets the open projects: active and on hold, of the goal, or of the area\'s goals not archived', () => {
    expect(applyTargets({ scope: 'goal', id: 'g1', goals, projects }).map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(applyTargets({ scope: 'area', id: 'a1', goals, projects }).map((p) => p.id)).toEqual(['p1', 'p2', 'p5']);
  });

  // MUTATION: apply to every project of the goal and p3/p4 change.
  it('from a goal: its open projects take the seed of the defaults being saved, and nothing else changes', () => {
    const out = byId(appliedTaskDefaults(projects, { scope: 'goal', id: 'g1', defaults: { duration: 60, tags: ['x'] }, goals, areas, nowIso: NOW }));
    expect(out.p1).toMatchObject({ taskDefaults: { duration: 60, tags: ['x'], energy: 'restore' }, updatedAt: NOW });
    expect(out.p2).toMatchObject({ taskDefaults: { duration: 60, tags: ['x'], energy: 'restore' }, updatedAt: NOW });
    for (const id of ['p3', 'p4', 'p5', 'p6', 'p7', 'p8']) expect(out[id]).toBe(byId(projects)[id]);
  });

  it('from an area: each project\'s goal keeps the fields it sets', () => {
    const out = byId(appliedTaskDefaults(projects, { scope: 'area', id: 'a1', defaults: { energy: 'restore', notes: 'Area' }, goals, areas, nowIso: NOW }));
    expect(out.p1.taskDefaults).toEqual({ duration: 45, notes: 'Area', energy: 'restore' });
    expect(out.p5.taskDefaults).toEqual({ notes: 'Area', energy: 'effort' });
    expect(out.p6).toBe(byId(projects).p6); // its goal is archived
  });

  it('clearing a goal\'s defaults and applying leaves its projects with the area\'s, or with none', () => {
    const out = byId(appliedTaskDefaults(projects, { scope: 'goal', id: 'g1', defaults: undefined, goals, areas, nowIso: NOW }));
    expect(out.p1.taskDefaults).toEqual({ energy: 'restore' });
    const bare = byId(appliedTaskDefaults(projects, { scope: 'goal', id: 'g4', defaults: undefined, goals, areas, nowIso: NOW }));
    expect(bare.p7).not.toHaveProperty('taskDefaults');
    expect(bare.p7.updatedAt).toBe(NOW);
  });

  it('a goal moved to another area in the same save falls back to the new area', () => {
    const moreAreas = [...areas, { id: 'a2', taskDefaults: { notes: 'A2' } }];
    const out = byId(appliedTaskDefaults(projects, { scope: 'goal', id: 'g1', defaults: {}, areaId: 'a2', goals, areas: moreAreas, nowIso: NOW }));
    expect(out.p1.taskDefaults).toEqual({ notes: 'A2' });
  });
});
