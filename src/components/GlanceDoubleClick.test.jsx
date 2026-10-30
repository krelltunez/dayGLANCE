import React from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { act, create } from 'react-test-renderer';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { DayPlannerContext } from '../context/DayPlannerContext.jsx';
import { FeaturesContext } from '../context/FeaturesContext.jsx';
import { SyncContext } from '../context/SyncContext.jsx';
import { loaders } from '../locales.js';
import GlanceSidebar from './GlanceSidebar.jsx';

// #2263: a double-click on a GLANCE row opens the task's editor, as on a
// timeline card. GLANCE reports on the day and does not rename in place; a
// single click still finds the task on the timeline. Desktop only.

const TODAY = '2026-09-08';
let i18n;
beforeAll(async () => {
  const bundle = await loaders.en();
  i18n = i18next.createInstance();
  await i18n.init({ lng: 'en', fallbackLng: false, resources: { en: { translation: bundle } }, interpolation: { escapeValue: false } });
});

const scheduled = { id: 's1', title: 'Write report', date: TODAY, startTime: '18:00', duration: 30, _agendaType: 'scheduled', color: 'bg-blue-500' };
const deadline = { id: 'u1', title: 'File taxes', deadline: TODAY, duration: 30, _agendaType: 'deadline', color: 'bg-red-500' };

function mount(variant, agenda = [scheduled, deadline]) {
  const openMobileEditTask = vi.fn();
  const planner = {
    currentTime: new Date(`${TODAY}T17:25:00`),
    tasks: [scheduled], unscheduledTasks: [{ ...deadline, _agendaType: undefined }], todayAgenda: agenda, recurringTasks: [],
    filterableTags: [], selectedTags: [], minimizedSections: {},
    agendaNowMarker: { insideTask: false, insertAfterIndex: 0, nowTimeStr: '17:25' },
    glanceAhead: { dayLabel: 'Wednesday', committedMinutes: 0, isEmpty: true, taskCount: 0, eventCount: 0, deadlineCount: 0 },
    getTodayStr: () => TODAY, getOverdueTasks: () => [], filterByTags: (tasks) => tasks,
    formatTime: (time) => time,
    timeToMinutes: (time) => { const [h, m] = time.split(':').map(Number); return h * 60 + m; },
    darkMode: false, textPrimary: '', textSecondary: '', cardBg: '', borderClass: '', hoverBg: '',
    setTaskContextMenu: vi.fn(), openMobileEditTask,
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
              <GlanceSidebar variant={variant} />
            </SyncContext.Provider>
          </FeaturesContext.Provider>
        </DayPlannerContext.Provider>
      </I18nextProvider>,
    );
  });
  const rows = root.root.findAll((n) => n.type === 'div' && typeof n.props.onDoubleClick === 'function' && n.props['data-ctx-menu']);
  return { rows, openMobileEditTask };
}

const row = { matches: () => false, classList: { contains: () => false }, parentElement: null };
const dblclick = (node) => act(() => { node.props.onDoubleClick({ target: row, currentTarget: row, stopPropagation() {} }); });

describe('GLANCE double-click', () => {
  it('opens a scheduled task as scheduled, and a deadline task as an Inbox task', () => {
    const { rows, openMobileEditTask } = mount('desktop');
    expect(rows).toHaveLength(2);
    rows.forEach(dblclick);
    expect(openMobileEditTask).toHaveBeenCalledWith(expect.objectContaining({ id: 's1' }), false);
    expect(openMobileEditTask).toHaveBeenCalledWith(expect.objectContaining({ id: 'u1' }), true);
  });

  it('is not offered on the tablet or in the tray', () => {
    expect(mount('tablet').rows).toHaveLength(0);
    expect(mount('tray').rows).toHaveLength(0);
  });
});
