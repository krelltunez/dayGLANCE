import { describe, it, expect } from 'vitest';
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
  dialLabelYieldsToSun,
  findDialFocusBlock,
  initialDialSelection,
  muteDialColor,
  precipRuns,
  stepDialSelection,
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

  it('clips a block running past midnight to the dial\'s day', () => {
    const model = computeDialModel([task({ startTime: '23:00', duration: 120 })]);
    expect(model.blocks[0].endMin).toBe(DIAL_DAY_MINUTES);
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

  it('handles an empty day', () => {
    const model = computeDialModel([]);
    expect(model.blocks).toEqual([]);
    expect(model.unblockedMinutes).toBeNull();
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

  it('reaches the extremes in one step (Home / End)', () => {
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
