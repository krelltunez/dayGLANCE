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
import CardSubtasks from './CardSubtasks.jsx';

vi.mock('react-dom', async (importOriginal) => ({ ...(await importOriginal()), createPortal: (node) => node }));

// #2368: a timeline card's long title. The full title is the tooltip (with
// the rename hint under it where a double-click renames), and a tall card
// wraps it: up to four lines, or two over subtasks that all still fit.

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

function renderCard({ task, planner: over = {}, ...props }) {
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
  return root;
}
const titleOf = (args) => renderCard(args).root.find((n) => n.props && n.props['data-title-lines'] !== undefined);

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

  it('a very tall card stops at four lines', () => {
    expect(titleOf({ task: task(), height: 600, isNarrowWidth: false }).props['data-title-lines']).toBe(4);
  });

  it('over subtasks that all still fit, two lines, and the subtask fit makes room for them', () => {
    const root = renderCard({ task: task({ subtasks: [{ id: 's1', title: 'Find the leak' }] }), height: 200, isNarrowWidth: false });
    const el = root.root.find((n) => n.props && n.props['data-title-lines'] !== undefined);
    expect(el.props['data-title-lines']).toBe(2);
    // 8 padding + 22 title row + 18 time row, and 13 for the second line.
    expect(root.root.findByType(CardSubtasks).props.reservedPx).toBe(48 + 13);
  });

  it('one line when a second would push a subtask out of sight', () => {
    // 100px: two subtasks fit under one line, one under two.
    const twoSubtasks = [{ id: 's1', title: 'Find the leak' }, { id: 's2', title: 'Get a quote' }];
    const root = renderCard({ task: task({ subtasks: twoSubtasks }), height: 100, isNarrowWidth: false });
    const el = root.root.find((n) => n.props && n.props['data-title-lines'] !== undefined);
    expect(el.props['data-title-lines']).toBe(1);
    expect(el.props.className).toContain('truncate');
    expect(root.root.findByType(CardSubtasks).props.reservedPx).toBe(48);
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

});

describe('the week popover', () => {
  it('shows the whole title, subtasks or not', () => {
    const el = titleOf({ task: task({ subtasks: [{ id: 's1', title: 'Find the leak' }] }), height: 220, isNarrowWidth: false, popover: true });
    expect(el.props['data-title-lines']).toBe(Infinity);
    expect(el.props.style).not.toHaveProperty('WebkitLineClamp');
  });

  it('puts the actions on a row of their own, so the title has the card\'s width', () => {
    const postpone = (root) => root.root.findAll((n) => n.type === 'button' && n.props.title === 'Postpone to tomorrow');
    const popover = renderCard({ task: task(), height: 220, isNarrowWidth: false, popover: true });
    const row = popover.root.find((n) => n.props && n.props['data-popover-actions']);
    expect(postpone(popover)).toHaveLength(1);
    expect(row.findAll((n) => n.type === 'button' && n.props.title === 'Postpone to tomorrow')).toHaveLength(1);
    // A timeline card keeps them beside the title.
    const card = renderCard({ task: task(), height: 220, isNarrowWidth: false });
    expect(card.root.findAll((n) => n.props && n.props['data-popover-actions'])).toHaveLength(0);
    expect(postpone(card)).toHaveLength(1);
  });
});

// #2388: the card's duration read "308 min" however long the task was.
describe('the duration beside the start time', () => {
  const textOf = (args) => JSON.stringify(renderCard(args).toJSON());
  const event = (over = {}) => task({ imported: true, title: 'Offsite', ...over });

  it('a task under an hour keeps its minute count', () => {
    expect(textOf({ task: task({ duration: 45 }), height: 80, isNarrowWidth: false })).toContain('45 min');
  });

  it('a task of an hour or more reads in hours and minutes', () => {
    const text = textOf({ task: task({ duration: 308 }), height: 400, isNarrowWidth: false });
    expect(text).toContain('5h 8m');
    expect(text).not.toContain('308');
  });

  it('an imported calendar event too', () => {
    expect(textOf({ task: event({ duration: 45 }), height: 80, isNarrowWidth: false })).toContain('45 min');
    const text = textOf({ task: event({ duration: 308 }), height: 400, isNarrowWidth: false });
    expect(text).toContain('5h 8m');
    expect(text).not.toContain('308');
  });

  it('an exact hour has no "0m"', () => {
    const text = textOf({ task: task({ duration: 120 }), height: 160, isNarrowWidth: false });
    expect(text).toContain('2h');
    expect(text).not.toContain('0m');
  });
});
