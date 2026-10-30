import React from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, create } from 'react-test-renderer';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { loaders } from '../locales.js';
import { DayPlannerContext } from '../context/DayPlannerContext.jsx';
import { SyncContext } from '../context/SyncContext.jsx';
import { FeaturesContext } from '../context/FeaturesContext.jsx';
import TaskTitleRenameField from './TaskTitleRenameField.jsx';
import AllDayTaskCard from './AllDayTaskCard.jsx';

// #2263: one rename field for the timeline cards, the all-day cards and the
// desktop Inbox row, and the all-day card's double-click: the title renames,
// the card opens the editor, as on a timeline card.

let i18n;
beforeAll(async () => {
  const bundle = await loaders.en();
  i18n = i18next.createInstance();
  await i18n.init({ lng: 'en', fallbackLng: false, resources: { en: { translation: bundle } }, interpolation: { escapeValue: false } });
});
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

const plannerFor = (over = {}) => ({
  darkMode: false, cardBg: '', borderClass: '', textPrimary: '', textSecondary: '', hoverBg: '',
  editingTaskId: null, editingTaskText: 'Paint fence', editingInputRef: { current: null },
  handleEditInputChange: vi.fn(), handleEditKeyDown: vi.fn(), saveTaskTitle: vi.fn(), applySuggestionForEdit: vi.fn(),
  startEditingTask: vi.fn(), openMobileEditTask: vi.fn(),
  showSuggestions: false, suggestions: [], selectedSuggestionIndex: 0, suggestionContext: null,
  expandedNotesTaskId: null, setExpandedNotesTaskId: vi.fn(), expandedTaskMenu: null, setExpandedTaskMenu: vi.fn(),
  longPressTimerRef: { current: null }, longPressTriggeredRef: { current: false },
  taskWidths: {}, getTaskCalendarStyle: () => null, tasks: [], unscheduledTasks: [],
  ...over,
});

const mount = (planner, node) => {
  let root;
  act(() => {
    root = create(
      <I18nextProvider i18n={i18n}>
        <DayPlannerContext.Provider value={planner}>
          <SyncContext.Provider value={{}}>
            <FeaturesContext.Provider value={{ projects: [], users: [] }}>{node}</FeaturesContext.Provider>
          </SyncContext.Provider>
        </DayPlannerContext.Provider>
      </I18nextProvider>,
      { createNodeMock: (el) => (el.type === 'input' ? { tag: 'the-input' } : null) },
    );
  });
  return root;
};

describe('TaskTitleRenameField', () => {
  it('names its input in editingInputRef, so a suggestion pick can place the cursor', () => {
    const planner = plannerFor({ showSuggestions: true, suggestionContext: 'editing', suggestions: [{ type: 'tag', value: 'home', display: '#home' }] });
    const root = mount(planner, <TaskTitleRenameField isInbox />);
    expect(planner.editingInputRef.current).toEqual({ tag: 'the-input' });
    const picker = root.root.find((n) => typeof n.props.onSelect === 'function');
    act(() => { picker.props.onSelect({ value: 'home' }); });
    expect(planner.applySuggestionForEdit).toHaveBeenCalledWith({ value: 'home' }, { tag: 'the-input' }, true);
  });

  it('routes keys and a blur to the Inbox or the timeline as it is told', () => {
    const planner = plannerFor();
    const input = mount(planner, <TaskTitleRenameField />).root.findByType('input');
    act(() => { input.props.onKeyDown({ key: 'Enter' }); });
    expect(planner.handleEditKeyDown).toHaveBeenCalledWith({ key: 'Enter' }, false);
    act(() => { input.props.onBlur(); vi.advanceTimersByTime(150); });
    expect(planner.saveTaskTitle).toHaveBeenCalledWith(false);
  });

  it('a blur while suggestions are open does not end the rename', () => {
    const planner = plannerFor({ showSuggestions: true });
    const input = mount(planner, <TaskTitleRenameField />).root.findByType('input');
    act(() => { input.props.onBlur(); vi.advanceTimersByTime(150); });
    expect(planner.saveTaskTitle).not.toHaveBeenCalled();
  });

  it('a double-click inside it stays in the field', () => {
    const input = mount(plannerFor(), <TaskTitleRenameField />).root.findByType('input');
    const stopPropagation = vi.fn();
    input.props.onDoubleClick({ stopPropagation });
    expect(stopPropagation).toHaveBeenCalled();
  });
});

describe('AllDayTaskCard double-click', () => {
  const task = { id: 't1', title: 'Holiday', date: '2026-10-30', isAllDay: true, color: 'bg-green-500' };
  const card = (root) => root.root.find((n) => n.type === 'div' && typeof n.props.onDoubleClick === 'function' && String(n.props.className).includes('rounded-lg shadow-sm'));
  // The double-click guard walks the DOM from the target up to the card.
  const domCard = { matches: () => false, classList: { contains: () => false }, parentElement: null };

  it('on the card opens the editor; on the title it renames', () => {
    const planner = plannerFor();
    const root = mount(planner, <AllDayTaskCard task={task} fillWidth={false} />);
    act(() => { card(root).props.onDoubleClick({ target: domCard, currentTarget: domCard, stopPropagation() {} }); });
    expect(planner.openMobileEditTask).toHaveBeenCalledWith(task, false);
    const title = root.root.find((n) => n.type === 'div' && n.props.title === 'Holiday' && typeof n.props.onDoubleClick === 'function');
    act(() => { title.props.onDoubleClick({ stopPropagation() {} }); });
    expect(planner.startEditingTask).toHaveBeenCalledWith(task, false);
  });

  it('draws the shared field while it is being renamed', () => {
    const root = mount(plannerFor({ editingTaskId: 't1' }), <AllDayTaskCard task={task} fillWidth={false} />);
    expect(root.root.findAllByType(TaskTitleRenameField)).toHaveLength(1);
  });

  it('leaves a double-tap on a touch tablet alone', () => {
    const root = mount(plannerFor({ isTablet: true }), <AllDayTaskCard task={task} fillWidth={false} />);
    expect(root.root.findAll((n) => n.type === 'div' && typeof n.props.onDoubleClick === 'function')).toHaveLength(0);
  });
});
