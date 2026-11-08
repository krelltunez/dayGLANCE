import { describe, it, expect } from 'vitest';
import {
  cleanTag, parseTags, parseSubtaskLines, normalizeTaskDefaults, taskDefaultsOf,
  withTags, withoutTrailingTags, projectTaskFields, draftWithProjectDefaults, DEFAULT_TASK_DURATION,
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
