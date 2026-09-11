import { describe, it, expect } from 'vitest';
import { getSunTimes } from './solar.js';
import {
  DIAL_DAY_MINUTES,
  DIAL_LANE_GAP,
  assignDialLanes,
  dialLaneBand,
  dialAngle,
  dialPoint,
  dialArcPath,
  dialSectorPath,
  dialTicks,
  dialIntensity,
  padDialSegment,
  classifyPrecip,
  computeDialModel,
  computeDialRoutines,
  dialLabelYieldsToSun,
  findDialFocusBlock,
  initialDialSelection,
  muteDialColor,
  computeDayAlignment,
  computeMoonBand,
  computeProjectProgress,
  dialTaskMinutes,
  moonPhasePath,
  assignComplicationSlot,
  normaliseComplicationSlots,
  COMPLICATION_SLOT_COUNT,
  moonStretches,
  precipArcSegments,
  precipRuns,
  stepDialSelection,
  computeDaylightBand,
  dialPeakUv,
  DAYLIGHT_FLOOR,
  DAYLIGHT_PEAK,
  computeFocusSpans,
  focusSpanMinutes,
  canStartFocusFromBlock,
  computeDayCompletion,
  dialDateFits,
  DIAL_DATE_MAX_FRAC,
} from './dayDial.js';

const task = (over = {}) => ({
  id: 1,
  title: 'Deep work',
  startTime: '09:00',
  duration: 60,
  isAllDay: false,
  completed: false,
  ...over,
});

describe('dialAngle / dialPoint', () => {
  it('puts midnight at 12 o\'clock and flows clockwise', () => {
    expect(dialAngle(0)).toBe(0);
    expect(dialAngle(DIAL_DAY_MINUTES)).toBeCloseTo(2 * Math.PI);

    const top = dialPoint(500, 500, 100, 0);        // midnight → up
    expect(top.x).toBeCloseTo(500);
    expect(top.y).toBeCloseTo(400);

    const right = dialPoint(500, 500, 100, 360);    // 6 AM → right
    expect(right.x).toBeCloseTo(600);
    expect(right.y).toBeCloseTo(500);

    const bottom = dialPoint(500, 500, 100, 720);   // noon → down
    expect(bottom.x).toBeCloseTo(500);
    expect(bottom.y).toBeCloseTo(600);

    const left = dialPoint(500, 500, 100, 1080);    // 6 PM → left
    expect(left.x).toBeCloseTo(400);
    expect(left.y).toBeCloseTo(500);
  });
});

describe('dialArcPath / dialSectorPath', () => {
  it('builds a finite arc path with the correct large-arc flag', () => {
    const short = dialArcPath(500, 500, 385, 540, 660); // 2h → minor arc
    expect(short).toMatch(/^M [\d.-]+ [\d.-]+ A 385 385 0 0 1 [\d.-]+ [\d.-]+$/);

    const long = dialArcPath(500, 500, 385, 0, 800);    // >12h → large arc
    expect(long).toContain(' A 385 385 0 1 1 ');
  });

  it('builds a closed annular sector with opposing sweeps', () => {
    const d = dialSectorPath(500, 500, 305, 385, 540, 660);
    expect(d.startsWith('M ')).toBe(true);
    expect(d.endsWith('Z')).toBe(true);
    // Outer arc sweeps clockwise (1), inner return arc counter-clockwise (0).
    expect(d).toContain(' A 385 385 0 0 1 ');
    expect(d).toContain(' A 305 305 0 0 0 ');
    // Every numeric token is finite — a NaN here blanks the whole ring.
    const nums = d.match(/-?\d+(\.\d+)?/g).map(Number);
    expect(nums.every(Number.isFinite)).toBe(true);
  });
});

describe('dialTicks', () => {
  it('emits 288 five-minute ticks classified hour/quarter/minor', () => {
    const ticks = dialTicks();
    expect(ticks).toHaveLength(288);
    expect(ticks.filter((t) => t.kind === 'hour')).toHaveLength(24);
    expect(ticks.filter((t) => t.kind === 'quarter')).toHaveLength(72);
    expect(ticks.filter((t) => t.kind === 'minor')).toHaveLength(288 - 96);
    expect(ticks.find((t) => t.min === 60).kind).toBe('hour');
    expect(ticks.find((t) => t.min === 75).kind).toBe('quarter');
    expect(ticks.find((t) => t.min === 65).kind).toBe('minor');
  });
});

describe('dialIntensity', () => {
  it('scales opacity and weight continuously and saturates at 3h', () => {
    const sliver = dialIntensity(15);
    const block = dialIntensity(180);
    const marathon = dialIntensity(600);
    expect(sliver.fillOpacity).toBeLessThan(block.fillOpacity);
    expect(sliver.edgeOpacity).toBeLessThan(block.edgeOpacity);
    expect(sliver.edgeWidth).toBeLessThan(block.edgeWidth);
    expect(marathon).toEqual(block);
    // A sliver is dimmer, never invisible.
    expect(sliver.edgeOpacity).toBeGreaterThan(0.4);
  });
});

describe('padDialSegment', () => {
  it('pads long blocks by the full gap and yields for slivers', () => {
    expect(padDialSegment(540, 660)).toEqual([543, 657]);
    // 12-minute block: pad capped at dur/6 = 2, keeping 8 visible minutes.
    expect(padDialSegment(540, 552)).toEqual([542, 550]);
  });

  it('keeps a flagged side flush so the night meets itself at midnight', () => {
    expect(padDialSegment(1380, 1440, 3, true, false)).toEqual([1383, 1440]);
    expect(padDialSegment(0, 420, 3, false, true)).toEqual([0, 417]);
  });
});

describe('assignDialLanes', () => {
  const blk = (startMin, endMin, id = `${startMin}`) => ({ id, startMin, endMin });

  it('keeps a day with no overlaps on one full-depth lane', () => {
    // Back-to-back blocks touch but never overlap — that separation is
    // padDialSegment's job along the ring, not a lane's.
    const laid = assignDialLanes([blk(540, 600), blk(600, 660), blk(700, 760)]);
    expect(laid.map((b) => [b.lane, b.laneCount])).toEqual([[0, 1], [0, 1], [0, 1]]);
  });

  it('pushes a nested block onto the outer lane', () => {
    // An all-day conference with a keynote inside it: the specific block
    // takes the luminous rim, the container recedes inward.
    const laid = assignDialLanes([blk(540, 1020, 'conf'), blk(570, 630, 'keynote')]);
    expect(laid).toMatchObject([
      { id: 'conf', lane: 0, laneCount: 2 },
      { id: 'keynote', lane: 1, laneCount: 2 },
    ]);
  });

  it('reuses a lane that has freed up inside the same cluster', () => {
    const laid = assignDialLanes([blk(600, 660, 'a'), blk(630, 720, 'b'), blk(675, 720, 'c')]);
    expect(laid.map((b) => b.lane)).toEqual([0, 1, 0]);
    expect(laid.map((b) => b.laneCount)).toEqual([2, 2, 2]);
  });

  it('scopes the lane count to each overlap cluster', () => {
    const laid = assignDialLanes([
      blk(480, 540, 'morning'),
      blk(600, 700, 'x'), blk(620, 720, 'y'), blk(640, 700, 'z'),
      blk(800, 860, 'evening'),
    ]);
    // One three-deep pile-up must not thin the wedges around it.
    expect(laid.map((b) => [b.id, b.lane, b.laneCount])).toEqual([
      ['morning', 0, 1],
      ['x', 0, 3], ['y', 1, 3], ['z', 2, 3],
      ['evening', 0, 1],
    ]);
  });

  it('handles empty and missing input', () => {
    expect(assignDialLanes([])).toEqual([]);
    expect(assignDialLanes(null)).toEqual([]);
  });
});

describe('dialLaneBand', () => {
  it('gives a single lane the whole band', () => {
    expect(dialLaneBand(300, 385, 0, 1)).toEqual({ rInner: 300, rOuter: 385 });
    expect(dialLaneBand(300, 385)).toEqual({ rInner: 300, rOuter: 385 });
  });

  it('splits the band inside-out, lane 0 innermost', () => {
    const inner = dialLaneBand(300, 385, 0, 2);
    const outer = dialLaneBand(300, 385, 1, 2);
    expect(inner.rInner).toBe(300);
    expect(outer.rOuter).toBe(385);
    expect(outer.rInner - inner.rOuter).toBeCloseTo(DIAL_LANE_GAP);
    expect(inner.rOuter - inner.rInner).toBeCloseTo(outer.rOuter - outer.rInner);
  });

  it('yields the gap so a crowded cluster keeps usable depth', () => {
    const lanes = [0, 1, 2, 3, 4, 5].map((i) => dialLaneBand(300, 385, i, 6));
    expect(lanes[0].rInner).toBe(300);
    expect(lanes[5].rOuter).toBeCloseTo(385);
    expect(lanes[1].rInner - lanes[0].rOuter).toBeLessThan(DIAL_LANE_GAP);
    // Still thicker than the widest luminous edge (4) plus its halo.
    lanes.forEach((l) => expect(l.rOuter - l.rInner).toBeGreaterThan(10));
  });
});

describe('computeDialModel', () => {
  it('maps timed tasks to categorized ring blocks, sorted by start', () => {
    const model = computeDialModel([
      task({ id: 2, title: 'Lunch #break', startTime: '12:30', duration: 45 }),
      task({ id: 1, title: 'Team sync', startTime: '14:00', duration: 60 }),
      task({ id: 3, title: 'All-day thing', isAllDay: true }),
      task({ id: 4, title: 'Unscheduled', startTime: null }),
    ]);
    expect(model.blocks.map((b) => b.id)).toEqual([2, 1]);
    expect(model.blocks[0]).toMatchObject({ startMin: 750, endMin: 795, kind: 'restore', completable: true });
    expect(model.blocks[1]).toMatchObject({ startMin: 840, endMin: 900, kind: 'effort' });
    expect(model.effortMinutes).toBe(60);
    expect(model.restoreMinutes).toBe(45);
  });

  it('marks read-only imported calendar events as not completable', () => {
    const model = computeDialModel([
      task({ id: 1, imported: true }),
      task({ id: 2, startTime: '11:00', imported: true, isTaskCalendar: true }),
    ]);
    expect(model.blocks[0].completable).toBe(false);
    expect(model.blocks[1].completable).toBe(true);
  });

  it('clips a block running past midnight but keeps its true end', () => {
    const model = computeDialModel([task({ startTime: '23:00', duration: 120 })]);
    // Geometry stops at the boundary; every readout still says 01:00.
    expect(model.blocks[0]).toMatchObject({
      startMin: 1380, endMin: DIAL_DAY_MINUTES, endsNextDay: true, endMinTrue: 60,
    });
  });

  it('carries last night\'s overrun into this morning', () => {
    const model = computeDialModel(
      [task({ id: 1, startTime: '09:00', duration: 60 })],
      null,
      [
        task({ id: 'y1', title: 'Late session', startTime: '23:00', duration: 150 }),
        task({ id: 'y2', title: 'Dinner', startTime: '19:00', duration: 60 }),
      ],
    );
    // Only the part after midnight, drawn from midnight; the block that
    // ended yesterday is not this day's business.
    expect(model.blocks.map((b) => b.id)).toEqual(['y1', 1]);
    expect(model.blocks[0]).toMatchObject({
      startMin: 0, endMin: 90, startedPrevDay: true, startMinTrue: 1380,
    });
  });

  it('leaves the totals to the day the task is filed under', () => {
    const carried = [task({ id: 'y1', startTime: '23:00', duration: 150 })];
    const withCarry = computeDialModel([task({ startTime: '09:00', duration: 60 })], null, carried);
    const without = computeDialModel([task({ startTime: '09:00', duration: 60 })], null, null);
    expect(withCarry.effortMinutes).toBe(without.effortMinutes);
    expect(withCarry.restoreMinutes).toBe(without.restoreMinutes);
    expect(withCarry.blocks).toHaveLength(2);
    expect(without.blocks).toHaveLength(1);
  });

  it('lanes a carried block against the morning it lands in', () => {
    const model = computeDialModel(
      [task({ id: 1, startTime: '00:30', duration: 60 })],
      null,
      [task({ id: 'y1', startTime: '23:00', duration: 150 })],
    );
    // 00:00–01:30 and 00:30–01:30 overlap, so they take separate lanes.
    expect(model.blocks.map((b) => [b.id, b.lane, b.laneCount])).toEqual([
      ['y1', 0, 2], [1, 1, 2],
    ]);
  });

  it('derives sleep segments and total from a full day window', () => {
    const model = computeDialModel(
      [task()],
      { start: '07:00', stop: '22:30' },
    );
    expect(model.sleep).toEqual([
      { startMin: 0, endMin: 420 },
      { startMin: 1350, endMin: 1440 },
    ]);
    expect(model.sleepMinutes).toBe(420 + 90);
  });

  it('shows no sleep without a full declared window', () => {
    expect(computeDialModel([task()], null).sleepMinutes).toBeNull();
    expect(computeDialModel([task()], { start: '07:00', stop: null }).sleepMinutes).toBeNull();
    expect(computeDialModel([task()], null).sleep).toEqual([]);
  });

  it('passes unblocked time through from computeDaySummary', () => {
    const model = computeDialModel(
      [
        task({ startTime: '09:00', duration: 60 }),
        task({ id: 2, startTime: '11:00', duration: 60 }),
      ],
      { start: '08:00', stop: '12:00' },
    );
    // 08:00–12:00 window, 2h blocked → 2h unblocked.
    expect(model.unblockedMinutes).toBe(120);
  });

  it('lanes overlapping blocks and leaves a clean day at full depth', () => {
    const model = computeDialModel([
      task({ id: 1, title: 'Offsite', startTime: '09:00', duration: 480 }),
      task({ id: 2, title: 'Keynote', startTime: '09:30', duration: 60 }),
      task({ id: 3, title: 'Dinner', startTime: '18:00', duration: 60 }),
    ]);
    expect(model.blocks.map((b) => [b.id, b.lane, b.laneCount])).toEqual([
      [1, 0, 2], [2, 1, 2], [3, 0, 1],
    ]);
  });

  it('collects all-day items without touching a single minute total', () => {
    const model = computeDialModel(
      [
        task({ id: 1, startTime: '09:00', duration: 60 }),
        task({ id: 2, title: 'Labour Day', isAllDay: true, startTime: '00:00', duration: 30, imported: true }),
        task({ id: 3, title: 'Water the plants', isAllDay: true, startTime: null, color: 'green' }),
      ],
      { start: '08:00', stop: '12:00' },
    );
    // The ring is unchanged: an all-day item has no hour to occupy, and an
    // Obsidian date-only line arrives at '00:00' — it must not become a
    // midnight wedge.
    expect(model.blocks.map((b) => b.id)).toEqual([1]);
    expect(model.allDay.map((a) => a.title)).toEqual(['Labour Day', 'Water the plants']);
    // A read-only imported all-day event has no completion to toggle.
    expect(model.allDay[0].completable).toBe(false);
    expect(model.allDay[1].completable).toBe(true);
    // Totals stay a partition of SCHEDULED minutes.
    expect(model.effortMinutes).toBe(60);
    expect(model.restoreMinutes).toBe(0);
    expect(model.unblockedMinutes).toBe(180);
    expect(model.sleepMinutes).toBe(480 + 720);
  });

  it('puts still-standing all-day items ahead of completed ones', () => {
    const model = computeDialModel([
      task({ id: 1, title: 'Done thing', isAllDay: true, completed: true }),
      task({ id: 2, title: 'Open thing', isAllDay: true }),
      task({ id: 3, title: 'Also open', isAllDay: true }),
    ]);
    expect(model.allDay.map((a) => a.title)).toEqual(['Open thing', 'Also open', 'Done thing']);
  });

  it('has no all-day items on a day without any', () => {
    expect(computeDialModel([task()]).allDay).toEqual([]);
    expect(computeDialModel([]).allDay).toEqual([]);
  });

  it('handles an empty day', () => {
    const model = computeDialModel([]);
    expect(model.blocks).toEqual([]);
    expect(model.unblockedMinutes).toBeNull();
  });
});

describe('computeDialRoutines', () => {
  const routine = (over = {}) => ({
    id: 'r1', name: 'Stretch', startTime: '06:45', duration: 15, isAllDay: false, ...over,
  });

  it('places timed routines in time order with their real duration', () => {
    const bars = computeDialRoutines([
      routine({ id: 'r2', name: 'Focus block', startTime: '14:30', duration: 120 }),
      routine(),
    ]);
    expect(bars.map((b) => [b.id, b.startMin, b.endMin])).toEqual([
      ['r1', 405, 420],     // the 15m default
      ['r2', 870, 990],     // and a two-hour one — the bar is as long as the routine
    ]);
    expect(bars[0].isRoutine).toBe(true);
    // The routine's `name` lands on `title`, the one field every readout reads.
    expect(bars.map((b) => b.title)).toEqual(['Stretch', 'Focus block']);
  });

  it('leaves out a routine with no time set', () => {
    // The pill form (isAllDay, no startTime) has no hour, and the ring is a
    // clock — it stays in the planner's own all-day strip.
    expect(computeDialRoutines([routine({ isAllDay: true, startTime: null })])).toEqual([]);
    expect(computeDialRoutines([routine({ startTime: null })])).toEqual([]);
    expect(computeDialRoutines(null)).toEqual([]);
  });

  it('marks the ones completed today', () => {
    const bars = computeDialRoutines(
      [routine({ id: 'r1' }), routine({ id: 'r2', startTime: '08:00' })],
      { r1: '2026-09-10' },
    );
    expect(bars.map((b) => b.completed)).toEqual([true, false]);
  });

  it('lanes overlapping routines, as the ring does for blocks', () => {
    const bars = computeDialRoutines([
      routine({ id: 'r1', startTime: '07:00', duration: 60 }),
      routine({ id: 'r2', startTime: '07:30', duration: 60 }),
      routine({ id: 'r3', startTime: '12:00', duration: 15 }),
    ]);
    expect(bars.map((b) => [b.id, b.lane, b.laneCount])).toEqual([
      ['r1', 0, 2], ['r2', 1, 2], ['r3', 0, 1],
    ]);
  });

  it('clips a routine running past midnight but keeps its true end', () => {
    const bars = computeDialRoutines([routine({ startTime: '23:30', duration: 60 })]);
    expect(bars[0]).toMatchObject({ endMin: DIAL_DAY_MINUTES, endsNextDay: true, endMinTrue: 30 });
  });
});

describe('muteDialColor', () => {
  it('pulls saturated task colors into one pastel-emissive family', () => {
    // Hue survives; saturation caps at 0.5; lightness pins at 0.73.
    expect(muteDialColor('#3b82f6')).toBe('#98b2dd'); // blue-500
    expect(muteDialColor('#ef4444')).toBe('#dd9898'); // red-500
    expect(muteDialColor('#22c55e')).toBe('#98ddb1'); // green-500
    expect(muteDialColor('#a855f7')).toBe('#bb98dd'); // purple-500
  });

  it('maps any gray to the same neutral and keeps output opaque hex', () => {
    expect(muteDialColor('#111111')).toBe('#bababa');
    expect(muteDialColor('#ffffff')).toBe('#bababa');
    expect(muteDialColor('#808080')).toBe('#bababa');
  });

  it('falls back to the effort blue on unparseable input', () => {
    expect(muteDialColor('not-a-color')).toBe('#93c5fd');
    expect(muteDialColor(null)).toBe('#93c5fd');
    expect(muteDialColor('#abc')).toBe('#93c5fd'); // shorthand unsupported
  });
});

describe('normaliseComplicationSlots', () => {
  it('reads a saved list positionally, so existing faces do not move', () => {
    // The old setting was a list of switched-on keys, and it was already read
    // straight into the corners in order. Treating it as slots is therefore
    // not a migration — it is the same arrangement, named.
    expect(normaliseComplicationSlots(['inbox', 'done', 'deadlines']))
      .toEqual(['inbox', 'done', 'deadlines', null]);
  });

  it('always returns one entry per corner', () => {
    for (const input of [null, undefined, [], 'nonsense', ['a', 'b', 'c', 'd', 'e', 'f']]) {
      expect(normaliseComplicationSlots(input)).toHaveLength(COMPLICATION_SLOT_COUNT);
    }
  });

  it('empties a corner holding anything that is not a key', () => {
    expect(normaliseComplicationSlots(['inbox', 7, '', { k: 1 }]))
      .toEqual(['inbox', null, null, null]);
  });
});

describe('assignComplicationSlot', () => {
  const SLOTS = ['inbox', 'done', 'deadlines', null];

  it('fills an empty corner', () => {
    expect(assignComplicationSlot(SLOTS, 3, 'aligned'))
      .toEqual(['inbox', 'done', 'deadlines', 'aligned']);
  });

  it('empties a corner', () => {
    expect(assignComplicationSlot(SLOTS, 1, null))
      .toEqual(['inbox', null, 'deadlines', null]);
  });

  it('swaps rather than clobbering, when the readout is already elsewhere', () => {
    // The common edit is "no, that one belongs over there". Clearing instead
    // would drop whatever was in the corner being moved into.
    expect(assignComplicationSlot(SLOTS, 0, 'deadlines'))
      .toEqual(['deadlines', 'done', 'inbox', null]);
  });

  it('moves into an empty corner without leaving a copy behind', () => {
    expect(assignComplicationSlot(SLOTS, 3, 'inbox'))
      .toEqual([null, 'done', 'deadlines', 'inbox']);
  });

  it('never lets one readout hold two corners', () => {
    let slots = normaliseComplicationSlots([]);
    slots = assignComplicationSlot(slots, 0, 'done');
    slots = assignComplicationSlot(slots, 2, 'done');
    slots = assignComplicationSlot(slots, 3, 'done');
    expect(slots.filter((k) => k === 'done')).toHaveLength(1);
  });

  it('treats re-picking a corner\'s own value as a no-op', () => {
    expect(assignComplicationSlot(SLOTS, 2, 'deadlines')).toEqual(SLOTS);
  });

  it('ignores a corner that does not exist', () => {
    expect(assignComplicationSlot(SLOTS, 9, 'aligned')).toEqual(SLOTS);
    expect(assignComplicationSlot(SLOTS, -1, 'aligned')).toEqual(SLOTS);
  });
});

describe('computeDayAlignment', () => {
  const PROJECTS = [{ id: 'p1', title: 'Billing' }, { id: 'p2', title: 'Docs' }];
  const task = (over) => ({ startTime: '09:00', duration: 60, ...over });

  it('weighs by minutes, on the same denominator as Done', () => {
    const day = [
      task({ startTime: '09:00', duration: 60, projectId: 'p1' }),
      task({ startTime: '10:00', duration: 30, projectId: 'p2' }),
      task({ startTime: '11:00', duration: 90 }),
    ];
    const a = computeDayAlignment(day, PROJECTS);
    expect(a.alignedMinutes).toBe(90);
    expect(a.totalMinutes).toBe(180);
    expect(a.fraction).toBeCloseTo(0.5, 5);
    // The two readouts must agree about what a day is made of.
    expect(a.totalMinutes).toBe(computeDayCompletion(day).totalMinutes);
  });

  it('counts a task pointing at a deleted project as unaligned', () => {
    // Silently crediting it would make the readout say the day was filed when
    // the project it was filed under is gone.
    const a = computeDayAlignment([task({ projectId: 'vanished' })], PROJECTS);
    expect(a.alignedMinutes).toBe(0);
    expect(a.unaligned).toHaveLength(1);
  });

  it('leaves a read-only imported event out of both halves', () => {
    const a = computeDayAlignment([
      task({ duration: 60, projectId: 'p1' }),
      task({ startTime: '10:00', duration: 60, imported: true }),
    ], PROJECTS);
    expect(a.totalMinutes).toBe(60);
    expect(a.unaligned).toHaveLength(0);
  });

  it('breaks the aligned time down heaviest first', () => {
    const a = computeDayAlignment([
      task({ startTime: '09:00', duration: 30, projectId: 'p2' }),
      task({ startTime: '10:00', duration: 60, projectId: 'p1' }),
      task({ startTime: '11:00', duration: 15, projectId: 'p2' }),
    ], PROJECTS);
    expect(a.byProject).toEqual([
      { id: 'p1', title: 'Billing', minutes: 60 },
      { id: 'p2', title: 'Docs', minutes: 45 },
    ]);
  });

  it('puts the unfiled blocks in the day\'s own order', () => {
    const a = computeDayAlignment([
      task({ startTime: '15:00', duration: 30, title: 'late' }),
      task({ startTime: '08:00', duration: 30, title: 'early' }),
    ], PROJECTS);
    expect(a.unaligned.map((x) => x.title)).toEqual(['early', 'late']);
  });

  it('is zero, not one, on an empty day and with no projects at all', () => {
    expect(computeDayAlignment([], PROJECTS).fraction).toBe(0);
    expect(computeDayAlignment([task({ projectId: 'p1' })], null).fraction).toBe(0);
  });
});

describe('computeProjectProgress', () => {
  const ALL = [
    { id: 'a', projectId: 'p1', completed: true },
    { id: 'b', projectId: 'p1', completed: false, date: '2026-07-09' },
    { id: 'c', projectId: 'p1', completed: false },
    { id: 'd', projectId: 'p1', completed: false, deadline: '2026-07-02' },
    { id: 'e', projectId: 'p2', completed: false },
  ];

  it('counts tasks, not minutes, and only its own', () => {
    // Minutes are the dial's unit everywhere else; a backlog is mostly
    // unscheduled and has none to weigh.
    const p = computeProjectProgress({ id: 'p1' }, ALL);
    expect(p.total).toBe(4);
    expect(p.done).toBe(1);
    expect(p.fraction).toBeCloseTo(0.25, 5);
  });

  it('sorts dated work first and leaves undated work at the end', () => {
    expect(computeProjectProgress({ id: 'p1' }, ALL).remaining.map((x) => x.id))
      .toEqual(['d', 'b', 'c']);
  });

  it('is empty rather than complete for a project with no tasks', () => {
    const p = computeProjectProgress({ id: 'empty' }, ALL);
    expect(p.total).toBe(0);
    expect(p.fraction).toBe(0);
  });

  it('survives a missing project', () => {
    expect(computeProjectProgress(null, ALL).total).toBe(0);
  });
});

describe('dialTaskMinutes', () => {
  it('is the one rule every minute-weighted readout counts by', () => {
    expect(dialTaskMinutes({ startTime: '09:00', duration: 45 })).toBe(45);
    expect(dialTaskMinutes({ startTime: '09:00', duration: 45, isAllDay: true })).toBe(0);
    expect(dialTaskMinutes({ duration: 45 })).toBe(0);
    expect(dialTaskMinutes({ startTime: '09:00', duration: 45, imported: true })).toBe(0);
    // An imported TASK calendar is the user's own work and does count.
    expect(dialTaskMinutes({ startTime: '09:00', duration: 45, imported: true, isTaskCalendar: true }))
      .toBe(45);
    expect(dialTaskMinutes(null)).toBe(0);
  });
});

describe('computeMoonBand', () => {
  const DEN = { lat: 39.7392, lon: -104.9903 };
  const sunFor = (date) => getSunTimes(date, DEN.lat, DEN.lon);
  const band = (date) => computeMoonBand(date, DEN, sunFor(date));

  it('draws nothing without a location', () => {
    const date = new Date(2026, 6, 2, 12);
    expect(computeMoonBand(date, null, sunFor(date)).steps).toEqual([]);
    expect(computeMoonBand(date, DEN, null).steps).toEqual([]);
  });

  it('never draws while the sun is up', () => {
    // The whole reason the band is clipped: the moon is above the horizon in
    // daylight about as often as at night, and the track can only mean one
    // thing at a time.
    for (let d = 1; d <= 28; d++) {
      const date = new Date(2026, 6, d, 12);
      const sun = sunFor(date);
      if (sun.polar || sun.sunriseMin == null || sun.sunsetMin == null) continue;
      const lit = sun.sunsetMin > sun.sunriseMin
        ? (m) => m >= sun.sunriseMin && m < sun.sunsetMin
        : (m) => m >= sun.sunriseMin || m < sun.sunsetMin;
      for (const step of computeMoonBand(date, DEN, sun).steps) {
        expect(lit((step.startMin + step.endMin) / 2)).toBe(false);
      }
    }
  });

  it('keeps a night that is cut by a midnight as two stretches', () => {
    // The case that rules out deriving the band from a single rise/set pair:
    // the moon is up at midnight, sets before dawn, and is back before the
    // next one. Asserted on the grouping itself rather than by hunting a real
    // date for it — whether any given date splits depends on where the
    // device's midnight falls, so the astronomy is covered in lunar.test.js
    // and this covers the thing that could actually break.
    const steps = [
      { startMin: 0, endMin: 4 }, { startMin: 4, endMin: 8 },
      { startMin: 1400, endMin: 1404 }, { startMin: 1404, endMin: 1440 },
    ];
    expect(moonStretches(steps)).toEqual([
      { startMin: 0, endMin: 8 },
      { startMin: 1400, endMin: 1440 },
    ]);
  });

  it('groups an unbroken night into one stretch, and nothing into none', () => {
    expect(moonStretches([
      { startMin: 120, endMin: 124 }, { startMin: 124, endMin: 128 },
    ])).toEqual([{ startMin: 120, endMin: 128 }]);
    expect(moonStretches([])).toEqual([]);
  });

  it('fades to nothing at new moon even though the moon is up', () => {
    // 2026-07-14 is a new moon: the disc is up for a stretch after sunset and
    // gives no light at all, so the band has to say so.
    const newMoon = band(new Date(2026, 6, 14, 12));
    expect(newMoon.fraction).toBeLessThan(0.02);
    for (const step of newMoon.steps) expect(step.opacity).toBeLessThan(0.002);
  });

  it('keeps even the brightest night under the daylight band', () => {
    // The ordering that has to hold. Not the physical ratio — see
    // MOONLIGHT_PEAK for why the band is scaled to be read rather than to be
    // proportional — but a night must never outshine a day on the same track.
    const brightest = Math.max(
      ...band(new Date(2026, 6, 1, 12)).steps.map((s) => s.opacity), 0);
    expect(brightest).toBeGreaterThan(DAYLIGHT_FLOOR);
    expect(brightest).toBeLessThan(DAYLIGHT_PEAK);
  });

  it('puts the glyph inside the longest stretch, never on its edge', () => {
    for (const d of [1, 2, 6, 10, 20]) {
      const { steps, glyphMin } = band(new Date(2026, 6, d, 12));
      if (glyphMin == null) continue;
      const covering = steps.find((s) => glyphMin >= s.startMin && glyphMin <= s.endMin);
      expect(covering).toBeTruthy();
      // Comfortably off both ends of the drawn span.
      expect(glyphMin).toBeGreaterThan(Math.min(...steps.map((s) => s.startMin)) + 20);
      expect(glyphMin).toBeLessThan(Math.max(...steps.map((s) => s.endMin)) - 20);
    }
  });

  it('leaves a sliver of a stretch unglyphed', () => {
    // 2026-07-14 again: about half an hour of moon after sunset, narrower
    // than the glyph that would mark it.
    expect(band(new Date(2026, 6, 14, 12)).glyphMin).toBeNull();
  });
});

describe('moonPhasePath', () => {
  // The terminator is an ellipse whose x-radius collapses at the quarters and
  // reopens the other way: that number is the whole shape.
  const terminatorRx = (d) => parseFloat(d.split('A')[2].trim().split(/\s+/)[0]);
  const sweep = (d) => d.split('A')[2].trim().split(/\s+/)[4];

  it('is a closed disc at full moon and an empty one at new', () => {
    expect(terminatorRx(moonPhasePath(10, 1, true))).toBe(10);
    expect(terminatorRx(moonPhasePath(10, 0, true))).toBe(10);
    // Same radius, opposite arc direction: one traces the disc, one erases it.
    expect(sweep(moonPhasePath(10, 1, true))).not.toBe(sweep(moonPhasePath(10, 0, true)));
  });

  it('collapses the terminator to a straight edge at the quarters', () => {
    expect(terminatorRx(moonPhasePath(10, 0.5, true))).toBe(0);
    expect(terminatorRx(moonPhasePath(10, 0.5, false))).toBe(0);
  });

  it('narrows the terminator toward the quarters from both sides', () => {
    expect(terminatorRx(moonPhasePath(10, 0.25, true))).toBe(5);
    expect(terminatorRx(moonPhasePath(10, 0.75, true))).toBe(5);
  });

  it('lights the opposite limb waxing and waning', () => {
    const waxing = moonPhasePath(10, 0.25, true);
    const waning = moonPhasePath(10, 0.25, false);
    expect(waxing).not.toBe(waning);
    // Mirroring for the southern hemisphere swaps them back.
    expect(moonPhasePath(10, 0.25, true, true)).toBe(waning);
    expect(moonPhasePath(10, 0.25, false, true)).toBe(waxing);
  });

  it('clamps a fraction that strays outside the disc', () => {
    expect(terminatorRx(moonPhasePath(10, 1.4, true))).toBe(10);
    expect(terminatorRx(moonPhasePath(10, -0.2, true))).toBe(10);
  });
});

describe('precipArcSegments', () => {
  it('brackets the glyph with a stub on each side', () => {
    // 15:00-18:00 of rain: inset 4 at both ends, 14 minutes opened at 16:30.
    expect(precipArcSegments({ startMin: 900, endMin: 1080 })).toEqual([
      [904, 983], [997, 1076],
    ]);
  });

  it('leaves the shortest run precipRuns can produce a visible stub', () => {
    // One wet hour is the floor: the runs are hour-grained.
    const [left, right] = precipArcSegments({ startMin: 900, endMin: 960 });
    expect(left[1] - left[0]).toBeGreaterThanOrEqual(6);
    expect(right[1] - right[0]).toBeGreaterThanOrEqual(6);
  });

  it('drops the arc when a stub would be too short to read', () => {
    // Not reachable from precipRuns today, but the glyph has to be able to
    // stand alone rather than sprout two specks either side of it.
    expect(precipArcSegments({ startMin: 900, endMin: 930 })).toEqual([]);
  });

  it('keeps the gap centered on the run, so the glyph marks its middle', () => {
    const [left, right] = precipArcSegments({ startMin: 600, endMin: 780 });
    expect(690 - left[1]).toBe(right[0] - 690);
  });
});

describe('classifyPrecip / precipRuns', () => {
  it('classifies WMO codes into rain, snow, or dry', () => {
    expect(classifyPrecip(0)).toBeNull();    // clear
    expect(classifyPrecip(3)).toBeNull();    // overcast
    expect(classifyPrecip(45)).toBeNull();   // fog
    expect(classifyPrecip(55)).toBe('rain'); // drizzle
    expect(classifyPrecip(63)).toBe('rain'); // rain
    expect(classifyPrecip(81)).toBe('rain'); // showers
    expect(classifyPrecip(95)).toBe('rain'); // thunderstorm
    expect(classifyPrecip(73)).toBe('snow'); // snowfall
    expect(classifyPrecip(86)).toBe('snow'); // snow showers
    expect(classifyPrecip(null)).toBeNull();
  });

  it('merges adjacent hours of one kind and splits on kind change', () => {
    const hourly = {};
    for (let h = 0; h < 24; h++) hourly[h] = { code: 1 };
    hourly[9] = { code: 61 };
    hourly[10] = { code: 63 };
    hourly[11] = { code: 71 };  // rain turns to snow
    hourly[15] = { code: 80 };  // separate afternoon shower
    expect(precipRuns(hourly)).toEqual([
      { kind: 'rain', startMin: 540, endMin: 660 },
      { kind: 'snow', startMin: 660, endMin: 720 },
      { kind: 'rain', startMin: 900, endMin: 960 },
    ]);
  });

  it('handles a dry day and missing data', () => {
    expect(precipRuns({})).toEqual([]);
    expect(precipRuns(null)).toEqual([]);
  });
});

describe('findDialFocusBlock', () => {
  const blocks = computeDialModel([
    task({ id: 1, title: 'Morning block', startTime: '09:00', duration: 180 }),
    task({ id: 2, title: 'Standup', startTime: '10:00', duration: 30 }),
    task({ id: 3, title: 'Team sync', startTime: '14:00', duration: 60 }),
  ]).blocks;

  it('prefers the latest-starting block covering now (nested wins)', () => {
    expect(findDialFocusBlock(blocks, 615)).toMatchObject({
      block: { id: 2 }, current: true,
    });
  });

  it('falls back to the next upcoming block', () => {
    expect(findDialFocusBlock(blocks, 780)).toMatchObject({
      block: { id: 3 }, current: false,
    });
  });

  it('returns null when the rest of the day is clear', () => {
    expect(findDialFocusBlock(blocks, 1000)).toBeNull();
    expect(findDialFocusBlock([], 600)).toBeNull();
  });
});

describe('initialDialSelection / stepDialSelection', () => {
  const blocks = [
    { id: 'a', startMin: 540, endMin: 600 },
    { id: 'b', startMin: 660, endMin: 720 },
    { id: 'c', startMin: 900, endMin: 960 },
  ];

  it('starts a selection on the block the hub is narrating', () => {
    // Mid-block, and between blocks (the next one up).
    expect(initialDialSelection(blocks, 570).id).toBe('a');
    expect(initialDialSelection(blocks, 630).id).toBe('b');
  });

  it('starts at the last block once the day is spent', () => {
    expect(initialDialSelection(blocks, 1200).id).toBe('c');
  });

  it('starts at the top of the day on a date with no now line', () => {
    expect(initialDialSelection(blocks, null).id).toBe('a');
  });

  it('has nothing to select on an empty day', () => {
    expect(initialDialSelection([], 570)).toBeNull();
    expect(initialDialSelection(null, null)).toBeNull();
  });

  it('walks the day in time order', () => {
    expect(stepDialSelection(blocks, 'a', 1).id).toBe('b');
    expect(stepDialSelection(blocks, 'c', -1).id).toBe('b');
  });

  it('clamps at both ends instead of wrapping', () => {
    expect(stepDialSelection(blocks, 'c', 1).id).toBe('c');
    expect(stepDialSelection(blocks, 'a', -1).id).toBe('a');
  });

  it('re-enters from the end the caller was heading toward', () => {
    // Selection went stale — the block was edited away under it.
    expect(stepDialSelection(blocks, 'gone', 1).id).toBe('a');
    expect(stepDialSelection(blocks, 'gone', -1).id).toBe('c');
    expect(stepDialSelection(blocks, null, 1).id).toBe('a');
  });

  it('clamps a step larger than the day to the ends', () => {
    expect(stepDialSelection(blocks, 'b', -blocks.length).id).toBe('a');
    expect(stepDialSelection(blocks, 'b', blocks.length).id).toBe('c');
  });

  it('has nothing to step through on an empty day', () => {
    expect(stepDialSelection([], null, 1)).toBeNull();
    expect(stepDialSelection(null, 'a', -1)).toBeNull();
  });
});

describe('dialLabelYieldsToSun', () => {
  it('yields a label the sunrise mark sits on (August: 6:09 vs 6 AM)', () => {
    expect(dialLabelYieldsToSun(360, { sunriseMin: 369, sunsetMin: 1183 })).toBe(true);
  });

  it('yields to a sunset near a label (equinox: 18:12 vs 6 PM)', () => {
    expect(dialLabelYieldsToSun(1080, { sunriseMin: 420, sunsetMin: 1092 })).toBe(true);
  });

  it('leaves labels alone once the sun is clear of them', () => {
    // Late May: sunrise 5:29, sunset 20:14 — both beyond the clearance.
    expect(dialLabelYieldsToSun(360, { sunriseMin: 329, sunsetMin: 1214 })).toBe(false);
    expect(dialLabelYieldsToSun(1080, { sunriseMin: 329, sunsetMin: 1214 })).toBe(false);
  });

  it('measures circularly across midnight', () => {
    // White nights: a 23:50 sunset is 10 minutes from the 12 AM label.
    expect(dialLabelYieldsToSun(0, { sunriseMin: 200, sunsetMin: 1430 })).toBe(true);
  });

  it('treats the clearance as exclusive at the boundary', () => {
    expect(dialLabelYieldsToSun(360, { sunriseMin: 390, sunsetMin: null })).toBe(false);
    expect(dialLabelYieldsToSun(360, { sunriseMin: 389, sunsetMin: null })).toBe(true);
  });

  it('is quiet with no solar data', () => {
    expect(dialLabelYieldsToSun(360, null)).toBe(false);
    expect(dialLabelYieldsToSun(360, { sunriseMin: null, sunsetMin: null })).toBe(false);
  });
});


describe('computeDaylightBand', () => {
  // Denver, ~5,280 ft: the site the band was designed against. Coordinates
  // only reach the astronomy — altitude is not part of a sun-angle
  // calculation, and reaches the band through the UV term instead.
  const DENVER = { lat: 39.7392, lon: -104.9903 };
  const TROMSO = { lat: 69.65, lon: 18.95 };

  const band = (date, coords, uv = null) =>
    computeDaylightBand(date, coords, getSunTimes(date, coords.lat, coords.lon), uv);
  const span = (steps) => (steps.length ? steps[steps.length - 1].endMin - steps[0].startMin : 0);
  const peak = (steps) => Math.max(...steps.map((x) => x.opacity));

  it('runs from sunrise to sunset, the same solution the hairlines use', () => {
    const date = new Date(2026, 8, 10);
    const sun = getSunTimes(date, DENVER.lat, DENVER.lon);
    const steps = computeDaylightBand(date, DENVER, sun);
    expect(steps[0].startMin).toBe(sun.sunriseMin);
    // Minutes are left unwrapped, so a band that crosses midnight runs past
    // 1440 rather than restarting; the geometry turns minutes into an angle,
    // and an angle wraps by itself. WHETHER this date wraps is a fact about
    // the device, not about the band — a UTC machine reading Denver
    // coordinates sets after local midnight, a machine in Denver does not —
    // so assert the rule and let the branch follow the host clock.
    const end = steps[steps.length - 1].endMin;
    expect(end % DIAL_DAY_MINUTES).toBe(sun.sunsetMin);
    expect(end).toBe(sun.sunsetMin > sun.sunriseMin
      ? sun.sunsetMin
      : sun.sunsetMin + DIAL_DAY_MINUTES);
  });

  it('unwraps a band that crosses midnight', () => {
    // The wrapping branch, pinned to a hand-built solution so it is exercised
    // in every timezone rather than only on the machines that happen to
    // produce it.
    const steps = computeDaylightBand(new Date(2026, 8, 10), DENVER,
      { sunriseMin: 1300, sunsetMin: 120, polar: null });
    expect(steps[0].startMin).toBe(1300);
    expect(steps[steps.length - 1].endMin).toBe(120 + DIAL_DAY_MINUTES);
  });

  it('makes a winter day both shorter and dimmer than a summer one', () => {
    // The whole point of normalising against the site's best noon rather
    // than each day's own: renormalising per day makes every December look
    // exactly like every June.
    const june = band(new Date(2026, 5, 21), DENVER);
    const dec = band(new Date(2026, 11, 21), DENVER);
    expect(span(dec)).toBeLessThan(span(june) - 4 * 60);
    expect(peak(dec)).toBeLessThan(peak(june) * 0.7);
  });

  it('never fades below the floor, so midwinter still reads', () => {
    const dec = band(new Date(2026, 11, 21), DENVER);
    expect(dec.length).toBeGreaterThan(0);
    for (const step of dec) expect(step.opacity).toBeGreaterThanOrEqual(DAYLIGHT_FLOOR);
    // And the floor is where it starts: the first step is at the horizon.
    expect(dec[0].opacity).toBeCloseTo(DAYLIGHT_FLOOR, 2);
  });

  it('tops out at the peak on the best day of the year', () => {
    const june = band(new Date(2026, 5, 21), DENVER);
    expect(peak(june)).toBeLessThanOrEqual(DAYLIGHT_PEAK + 1e-9);
    expect(peak(june)).toBeGreaterThan(DAYLIGHT_PEAK * 0.95);
    for (const step of june) expect(step.opacity).toBeLessThanOrEqual(DAYLIGHT_PEAK + 1e-9);
  });

  it('brightens toward solar noon and back down again', () => {
    const steps = band(new Date(2026, 8, 10), DENVER);
    const mid = Math.floor(steps.length / 2);
    expect(steps[mid].opacity).toBeGreaterThan(steps[0].opacity);
    expect(steps[mid].opacity).toBeGreaterThan(steps[steps.length - 1].opacity);
  });

  it('lights the whole ring through polar day and none of it through polar night', () => {
    const midnightSun = band(new Date(2026, 5, 21), TROMSO);
    expect(span(midnightSun)).toBe(1440);
    for (const step of midnightSun) expect(step.opacity).toBeGreaterThan(DAYLIGHT_FLOOR);
    // Polar night is the opposite day, not the same missing data.
    expect(band(new Date(2026, 11, 21), TROMSO)).toEqual([]);
  });

  it('scales the whole band by UV when the forecast reaches the date', () => {
    const date = new Date(2026, 5, 21);
    const clear = band(date, DENVER, 10);
    const overcast = band(date, DENVER, 1);
    const noData = band(date, DENVER);
    // No UV is not "UV zero" — the band is pure geometry there.
    expect(peak(noData)).toBeCloseTo(peak(clear), 6);
    expect(peak(overcast)).toBeLessThan(peak(clear));
    // ...but a flat grey day is still a lit day.
    expect(peak(overcast)).toBeGreaterThan(DAYLIGHT_FLOOR);
    expect(span(overcast)).toBe(span(clear));
  });

  it('draws nothing without a location', () => {
    expect(computeDaylightBand(new Date(2026, 5, 21), null, { sunriseMin: 300, sunsetMin: 1200 })).toEqual([]);
    expect(computeDaylightBand(new Date(2026, 5, 21), DENVER, null)).toEqual([]);
  });
});

describe('dialPeakUv', () => {
  it('takes the day\'s highest reading', () => {
    expect(dialPeakUv({ 9: { uv: 3 }, 12: { uv: 8.4 }, 15: { uv: 5 } })).toBe(8.4);
  });

  it('is null when the forecast carries no UV at all', () => {
    expect(dialPeakUv(null)).toBeNull();
    expect(dialPeakUv({ 12: { temp: 20, code: 1 } })).toBeNull();
  });

  it('keeps a real zero apart from missing data', () => {
    // Overcast midwinter genuinely reads 0; that is data, not absence.
    expect(dialPeakUv({ 12: { uv: 0 } })).toBe(0);
  });
});

describe('computeFocusSpans', () => {
  const log = (spans, extra = {}) => ({ '2026-09-10': { totalMinutes: 60, sessions: spans.length, spans, ...extra } });

  it('places each session on the day\'s clock', () => {
    expect(computeFocusSpans(log([{ start: 540, end: 565 }]), '2026-09-10'))
      .toEqual([{ startMin: 540, endMin: 565 }]);
  });

  it('draws back-to-back sessions as one stretch', () => {
    // Two pomodoros either side of a break inside one block are one piece of
    // focus to look at; the day's session COUNT is kept separately, so
    // nothing is lost by merging them here.
    expect(computeFocusSpans(log([
      { start: 540, end: 565 }, { start: 566, end: 591 },
    ]), '2026-09-10')).toEqual([{ startMin: 540, endMin: 591 }]);
  });

  it('keeps sessions in different blocks apart', () => {
    expect(computeFocusSpans(log([
      { start: 540, end: 565 }, { start: 840, end: 870 },
    ]), '2026-09-10')).toEqual([
      { startMin: 540, endMin: 565 },
      { startMin: 840, endMin: 870 },
    ]);
  });

  it('orders and coalesces whatever order the log holds', () => {
    expect(computeFocusSpans(log([
      { start: 840, end: 870 }, { start: 540, end: 600 }, { start: 580, end: 650 },
    ]), '2026-09-10')).toEqual([
      { startMin: 540, endMin: 650 },
      { startMin: 840, endMin: 870 },
    ]);
  });

  it('clips a session that ran past midnight at the day it belongs to', () => {
    // The log is keyed by the date the session STARTED; the remainder is
    // tomorrow's, and this entry does not describe tomorrow.
    expect(computeFocusSpans(log([{ start: 1425, end: 1470 }]), '2026-09-10'))
      .toEqual([{ startMin: 1425, endMin: 1440 }]);
  });

  it('is empty for a day with no record, and for the old shape', () => {
    expect(computeFocusSpans(log([{ start: 540, end: 565 }]), '2026-09-09')).toEqual([]);
    expect(computeFocusSpans(null, '2026-09-10')).toEqual([]);
    // Days logged before spans existed keep their totals but have no times
    // to place — the ring is honestly bare for them rather than guessing.
    expect(computeFocusSpans({ '2026-09-10': { totalMinutes: 90, sessions: 2 } }, '2026-09-10')).toEqual([]);
  });

  it('drops entries that carry no real interval', () => {
    expect(computeFocusSpans(log([
      { start: 540, end: 540 }, { start: 600, end: 590 }, { start: 'x', end: 700 }, null,
    ]), '2026-09-10')).toEqual([]);
  });
});

describe('focusSpanMinutes', () => {
  it('totals the merged spans', () => {
    expect(focusSpanMinutes([{ startMin: 540, endMin: 591 }, { startMin: 840, endMin: 870 }])).toBe(81);
  });

  it('is zero with nothing to total', () => {
    expect(focusSpanMinutes([])).toBe(0);
    expect(focusSpanMinutes(null)).toBe(0);
  });
});


describe('canStartFocusFromBlock', () => {
  const block = (over = {}) => ({ startMin: 540, endMin: 660, ...over });

  it('allows it only on the block that is running now', () => {
    // Focus mode derives its block from the CURRENT time, not from whatever
    // was tapped, so offering the action elsewhere would silently focus a
    // different block than the one asked for.
    expect(canStartFocusFromBlock(block(), 600)).toBe(true);
    expect(canStartFocusFromBlock(block(), 540)).toBe(true);   // the first minute counts
    expect(canStartFocusFromBlock(block(), 660)).toBe(false);  // the last does not
    expect(canStartFocusFromBlock(block(), 400)).toBe(false);
    expect(canStartFocusFromBlock(block(), 800)).toBe(false);
  });

  it('refuses where there is no running block to focus', () => {
    expect(canStartFocusFromBlock(block(), null)).toBe(false);  // no now line
    expect(canStartFocusFromBlock(block({ isRoutine: true }), 600)).toBe(false);
    expect(canStartFocusFromBlock({ }, 600)).toBe(false);       // an all-day item
    expect(canStartFocusFromBlock(null, 600)).toBe(false);
  });
});


describe('computeDayCompletion', () => {
  const T = (over = {}) => ({ id: 1, title: 'x', startTime: '09:00', duration: 60, ...over });
  const ids = (c) => c.remaining.map((t) => t.id);

  it('weighs completion by minutes, not by block count', () => {
    // The whole reason this face measures in minutes: a two-hour block is
    // more of the day than a fifteen-minute errand.
    const c = computeDayCompletion([
      T({ id: 1, duration: 120, completed: true }),
      T({ id: 2, startTime: '14:00', duration: 15 }),
    ]);
    expect(c.doneMinutes).toBe(120);
    expect(c.totalMinutes).toBe(135);
    expect(c.fraction).toBeCloseTo(120 / 135, 5);
    // By block count this would read 1 of 2; by minutes it is nearly done.
    expect(c.fraction).toBeGreaterThan(0.85);
  });

  it('reads an empty day as empty, never as finished', () => {
    // 0/0 is not 100%: a day with nothing scheduled has completed nothing.
    const c = computeDayCompletion([]);
    expect(c).toEqual({ doneMinutes: 0, totalMinutes: 0, fraction: 0, remaining: [] });
    expect(computeDayCompletion(null).fraction).toBe(0);
  });

  it('reaches exactly 1 when everything scheduled is done', () => {
    const c = computeDayCompletion([
      T({ id: 1, completed: true }), T({ id: 2, startTime: '11:00', completed: true }),
    ]);
    expect(c.fraction).toBe(1);
    expect(c.remaining).toEqual([]);
  });

  it('leaves out what is not yours to complete', () => {
    // A read-only imported meeting would otherwise peg the figure below
    // 100% on any day containing one.
    const c = computeDayCompletion([
      T({ id: 1, completed: true }),
      T({ id: 2, startTime: '11:00', imported: true }),
    ]);
    expect(c.fraction).toBe(1);
    expect(ids(c)).toEqual([]);
    // ...but an imported TASK calendar is the user's own work.
    const own = computeDayCompletion([
      T({ id: 1, completed: true }),
      T({ id: 2, startTime: '11:00', imported: true, isTaskCalendar: true }),
    ]);
    expect(own.fraction).toBe(0.5);
    expect(ids(own)).toEqual([2]);
  });

  it('leaves out what has no minutes to weigh', () => {
    const c = computeDayCompletion([
      T({ id: 1, completed: true }),
      T({ id: 2, isAllDay: true, duration: 600 }),   // no hour on the clock
      T({ id: 3, startTime: null, duration: 30 }),   // unscheduled
      T({ id: 4, startTime: '13:00', duration: 0 }), // zero-length
    ]);
    expect(c.totalMinutes).toBe(60);
    expect(c.fraction).toBe(1);
  });

  it('lists what is left, in time order', () => {
    expect(ids(computeDayCompletion([
      T({ id: 'c', startTime: '16:00' }),
      T({ id: 'a', startTime: '08:00' }),
      T({ id: 'done', startTime: '09:00', completed: true }),
      T({ id: 'b', startTime: '12:30' }),
    ]))).toEqual(['a', 'b', 'c']);
  });
});


describe('dialDateFits', () => {
  // Measured on the real face with Lora loaded and two-digit (Fahrenheit)
  // temperatures, which is the tight case: a three-character glyph at r=250
  // eats into the half-face the date has to live in.
  const DIAL = 778;

  it('gives the line the span left between the two temperatures', () => {
    // Temps sit at r=250 — half the face — less a glyph at each end.
    expect(DIAL_DATE_MAX_FRAC).toBeLessThan(0.5);
    expect(dialDateFits(DIAL * 0.43, DIAL)).toBe(true);
    expect(dialDateFits(DIAL * 0.45, DIAL)).toBe(false);
    expect(dialDateFits(DIAL * DIAL_DATE_MAX_FRAC, DIAL)).toBe(true);
  });

  it('scales with the face, not with the viewport', () => {
    // The same string fits a big dial and not a small one; nothing here
    // knows or cares how wide the window is.
    expect(dialDateFits(348, 947)).toBe(true);
    expect(dialDateFits(348, 338)).toBe(false);
  });

  it('keeps the full date until something is actually known', () => {
    // Before the probe has been measured, showing the long form and
    // correcting is better than abbreviating a date that would have fit.
    expect(dialDateFits(null, DIAL)).toBe(true);
    expect(dialDateFits(0, DIAL)).toBe(true);
    expect(dialDateFits(348, null)).toBe(true);
  });
});
