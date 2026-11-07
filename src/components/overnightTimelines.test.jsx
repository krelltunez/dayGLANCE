import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect, vi } from 'vitest';
import { continuationsFromPreviousDay, shiftDateStr } from '@glance-apps/agenda-core';

// #2278: a timed task that runs past midnight. Its start date draws its card
// clipped at 24:00, and the NEXT date draws the rest from 00:00 as a
// continuation on every timeline: MULTI (TimeGrid), DAY (DayViewColumn, which
// is also JOBO's Plan side), WEEK and the phone. The next date never draws it
// as one of its own tasks. Rendered with the app's real carry rule standing in
// for App.jsx's getContinuationsForDate.

const fixture = vi.hoisted(() => ({ ctx: {}, features: {} }));
vi.mock('../context/DayPlannerContext.jsx', () => ({ useDayPlannerCtx: () => fixture.ctx }));
vi.mock('../context/FeaturesContext.jsx', () => ({ useFeaturesCtx: () => fixture.features }));
vi.mock('../context/SyncContext.jsx', () => ({ useSyncCtx: () => ({}) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key, o) => (o?.day ? `${key}:${o.day}` : key) }) }));
vi.mock('./DayWindowMarkers.jsx', () => ({ default: () => null }));
vi.mock('../hooks/useTimelineZoom.js', () => ({ default: () => 1 }));
vi.mock('../hooks/useWeekViewHourHeight.js', () => ({ default: () => 60 }));

import { DayViewColumn } from './DayView.jsx';
import WeekView from './WeekView.jsx';
import TimeGrid from './TimeGrid.jsx';
import MobileTimeGrid from './MobileTimeGrid.jsx';

const TUE = '2026-11-03';
const WED = '2026-11-04';
const at = (s) => new Date(`${s}T12:00:00`);
const toMin = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
const pad = (n) => String(n).padStart(2, '0');
const dateStrOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const night = (over = {}) => ({ id: 'night', title: 'Night shift', date: TUE, startTime: '23:00', duration: 120, color: 'bg-blue-500', ...over });

function setup({ tasks = [night()], dates = [at(WED)], resizePreview = null, drag = null } = {}) {
  const forDate = (d) => tasks.filter((t) => t.date === dateStrOf(d));
  const noop = () => {};
  fixture.ctx = {
    darkMode: false, use24HourClock: true, isTablet: false,
    borderClass: '', textSecondary: '', textPrimary: '', cardBg: '', hoverBg: '',
    currentTime: at('2026-10-01'), // another day: no now line
    formatTime: (v) => v, timeToMinutes: toMin, minutesToTime: (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`,
    getTasksForDate: forDate, getDayDisplayForDate: forDate,
    getContinuationsForDate: (d) => continuationsFromPreviousDay(forDate(at(shiftDateStr(dateStrOf(d), -1)))),
    getTaskCalendarStyle: () => ({}),
    taskWidths: { night: 400, other: 400 }, conflicts: [], tasks,
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

const continuations = (html) => [...html.matchAll(/data-continuation-from="([^"]*)"[^>]*style="top:([\d.-]+)px;height:([\d.]+)px/g)]
  .map(([, from, top, height]) => ({ from, top: Number(top), height: Number(height) }));
const cardIds = (html) => [...html.matchAll(/data-task-id="([^"]+)"/g)].map((m) => m[1]);

const dayCol = (dateStr, startHour, endHour) => ({ date: at(dateStr), dateStr, startHour, endHour });

describe('the next date draws the continuation', () => {
  it('DAY (and JOBO\'s Plan side): from 00:00 for the spill, marked from Tuesday, not as a task of its own', () => {
    setup();
    const html = renderToStaticMarkup(<DayViewColumn col={dayCol(WED, 0, 8)} colIdx={0} hourHeight={60} planOnly />);
    expect(continuations(html)).toEqual([{ from: TUE, top: 0, height: 60 }]);
    // One element for the task, the continuation: not a task card of Wednesday's.
    expect(cardIds(html)).toEqual(['night']);
    expect(html).toMatch(/task\.continuesFrom:\S+/);
    // Only its bottom edge resizes.
    expect(html).toContain('data-resize-handle="bottom"');
    expect(html).not.toContain('data-resize-handle="top"');
  });

  it('DAY: a column the spill does not reach draws nothing', () => {
    setup({ tasks: [night()] });
    const html = renderToStaticMarkup(<DayViewColumn col={dayCol(WED, 8, 16)} colIdx={1} hourHeight={60} />);
    expect(continuations(html)).toEqual([]);
  });

  it('DAY: a spill that runs into the next column puts the handle on the slice with the end', () => {
    setup({ tasks: [night({ startTime: '20:00', duration: 24 * 60 })] }); // to 20:00 Wednesday
    const first = renderToStaticMarkup(<DayViewColumn col={dayCol(WED, 0, 8)} colIdx={0} hourHeight={60} />);
    const third = renderToStaticMarkup(<DayViewColumn col={dayCol(WED, 16, 24)} colIdx={2} hourHeight={60} />);
    expect(continuations(first)).toEqual([{ from: TUE, top: 0, height: 480 }]);
    expect(first).not.toContain('data-resize-handle="bottom"');
    expect(continuations(third)).toEqual([{ from: TUE, top: 0, height: 240 }]);
    expect(third).toContain('data-resize-handle="bottom"');
  });

  it('MULTI: placed from the rendered rows, as a card is', () => {
    setup({ dates: [at(TUE), at(WED)] });
    const html = renderToStaticMarkup(<TimeGrid />);
    expect(continuations(html)).toEqual([{ from: TUE, top: 0, height: 119 }]);
  });

  it('WEEK: a chip from 00:00, marked from Tuesday', () => {
    setup({ dates: [at(TUE), at(WED)] });
    const html = renderToStaticMarkup(<WeekView />);
    expect(continuations(html)).toEqual([{ from: TUE, top: 0, height: 60 }]);
    expect(html).toMatch(/task\.continuesFrom:\S+/);
  });

  it('phone: the continuation with its drag tab and touch resize handle', () => {
    setup();
    const html = renderToStaticMarkup(<MobileTimeGrid />);
    expect(continuations(html)).toEqual([{ from: TUE, top: 0, height: 119 }]);
    expect(html).toContain('data-drag-handle');
    expect(html).toContain('data-resize-handle="bottom"');
  });

  it('nothing for a task that ends exactly at midnight, an all-day task, or a deleted one (not in any list)', () => {
    for (const tasks of [[night({ duration: 60 })], [night({ isAllDay: true })], []]) {
      setup({ tasks });
      expect(continuations(renderToStaticMarkup(<DayViewColumn col={dayCol(WED, 0, 8)} colIdx={0} hourHeight={60} />))).toEqual([]);
      expect(continuations(renderToStaticMarkup(<TimeGrid />))).toEqual([]);
    }
  });

  // A past night's block that gave way to its Do gives way on the next date
  // too (utils/continuations.js continuationsForDate); JOBO's Plan side, which
  // shows the plan whatever was done, asks for the plan as it stood.
  it('JOBO\'s Plan side asks for the plan as it stood; DAY and the phone for the date as shown', () => {
    const asked = (render) => {
      setup();
      const seen = [];
      const carry = fixture.ctx.getContinuationsForDate;
      fixture.ctx.getContinuationsForDate = (d, tag, opts) => { seen.push(!!opts?.asPlanned); return carry(d); };
      render();
      return seen;
    };
    expect(asked(() => renderToStaticMarkup(<DayViewColumn col={dayCol(WED, 0, 8)} colIdx={0} hourHeight={60} planOnly />))).toEqual([true]);
    expect(asked(() => renderToStaticMarkup(<DayViewColumn col={dayCol(WED, 0, 8)} colIdx={0} hourHeight={60} />))).toEqual([false]);
    expect(asked(() => renderToStaticMarkup(<MobileTimeGrid planOnly />))).toEqual([true]);
    expect(asked(() => renderToStaticMarkup(<MobileTimeGrid />))).toEqual([false]);
  });
});

describe('the start date clips the card at 24:00', () => {
  it('MULTI: the card stops at the bottom of the day and hands its bottom edge to the next date', () => {
    setup({ dates: [at(TUE)] });
    const html = renderToStaticMarkup(<TimeGrid />);
    const card = html.match(/data-task-id="night"[^>]*style="top:(\d+)px;height:(\d+)px/);
    expect(Number(card[1])).toBe(23 * 60 * 2);
    expect(Number(card[1]) + Number(card[2])).toBeLessThanOrEqual(24 * 60 * 2);
    expect(html).toContain('data-continues-next-day');
    expect(html).not.toContain('data-resize-handle="bottom"');
    // Its top edge still moves its start.
    expect(html).toContain('data-resize-handle="top"');
  });

  it('WEEK: the chip stops at midnight', () => {
    setup({ dates: [at(TUE)] });
    const html = renderToStaticMarkup(<WeekView />);
    const chip = html.match(/data-task-id="night"[^>]*style="top:(\d+)px;height:(\d+)px/);
    expect(Number(chip[1]) + Number(chip[2])).toBe(24 * 60);
  });

  it('phone: the card stops at midnight with no bottom handle', () => {
    setup({ dates: [at(TUE)] });
    const html = renderToStaticMarkup(<MobileTimeGrid />);
    expect(html).toContain('data-continues-next-day');
  });
});

describe('gestures show on the next date too', () => {
  it('resizing: the end guide is drawn on the next date, where the end is', () => {
    const preview = { taskId: 'night', dateStr: TUE, edge: 'bottom', startMinutes: 23 * 60, endMinutes: 25 * 60 + 30 };
    setup({ resizePreview: preview });
    const wed = renderToStaticMarkup(<DayViewColumn col={dayCol(WED, 0, 8)} colIdx={0} hourHeight={60} />);
    expect(wed).toContain('data-resize-guide="end"');
    expect(wed).not.toContain('data-resize-guide="start"');
    expect(wed).toContain('01:30');
    const tue = renderToStaticMarkup(<DayViewColumn col={dayCol(TUE, 16, 24)} colIdx={2} hourHeight={60} />);
    expect(tue).toContain('data-resize-guide="start"');
    expect(tue).not.toContain('data-resize-guide="end"');
  });

  it('dragging: a drop that would cross midnight previews the rest on the next date', () => {
    setup({ dates: [at(TUE), at(WED)], drag: { task: night(), time: '23:30', date: at(TUE) } });
    const html = renderToStaticMarkup(<TimeGrid />);
    const blocks = [...html.matchAll(/data-drag-block-preview=""[^>]*style="top:([\d.]+)px;height:([\d.]+)px"/g)].map((m) => [Number(m[1]), Number(m[2])]);
    // Tuesday from 23:30 to midnight, and Wednesday from 00:00 for the 90 minutes left.
    expect(blocks).toEqual([[23 * 60 * 2 + 60, 59], [0, 179]]);
    expect(html).toContain('23:30–01:30');
  });
});
