import React from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, create } from 'react-test-renderer';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { loaders } from '../locales.js';
import { DayPlannerContext } from '../context/DayPlannerContext.jsx';
import { FeaturesContext } from '../context/FeaturesContext.jsx';
import { SyncContext } from '../context/SyncContext.jsx';
import { TASK_COLORS } from '../utils/colorUtils.js';
import { completionFollowUpDraft } from '../utils/followUp.js';
import { followUpDraft } from '../jobo/carryForward.js';
import useNewTaskInput from '../hooks/useNewTaskInput.js';
import useTaskActions from '../hooks/useTaskActions.js';
import TaskDeadlineField from './TaskDeadlineField.jsx';
import DesktopNewTaskModal from './DesktopNewTaskModal.jsx';
import MobileNewTaskModal from './MobileNewTaskModal.jsx';

// #2422: "Schedule follow-up task" opened the Inbox form, which has no day or
// time, so a follow-up could not be scheduled as it was made. The follow-up
// form has a switch: the Inbox, where it starts, or the timeline.
//
// These walk the real forms, the real input hook and the real save: opener's
// draft → switch → submit → the list the task lands in.

let i18n;
beforeAll(async () => {
  const bundle = await loaders.en();
  i18n = i18next.createInstance();
  await i18n.init({ lng: 'en', fallbackLng: false, resources: { en: { translation: bundle } }, interpolation: { escapeValue: false } });
});

let stored;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 18, 10, 0, 0)); // Wed 18 Nov 2026
  stored = {};
  globalThis.document = { activeElement: null, addEventListener: () => {}, removeEventListener: () => {} };
  globalThis.localStorage = {
    getItem: (k) => (k in stored ? stored[k] : null),
    setItem: (k, v) => { stored[k] = String(v); },
    removeItem: (k) => { delete stored[k]; },
  };
  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
});
afterEach(() => {
  vi.useRealTimers();
  delete globalThis.document; delete globalThis.localStorage; delete globalThis.requestAnimationFrame;
});

const nodeMock = () => ({ focus: () => {}, blur: () => {}, contains: () => true, scrollIntoView: () => {}, setSelectionRange: () => {}, style: {} });

const DONE = { id: 't1', title: 'Send the contract #legal', color: 'bg-rose-500', completed: true, completedAt: '2026-11-18T09:30:00' };
const PROJECTS = [{ id: 'p1', name: 'Launch', status: 'active' }];

// The draft App's openFollowUp hands the form: a day and a start time, then
// what utils/followUp.js pre-fills.
const completionDraft = (task = DONE, projects = []) => {
  const { selection: _selection, ...draft } = completionFollowUpDraft(task, { projects, prefix: 'Follow up:', note: 'line' });
  return { startTime: '14:15', duration: 30, date: '2026-11-18', isAllDay: false, recurrence: null, ...draft };
};

function setup({ Modal = DesktopNewTaskModal, isMobile = false, draft = completionDraft(), editing = null } = {}) {
  let state;
  const lists = { tasks: [], unscheduled: [] };
  function Harness() {
    const input = useNewTaskInput({ allTags: [], showAddTask: true, t: i18n.t, language: 'en', use24HourClock: false, isEditing: !!editing });
    state = input;
    const actions = useTaskActions({
      tasks: lists.tasks, setTasks: (u) => { lists.tasks = u(lists.tasks); },
      unscheduledTasks: lists.unscheduled, setUnscheduledTasks: (u) => { lists.unscheduled = u(lists.unscheduled); },
      recurringTasks: [], setRecurringTasks: vi.fn(),
      recycleBin: [], setRecycleBin: vi.fn(),
      completedTaskUids: new Set(), setCompletedTaskUids: vi.fn(),
      selectedDate: new Date(2026, 10, 18, 9, 0, 0),
      onboardingProgress: {}, setOnboardingProgress: vi.fn(),
      pushUndo: vi.fn(() => ''), playUISound: vi.fn(),
      parseRecurringId: () => null,
      getAdjustedTimeForImportedConflicts: (id, requested) => ({ conflicted: false, adjustedStartTime: requested, conflictingEvent: null }),
      newTask: input.newTask, setNewTask: input.setNewTask,
      setShowAddTask: vi.fn(), setShowRecurrencePicker: vi.fn(),
      expandedNotesTaskId: null, setExpandedNotesTaskId: vi.fn(),
      setSyncNotification: vi.fn(), setUndoToast: vi.fn(),
      setShowColorPicker: vi.fn(), setShowDeadlinePicker: vi.fn(),
      recurringDeleteConfirm: null, setRecurringDeleteConfirm: vi.fn(),
      hoverPreviewTime: null, hoverPreviewDate: null, setHoverPreviewTime: vi.fn(), setHoverPreviewDate: vi.fn(),
      swipeSchedulingInboxTaskId: { current: null },
      syncTaskCompletionToCalDAV: vi.fn(), computeAvailableSlots: vi.fn(() => []),
      activeFrameNudgeKey: null, setFrameNudgeDismissedKey: vi.fn(),
      frameScheduleModal: null, setFrameScheduleModal: vi.fn(),
      focusBlockTasks: [], setFocusBlockTasks: vi.fn(),
      focusCompletedTasks: new Set(), setFocusCompletedTasks: vi.fn(),
      exitFocusModeRef: { current: null }, playFocusSound: vi.fn(),
      projects: PROJECTS, goals: [], areas: [],
    });
    const ctx = {
      ...input,
      showAddTask: true, setShowAddTask: vi.fn(),
      isMobile, isTablet: false,
      mobileEditingTask: editing, setMobileEditingTask: vi.fn(),
      mobileEditIsInbox: !!editing, setMobileEditIsInbox: vi.fn(),
      mobileEditingNativeEvent: null, setMobileEditingNativeEvent: vi.fn(),
      selectedDate: new Date(2026, 10, 18, 12, 0, 0),
      cardBg: 'bg-white', borderClass: 'border-stone-200', textPrimary: 'text-stone-900', textSecondary: 'text-stone-500', darkMode: false, hoverBg: 'hover:bg-stone-100',
      colors: TASK_COLORS,
      formatTime: (x) => x, use24HourClock: false,
      setShowRecurrencePicker: vi.fn(), setShowDatePicker: vi.fn(), setShowColorPicker: vi.fn(),
      setShowRecurrenceEndDatePicker: vi.fn(), setShowTimePicker: vi.fn(), setDeadlinePickerTaskId: vi.fn(),
      tasks: [], unscheduledTasks: [], recurringTasks: [],
      addTask: actions.addTask, saveMobileEditTask: vi.fn(), moveToRecycleBin: vi.fn(), sendTaskToBucket: vi.fn(),
    };
    return (
      <DayPlannerContext.Provider value={ctx}>
        <Modal />
      </DayPlannerContext.Provider>
    );
  }
  let root;
  act(() => {
    root = create(
      <I18nextProvider i18n={i18n}>
        <FeaturesContext.Provider value={{ aiConfig: {}, goalsProjectsEnabled: false, multiUserEnabled: false, users: [], goals: [], projects: PROJECTS, areas: [] }}>
          <SyncContext.Provider value={{}}>
            <Harness />
          </SyncContext.Provider>
        </FeaturesContext.Provider>
      </I18nextProvider>,
      { createNodeMock: nodeMock },
    );
  });
  act(() => { state.setNewTask(draft); });
  const option = (which) => root.root.findAll(n => typeof n.type === 'string' && n.props['data-follow-up-destination'] === which);
  return {
    root,
    lists,
    newTask: () => state.newTask,
    option,
    choose: (which) => act(() => { option(which)[0].props.onClick(); }),
    type: (value) => act(() => { state.handleNewTaskInputChange({ target: { value, selectionStart: value.length } }); }),
    set: (patch) => act(() => { state.setNewTask(prev => ({ ...prev, ...patch })); }),
    submit: () => act(() => { root.root.findByType('form').props.onSubmit({ preventDefault: () => {}, nativeEvent: { submitter: null } }); }),
    text: () => JSON.stringify(root.toJSON()),
  };
}

const FORMS = [
  ['desktop', { Modal: DesktopNewTaskModal }],
  ['phone', { Modal: MobileNewTaskModal, isMobile: true }],
];

describe.each(FORMS)('the follow-up form\'s switch, %s (#2422)', (_name, form) => {
  it('starts in the Inbox, and saving there adds an Inbox task', () => {
    const p = setup(form);
    expect(p.option('inbox')[0].props['aria-checked']).toBe(true);
    expect(p.option('schedule')[0].props['aria-checked']).toBe(false);
    p.submit();
    expect(p.lists.tasks).toEqual([]);
    expect(p.lists.unscheduled).toHaveLength(1);
    expect(p.lists.unscheduled[0]).toMatchObject({ title: 'Follow up: Send the contract #legal', priority: 0, notes: 'line' });
    expect(p.lists.unscheduled[0]).not.toHaveProperty('date');
  });

  it('switched to the timeline, shows the scheduled form and saves on the day and time the opener gave', () => {
    const p = setup(form);
    expect(p.text()).toContain('New Inbox Task');
    p.choose('schedule');
    expect(p.option('schedule')[0].props['aria-checked']).toBe(true);
    expect(p.text()).toContain('New Scheduled Task');
    p.submit();
    expect(p.lists.unscheduled).toEqual([]);
    expect(p.lists.tasks).toHaveLength(1);
    const saved = p.lists.tasks[0];
    expect(saved).toMatchObject({ title: 'Follow up: Send the contract #legal', date: '2026-11-18', startTime: '14:15', duration: 30, notes: 'line', color: 'bg-rose-500' });
    // Inbox-only fields, and the form's own bookkeeping, are not on the task.
    for (const key of ['deadline', 'priority', 'followUp', 'openInInbox', 'keepUnscheduled', 'recurrence']) expect(saved, key).not.toHaveProperty(key);
  });

  it('a day typed in the title is the deadline in the Inbox and the day on the timeline', () => {
    const p = setup(form);
    p.type('Follow up: Send the contract tomorrow #legal');
    expect(p.newTask()).toMatchObject({ deadline: '2026-11-19', date: '2026-11-18' });
    p.choose('schedule');
    expect(p.newTask()).toMatchObject({ deadline: null, date: '2026-11-19' });
    p.choose('inbox');
    expect(p.newTask()).toMatchObject({ deadline: '2026-11-19', date: '2026-11-18' });
    p.choose('schedule');
    p.submit();
    expect(p.lists.tasks[0]).toMatchObject({ title: 'Follow up: Send the contract #legal', date: '2026-11-19' });
  });

  it('back in the Inbox, a repeat and all-day set on the timeline are gone, and the deadline field is there', () => {
    const p = setup(form);
    p.choose('schedule');
    expect(p.root.root.findAllByType(TaskDeadlineField).every(field => field.children.length === 0)).toBe(true);
    p.set({ recurrence: { type: 'weekly' }, isAllDay: true });
    p.choose('inbox');
    expect(p.newTask()).toMatchObject({ openInInbox: true, recurrence: null, isAllDay: false });
    expect(p.root.root.findAllByType(TaskDeadlineField).some(field => field.children.length > 0)).toBe(true);
    p.submit();
    expect(p.lists.unscheduled[0].isAllDay).toBe(false);
  });

  it('a project task\'s follow-up is scheduled in its project, with the switch in place of the Unscheduled tick', () => {
    const p = setup({ ...form, draft: completionDraft({ ...DONE, projectId: 'p1' }, PROJECTS) });
    p.choose('schedule');
    expect(p.text()).not.toContain('add to project card');
    p.submit();
    expect(p.lists.unscheduled).toEqual([]);
    expect(p.lists.tasks[0]).toMatchObject({ projectId: 'p1', date: '2026-11-18', startTime: '14:15' });
  });

  it('JOBO\'s Add follow-up has it too, for a task with no project', () => {
    const { cursor: _cursor, ...draft } = followUpDraft(DONE, { projects: PROJECTS });
    const p = setup({ ...form, draft: { startTime: '09:00', duration: 30, date: '2026-11-20', isAllDay: false, recurrence: null, ...draft, title: `Chase it${draft.title}` } });
    p.choose('schedule');
    p.submit();
    expect(p.lists.tasks[0]).toMatchObject({ title: 'Chase it #legal', date: '2026-11-20', startTime: '09:00' });
  });

  it('is on no other form: a new Inbox task, a project task kept unscheduled, or an edit', () => {
    const plain = { title: 'Sort the receipts', startTime: '09:00', duration: 30, date: '2026-11-18', isAllDay: false, openInInbox: true, deadline: null, priority: 0 };
    expect(setup({ ...form, draft: plain }).option('inbox')).toEqual([]);
    const kept = setup({ ...form, draft: { ...plain, openInInbox: false, projectId: 'p1', keepUnscheduled: true } });
    expect(kept.option('inbox')).toEqual([]);
    expect(kept.text()).toContain('add to project card');
    const editing = setup({ ...form, draft: completionDraft(), editing: { id: 'u1', title: 'Follow up: Send the contract' } });
    expect(editing.option('inbox')).toEqual([]);
  });
});
