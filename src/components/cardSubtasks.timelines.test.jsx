import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect, vi } from 'vitest';
import { continuationsFromPreviousDay, shiftDateStr } from '@glance-apps/agenda-core';

// Subtasks on the timelines' real cards: DAY (DayViewColumn, also JOBO's Plan
// side), MULTI (TimeGrid) and the phone's GRID (MobileTimeGrid). Wide cards
// with room list them, checkable on a one-off task and not on a repeating
// one; narrow cards and short ones show none; the device setting turns them
// off. The harness is overnightTimelines.test.jsx's.

const fixture = vi.hoisted(() => ({ ctx: {}, features: {} }));
vi.mock('../context/DayPlannerContext.jsx', () => ({ useDayPlannerCtx: () => fixture.ctx }));
vi.mock('../context/FeaturesContext.jsx', () => ({ useFeaturesCtx: () => fixture.features }));
vi.mock('../context/SyncContext.jsx', () => ({ useSyncCtx: () => ({}) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key, o) => (o?.day ? `${key}:${o.day}` : key) }) }));
vi.mock('./DayWindowMarkers.jsx', () => ({ default: () => null }));
vi.mock('../hooks/useTimelineZoom.js', () => ({ default: () => 1 }));
vi.mock('../hooks/useWeekViewHourHeight.js', () => ({ default: () => 60 }));

import { DayViewColumn } from './DayView.jsx';
import TimeGrid from './TimeGrid.jsx';
import MobileTimeGrid from './MobileTimeGrid.jsx';

const TUE = '2026-11-03';
const WED = '2026-11-04';
const at = (s) => new Date(`${s}T12:00:00`);
const toMin = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
const pad = (n) => String(n).padStart(2, '0');
const dateStrOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const steps = (...titles) => titles.map((title, i) => ({ id: `st${i}`, title, completed: false }));
const evening = { id: 'evening', title: 'Evening tasks', date: WED, startTime: '16:00', duration: 240, color: 'bg-purple-500', subtasks: steps('Prepare meals', 'Reddit post', 'Read book') };
const quick = { id: 'quick', title: 'Quick call', date: WED, startTime: '10:00', duration: 15, color: 'bg-blue-500', subtasks: steps('Dial in') };
const gym = { id: 'recurring-g1-2026-11-04', title: 'Gym', date: WED, startTime: '07:00', duration: 120, color: 'bg-emerald-500', subtasks: steps('Warm up', 'Lift') };

function setup({ tasks = [evening, quick, gym], dates = [at(WED)], resizePreview = null, drag = null, isTablet = false, widths = {}, showCardSubtasks } = {}) {
  const forDate = (d) => tasks.filter((t) => t.date === dateStrOf(d));
  const noop = () => {};
  fixture.ctx = {
    darkMode: false, use24HourClock: true, isTablet,
    setTaskEnergy: vi.fn(),
    borderClass: '', textSecondary: '', textPrimary: '', cardBg: '', hoverBg: '',
    currentTime: at('2026-10-01'), // another day: no now line
    formatTime: (v) => v, timeToMinutes: toMin, minutesToTime: (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`,
    getTasksForDate: forDate, getDayDisplayForDate: forDate,
    getContinuationsForDate: (d) => continuationsFromPreviousDay(forDate(at(shiftDateStr(dateStrOf(d), -1)))),
    getTaskCalendarStyle: () => ({}),
    taskWidths: { evening: 400, quick: 400, 'recurring-g1-2026-11-04': 400, ...widths }, conflicts: [], tasks,
    toggleSubtask: vi.fn(), setExpandedNotesTaskId: vi.fn(),
    ...(showCardSubtasks === undefined ? {} : { showCardSubtasks }),
    setTaskRef: () => noop,
    calculateConflictPosition: () => ({ left: 2, right: 2, width: null }),
    // MULTI reads positions off its rendered rows; here, 2px a minute.
    minutesToPosition: (m) => m * 2,
    calculateTaskPosition: (t) => {
      const s = toMin(t.startTime);
      const e = Math.min(s + t.duration, 24 * 60 - 0.001);
      return { top: Math.round(s * 2), height: Math.round(e * 2) - Math.round(s * 2) - 1 };
    },
    calendarRef: { current: null }, stickyHeaderRef: { current: null }, timeGridRef: { current: null },
    longPressTimerRef: { current: null }, longPressTriggeredRef: { current: false },
    weekViewDates: dates, weekTimelineStartHour: 0, weekTimelineEndHour: 24,
    hours: Array.from({ length: 24 }, (_, i) => i), visibleDates: dates,
    frameResizingRef: { current: false },
    resizePreview,
    draggedTask: drag ? drag.task : null, dragPreviewTime: drag ? drag.time : null, dragPreviewDate: drag ? drag.date : null,
  };
  fixture.features = {
    getFrameInstancesForDate: () => [], computeAvailableSlots: () => [],
    hgVisibleProjects: [], todayRoutines: [], routineCompletions: {}, projects: [],
  };
}

// Each card's subtask list: { id: 'interactive'|'read-only' }, and the rows it draws.
const lists = (html) => {
  const out = {};
  for (const card of html.split('data-task-id="').slice(1)) {
    const id = card.slice(0, card.indexOf('"'));
    const m = card.match(/data-card-subtasks="(interactive|read-only)"/);
    if (m && !(id in out)) out[id] = m[1];
  }
  return out;
};
const rowCount = (html, id) => {
  const card = html.split('data-task-id="').find((c) => c.startsWith(`${id}"`)) || '';
  return (card.match(/data-card-subtask="/g) || []).length;
};
const dayCol = (dateStr, startHour, endHour) => ({ date: at(dateStr), dateStr, startHour, endHour });

describe('subtasks on the timelines\' cards', () => {
  it('DAY (and JOBO\'s Plan side): a long one-off card lists them to tick; a repeating one without checkboxes; a short one none', () => {
    setup();
    const html = renderToStaticMarkup(<DayViewColumn col={dayCol(WED, 0, 24)} colIdx={0} hourHeight={60} planOnly />);
    expect(lists(html)).toEqual({ evening: 'interactive', 'recurring-g1-2026-11-04': 'read-only' });
    expect(rowCount(html, 'evening')).toBe(3);
  });

  it('MULTI: the same', () => {
    setup();
    expect(lists(renderToStaticMarkup(<TimeGrid />))).toEqual({ evening: 'interactive', 'recurring-g1-2026-11-04': 'read-only' });
  });

  it('GRID on the phone: the same', () => {
    setup();
    expect(lists(renderToStaticMarkup(<MobileTimeGrid />))).toEqual({ evening: 'interactive', 'recurring-g1-2026-11-04': 'read-only' });
  });

  // The list lives in the wide layouts only: a side-by-side card is too thin
  // to read one.
  it('a narrow card shows none, desktop and phone', () => {
    setup({ widths: { evening: 200 } });
    expect(lists(renderToStaticMarkup(<TimeGrid />))).not.toHaveProperty('evening');
    setup({ widths: { evening: 150 } });
    expect(lists(renderToStaticMarkup(<MobileTimeGrid />))).not.toHaveProperty('evening');
  });

  it('the device setting turns them off everywhere', () => {
    setup({ showCardSubtasks: false });
    expect(lists(renderToStaticMarkup(<TimeGrid />))).toEqual({});
    expect(lists(renderToStaticMarkup(<MobileTimeGrid />))).toEqual({});
    expect(lists(renderToStaticMarkup(<DayViewColumn col={dayCol(WED, 0, 24)} colIdx={0} hourHeight={60} planOnly />))).toEqual({});
  });
});
