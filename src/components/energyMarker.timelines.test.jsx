import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect, vi } from 'vitest';
import { continuationsFromPreviousDay, shiftDateStr } from '@glance-apps/agenda-core';

// #2331: the energy marker on the timelines' real cards: DAY (DayViewColumn),
// MULTI (TimeGrid), and the phone (MobileTimeGrid). A leaf on a Restore block,
// a control on desktop and only a mark on a tablet or a phone; nothing drawn
// on an Effort block until a desktop card is hovered. The harness is
// overnightTimelines.test.jsx's.

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

const lunch = { id: 'lunch', title: 'Lunch with Sam', date: WED, startTime: '12:00', duration: 60, color: 'bg-blue-500' };
const work = { id: 'work', title: 'Write the report', date: WED, startTime: '14:00', duration: 60, color: 'bg-blue-500' };

function setup({ tasks = [lunch, work], dates = [at(WED)], resizePreview = null, drag = null, isTablet = false, widths = {} } = {}) {
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
    taskWidths: { lunch: 400, work: 400, ...widths }, conflicts: [], tasks,
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

// The marker on each task's card: { id: 'restore'|'effort', control: bool }.
const markers = (html) => {
  const out = {};
  for (const card of html.split('data-task-id="').slice(1)) {
    const id = card.slice(0, card.indexOf('"'));
    const m = card.match(/<(button|svg)[^>]*data-energy-marker="(restore|effort)"/);
    if (m && !(id in out)) out[id] = { energy: m[2], control: m[1] === 'button' };
  }
  return out;
};
const dayCol = (dateStr, startHour, endHour) => ({ date: at(dateStr), dateStr, startHour, endHour });

describe('the energy marker on the timelines', () => {
  it('DAY on desktop: a leaf you can click on Restore, a hover-only one on Effort', () => {
    setup();
    const html = renderToStaticMarkup(<DayViewColumn col={dayCol(WED, 8, 18)} colIdx={0} hourHeight={60} planOnly />);
    expect(markers(html)).toEqual({ lunch: { energy: 'restore', control: true }, work: { energy: 'effort', control: true } });
    expect(html).toContain('group-hover/card:opacity-40');
  });

  it('MULTI on desktop: the same', () => {
    setup();
    expect(markers(renderToStaticMarkup(<TimeGrid />))).toEqual({
      lunch: { energy: 'restore', control: true }, work: { energy: 'effort', control: true },
    });
  });

  it('on a tablet: the leaf on Restore only, and not a control', () => {
    setup({ isTablet: true });
    expect(markers(renderToStaticMarkup(<TimeGrid />))).toEqual({ lunch: { energy: 'restore', control: false } });
  });

  it('on a phone: the leaf on Restore only, and not a control', () => {
    setup();
    expect(markers(renderToStaticMarkup(<MobileTimeGrid />))).toEqual({ lunch: { energy: 'restore', control: false } });
  });

  // Where it sits: a wide card's leaf is the first of its action buttons, at
  // their size, so it lines up with them whether or not the card has a tags
  // row; a narrow card (actions in its overflow menu) keeps it in the title row.
  const cardHtml = (html, id) => html.split('data-task-id="').find((c) => c.startsWith(`${id}"`)) || '';
  const leafBeforeNotes = /data-energy-marker="restore"[^>]*>(?:(?!<button)[\s\S])*<\/button><button[^>]*title="sched\.notesSubtasks"/;

  it('a wide card draws the leaf as the first action button, at the actions\' size', () => {
    setup({ tasks: [{ ...lunch, title: 'Lunch with Sam #friends' }] });
    const card = cardHtml(renderToStaticMarkup(<TimeGrid />), 'lunch');
    expect(card).toMatch(leafBeforeNotes);
    expect(card).toMatch(/<button[^>]*data-energy-marker="restore"[^>]*class="rounded p-1 /);
  });

  it('a narrow card keeps it in the title row', () => {
    setup({ tasks: [lunch], widths: { lunch: 200 } });
    const card = cardHtml(renderToStaticMarkup(<TimeGrid />), 'lunch');
    expect(card).toContain('data-energy-marker="restore"');
    expect(card).not.toMatch(leafBeforeNotes);
  });

  it('a hand-set override is drawn as its value, the same leaf as a derived one', () => {
    setup({ tasks: [{ ...lunch, energy: 'effort' }, { ...work, energy: 'restore' }] });
    expect(markers(renderToStaticMarkup(<TimeGrid />))).toEqual({
      lunch: { energy: 'effort', control: true }, work: { energy: 'restore', control: true },
    });
  });
});
