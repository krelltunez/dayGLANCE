import React from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { act, create } from 'react-test-renderer';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { loaders } from '../locales.js';
import { DayPlannerContext } from '../context/DayPlannerContext.jsx';
import { FeaturesContext } from '../context/FeaturesContext.jsx';
import { SyncContext } from '../context/SyncContext.jsx';
import TimelineTaskCardContent from './TimelineTaskCardContent.jsx';

vi.mock('react-dom', async (importOriginal) => ({ ...(await importOriginal()), createPortal: (node) => node }));

// #2368: a timeline card's long title. The full title is the tooltip (with
// the rename hint under it where a double-click renames), and a tall card
// wraps it, unless the card lists subtasks.

let i18n;
beforeAll(async () => {
  const bundle = await loaders.en();
  i18n = i18next.createInstance();
  await i18n.init({ lng: 'en', fallbackLng: false, resources: { en: { translation: bundle } }, interpolation: { escapeValue: false } });
});

const noop = () => {};
const planner = {
  isTablet: false, darkMode: false, editingTaskId: null,
  expandedNotesTaskId: null, setExpandedNotesTaskId: noop,
  expandedTaskMenu: null, setExpandedTaskMenu: noop,
  longPressTimerRef: { current: null }, longPressTriggeredRef: { current: false },
  setEditingRecurrenceTaskId: noop, openMobileEditTask: noop, toggleComplete: noop, startEditingTask: noop,
  moveToInbox: noop, moveToRecycleBin: noop, postponeTask: noop,
  formatTime: (t) => t, timeToMinutes: () => 0, setTasks: noop,
  updateTaskNotes: noop, addSubtask: noop, toggleSubtask: noop, deleteSubtask: noop, updateSubtaskTitle: noop,
  setInboxProjectFilter: noop, setInboxPriorityFilter: noop, setHideCompletedInbox: noop,
  setHideProjectTasksInbox: noop, setHideStandaloneTasksInbox: noop,
  showCardSubtasks: true, tasks: [], unscheduledTasks: [], recurringTasks: [],
};
const features = {
  goalsProjectsEnabled: false, projects: [], projectFilter: null, setProjectFilter: noop,
  aiConfig: null, aiSubtasksLoadingForTask: null, generateAISubtasks: noop, multiUserEnabled: false, users: [],
};

const LONG = 'Call the roofer about the leak over the back bedroom before the rain on Thursday';

function titleOf({ task, planner: over = {}, ...props }) {
  let root;
  act(() => {
    root = create(
      <I18nextProvider i18n={i18n}>
        <DayPlannerContext.Provider value={{ ...planner, ...over }}>
          <FeaturesContext.Provider value={features}>
            <SyncContext.Provider value={{}}>
              <TimelineTaskCardContent task={task} {...props} />
            </SyncContext.Provider>
          </FeaturesContext.Provider>
        </DayPlannerContext.Provider>
      </I18nextProvider>,
    );
  });
  return root.root.find((n) => n.props && n.props['data-title-lines'] !== undefined);
}

const task = (over = {}) => ({ id: 't1', title: LONG, color: 'bg-blue-500', startTime: '09:00', duration: 60, subtasks: [], ...over });

describe('the full title on hover', () => {
  it('a wide card shows the full title, the rename hint on a second line', () => {
    const el = titleOf({ task: task(), height: 80, isNarrowWidth: false });
    expect(el.props.title).toBe(`${LONG}\nDouble-click to rename`);
  });

  it('a narrow card too', () => {
    const el = titleOf({ task: task(), height: 80, isNarrowWidth: true });
    expect(el.props.title).toBe(`${LONG}\nDouble-click to rename`);
  });

  it('no rename hint where a double-click does not rename (a tablet)', () => {
    const el = titleOf({ task: task(), height: 80, isNarrowWidth: false, planner: { isTablet: true } });
    expect(el.props.title).toBe(LONG);
  });
});

describe('a tall card wraps the title', () => {
  it('a short card keeps one line', () => {
    const el = titleOf({ task: task(), height: 30, isNarrowWidth: false });
    expect(el.props['data-title-lines']).toBe(1);
    expect(el.props.className).toContain('truncate');
  });

  it('a tall card without subtasks wraps', () => {
    const el = titleOf({ task: task(), height: 80, isNarrowWidth: false });
    expect(el.props['data-title-lines']).toBe(3);
    expect(el.props.className).not.toContain('truncate');
    expect(el.props.style).toMatchObject({ WebkitLineClamp: 3 });
  });

  it('a tall card too narrow to wrap words whole (side-by-side overlaps) keeps one line', () => {
    const el = titleOf({ task: task(), height: 200, width: 130, isNarrowWidth: true });
    expect(el.props['data-title-lines']).toBe(1);
    expect(titleOf({ task: task(), height: 200, width: 220, isNarrowWidth: true }).props['data-title-lines']).toBeGreaterThan(1);
  });

  it('the width is read as at 100% zoom', () => {
    // 260px drawn at 2x zoom is a 130px card.
    expect(titleOf({ task: task(), height: 400, width: 260, zoom: 2, isNarrowWidth: true }).props['data-title-lines']).toBe(1);
  });

  it('a tall card that lists subtasks keeps one line', () => {
    const el = titleOf({ task: task({ subtasks: [{ id: 's1', title: 'Find the leak' }] }), height: 200, isNarrowWidth: false });
    expect(el.props['data-title-lines']).toBe(1);
    expect(el.props.className).toContain('truncate');
  });

  it('with the card subtasks setting off, the subtasks are not in the way', () => {
    const el = titleOf({
      task: task({ subtasks: [{ id: 's1', title: 'Find the leak' }] }),
      height: 80,
      isNarrowWidth: false,
      planner: { showCardSubtasks: false },
    });
    expect(el.props['data-title-lines']).toBe(3);
  });

  it('the week popover wraps even with subtasks', () => {
    const el = titleOf({ task: task({ subtasks: [{ id: 's1', title: 'Find the leak' }] }), height: 220, isNarrowWidth: false, wrapTitle: true });
    expect(el.props['data-title-lines']).toBeGreaterThan(3);
  });
});
