import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, create } from 'react-test-renderer';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { loaders } from '../../locales.js';
import { DayPlannerContext } from '../../context/DayPlannerContext.jsx';
import { FeaturesContext } from '../../context/FeaturesContext.jsx';
import { SyncContext } from '../../context/SyncContext.jsx';
import ProjectCard from './ProjectCard.jsx';
import ProjectPlanner from './ProjectPlanner.jsx';
import SchedTaskCard from '../sched/SchedTaskCard.jsx';
import { ProjectForm } from '../goals/GoalDashboard.jsx';

// #2394: a project can list its unscheduled tasks deadlines first, set in its
// edit dialog or from the Planner. The real card, Planner and form: the order
// drawn, which rows can still be dragged, what a drag writes, and that turning
// it off shows the manual order with the drag in it.

const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };

const noop = () => {};
const task = (id, projectOrder, over = {}) => ({
  id, title: id.toUpperCase(), projectId: 'p1', projectOrder, duration: 30, color: 'bg-orange-500',
  completed: false, isAllDay: false, notes: '', subtasks: [], priority: 0, lastModified: '2026-11-01T00:00:00.000Z', ...over,
});
// Manual order: a, b, c, d. b and d have deadlines, d's the sooner. `other` is another project's.
const TASKS = () => [
  task('a', 0), task('b', 10, { deadline: '2027-01-10' }), task('c', 20), task('d', 30, { deadline: '2026-11-15' }),
  task('done', 40, { completed: true }), task('other', 0, { projectId: 'p2' }),
];
const BY_DEADLINE = { id: 'p1', title: 'Degree', color: 'bg-orange-500', status: 'active', taskSort: 'deadline' };
const MANUAL = { id: 'p1', title: 'Degree', color: 'bg-orange-500', status: 'active' };

async function mount(render, { unscheduled = TASKS(), updateProject = noop } = {}) {
  const bundle = await loaders.en();
  const i18n = i18next.createInstance();
  await i18n.init({ lng: 'en', fallbackLng: false, resources: { en: { translation: bundle } }, interpolation: { escapeValue: false } });
  const state = { unscheduled };
  const reorderUnscheduledTasks = vi.fn((next) => { state.unscheduled = next; });
  const tree = (project) => (
    <I18nextProvider i18n={i18n}>
      <DayPlannerContext.Provider value={{
        isMobile: false, isTablet: false, isLandscape: true, darkMode: false, use24HourClock: false,
        cardBg: '', borderClass: '', textPrimary: '', textSecondary: '', hoverBg: '',
        tasks: [], unscheduledTasks: state.unscheduled, recurringTasks: [],
        setTasks: noop, setUnscheduledTasks: noop, reorderUnscheduledTasks,
        openMobileEditTask: noop, scheduleTaskAtNextSlot: noop, postponeTask: noop, toggleComplete: noop, formatTime: (v) => v,
        getTodayStr: () => '2026-11-14', currentTimeMinutes: 600, currentTime: new Date(2026, 10, 14, 10, 0),
        expandedNotesTaskId: null, setExpandedNotesTaskId: noop,
        updateTaskNotes: noop, addSubtask: noop, toggleSubtask: noop, deleteSubtask: noop, updateSubtaskTitle: noop,
        longPressTriggeredRef: { current: false }, longPressTimerRef: { current: null },
        mobileActiveTab: '', showDeadlinePicker: null, setShowDeadlinePicker: noop,
        pushUndo: noop, setUndoToast: noop,
      }}>
        <FeaturesContext.Provider value={{
          goals: [], projects: [project], areas: [], goalsProjectsEnabled: true, multiUserEnabled: false, users: [],
          deleteProject: noop, updateProject, moveProject: noop, setPlannerProjectId: noop,
          generateAISubtasks: noop, aiSubtasksLoadingForTask: null, aiConfig: null,
          showGoalsDashboard: false, enterHyperGlanceMode: noop, isVisibleForUser: () => true,
        }}>
          <SyncContext.Provider value={{ loadWikiNote: null, saveWikiNote: null, openInObsidian: null, obsidianConfig: { enabled: false }, bridgeHeartbeatRef: { current: null } }}>
            {render(project)}
          </SyncContext.Provider>
        </FeaturesContext.Provider>
      </DayPlannerContext.Provider>
    </I18nextProvider>
  );
  let root;
  const show = async (project) => {
    await act(async () => {
      if (root) root.update(tree(project));
      else root = create(tree(project), { createNodeMock: () => ({ focus: noop, scrollIntoView: noop, addEventListener: noop, removeEventListener: noop }) });
    });
  };
  return { show, root: () => root.root, state, reorderUnscheduledTasks };
}

const dragEvent = () => ({ preventDefault: noop, dataTransfer: {} });

describe('the project card', () => {
  const card = (project) => <ProjectCard project={project} onEditClick={noop} visibleCount={20} />;
  const rows = (root) => root.findAll((n) => typeof n.type === 'string' && n.props['data-project-task'] !== undefined);
  const order = (root) => rows(root).map((r) => r.props['data-project-task']);
  const row = (root, id) => rows(root).find((r) => r.props['data-project-task'] === id);
  const drag = (root, from, to) => {
    act(() => { row(root, from).props.onDragStart(dragEvent()); });
    act(() => { row(root, to).props.onDrop(dragEvent()); });
  };

  it('manual: the dragged order, every open row draggable', async () => {
    const m = await mount(card);
    await m.show(MANUAL);
    expect(order(m.root())).toEqual(['a', 'b', 'c', 'd', 'done']);
    expect(rows(m.root()).filter((r) => r.props.draggable).map((r) => r.props['data-project-task'])).toEqual(['a', 'b', 'c', 'd']);
  });

  it('by deadline: dated tasks first, soonest first, then the rest in manual order', async () => {
    const m = await mount(card);
    await m.show(BY_DEADLINE);
    expect(order(m.root())).toEqual(['d', 'b', 'a', 'c', 'done']);
  });

  it('by deadline: only the undated rows can be dragged or dropped on; a dated row keeps the grip\'s width without one', async () => {
    const m = await mount(card);
    await m.show(BY_DEADLINE);
    for (const id of ['a', 'c']) {
      expect(row(m.root(), id).props.draggable, id).toBe(true);
      expect(row(m.root(), id).findAll((n) => n.props['data-drag-handle'] !== undefined), id).toHaveLength(1);
    }
    for (const id of ['d', 'b']) {
      const r = row(m.root(), id);
      expect(r.props.draggable, id).toBe(false);
      expect(r.props.onDrop, id).toBeUndefined();
      expect(r.props['data-drag-idx'], id).toBeUndefined();
      expect(r.findAll((n) => n.props['data-drag-handle'] !== undefined), id).toHaveLength(0);
      expect(r.findAll((n) => n.props['data-no-grip'] !== undefined), id).toHaveLength(1);
    }
    // The completed row never had a grip, and gets no stand-in for one.
    expect(row(m.root(), 'done').findAll((n) => n.props['data-no-grip'] !== undefined)).toHaveLength(0);
  });

  it('by deadline: dragging an undated task reorders the undated ones, and turning the order off shows the manual order with that drag in it', async () => {
    const m = await mount(card);
    await m.show(BY_DEADLINE);
    drag(m.root(), 'c', 'a');
    expect(m.reorderUnscheduledTasks).toHaveBeenCalledTimes(1);
    // Another project's task is untouched.
    expect(m.state.unscheduled.find((t) => t.id === 'other')).toEqual(TASKS().find((t) => t.id === 'other'));
    await m.show(BY_DEADLINE);
    expect(order(m.root())).toEqual(['d', 'b', 'c', 'a', 'done']);
    await m.show(MANUAL);
    // b and d hold the manual places they had (second and fourth).
    expect(order(m.root())).toEqual(['c', 'b', 'a', 'd', 'done']);
  });

  it('manual: a drag still moves any open task anywhere', async () => {
    const m = await mount(card);
    await m.show(MANUAL);
    drag(m.root(), 'd', 'a');
    await m.show(MANUAL);
    expect(order(m.root())).toEqual(['d', 'a', 'b', 'c', 'done']);
  });
});

describe('the Planner', () => {
  const planner = (project) => <ProjectPlanner project={project} onClose={noop} />;
  const cards = (root) => root.findAllByType(SchedTaskCard).filter((c) => c.props.isInbox);
  const order = (root) => cards(root).map((c) => c.props.task.id);
  const toggle = (root) => root.find((n) => typeof n.type === 'string' && n.props['data-planner-deadline-order-toggle'] !== undefined);

  it('lists the unscheduled column under the project\'s order, and only undated tasks drag under the deadline order', async () => {
    const m = await mount(planner);
    await m.show(MANUAL);
    expect(order(m.root())).toEqual(['a', 'b', 'c', 'd', 'done']);
    expect(cards(m.root()).filter((c) => c.props.dnd).map((c) => c.props.task.id)).toEqual(['a', 'b', 'c', 'd']);
    await m.show(BY_DEADLINE);
    expect(order(m.root())).toEqual(['d', 'b', 'a', 'c', 'done']);
    expect(cards(m.root()).filter((c) => c.props.dnd).map((c) => [c.props.task.id, c.props.dnd.idx])).toEqual([['a', 0], ['c', 1]]);
    // A dated card keeps the grip's width, so the checkboxes stay in one
    // column; a completed one never had a grip and gets no stand-in.
    const noGrip = (c) => c.findAll((n) => typeof n.type === 'string' && n.props['data-no-grip'] !== undefined).length;
    expect(cards(m.root()).map((c) => [c.props.task.id, noGrip(c)])).toEqual([['d', 1], ['b', 1], ['a', 0], ['c', 0], ['done', 0]]);
  });

  it('with one undated task there are no grips, so the dated cards hold no space for one', async () => {
    const m = await mount(planner, { unscheduled: TASKS().filter((x) => x.id !== 'c') });
    await m.show(BY_DEADLINE);
    expect(cards(m.root()).some((c) => c.props.dnd)).toBe(false);
    expect(m.root().findAll((n) => typeof n.type === 'string' && n.props['data-no-grip'] !== undefined)).toHaveLength(0);
  });

  it('a drag under the deadline order reorders the undated tasks and leaves the dated ones their manual places', async () => {
    const m = await mount(planner);
    await m.show(BY_DEADLINE);
    const dnd = (id) => cards(m.root()).find((c) => c.props.task.id === id).props.dnd;
    act(() => { dnd('c').onDragStart(dragEvent(), dnd('c').idx); });
    act(() => { dnd('a').onDrop(dragEvent(), dnd('a').idx); });
    await m.show(BY_DEADLINE);
    expect(order(m.root())).toEqual(['d', 'b', 'c', 'a', 'done']);
    await m.show(MANUAL);
    expect(order(m.root())).toEqual(['c', 'b', 'a', 'd', 'done']);
  });

  it('the header toggle says which order is on and writes the other to the project', async () => {
    const updateProject = vi.fn();
    const m = await mount(planner, { updateProject });
    await m.show(MANUAL);
    expect(toggle(m.root()).props['aria-pressed']).toBe(false);
    expect(toggle(m.root()).children).toContain('By deadline');
    expect(toggle(m.root()).props.title).toBe('Unscheduled tasks: your own order. Click to put deadlines first.');
    act(() => { toggle(m.root()).props.onClick(); });
    expect(updateProject).toHaveBeenLastCalledWith('p1', { taskSort: 'deadline' });
    await m.show(BY_DEADLINE);
    expect(toggle(m.root()).props['aria-pressed']).toBe(true);
    act(() => { toggle(m.root()).props.onClick(); });
    // Absent, not false or 'manual': a project that never used it has no field.
    expect(updateProject).toHaveBeenLastCalledWith('p1', { taskSort: undefined });
  });
});

describe('the project\'s edit dialog', () => {
  const form = (onSave) => (project) => <ProjectForm initial={project} goals={[]} onSave={onSave} onCancel={noop} />;
  const box = (root) => root.find((n) => n.type === 'input' && n.props['data-project-deadline-order'] !== undefined);
  const submit = (root) => act(() => { root.find((n) => n.type === 'form').props.onSubmit({ preventDefault: noop }); });

  it('shows the project\'s order, and saves it: on as the field, off as no field', async () => {
    const onSave = vi.fn();
    const m = await mount(form(onSave));
    await m.show(MANUAL);
    expect(box(m.root()).props.checked).toBe(false);
    submit(m.root());
    expect(onSave.mock.calls[0][0]).toHaveProperty('taskSort', undefined);
    act(() => { box(m.root()).props.onChange({ target: { checked: true } }); });
    submit(m.root());
    expect(onSave.mock.calls[1][0].taskSort).toBe('deadline');
  });

  it('a project already ordered by deadline opens with it on, and unticking it clears the field', async () => {
    const onSave = vi.fn();
    const m = await mount(form(onSave));
    await m.show(BY_DEADLINE);
    expect(box(m.root()).props.checked).toBe(true);
    act(() => { box(m.root()).props.onChange({ target: { checked: false } }); });
    submit(m.root());
    expect(onSave.mock.calls[0][0]).toHaveProperty('taskSort', undefined);
  });

  it('a new project starts in the manual order', async () => {
    const onSave = vi.fn();
    const m = await mount(() => <ProjectForm goals={[]} onSave={onSave} onCancel={noop} />);
    await m.show(MANUAL);
    expect(box(m.root()).props.checked).toBe(false);
  });
});
