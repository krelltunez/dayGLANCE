import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import useTaskActions from './useTaskActions.js';
import { NEW_PROJECT_ID } from '../utils/pendingProject.js';
import { readLastUsedProject } from '../utils/lastUsedProject.js';
import { TASK_COLORS } from '../utils/colorUtils.js';

// "New project…" in the task modal: Add creates the project and the task in
// it, and reads the stored task back.
const DAY = '2026-10-02';
function build(newTask, extra = {}) {
  const setTasks = vi.fn();
  const setUnscheduledTasks = vi.fn();
  const addProject = vi.fn((fields) => ({ ...fields, id: 'p-new', status: 'active' }));
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const actions = useTaskActions({
    tasks: [], setTasks, unscheduledTasks: [], setUnscheduledTasks, recurringTasks: [], setRecurringTasks: vi.fn(),
    selectedDate: new Date(`${DAY}T12:00:00`), newTask, setNewTask: vi.fn(), setShowAddTask: vi.fn(),
    pushUndo: vi.fn(), playUISound: vi.fn(), setUndoToast: vi.fn(), setSyncNotification: vi.fn(),
    getAdjustedTimeForImportedConflicts: (_id, startTime) => ({ conflicted: false, adjustedStartTime: startTime, conflictingEvent: null }),
    onboardingProgress: { hasAddedScheduledTask: true, hasAddedInboxTask: true, hasUsedTags: true },
    setOnboardingProgress: vi.fn(), swipeSchedulingInboxTaskId: { current: null },
    colors: TASK_COLORS, getNextQuarterHour: () => '09:00', parseRecurringId: () => null,
    addProject, goals: [{ id: 'g1', title: 'Health', color: 'bg-green-500' }],
    ...extra,
  });
  return { actions, addProject, inbox: () => setUnscheduledTasks.mock.calls[0][0]([]).at(-1), scheduled: () => setTasks.mock.calls[0][0]([]).at(-1) };
}
const form = (more) => ({ title: 'Buy shoes', duration: 30, startTime: '10:00', date: DAY, isAllDay: false, projectId: NEW_PROJECT_ID, newProject: { title: 'Run a 10k', goalId: 'g1' }, color: 'bg-green-500', ...more });

describe('a task saved with a new project', () => {
  it('to the Inbox: the project is created and the task is in it', () => {
    const { actions, addProject, inbox } = build(form({ openInInbox: true }));
    actions.addTask(true);
    expect(addProject).toHaveBeenCalledTimes(1);
    expect(inbox()).toMatchObject({ title: 'Buy shoes', projectId: 'p-new', color: 'bg-green-500' });
    expect(inbox()).not.toHaveProperty('newProject');
  });

  it('scheduled: the same', () => {
    const { actions, scheduled } = build(form());
    actions.addTask(false);
    expect(scheduled().projectId).toBe('p-new');
  });

  it('an empty title saves nothing and creates no project', () => {
    const { actions, addProject } = build(form({ title: '  ' }));
    actions.addTask(false);
    expect(addProject).not.toHaveBeenCalled();
  });

  // MUTATION: drop the hand-over and a task tagged #obsidian is written to
  // its daily note without its new project, which the app's project list
  // does not hold until the next render.
  it('hands the new project to the #obsidian write, which cannot find it yet', () => {
    const getObsidianTaskMeta = vi.fn(() => null);
    const { actions } = build(form({ title: 'Buy shoes #obsidian' }), { getObsidianTaskMeta });
    actions.addTask(false);
    expect(getObsidianTaskMeta).toHaveBeenCalledWith('Buy shoes', 'p-new', expect.objectContaining({ id: 'p-new', title: 'Run a 10k' }));
  });
});

// #2308: the title written to the daily note drops #obsidian and only that
// tag. The old rule (`#obsidian\b`) cut `#obsidian/inbox` down to `/inbox`.
describe('the #obsidian tag on save', () => {
  const plain = (title) => ({ title, duration: 30, startTime: '10:00', date: DAY, isAllDay: false, projectId: null, color: 'bg-green-500' });

  it('drops #obsidian, in any case, and leaves a longer or nested tag whole', () => {
    const getObsidianTaskMeta = vi.fn(() => null);
    build(plain('Buy shoes #Obsidian #obsidian/inbox #obsidian-notes, today'), { getObsidianTaskMeta }).actions.addTask(false);
    expect(getObsidianTaskMeta).toHaveBeenCalledWith('Buy shoes #obsidian/inbox #obsidian-notes, today', null, null);
  });

  it('a title with only a longer tag is not an #obsidian task', () => {
    const getObsidianTaskMeta = vi.fn(() => null);
    build(plain('Buy shoes #obsidian-notes'), { getObsidianTaskMeta }).actions.addTask(false);
    expect(getObsidianTaskMeta).not.toHaveBeenCalled();
  });
});

// #2274: a task saved from the editor makes its project the picker's
// "last used" on this device; one saved without a project leaves it.
describe('the last used project', () => {
  const store = new Map();
  beforeEach(() => {
    store.clear();
    globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) };
  });
  afterEach(() => { delete globalThis.localStorage; });

  it('is the project the task was saved with, a new one by its real id', () => {
    build(form({ openInInbox: true })).actions.addTask(true);
    expect(readLastUsedProject()).toBe('p-new');
    build(form({ projectId: 'p-other', newProject: undefined })).actions.addTask(false);
    expect(readLastUsedProject()).toBe('p-other');
  });

  it('a task saved without a project, or not saved at all, leaves it', () => {
    build(form({ projectId: 'p-other', newProject: undefined })).actions.addTask(false);
    build(form({ projectId: null, newProject: undefined })).actions.addTask(false);
    build(form({ title: ' ', projectId: 'p-third', newProject: undefined })).actions.addTask(false);
    expect(readLastUsedProject()).toBe('p-other');
  });
});
