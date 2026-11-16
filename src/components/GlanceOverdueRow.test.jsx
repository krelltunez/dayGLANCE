import React from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, create } from 'react-test-renderer';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { DayPlannerContext } from '../context/DayPlannerContext.jsx';
import { FeaturesContext } from '../context/FeaturesContext.jsx';
import { SyncContext } from '../context/SyncContext.jsx';
import { loaders } from '../locales.js';
import GlanceSidebar from './GlanceSidebar.jsx';
import MobileGlanceSection from './MobileGlanceSection.jsx';

// #2418: a row of the Overdue list finds its task. The row of an Inbox task
// whose deadline has passed returned before doing anything, on every surface:
// no way to its details and no way to where it is. Where the task is found is
// goToOverdueTask's business (useNavigation.test.js); this is the row's wiring.

const TODAY = '2026-11-16';
let i18n;
beforeAll(async () => {
  const bundle = await loaders.en();
  i18n = i18next.createInstance();
  await i18n.init({ lng: 'en', fallbackLng: false, resources: { en: { translation: bundle } }, interpolation: { escapeValue: false } });
});
afterEach(() => { vi.unstubAllGlobals(); });

const scheduled = { id: 's1', title: 'Write report', date: '2026-11-15', startTime: '09:00', duration: 30, color: 'bg-blue-500', _overdueType: 'scheduled' };
const deadline = { id: 'u1', title: 'File taxes', deadline: '2026-11-15', duration: 30, color: 'bg-red-500', _overdueType: 'deadline' };

function mount(surface) {
  const goToOverdueTask = vi.fn();
  const openMobileEditTask = vi.fn();
  const openMainAt = vi.fn();
  if (surface === 'tray') vi.stubGlobal('window', { ...globalThis.window, electronAPI: { openMainAt } });
  const planner = {
    currentTime: new Date(`${TODAY}T10:00:00`),
    tasks: [scheduled], unscheduledTasks: [deadline], todayAgenda: [], recurringTasks: [],
    filterableTags: [], selectedTags: [], minimizedSections: {},
    agendaNowMarker: { insideTask: false, insertAfterIndex: 0, nowTimeStr: '10:00' },
    glanceAhead: { dayLabel: 'Tuesday', committedMinutes: 0, isEmpty: true, taskCount: 0, eventCount: 0, deadlineCount: 0 },
    getTodayStr: () => TODAY, getOverdueTasks: () => [scheduled, deadline], filterByTags: (tasks) => tasks,
    formatTime: (time) => time, formatDeadlineDate: (date) => date, renderTitle: (title) => title,
    timeToMinutes: (time) => { const [h, m] = time.split(':').map(Number); return h * 60 + m; },
    darkMode: false, textPrimary: '', textSecondary: '', cardBg: '', borderClass: '', hoverBg: '',
    setTaskContextMenu: vi.fn(), openMobileEditTask, goToOverdueTask,
    incompleteTodayTasks: [], visibleDates: [], weekViewDates: [],
  };
  const features = {
    aiConfig: { features: {} }, myFrames: [], getFrameInstancesForDate: () => [],
    goals: [], projects: [], hgVisibleProjects: [], goalsProjectsEnabled: false, isVisibleForUser: () => true,
  };
  let root;
  act(() => {
    root = create(
      <I18nextProvider i18n={i18n}>
        <DayPlannerContext.Provider value={planner}>
          <FeaturesContext.Provider value={features}>
            <SyncContext.Provider value={{}}>
              {surface === 'mobile' ? <MobileGlanceSection /> : <GlanceSidebar variant={surface} />}
            </SyncContext.Provider>
          </FeaturesContext.Provider>
        </DayPlannerContext.Provider>
      </I18nextProvider>,
    );
  });
  const rowFor = (id) => root.root.find((n) => n.type === 'div' && n.props['data-overdue-open'] === id);
  return { rowFor, goToOverdueTask, openMobileEditTask, openMainAt };
}

const click = (node) => act(() => { node.props.onClick(); });

describe('Overdue row', () => {
  it.each(['desktop', 'tablet', 'mobile'])('finds either kind of task on a click (%s)', (surface) => {
    const { rowFor, goToOverdueTask } = mount(surface);

    click(rowFor('s1'));
    expect(goToOverdueTask).toHaveBeenLastCalledWith(expect.objectContaining({ id: 's1' }), undefined);

    click(rowFor('u1'));
    expect(goToOverdueTask).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'u1' }), { onMissing: expect.any(Function) });
    expect(rowFor('u1').props.className).toContain('cursor-pointer');
  });

  it.each(['desktop', 'mobile'])('opens the editor for an Inbox task its Inbox filters out (%s)', (surface) => {
    const { rowFor, goToOverdueTask, openMobileEditTask } = mount(surface);
    click(rowFor('u1'));
    act(() => { goToOverdueTask.mock.calls[0][1].onMissing(); });
    expect(openMobileEditTask).toHaveBeenCalledWith(expect.objectContaining({ id: 'u1' }), true);
  });

  it('opens the editor on a double-click, on the desktop only', () => {
    const el = { matches: () => false, classList: { contains: () => false }, parentElement: null };
    const { rowFor, openMobileEditTask } = mount('desktop');
    for (const id of ['s1', 'u1']) {
      act(() => { rowFor(id).props.onDoubleClick({ target: el, currentTarget: el, stopPropagation() {} }); });
    }
    expect(openMobileEditTask).toHaveBeenCalledWith(expect.objectContaining({ id: 's1' }), false);
    expect(openMobileEditTask).toHaveBeenCalledWith(expect.objectContaining({ id: 'u1' }), true);

    expect(mount('tablet').rowFor('u1').props.onDoubleClick).toBeUndefined();
    expect(mount('tray').rowFor('u1').props.onDoubleClick).toBeUndefined();
  });

  it('asks the main window from the tray: the timeline for one, the Inbox for the other', () => {
    const { rowFor, goToOverdueTask, openMainAt } = mount('tray');
    click(rowFor('s1'));
    click(rowFor('u1'));
    expect(openMainAt.mock.calls).toEqual([
      [{ action: 'goto-task', taskId: 's1', date: '2026-11-15', startTime: '09:00' }],
      [{ action: 'goto-inbox-task', taskId: 'u1' }],
    ]);
    expect(goToOverdueTask).not.toHaveBeenCalled();
  });
});
