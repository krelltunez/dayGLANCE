import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect, vi } from 'vitest';

// #2277: while a task is dragged over the timeline, each view draws the block
// it becomes if dropped now, from the cursor's time for the task's duration,
// with that view's own time-to-pixel conversion. The views are rendered here
// with nothing on them but the drag, so the only block on the page is the
// preview, and its geometry can be read off the markup.

const fixture = vi.hoisted(() => ({ ctx: {}, features: {} }));
vi.mock('../context/DayPlannerContext.jsx', () => ({ useDayPlannerCtx: () => fixture.ctx }));
vi.mock('../context/FeaturesContext.jsx', () => ({ useFeaturesCtx: () => fixture.features }));
vi.mock('../context/SyncContext.jsx', () => ({ useSyncCtx: () => ({}) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key) => key }) }));
vi.mock('./DayWindowMarkers.jsx', () => ({ default: () => null }));
vi.mock('../hooks/useTimelineZoom.js', () => ({ default: () => 1 }));
vi.mock('../hooks/useWeekViewHourHeight.js', () => ({ default: () => 60 }));

import { DayViewColumn } from './DayView.jsx';
import WeekView from './WeekView.jsx';
import TimeGrid from './TimeGrid.jsx';

const DATE = new Date(2026, 10, 4, 12);
const toMin = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };

function setup({ duration = 90, previewTime = '10:00', date = DATE } = {}) {
  fixture.ctx = {
    darkMode: false, use24HourClock: true, isTablet: false,
    borderClass: '', textSecondary: '', textPrimary: '', cardBg: '', hoverBg: '',
    currentTime: new Date(2026, 10, 3, 12), // another day: no now line
    formatTime: (v) => v, timeToMinutes: toMin,
    getTasksForDate: () => [], getDayDisplayForDate: () => [],
    taskWidths: {}, conflicts: [], tasks: [],
    calendarRef: { current: null }, stickyHeaderRef: { current: null }, timeGridRef: { current: null },
    weekViewDates: [date], weekTimelineStartHour: 0, weekTimelineEndHour: 24,
    hours: Array.from({ length: 24 }, (_, i) => i), visibleDates: [date],
    // MULTI reads positions off its rendered rows; here, 2px a minute.
    minutesToPosition: (m) => m * 2,
    frameResizingRef: { current: false },
    draggedTask: { id: 't1', title: 'Moving', duration },
    dragPreviewTime: previewTime, dragPreviewDate: date,
  };
  fixture.features = {
    getFrameInstancesForDate: () => [], computeAvailableSlots: () => [],
    hgVisibleProjects: [], todayRoutines: [], routineCompletions: {},
  };
}

const blocks = (html) => [...html.matchAll(/data-drag-block-preview=""[^>]*style="top:([\d.]+)px;height:([\d.]+)px"/g)]
  .map(([, top, height]) => ({ top: Number(top), height: Number(height) }));

describe('drag block preview', () => {
  it('DAY: the block spans the task\'s duration on the column\'s hour height', () => {
    setup({ duration: 90, previewTime: '10:00' });
    const col = { date: DATE, dateStr: '2026-11-04', startHour: 8, endHour: 16 };
    const html = renderToStaticMarkup(<DayViewColumn col={col} colIdx={0} hourHeight={60} />);
    // 10:00 is 120 minutes into an 08:00 column at 60px an hour; 90 minutes tall.
    expect(blocks(html)).toEqual([{ top: 120, height: 90 }]);
    expect(html).toContain('10:00–11:30');
  });

  it('DAY: a column the block does not reach draws nothing, and one it runs into draws its slice without a label', () => {
    setup({ duration: 120, previewTime: '07:00' });
    const morning = { date: DATE, dateStr: '2026-11-04', startHour: 0, endHour: 8 };
    const midday = { date: DATE, dateStr: '2026-11-04', startHour: 8, endHour: 16 };
    const evening = { date: DATE, dateStr: '2026-11-04', startHour: 16, endHour: 24 };
    const first = renderToStaticMarkup(<DayViewColumn col={morning} colIdx={0} hourHeight={60} />);
    const second = renderToStaticMarkup(<DayViewColumn col={midday} colIdx={1} hourHeight={60} />);
    const third = renderToStaticMarkup(<DayViewColumn col={evening} colIdx={2} hourHeight={60} />);
    expect(blocks(first)).toEqual([{ top: 420, height: 60 }]);
    expect(first).toContain('07:00–09:00');
    expect(blocks(second)).toEqual([{ top: 0, height: 60 }]);
    expect(second).not.toContain('07:00–09:00');
    expect(blocks(third)).toEqual([]);
  });

  it('WEEK: the block spans the task\'s duration on the week\'s hour height, labelled with the day', () => {
    setup({ duration: 45, previewTime: '09:15' });
    const html = renderToStaticMarkup(<WeekView />);
    expect(blocks(html)).toEqual([{ top: 555, height: 45 }]); // 09:15 at 60px an hour
    expect(html).toMatch(/\S+ 09:15–10:00/);
  });

  it('MULTI: the block is placed as a card is, from the rendered rows', () => {
    setup({ duration: 60, previewTime: '13:30' });
    const html = renderToStaticMarkup(<TimeGrid />);
    // top = pos(13:30) = 1620; height = pos(14:30) - top - 1, as calculateTaskPosition.
    expect(blocks(html)).toEqual([{ top: 1620, height: 119 }]);
    expect(html).toContain('13:30–14:30');
  });

  it('a task with no duration is drawn at 30 minutes', () => {
    setup({ duration: null, previewTime: '10:00' });
    const col = { date: DATE, dateStr: '2026-11-04', startHour: 8, endHour: 16 };
    const html = renderToStaticMarkup(<DayViewColumn col={col} colIdx={0} hourHeight={60} />);
    expect(blocks(html)).toEqual([{ top: 120, height: 30 }]);
  });

  it('no block once the drag leaves the timeline (the all-day area clears the preview time)', () => {
    setup({ previewTime: null });
    const col = { date: DATE, dateStr: '2026-11-04', startHour: 8, endHour: 16 };
    expect(blocks(renderToStaticMarkup(<DayViewColumn col={col} colIdx={0} hourHeight={60} />))).toEqual([]);
    expect(blocks(renderToStaticMarkup(<WeekView />))).toEqual([]);
    expect(blocks(renderToStaticMarkup(<TimeGrid />))).toEqual([]);
  });

  it('never takes a pointer event, so the drop lands on the column underneath', () => {
    setup();
    const html = renderToStaticMarkup(<WeekView />);
    expect(html).toMatch(/data-drag-block-preview=""[^>]*class="[^"]*pointer-events-none/);
  });
});
