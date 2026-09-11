import { describe, it, expect } from 'vitest';
import { layoutDayCell, dayCellItemKind, tagKind } from './monthCellLayout.js';
import { MONTH_CELL_LAYOUT } from '../constants/monthView.js';
import { FIXTURE_DATE, busyDayItems } from './monthCellLayout.fixture.js';

// 07:00–21:00 is 14 hours; a 140px cell makes an hour 10px, a minute 1/6px.
const DATE = '2026-09-16';
const W = 50;
const H = 140;
const { minBandHeight, laneGap, bandGap, maxLanes } = MONTH_CELL_LAYOUT;

const task = (id, startTime, duration, extra = {}) =>
  ({ id, title: id, date: DATE, startTime, duration, isAllDay: false, completed: false, ...extra });
const event = (id, startTime, duration, extra = {}) => task(id, startTime, duration, { imported: true, ...extra });

const byId = (list, id) => list.find((b) => b.id === id);

// Two bands that share horizontal space must never touch or overlap vertically.
const xOverlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width;
function expectNoPixelCollisions(bands, gap = bandGap) {
  for (let i = 0; i < bands.length; i++) {
    for (let j = i + 1; j < bands.length; j++) {
      const a = bands[i], b = bands[j];
      if (!xOverlaps(a, b)) continue;
      const separated = a.y + a.height + gap <= b.y || b.y + b.height + gap <= a.y;
      expect(separated, `${a.id} and ${b.id} collide`).toBe(true);
    }
  }
}

describe('constants', () => {
  it('exports the hour window and geometry as plain frozen data', () => {
    expect(MONTH_CELL_LAYOUT.window).toEqual({ startHour: 7, endHour: 21 });
    expect(Object.isFrozen(MONTH_CELL_LAYOUT)).toBe(true);
    expect(minBandHeight).toBeGreaterThan(0);
    expect(maxLanes).toBe(3);
    expect(laneGap).toBeGreaterThanOrEqual(0);
  });
});

describe('layoutDayCell — empty day', () => {
  it('returns empty collections, one lane, and no overflow', () => {
    const out = layoutDayCell([], DATE, W, H);
    expect(out.bands).toEqual([]);
    expect(out.points).toEqual([]);
    expect(out.allDay).toEqual([]);
    expect(out.laneCount).toBe(1);
    expect(out.hasOverflow).toBe(false);
    expect(out.overflow).toEqual({ lanesNeeded: 0, hidden: [], crowded: false });
    expect(out.window).toEqual({ startMinutes: 420, endMinutes: 1260 });
    expect(out.usableWidth).toBe(W);
    expect(layoutDayCell(null, DATE, W, H).bands).toEqual([]);
  });
});

describe('layoutDayCell — single item', () => {
  it('spans the usable width on one lane at the hour-window position', () => {
    const out = layoutDayCell([task('a', '09:00', 60)], DATE, W, H);
    expect(out.laneCount).toBe(1);
    expect(out.bands).toHaveLength(1);
    expect(out.bands[0]).toMatchObject({
      id: 'a', kind: 'task', lane: 0, laneCount: 1,
      x: 0, y: 20, width: W, height: 10,
      clampedStart: false, clampedEnd: false, completed: false,
    });
  });

  it('carries completion through for the renderer', () => {
    const out = layoutDayCell([task('a', '09:00', 60, { completed: true })], DATE, W, H);
    expect(out.bands[0].completed).toBe(true);
  });
});

describe('layoutDayCell — overlap lanes', () => {
  it('splits two overlapping items into two lanes of half the usable width', () => {
    const out = layoutDayCell([task('a', '09:00', 60), task('b', '09:30', 60)], DATE, W, H);
    expect(out.laneCount).toBe(2);
    const laneWidth = (W - laneGap) / 2;
    expect(byId(out.bands, 'a')).toMatchObject({ lane: 0, laneCount: 2, x: 0, width: laneWidth, y: 20, height: 10 });
    expect(byId(out.bands, 'b')).toMatchObject({ lane: 1, laneCount: 2, x: laneWidth + laneGap, width: laneWidth, y: 25, height: 10 });
    expect(out.hasOverflow).toBe(false);
  });

  it('gives a three-way overlap three lanes', () => {
    const out = layoutDayCell([
      event('team', '13:00', 60), task('review', '13:30', 60), event('interview', '13:45', 30),
    ], DATE, W, H);
    expect(out.laneCount).toBe(3);
    const laneWidth = (W - 2 * laneGap) / 3;
    expect(out.bands.map((b) => [b.id, b.lane, b.laneCount])).toEqual([
      ['team', 0, 3], ['review', 1, 3], ['interview', 2, 3],
    ]);
    for (const b of out.bands) {
      expect(b.width).toBeCloseTo(laneWidth);
      expect(b.x).toBeCloseTo(b.lane * (laneWidth + laneGap));
    }
  });

  it('keeps a lone item full width even when another part of the day overlaps', () => {
    const out = layoutDayCell([
      task('solo', '08:00', 60), task('a', '13:00', 60), task('b', '13:30', 60),
    ], DATE, W, H);
    expect(byId(out.bands, 'solo')).toMatchObject({ laneCount: 1, width: W, x: 0 });
    expect(out.laneCount).toBe(2);
  });

  it('does not split back-to-back items — they share a lane', () => {
    const out = layoutDayCell([task('a', '09:00', 60), task('b', '10:00', 60)], DATE, W, H);
    expect(out.laneCount).toBe(1);
    expect(out.bands.every((b) => b.width === W)).toBe(true);
  });
});

describe('layoutDayCell — window clamping', () => {
  it('clamps an item that starts before the window to the top edge', () => {
    const out = layoutDayCell([task('early', '06:00', 120)], DATE, W, H);
    expect(out.bands[0]).toMatchObject({ y: 0, height: 10, clampedStart: true, clampedEnd: false });
  });

  it('clamps an item that ends after the window to the bottom edge', () => {
    const out = layoutDayCell([task('late', '20:30', 90)], DATE, W, H);
    expect(out.bands[0]).toMatchObject({ y: 135, height: 5, clampedStart: false, clampedEnd: true });
  });

  it('still shows an item entirely before the window, as a minimum band at the top', () => {
    const out = layoutDayCell([task('dawn', '05:00', 60)], DATE, W, H);
    expect(out.bands).toHaveLength(1);
    expect(out.bands[0]).toMatchObject({ y: 0, height: minBandHeight, clampedStart: true });
  });

  it('still shows an item entirely after the window, as a minimum band at the bottom', () => {
    const out = layoutDayCell([task('night', '22:00', 60)], DATE, W, H);
    expect(out.bands).toHaveLength(1);
    expect(out.bands[0]).toMatchObject({ y: H - minBandHeight, height: minBandHeight, clampedEnd: true });
  });

  it('never fits the window to the day: a late item leaves the window untouched', () => {
    const quiet = layoutDayCell([task('a', '09:00', 60)], DATE, W, H);
    const busy = layoutDayCell([task('a', '09:00', 60), task('z', '23:00', 30)], DATE, W, H);
    expect(busy.window).toEqual(quiet.window);
    expect(byId(busy.bands, 'a')).toMatchObject({ y: 20, height: 10 });
  });

  it('honours an explicit window option', () => {
    const out = layoutDayCell([task('a', '09:00', 60)], DATE, W, 120, { window: { startHour: 8, endHour: 20 } });
    expect(out.window).toEqual({ startMinutes: 480, endMinutes: 1200 });
    expect(out.bands[0]).toMatchObject({ y: 10, height: 10 });
  });
});

describe('layoutDayCell — all-day and points', () => {
  it('lists an all-day item separately and leaves the timed bands alone', () => {
    const out = layoutDayCell([
      task('bday', null, null, { isAllDay: true, imported: true }),
      task('a', '09:00', 60),
    ], DATE, W, H);
    expect(out.allDay).toEqual([{ id: 'bday', kind: 'event', completed: false }]);
    expect(out.bands.map((b) => b.id)).toEqual(['a']);
    expect(out.points).toEqual([]);
  });

  it('keys all-day on the flag, so a date-only line stamped 00:00 is not drawn at midnight', () => {
    const out = layoutDayCell([task('obs', '00:00', 0, { isAllDay: true })], DATE, W, H);
    expect(out.allDay.map((i) => i.id)).toEqual(['obs']);
    expect(out.bands).toEqual([]);
    expect(out.points).toEqual([]);
  });

  it('treats a missing start time as all-day', () => {
    const out = layoutDayCell([task('nostart', null, 30)], DATE, W, H);
    expect(out.allDay.map((i) => i.id)).toEqual(['nostart']);
  });

  it('renders a zero-duration item as a point at its minute, not a band', () => {
    const out = layoutDayCell([task('dentist', '11:00', 0), task('due', '15:00', null)], DATE, W, H);
    expect(out.bands).toEqual([]);
    expect(out.points).toEqual([
      { id: 'dentist', kind: 'task', completed: false, x: W / 2, y: 40, clamped: null },
      { id: 'due', kind: 'task', completed: false, x: W / 2, y: 80, clamped: null },
    ]);
  });

  it('clamps a point outside the window and says which way', () => {
    const out = layoutDayCell([task('p1', '05:00', 0), task('p2', '23:00', 0)], DATE, W, H);
    expect(byId(out.points, 'p1')).toMatchObject({ y: 0, clamped: 'before' });
    expect(byId(out.points, 'p2')).toMatchObject({ y: H, clamped: 'after' });
  });

  it('keeps a point out of the lane count', () => {
    const out = layoutDayCell([task('a', '09:00', 60), task('p', '09:30', 0)], DATE, W, H);
    expect(out.laneCount).toBe(1);
    expect(out.bands[0].width).toBe(W);
  });
});

describe('layoutDayCell — lane cap', () => {
  it('caps lanes at the constant and reports the hidden items instead of thinning', () => {
    const items = [
      task('a', '09:00', 60), task('b', '09:10', 50), task('c', '09:20', 40), task('d', '09:30', 30),
    ];
    const out = layoutDayCell(items, DATE, W, H);
    expect(out.laneCount).toBe(maxLanes);
    expect(out.overflow.lanesNeeded).toBe(4);
    expect(out.overflow.hidden).toEqual(['d']);
    expect(out.hasOverflow).toBe(true);
    expect(out.bands.map((b) => b.id)).toEqual(['a', 'b', 'c']);
    const laneWidth = (W - (maxLanes - 1) * laneGap) / maxLanes;
    for (const b of out.bands) expect(b.width).toBeCloseTo(laneWidth);
  });

  it('respects a maxLanes override', () => {
    const out = layoutDayCell([task('a', '09:00', 60), task('b', '09:30', 60)], DATE, W, H, { maxLanes: 1 });
    expect(out.laneCount).toBe(1);
    expect(out.bands.map((b) => b.id)).toEqual(['a']);
    expect(out.overflow).toMatchObject({ lanesNeeded: 2, hidden: ['b'] });
  });
});

describe('layoutDayCell — minimum band height', () => {
  it('keeps a 15-minute item visible at the minimum height', () => {
    const out = layoutDayCell([task('short', '09:00', 15)], DATE, W, H);
    expect(out.bands[0]).toMatchObject({ y: 20, height: minBandHeight });
  });

  it('does not let consecutive minimum-height bands merge', () => {
    const out = layoutDayCell([
      task('a', '09:00', 15), task('b', '09:15', 15), task('c', '09:30', 15),
    ], DATE, W, H);
    expect(out.laneCount).toBe(1);
    const [a, b, c] = ['a', 'b', 'c'].map((id) => byId(out.bands, id));
    expect(a.y).toBe(20);
    expect(b.y).toBeGreaterThanOrEqual(a.y + a.height + bandGap);
    expect(c.y).toBeGreaterThanOrEqual(b.y + b.height + bandGap);
    for (const band of out.bands) expect(band.height).toBeGreaterThanOrEqual(minBandHeight);
    expectNoPixelCollisions(out.bands);
    expect(out.overflow.crowded).toBe(false);
  });

  it('keeps pushed bands inside the cell, pulling the run back up from the bottom edge', () => {
    const out = layoutDayCell([task('a', '20:30', 90), task('b', '22:30', 30)], DATE, W, H);
    for (const band of out.bands) {
      expect(band.y).toBeGreaterThanOrEqual(0);
      expect(band.y + band.height).toBeLessThanOrEqual(H);
    }
    expectNoPixelCollisions(out.bands);
    expect(out.overflow.crowded).toBe(false);
  });

  it('flags a cell that cannot fit its minimum bands as crowded rather than piling them up', () => {
    const items = Array.from({ length: 6 }, (_, i) => task(`s${i}`, `20:${String(i * 5).padStart(2, '0')}`, 5));
    const out = layoutDayCell(items, DATE, W, 12);
    expect(out.overflow.crowded).toBe(true);
    expect(out.hasOverflow).toBe(true);
    for (const band of out.bands) {
      expect(band.y).toBeGreaterThanOrEqual(0);
      expect(band.y + band.height).toBeLessThanOrEqual(12);
    }
  });
});

describe('layoutDayCell — gutter', () => {
  it('subtracts the gutter from the usable width and parks points in it', () => {
    const out = layoutDayCell([task('a', '09:00', 60), task('p', '11:00', 0)], DATE, 60, H, { gutterWidth: 12 });
    expect(out.gutterWidth).toBe(12);
    expect(out.usableWidth).toBe(48);
    expect(out.bands[0]).toMatchObject({ x: 0, width: 48 });
    expect(out.points[0]).toMatchObject({ x: 54, y: 40 });
  });

  it('defaults to no gutter, with points centred on the cell', () => {
    const out = layoutDayCell([task('p', '11:00', 0)], DATE, 60, H);
    expect(out.usableWidth).toBe(60);
    expect(out.points[0].x).toBe(30);
  });
});

describe('layoutDayCell — item kinds and dates', () => {
  it('derives kind from the agenda shape and honours an explicit routine tag', () => {
    expect(dayCellItemKind(event('e', '09:00', 30))).toBe('event');
    expect(dayCellItemKind(task('t', '09:00', 30))).toBe('task');
    expect(dayCellItemKind(task('tc', '09:00', 30, { imported: true, isTaskCalendar: true }))).toBe('task');
    expect(dayCellItemKind({ id: 'r', name: 'Lunch', startTime: '12:00', duration: 60, kind: 'routine' })).toBe('routine');
    expect(dayCellItemKind({ id: 'x', kind: 'nonsense' })).toBe('task');
  });

  it('tags routines as bands like any other, marked by kind', () => {
    const routines = tagKind([{ id: 'r', name: 'Lunch', startTime: '12:00', duration: 60, isAllDay: false, completed: false }], 'routine');
    const out = layoutDayCell([task('a', '12:30', 30), ...routines], DATE, W, H);
    expect(out.laneCount).toBe(2);
    expect(byId(out.bands, 'r')).toMatchObject({ kind: 'routine', lane: 0, y: 50, height: 10 });
    expect(byId(out.bands, 'a')).toMatchObject({ kind: 'task', lane: 1 });
  });

  it('ignores items dated another day and keeps undated routines', () => {
    const out = layoutDayCell([
      task('today', '09:00', 60),
      task('tomorrow', '09:00', 60, { date: '2026-09-17' }),
      { id: 'r', name: 'Gym', startTime: '18:30', duration: 60, kind: 'routine' },
    ], DATE, W, H);
    expect(out.bands.map((b) => b.id).sort()).toEqual(['r', 'today']);
  });

  it('echoes the cell it laid out', () => {
    const out = layoutDayCell([], DATE, W, H, { gutterWidth: 8 });
    expect(out).toMatchObject({ date: DATE, cellWidth: W, cellHeight: H, gutterWidth: 8, usableWidth: W - 8 });
  });
});

describe('layoutDayCell — a realistically busy day (agenda-core fixture)', () => {
  const { agenda, routines } = busyDayItems();
  const items = [...agenda, ...tagKind(routines, 'routine')];
  const out = layoutDayCell(items, FIXTURE_DATE, W, H);

  it('sorts every item into the right collection', () => {
    expect(out.allDay.map((i) => i.id).sort()).toEqual(['cal-bday', 't-expense']);
    expect(out.points.map((p) => p.id)).toEqual(['t-dentist']);
    expect(out.bands.map((b) => b.id).sort()).toEqual([
      'cal-dinner', 'cal-interview', 'cal-team', 'ev-1on1', 'ev-standup',
      'recurring-r-workshop-2026-09-16', 'ro-breakfast', 'ro-gym', 'ro-lunch',
      'ro-run', 'ro-stretch', 'ro-wind', 't-call', 't-deep', 't-review',
    ]);
  });

  it('tags kinds from the agenda shapes: projected and imported events, tasks, routines', () => {
    const kinds = Object.fromEntries(out.bands.map((b) => [b.id, b.kind]));
    expect(kinds['cal-team']).toBe('event');
    expect(kinds['ev-standup']).toBe('event');
    expect(kinds['t-deep']).toBe('task');
    expect(kinds['recurring-r-workshop-2026-09-16']).toBe('task');
    expect(kinds['ro-lunch']).toBe('routine');
    expect(byId(out.allDay, 'cal-bday').kind).toBe('event');
    expect(byId(out.allDay, 't-expense').kind).toBe('task');
    expect(byId(out.bands, 'ro-run').completed).toBe(true);
    expect(byId(out.bands, 't-call').completed).toBe(true);
  });

  it('packs the morning two deep and the early afternoon three deep, nothing hidden', () => {
    expect(out.laneCount).toBe(3);
    expect(out.overflow).toEqual({ lanesNeeded: 3, hidden: [], crowded: false });
    expect(out.hasOverflow).toBe(false);
    expect(byId(out.bands, 't-deep')).toMatchObject({ lane: 0, laneCount: 2 });
    expect(byId(out.bands, 'ev-1on1')).toMatchObject({ lane: 1, laneCount: 2 });
    expect(byId(out.bands, 't-call')).toMatchObject({ lane: 1, laneCount: 2 });
    expect(byId(out.bands, 'cal-team')).toMatchObject({ lane: 0, laneCount: 3 });
    expect(byId(out.bands, 't-review')).toMatchObject({ lane: 1, laneCount: 3 });
    expect(byId(out.bands, 'cal-interview')).toMatchObject({ lane: 2, laneCount: 3 });
    for (const id of ['ev-standup', 'ro-lunch', 'ro-stretch', 'recurring-r-workshop-2026-09-16', 'ro-gym']) {
      expect(byId(out.bands, id)).toMatchObject({ laneCount: 1, width: W });
    }
  });

  it('clamps the edges of the day and keeps the out-of-window routine visible', () => {
    expect(byId(out.bands, 'ro-run')).toMatchObject({ y: 0, height: minBandHeight, clampedStart: true });
    expect(byId(out.bands, 'cal-dinner')).toMatchObject({ clampedEnd: true });
    expect(byId(out.bands, 'ro-wind')).toMatchObject({ clampedEnd: true, height: minBandHeight });
    expect(byId(out.bands, 'ro-wind').y + minBandHeight).toBe(H);
    expect(byId(out.points, 't-dentist')).toMatchObject({ y: 40, clamped: null });
  });

  it('keeps every band inside the cell with no pixel collisions', () => {
    for (const band of out.bands) {
      expect(band.y).toBeGreaterThanOrEqual(0);
      expect(band.y + band.height).toBeLessThanOrEqual(H);
      expect(band.x).toBeGreaterThanOrEqual(0);
      expect(band.x + band.width).toBeLessThanOrEqual(W + 1e-9);
      expect(band.height).toBeGreaterThanOrEqual(minBandHeight);
    }
    expectNoPixelCollisions(out.bands);
  });

  it('lays out the same day identically with a desktop gutter, minus the gutter width', () => {
    const desk = layoutDayCell(items, FIXTURE_DATE, W + 10, H, { gutterWidth: 10 });
    expect(desk.usableWidth).toBe(W);
    expect(desk.bands).toEqual(out.bands);
    expect(desk.points[0]).toMatchObject({ x: W + 5, y: 40 });
    expect(desk.allDay).toEqual(out.allDay);
  });
});
