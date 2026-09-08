import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { DayPlannerContext } from '../context/DayPlannerContext.jsx';
import { FeaturesContext } from '../context/FeaturesContext.jsx';
import { SyncContext } from '../context/SyncContext.jsx';
import { languages, loaders } from '../locales.js';
import GlanceSidebar from './GlanceSidebar.jsx';
import MobileGlanceSection from './MobileGlanceSection.jsx';
import ViewCycler from './ViewCycler.jsx';

const escape = (value) => renderToStaticMarkup(<>{value}</>);
const surfaces = ['desktop', 'tray', 'tablet', 'mobile'];
const task = {
  id: 'task-1', title: 'Sample task', date: '2026-09-08',
  _agendaType: 'scheduled', startTime: '09:00', duration: 30, completed: true,
};

async function translation(language) {
  const bundle = await loaders[language]();
  const i18n = i18next.createInstance();
  await i18n.init({
    lng: language, fallbackLng: false,
    resources: { [language]: { translation: bundle } },
    interpolation: { escapeValue: false },
  });
  return i18n;
}

function renderGlance(surface, i18n, planner = {}, features = {}) {
  const day = {
    currentTime: new Date('2026-09-08T17:25:00'),
    tasks: [], unscheduledTasks: [], todayAgenda: [task],
    filterableTags: [], selectedTags: [], minimizedSections: {},
    agendaNowMarker: { insideTask: false, insertAfterIndex: 0, nowTimeStr: '17:25' },
    glanceAhead: { dayLabel: 'Wednesday', committedMinutes: 0, isEmpty: true },
    getTodayStr: () => '2026-09-08', getOverdueTasks: () => [],
    filterByTags: (tasks) => tasks, formatTime: (time) => time,
    timeToMinutes: (time) => {
      const [hours, minutes] = time.split(':').map(Number);
      return hours * 60 + minutes;
    },
    ...planner,
  };
  const featureValues = {
    aiConfig: { features: {} }, projects: [], myFrames: [],
    getFrameInstancesForDate: () => [],
    ...features,
  };
  return renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <DayPlannerContext.Provider value={day}>
        <FeaturesContext.Provider value={featureValues}>
          <SyncContext.Provider value={{}}>
            {surface === 'mobile' ? <MobileGlanceSection /> : <GlanceSidebar variant={surface} />}
          </SyncContext.Provider>
        </FeaturesContext.Provider>
      </DayPlannerContext.Provider>
    </I18nextProvider>,
  );
}

describe.each(['zh-CN', 'en', 'de'])('%s GLANCE localization', (language) => {
  describe.each(surfaces)('%s surface', (surface) => {
    it.each([
      [17, 'relaxOrMoreTasks'], [19, 'enjoyEvening'], [22, 'restForTomorrow'],
    ])('translates the all-done message at %i:25 and preserves the clock formatter', async (hour, subtitle) => {
      const i18n = await translation(language);
      const nowTimeStr = `${hour}:25`;
      for (const use24HourClock of [false, true]) {
        const formattedTime = use24HourClock ? nowTimeStr : `${hour - 12}:25 PM`;
        const formatTime = vi.fn((time) => time === nowTimeStr ? formattedTime : time);
        const html = renderGlance(surface, i18n, {
          currentTime: new Date(`2026-09-08T${nowTimeStr}:00`), use24HourClock, formatTime,
          agendaNowMarker: { insideTask: false, insertAfterIndex: 0, nowTimeStr },
        });
        expect(formatTime).toHaveBeenCalledWith(nowTimeStr);
        expect(html).toContain(escape(i18n.t('glance.allDoneMessage', { time: formattedTime })));
        expect(html).toContain(escape(i18n.t(`glance.${subtitle}`)));
        expect(html).not.toContain('{{time}}');
        if (language === 'zh-CN') {
          expect(html).toContain(`${formattedTime}，都完成了！`);
          expect(html).toContain({
            17: '休息一下，还是再完成几项任务？',
            19: '享受晚间时光！',
            22: '好好休息，为明天养精蓄锐！',
          }[hour]);
          expect(html).not.toContain('all done!');
        }
        if (language === 'en') expect(html).toContain(`${formattedTime}, all done!`);
      }
    });

    it.each([false, true])('translates habit and routine Add labels (routines populated: %s)', async (populated) => {
      const i18n = await translation(language);
      const html = renderGlance(surface, i18n, {}, {
        habitsEnabled: true, activeHabits: [], routinesEnabled: true, routineCompletions: {},
        todayRoutines: populated ? [{ id: 'routine-1', name: 'Sample routine', isAllDay: true }] : [],
      });
      expect(html.split(`+ ${escape(i18n.t('common.add'))}`).length - 1).toBe(2);
      if (populated) expect(html).toContain('Sample routine');
      if (language === 'zh-CN') expect(html).not.toContain('+ Add');
    });
  });
});

describe.each(['zh-CN', 'en'])('%s GLANCE detail labels', (language) => {
  it('localizes the mobile notes close button accessible name', async () => {
    const i18n = await translation(language);
    const html = renderGlance('mobile', i18n, {
      expandedNotesTaskId: task.id,
      todayAgenda: [{ ...task, imported: true, notes: 'Sample note' }],
    });
    expect(html).toContain('Sample note');
    expect(html).toContain(`aria-label="${language === 'zh-CN' ? '关闭' : 'Close'}"`);
    expect(html).not.toContain('aria-label="Close notes"');
  });

  describe.each(surfaces)('%s surface', (surface) => {
    it.each(['scheduled', 'allday'])('localizes the free-time message and duration units (%s agenda)', async (agendaType) => {
      const i18n = await translation(language);
      const html = renderGlance(surface, i18n, {
        currentTime: new Date('2026-09-08T08:00:00'),
        todayAgenda: [{
          ...task, _agendaType: agendaType, isAllDay: agendaType === 'allday',
          startTime: agendaType === 'scheduled' ? '09:30' : null, completed: false,
        }],
        agendaNowMarker: { insideTask: false, insertAfterIndex: -1, nowTimeStr: '08:00', gapMinutes: 90 },
      });
      expect(html).toContain(language === 'zh-CN'
        ? '08:00，还有 1小时30分钟 空闲时间'
        : '08:00, 1h 30m of free time');
      expect(html).not.toContain('glance.freeTimeMessage');
    });

    it.each([1, 2])('localizes tomorrow preview counts (%i) and committed duration', async (count) => {
      const i18n = await translation(language);
      const html = renderGlance(surface, i18n, {
        glanceAhead: {
          dayLabel: 'Wednesday', isEmpty: false, committedMinutes: 90,
          taskCount: count, eventCount: count, deadlineCount: count,
        },
      });
      const expected = language === 'zh-CN'
        ? [`${count} 项任务`, `${count} 个日历事件`, `${count} 项即将截止`, '已安排 1小时30分钟']
        : [`${count} task${count === 1 ? '' : 's'}`, `${count} event${count === 1 ? '' : 's'}`,
          `${count} deadline${count === 1 ? '' : 's'}`, '1h 30m committed'];
      for (const text of expected) expect(html).toContain(`${text}</span>`);
    });

    it.each([false, true])('localizes the project-filter tooltip (selected: %s)', async (selected) => {
      const i18n = await translation(language);
      const html = renderGlance(surface, i18n, {
        todayAgenda: [{ ...task, projectId: 'project-1' }],
      }, {
        goalsProjectsEnabled: true, goals: [], hgVisibleProjects: [],
        projects: [{ id: 'project-1', title: 'Sample project' }],
        projectFilter: selected ? 'project-1' : null,
      });
      const title = language === 'zh-CN'
        ? (selected ? '清除项目筛选' : '筛选：Sample project')
        : (selected ? 'Clear project filter' : 'Filter: Sample project');
      expect(html).toContain(`title="${title}"`);
    });
  });
});

it('uses 领域 consistently for Chinese Areas without changing regional settings', async () => {
  const zhCN = await loaders['zh-CN']();
  expect(zhCN.common.addArea).toBe('添加领域');
  for (const [key, label] of Object.entries(zhCN.goals).filter(([key]) => /area/i.test(key))) {
    expect(label, key).toContain('领域');
    expect(label, key).not.toContain('区域');
  }
  expect(zhCN.settings.localization).toBe('语言与区域');
});

describe.each(languages)('%s view labels', (language) => {
  it.each(['multi', 'day', 'week', 'sched'])('localizes %s label, tooltip and accessible name', async (view) => {
    const i18n = await translation(language);
    const key = `sched.view${view[0].toUpperCase()}${view.slice(1)}Short`;
    expect(i18n.exists(key)).toBe(true);
    const label = i18n.t(key);
    for (const canShowViewCycler of [false, true]) {
      if (!canShowViewCycler && (view === 'day' || view === 'week')) continue;
      const html = renderToStaticMarkup(
        <I18nextProvider i18n={i18n}>
          <DayPlannerContext.Provider value={{ effectiveViewMode: view, canShowViewCycler }}>
            <ViewCycler />
          </DayPlannerContext.Provider>
        </I18nextProvider>,
      );
      expect(html).toContain(`>${escape(label)}</span>`);
      expect(html).toContain(`title="${escape(i18n.t('sched.viewTooltip', {
        view: label, keys: canShowViewCycler ? '1/2/3/4' : '1/4',
      }))}"`);
      expect(html).toContain(`aria-label="${escape(i18n.t('sched.viewAria', { view: label }))}"`);
      if (language === 'zh-CN') expect(label).toBe({ multi: '多日', day: '单日', week: '周', sched: '日程' }[view]);
      if (language === 'en') expect(label).toBe(view.toUpperCase());
    }
  });
});
