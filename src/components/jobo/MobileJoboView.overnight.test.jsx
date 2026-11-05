import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect, vi } from 'vitest';
import { continuationsFromPreviousDay, shiftDateStr } from '@glance-apps/agenda-core';
import { createDoRecord } from '../../jobo/core.js';

// #2278, phase 1 gaps: JOBO on the phone. The narrow Plan lane (bars) draws
// the night before's task from 00:00, as the phone timeline's cards do: a bar
// of the task itself, packed with the date's own bars. Rendered with the
// app's real carry rule standing in for App.jsx's getContinuationsForDate.

const fixture = vi.hoisted(() => ({ ctx: {}, features: {} }));
vi.mock('../../context/DayPlannerContext.jsx', () => ({ useDayPlannerCtx: () => fixture.ctx }));
vi.mock('../../context/FeaturesContext.jsx', () => ({ useFeaturesCtx: () => fixture.features }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key) => key, i18n: { language: 'en' } }) }));
// The phone timeline itself is covered in overnightTimelines.test.jsx; here
// it only hosts the lane's overlay, as its bars mode does.
vi.mock('../MobileTimeGrid.jsx', () => ({
  default: ({ barsMode, barsOverlay }) => <div data-grid={barsMode ? 'bars' : 'cards'}>{barsOverlay}</div>,
}));
import MobileJoboView from './MobileJoboView.jsx';

const TUE = '2026-11-03';
const WED = '2026-11-04';
const HOUR = 161;
const pad = (n) => String(n).padStart(2, '0');
const dateStrOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const toMin = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };

const night = { id: 'night', title: 'Night shift', date: TUE, startTime: '23:00', duration: 150, color: 'bg-blue-500' };
const early = { id: 'early', title: 'Gym', date: WED, startTime: '00:30', duration: 60, color: 'bg-green-500' };

function render(tasks, date = WED, { records = [], now = '2026-11-10T12:00:00' } = {}) {
  const forDate = (d) => tasks.filter((t) => t.date === dateStrOf(d));
  fixture.ctx = {
    // A past day: Do is the wide side, Plan the narrow lane of bars.
    selectedDate: new Date(`${date}T12:00:00`), currentTime: new Date(now),
    tasks, unscheduledTasks: [], expandedRecurringTasks: [], recurringTasks: [],
    getTasksForDate: forDate,
    getContinuationsForDate: (d, applyTagFilter, opts) => (fixture.asked = { applyTagFilter, ...opts }) && continuationsFromPreviousDay(forDate(new Date(`${shiftDateStr(dateStrOf(d), -1)}T12:00:00`))),
    calculateTaskPosition: (t) => {
      const s = toMin(t.startTime);
      const e = Math.min(s + t.duration, 1440);
      return { top: s * HOUR / 60, height: (e - s) * HOUR / 60 - 1 };
    },
    // Two rows that overlap share the lane, side by side.
    calculateConflictPosition: (row, all) => {
      const s = toMin(row.startTime); const e = s + row.duration;
      const overlapping = all.filter((o) => toMin(o.startTime) < e && toMin(o.startTime) + o.duration > s);
      if (overlapping.length < 2) return { left: 3, right: 3, width: null };
      const i = overlapping.findIndex((o) => o.id === row.id);
      return { left: `${i * 50}%`, width: '50%' };
    },
    formatTime: (v) => v, textPrimary: '', textSecondary: '', cardBg: '', borderClass: '', darkMode: false,
    calendarRef: { current: null }, timeGridRef: { current: null },
  };
  fixture.features = { joboRecords: records, joboLoaded: true, joboWritable: true, joboError: null, recordJobo: vi.fn(), reloadJobo: vi.fn() };
  return renderToStaticMarkup(<MobileJoboView stickyHeaderRef={{ current: null }} />);
}

const bars = (html) => [...html.matchAll(/<div[^>]*data-jobo-bar="plan"[^>]*>/g)].map((m) => m[0]);

describe('JOBO phone: the narrow Plan lane draws the night before\'s task (#2278)', () => {
  it('a bar from 00:00 for the minutes after midnight, of the task itself', () => {
    const html = render([night]);
    expect(html).toContain('data-grid="bars"');
    const [bar] = bars(html);
    expect(bar).toContain('data-jobo-bar-task="night"');
    expect(bar).toContain(`data-continuation-from="${TUE}"`);
    expect(bar).toContain('top:0px');
    expect(bar).toContain(`height:${90 * HOUR / 60 - 1}px`);
    expect(bar).toContain('border-dashed');
    // The Plan lane shows the plan as it stood, untouched by the tag filter,
    // as JOBO's day model reads the day.
    expect(fixture.asked).toEqual({ applyTagFilter: false, asPlanned: true });
  });

  it('is packed beside the date\'s own bar that it overlaps', () => {
    const shown = bars(render([night, early]));
    expect(shown).toHaveLength(2);
    const own = shown.find((b) => b.includes('data-jobo-bar-task="early"'));
    const piece = shown.find((b) => b.includes('data-continuation-from'));
    expect(own).toContain('width:50%');
    expect(piece).toContain('width:50%');
    expect(own).not.toBe(piece);
  });

  it('the start date draws the task as its own bar, cut at midnight, and no piece', () => {
    const shown = bars(render([night], TUE));
    expect(shown).toHaveLength(1);
    expect(shown[0]).toContain('data-jobo-bar-task="night"');
    expect(shown[0]).not.toContain('data-continuation-from');
    expect(shown[0]).toContain(`top:${23 * HOUR}px`);
  });
});

describe('JOBO phone: the narrow Do lane marks the rest of a Do past midnight', () => {
  it('draws the next date\'s slice from 00:00, squared and dashed at the top', () => {
    const stamp = '2026-11-04T02:00:00-05:00';
    const record = createDoRecord({
      id: 'manual:night', taskId: 'night', title: 'Night shift', source: 'manual', progress: 'completed',
      timing: 'timed', date: TUE, startTime: '23:00', endDate: WED, endTime: '01:30', planSnapshot: null,
      createdAt: stamp, updatedAt: stamp, observedAt: stamp,
    });
    // Today: Plan is the wide side, Do the narrow lane.
    const html = render([night], WED, { records: [record], now: `${WED}T09:00:00` });
    const [bar] = [...html.matchAll(/<div[^>]*data-jobo-bar="do"[^>]*>/g)].map((m) => m[0]);
    expect(bar).toContain(`data-continuation-from="${TUE}"`);
    expect(bar).toContain('top:0px');
    expect(bar).toContain('border-dashed');
  });
});
