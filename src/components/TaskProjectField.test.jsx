import React, { useState } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, create } from 'react-test-renderer';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { loaders } from '../locales.js';
import { DayPlannerContext } from '../context/DayPlannerContext.jsx';
import { FeaturesContext } from '../context/FeaturesContext.jsx';
import { NEW_PROJECT_ID, withPendingProject } from '../utils/pendingProject.js';
import { getProjectColor } from '../utils/colorUtils.js';
import TaskProjectField from './TaskProjectField.jsx';

// The task editor's project field (#2279): a picker that groups the projects
// by area and goal the way the Inbox filter does (#2232), folding, and that
// sets on the task exactly what the native <select> it replaced did.

let i18n;
beforeAll(async () => {
  const bundle = await loaders.en();
  i18n = i18next.createInstance();
  await i18n.init({ lng: 'en', fallbackLng: false, resources: { en: { translation: bundle } }, interpolation: { escapeValue: false } });
});

// No DOM here: `document` records its listeners and the focused node, and
// every ref is a mock node inside the picker (an outside tap is any other object).
let listeners;
const store = new Map();
beforeEach(() => {
  listeners = {};
  store.clear();
  globalThis.document = {
    activeElement: null,
    addEventListener: (type, fn) => { (listeners[type] ||= new Set()).add(fn); },
    removeEventListener: (type, fn) => { listeners[type]?.delete(fn); },
  };
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
});
afterEach(() => { delete globalThis.document; delete globalThis.localStorage; });

// The test renderer asks for a mock each time it attaches a ref, where a
// browser hands back the same element: a row keeps one mock across renders.
const nodeMocks = () => {
  const rows = new Map();
  return (element) => {
    const row = element.props['data-project-picker-option'] ?? element.props['data-project-picker-group'];
    if (row !== undefined && rows.has(row)) return rows.get(row);
    const node = {
      inside: true,
      row,
      focus: vi.fn(() => { globalThis.document.activeElement = node; }),
      contains: (target) => !!target?.inside,
    };
    if (row !== undefined) rows.set(row, node);
    return node;
  };
};

const AREAS = [{ id: 'a-work', name: 'Work' }];
const GOALS = [
  { id: 'g-ship', title: 'Ship v6', areaId: 'a-work', color: 'bg-rose-500', assignedUserSyncIds: ['u-goal'] },
  { id: 'g-read', title: 'Read more', color: 'bg-green-500' },
  { id: 'g-old', title: 'Old goal', status: 'archived' },
];
const PROJECTS = [
  { id: 'p-api', title: 'API', goalId: 'g-ship', assignedUserSyncIds: ['u-1'] },
  { id: 'p-docs', title: 'Docs', goalId: 'g-ship', color: 'bg-amber-500' },
  { id: 'p-books', title: 'Books', goalId: 'g-read' },
  { id: 'p-legacy', title: 'Legacy', goalId: 'g-old' },
  { id: 'p-solo', title: 'Solo' },
  { id: 'p-gone', title: 'Shelved', status: 'archived' },
  { id: 'p-done', title: 'Finished', goalId: 'g-read', status: 'completed' },
];

const planner = (overrides = {}) => ({
  darkMode: false, isMobile: false,
  borderClass: 'border-stone-200', textPrimary: 'text-stone-900', textSecondary: 'text-stone-500', hoverBg: 'hover:bg-stone-100',
  ...overrides,
});

function setup(initialTask = { title: 'Write it' }, { projects = PROJECTS, plannerOverrides } = {}) {
  const setNewTask = vi.fn();
  function Harness() {
    const [newTask, setTask] = useState(initialTask);
    setNewTask.mockImplementation(setTask);
    return <TaskProjectField newTask={newTask} setNewTask={setNewTask} />;
  }
  let root;
  act(() => {
    root = create(
      <I18nextProvider i18n={i18n}>
        <DayPlannerContext.Provider value={planner(plannerOverrides)}>
          <FeaturesContext.Provider value={{ goals: GOALS, projects, areas: AREAS }}>
            <Harness />
          </FeaturesContext.Provider>
        </DayPlannerContext.Provider>
      </I18nextProvider>,
      { createNodeMock: nodeMocks() },
    );
  });
  const find = (props) => root.root.findAll((n) => typeof n.type === 'string' && Object.entries(props).every(([k, v]) => n.props[k] === v));
  const one = (props) => find(props)[0];
  const trigger = () => one({ 'data-project-picker-trigger': true });
  const panel = () => one({ 'data-project-picker-panel': true });
  const option = (id) => one({ 'data-project-picker-option': id });
  const group = (key) => one({ 'data-project-picker-group': key });
  const text = (node) => (typeof node === 'string' ? node : (node?.children || []).map(text).join(''));
  const rows = () => root.root.findAll((n) => typeof n.type === 'string'
    && (n.props['data-project-picker-option'] !== undefined || n.props['data-project-picker-group'] !== undefined))
    .map((n) => n.props['data-project-picker-option'] ?? `[${n.props['data-project-picker-group']}]`);
  const key = (node, k, extra = {}) => {
    const e = { key: k, target: extra.target ?? {}, preventDefault: vi.fn(), stopPropagation: vi.fn() };
    act(() => { node.props.onKeyDown(e); });
    return e;
  };
  const click = (node) => act(() => { node.props.onClick(); });
  const lastTask = () => setNewTask.mock.calls.at(-1)?.[0];
  return { root, setNewTask, trigger, panel, option, group, text, rows, key, click, lastTask, find };
}

describe('the closed field', () => {
  it('reads "No project" when the task has none', () => {
    const { trigger, text, panel } = setup();
    expect(text(trigger())).toContain('No project');
    expect(trigger().props['aria-expanded']).toBe(false);
    expect(panel()).toBeUndefined();
  });

  it('names the task\'s project and its goal', () => {
    const { trigger, text, find } = setup({ title: 'x', projectId: 'p-api' });
    expect(text(trigger())).toContain('API');
    expect(text(find({ 'data-project-picker-goal': true })[0])).toBe('Ship v6');
  });

  it('still names a project that has since been completed', () => {
    const { trigger, text } = setup({ title: 'x', projectId: 'p-done' });
    expect(text(trigger())).toContain('Finished');
  });
});

describe('the list, by area and goal', () => {
  it('No project and New project… first, then areas, their goals folded, then the standalone projects', () => {
    const { trigger, click, rows } = setup();
    click(trigger());
    expect(rows()).toEqual(['none', 'new', '[area-a-work]', '[goal-g-ship]', '[area-none]', '[goal-g-read]', '[standalone]']);
  });

  it('a goal unfolds to its projects; archived and completed projects are not offered; a project of an archived goal is standalone', () => {
    const { trigger, click, rows, group } = setup();
    click(trigger());
    click(group('goal-g-read'));
    click(group('standalone'));
    expect(rows()).toEqual([
      'none', 'new', '[area-a-work]', '[goal-g-ship]', '[area-none]', '[goal-g-read]', 'p-books', '[standalone]', 'p-legacy', 'p-solo',
    ]);
  });

  it('opens on the task\'s project, its goal unfolded, and focuses it', () => {
    const { trigger, click, rows, option } = setup({ title: 'x', projectId: 'p-docs' });
    click(trigger());
    expect(rows()).toContain('p-docs');
    expect(option('p-docs').props['aria-current']).toBe('true');
    expect(option('p-api').props['aria-current']).toBeUndefined();
  });

  it('remembers a fold on the device, under keys of its own', () => {
    const { trigger, click, group } = setup();
    click(trigger());
    click(group('goal-g-ship'));
    expect(store.get('day-planner-task-project-open-goal-g-ship')).toBe('true');
    expect([...store.keys()].some((k) => k.startsWith('day-planner-inbox-filter-open-'))).toBe(false);
    const again = setup();
    again.click(again.trigger());
    expect(again.rows()).toContain('p-api');
  });
});

describe('choosing', () => {
  it('a project sets what the old select set: its id, its colour and its users', () => {
    const { trigger, click, group, option, lastTask, panel } = setup({ title: 'Write it', color: 'bg-blue-500' });
    click(trigger());
    click(group('goal-g-ship'));
    click(option('p-api'));
    const api = PROJECTS[0];
    expect(lastTask()).toEqual({
      title: 'Write it', projectId: 'p-api', color: getProjectColor(api, GOALS[0]), assignedUserSyncIds: ['u-1'],
    });
    expect(lastTask().color).toBe('bg-rose-500');
    expect(panel()).toBeUndefined();
  });

  it('a project with its own colour gives the task that colour; one with no users clears them', () => {
    const { trigger, click, group, option, lastTask } = setup({ title: 'x', assignedUserSyncIds: ['u-1'] });
    click(trigger());
    click(group('goal-g-ship'));
    click(option('p-docs'));
    expect(lastTask()).toEqual({ title: 'x', projectId: 'p-docs', color: 'bg-amber-500', assignedUserSyncIds: [] });
  });

  it('No project clears the project and its users, and keeps the colour', () => {
    const { trigger, click, option, lastTask } = setup({ title: 'x', projectId: 'p-api', color: 'bg-rose-500', assignedUserSyncIds: ['u-1'] });
    click(trigger());
    click(option('none'));
    expect(lastTask()).toEqual({ title: 'x', projectId: null, color: 'bg-rose-500', assignedUserSyncIds: [] });
  });

  it('New project… turns the field into a pending project\'s name', () => {
    const initial = { title: 'x', color: 'bg-teal-500' };
    const { trigger, click, option, lastTask, find } = setup(initial);
    click(trigger());
    click(option('new'));
    expect(lastTask()).toEqual(withPendingProject(initial, { title: '', goalId: '' }, GOALS));
    expect(lastTask().projectId).toBe(NEW_PROJECT_ID);
    expect(find({ 'data-task-new-project': true })).toHaveLength(1);
    expect(find({ 'data-project-picker-trigger': true })).toHaveLength(0);
  });
});

describe('the keyboard', () => {
  it('Enter or Space on the field opens it (the form keeps Space from pressing buttons)', () => {
    const { trigger, key, panel } = setup();
    const enter = key(trigger(), 'Enter');
    expect(enter.preventDefault).toHaveBeenCalled();
    expect(panel()).toBeDefined();
    key(trigger(), ' ');
    expect(panel()).toBeUndefined();
    key(trigger(), ' ');
    expect(panel()).toBeDefined();
  });

  const focused = () => globalThis.document.activeElement?.row;

  it('focuses the task\'s project on opening', () => {
    const { trigger, key } = setup({ title: 'x', projectId: 'p-books' });
    key(trigger(), 'Enter');
    expect(focused()).toBe('p-books');
  });

  it('focuses "No project" on opening, walks the rows with the arrows, unfolds with Right, and picks with Enter', () => {
    const { trigger, key, panel, lastTask, option, group, rows } = setup();
    key(trigger(), 'Enter');
    expect(focused()).toBe('none');
    const down = key(panel(), 'ArrowDown');
    expect(down.stopPropagation).toHaveBeenCalled();
    expect(focused()).toBe('new');
    key(panel(), 'ArrowDown');
    key(panel(), 'ArrowDown');
    expect(focused()).toBe('goal-g-ship');
    key(group('goal-g-ship'), 'ArrowRight');
    expect(rows()).toContain('p-api');
    key(panel(), 'ArrowDown');
    expect(focused()).toBe('p-api');
    key(group('goal-g-ship'), 'ArrowLeft');
    expect(rows()).not.toContain('p-api');
    key(group('goal-g-ship'), 'Enter');
    const enter = key(option('p-docs'), 'Enter');
    expect(enter.stopPropagation).toHaveBeenCalled();
    expect(lastTask().projectId).toBe('p-docs');
    expect(focused()).toBeUndefined(); // back on the field, which is no row
  });

  it('Down on the open field goes back into the list', () => {
    const { trigger, key } = setup({ title: 'x', projectId: 'p-books' });
    key(trigger(), 'ArrowDown');
    globalThis.document.activeElement = null;
    const down = key(trigger(), 'ArrowDown');
    expect(down.stopPropagation).toHaveBeenCalled();
    expect(focused()).toBe('p-books');
  });

  it('Up from the first row wraps to the last; Home and End jump', () => {
    const { trigger, key, panel } = setup();
    key(trigger(), 'Enter');
    key(panel(), 'ArrowUp');
    expect(focused()).toBe('standalone');
    key(panel(), 'Home');
    expect(focused()).toBe('none');
    key(panel(), 'End');
    expect(focused()).toBe('standalone');
  });

  it('Space picks a row too, and stops there', () => {
    const { trigger, key, option, lastTask } = setup({ title: 'x', projectId: 'p-api' });
    key(trigger(), 'Enter');
    const space = key(option('none'), ' ');
    expect(space.preventDefault).toHaveBeenCalled();
    expect(space.stopPropagation).toHaveBeenCalled();
    expect(lastTask().projectId).toBeNull();
  });

  it('Escape closes the picker and stops there, so the editor stays open', () => {
    const { trigger, key, panel, setNewTask } = setup();
    key(trigger(), 'Enter');
    const esc = key(panel(), 'Escape');
    expect(esc.stopPropagation).toHaveBeenCalled();
    expect(esc.preventDefault).toHaveBeenCalled();
    expect(panel()).toBeUndefined();
    expect(setNewTask).not.toHaveBeenCalled();
  });

  it('Escape on the closed field is left to the editor', () => {
    const { trigger, key } = setup();
    const esc = key(trigger(), 'Escape');
    expect(esc.stopPropagation).not.toHaveBeenCalled();
    expect(esc.preventDefault).not.toHaveBeenCalled();
  });
});

describe('closing', () => {
  it('a tap outside closes it; a tap inside does not', () => {
    const { trigger, click, panel } = setup();
    click(trigger());
    const [onPointerDown] = listeners.pointerdown;
    act(() => { onPointerDown({ target: { inside: true } }); });
    expect(panel()).toBeDefined();
    act(() => { onPointerDown({ target: {} }); });
    expect(panel()).toBeUndefined();
    expect(listeners.pointerdown.size).toBe(0);
  });

  it('Tab out of it closes it', () => {
    const { trigger, click, panel, root } = setup();
    click(trigger());
    const container = root.root.find((n) => n.props['data-task-project-picker']);
    act(() => { container.props.onBlur({ relatedTarget: { inside: true } }); });
    expect(panel()).toBeDefined();
    act(() => { container.props.onBlur({ relatedTarget: {} }); });
    expect(panel()).toBeUndefined();
  });
});

describe('the filter', () => {
  const many = [...PROJECTS, ...Array.from({ length: 4 }, (_, i) => ({ id: `p-x${i}`, title: `Extra ${i}` }))];

  it('heads the list only when there are many projects', () => {
    const few = setup();
    few.click(few.trigger());
    expect(few.find({ 'data-project-picker-filter': true })).toHaveLength(0);
    const lots = setup(undefined, { projects: many });
    lots.click(lots.trigger());
    expect(lots.find({ 'data-project-picker-filter': true })).toHaveLength(1);
  });

  it('narrows to the matches, every group open, and Enter picks the first without submitting', () => {
    const { trigger, click, find, rows, lastTask } = setup(undefined, { projects: many });
    click(trigger());
    const input = () => find({ 'data-project-picker-filter': true })[0];
    act(() => { input().props.onChange({ target: { value: 'ship' } }); });
    expect(rows()).toEqual(['none', 'new', '[area-a-work]', '[goal-g-ship]', 'p-api', 'p-docs']);
    const e = { key: 'Enter', preventDefault: vi.fn(), stopPropagation: vi.fn() };
    act(() => { input().props.onKeyDown(e); });
    expect(e.preventDefault).toHaveBeenCalled();
    expect(lastTask().projectId).toBe('p-api');
  });

  it('says when nothing matches', () => {
    const { trigger, click, find, root } = setup(undefined, { projects: many });
    click(trigger());
    act(() => { find({ 'data-project-picker-filter': true })[0].props.onChange({ target: { value: 'zzz' } }); });
    expect(JSON.stringify(root.toJSON())).toContain('No matching projects');
  });
});

describe('pending a new project', () => {
  it('is a required name, a goal from the active ones, and a way back', () => {
    const { find, root } = setup({ title: '', projectId: NEW_PROJECT_ID, newProject: { title: 'Run', goalId: 'g-read' } });
    const input = find({ id: 'task-new-project-name' })[0];
    expect(input.props.required).toBe(true);
    expect(input.props.value).toBe('Run');
    const goalOptions = root.root.findAllByType('option').map((o) => o.props.children);
    expect(goalOptions).toContain('Read more');
    expect(goalOptions).not.toContain('Old goal');
    expect(find({ 'data-task-new-project-cancel': true })).toHaveLength(1);
  });
});
