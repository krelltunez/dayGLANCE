import { computeDaySummary } from './daySummary.js';
import { deriveBlockEnergy } from './energyAxis.js';

// Model + geometry for the Day Dial — the ambient 24-hour instrument view.
// Pure functions only: DayDial.jsx stays presentational and every angle,
// path, and rollup here is testable without a DOM.
//
// The dial's visual register is INSTRUMENT (chronograph bezel, not analog
// journal): flat translucent fills with one luminous arc along the outer
// edge, hierarchy through opacity and stroke weight rather than pattern,
// and the now line carrying the entire visual budget. Those decisions live
// in DayDial.jsx; this module only answers "what is where".
//
// Orientation: midnight at 12 o'clock, time flowing clockwise — 6 AM right,
// noon bottom, 6 PM left. A full day is one revolution, so a minute is 0.25°.

export const DIAL_DAY_MINUTES = 1440;

// Category palette, emissive-on-dark. Effort/Restore reuse the energy-axis
// split (energyAxis.js); Sleep is the time outside the declared day window
// (useDayWindows); Unblocked is measured by computeDaySummary and shown only
// in the legend — on the ring it is simply the dark gaps.
export const DIAL_COLORS = {
  effort: '#93c5fd',   // blue-300
  restore: '#5eead4',  // teal-300
  sleep: '#c4b5fd',    // violet-300
  unblocked: '#9ca3af', // gray-400 (legend dot only)
  now: '#fe8b00',      // brand orange — the only moving element
};

const timeToMin = (t) => {
  const [h, m] = String(t).split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};

/** Angle in radians for a minute-of-day, measured clockwise from midnight-at-top. */
export function dialAngle(min) {
  return (min / DIAL_DAY_MINUTES) * 2 * Math.PI;
}

/** Point on the dial at radius r for a minute-of-day (SVG coords, y down). */
export function dialPoint(cx, cy, r, min) {
  const a = dialAngle(min);
  return { x: cx + r * Math.sin(a), y: cy - r * Math.cos(a) };
}

const fmt = (n) => Number(n.toFixed(3));

/**
 * Stroke-only arc path from startMin to endMin (clockwise). Callers must keep
 * spans under a full revolution; a full circle should be a <circle> element.
 */
export function dialArcPath(cx, cy, r, startMin, endMin) {
  const p1 = dialPoint(cx, cy, r, startMin);
  const p2 = dialPoint(cx, cy, r, endMin);
  const largeArc = endMin - startMin > DIAL_DAY_MINUTES / 2 ? 1 : 0;
  return `M ${fmt(p1.x)} ${fmt(p1.y)} A ${r} ${r} 0 ${largeArc} 1 ${fmt(p2.x)} ${fmt(p2.y)}`;
}

/** Closed annular-sector (wedge band) path between rInner and rOuter. */
export function dialSectorPath(cx, cy, rInner, rOuter, startMin, endMin) {
  const o1 = dialPoint(cx, cy, rOuter, startMin);
  const o2 = dialPoint(cx, cy, rOuter, endMin);
  const i1 = dialPoint(cx, cy, rInner, endMin);
  const i2 = dialPoint(cx, cy, rInner, startMin);
  const largeArc = endMin - startMin > DIAL_DAY_MINUTES / 2 ? 1 : 0;
  return [
    `M ${fmt(o1.x)} ${fmt(o1.y)}`,
    `A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${fmt(o2.x)} ${fmt(o2.y)}`,
    `L ${fmt(i1.x)} ${fmt(i1.y)}`,
    `A ${rInner} ${rInner} 0 ${largeArc} 0 ${fmt(i2.x)} ${fmt(i2.y)}`,
    'Z',
  ].join(' ');
}

/**
 * Tick schedule for the bezel: hairlines every 5 minutes, medium at the
 * quarter hour, full-length on the hour — one color at three opacities is
 * what makes the dial read as engineered. Returns [{min, kind}] with kind
 * 'hour' | 'quarter' | 'minor'.
 */
export function dialTicks() {
  const ticks = [];
  for (let min = 0; min < DIAL_DAY_MINUTES; min += 5) {
    const kind = min % 60 === 0 ? 'hour' : min % 15 === 0 ? 'quarter' : 'minor';
    ticks.push({ min, kind });
  }
  return ticks;
}

/**
 * Continuous intensity scale by duration — a 15-minute sliver and a 3-hour
 * block are the same family at different intensities (opacity + stroke
 * weight, never pattern variety). Saturates at 3 hours. Widths are in
 * 1000-unit-viewBox units.
 */
export function dialIntensity(durationMin) {
  const t = Math.max(0, Math.min(1, durationMin / 180));
  return {
    fillOpacity: fmt(0.05 + t * 0.11), // 0.05 – 0.16
    edgeOpacity: fmt(0.45 + t * 0.55), // 0.45 – 1.0
    edgeWidth: fmt(2 + t * 2),         // 2 – 4
  };
}

/**
 * Shrink a segment so adjacent blocks separate on the ring. The gap yields
 * for short blocks (never eats more than a third of one) so slivers stay
 * visible. Per-side flags let a segment that continues past an edge keep it
 * flush — the declared night is one mass, so its two halves must meet at
 * midnight without a seam. Returns [paddedStart, paddedEnd].
 */
export function padDialSegment(startMin, endMin, gapMin = 3, padStart = true, padEnd = true) {
  const pad = Math.min(gapMin, (endMin - startMin) / 6);
  return [startMin + (padStart ? pad : 0), endMin - (padEnd ? pad : 0)];
}

/**
 * Roll one day's tasks + declared day window into everything the dial draws.
 *
 * @param dayTasks  The date's tasks (the getTasksForDate shape). Same scope
 *                  rules as computeDaySummary: only timed blocks count.
 * @param dayWindow Resolved {start, stop} 'HH:MM' markers or null.
 * @returns {{
 *   blocks: Array<{id, title, startMin, endMin, kind: 'effort'|'restore', completed: boolean}>,
 *   sleep: Array<{startMin, endMin}>,   // outside the day window; empty without full markers
 *   effortMinutes: number,
 *   restoreMinutes: number,
 *   sleepMinutes: number|null,          // null = no declared window, nothing honest to show
 *   unblockedMinutes: number|null,      // computeDaySummary semantics
 * }}
 */
export function computeDialModel(dayTasks, dayWindow = null) {
  const blocks = (dayTasks || [])
    .filter((t) => t && !t.isAllDay && t.startTime && (t.duration || 0) > 0)
    .map((t) => {
      const startMin = timeToMin(t.startTime);
      return {
        id: t.id,
        title: t.title || '',
        startMin,
        // A block running past midnight is clipped to the dial's day — the
        // ring is one revolution and wrap-around would read as morning.
        endMin: Math.min(DIAL_DAY_MINUTES, startMin + (t.duration || 0)),
        kind: deriveBlockEnergy(t),
        completed: !!t.completed,
      };
    })
    .filter((b) => b.endMin > b.startMin)
    .sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);

  const startM = dayWindow?.start ? timeToMin(dayWindow.start) : null;
  const stopM = dayWindow?.stop ? timeToMin(dayWindow.stop) : null;
  const hasWindow = startM !== null && stopM !== null && stopM > startM;

  const sleep = [];
  if (hasWindow) {
    if (startM > 0) sleep.push({ startMin: 0, endMin: startM });
    if (stopM < DIAL_DAY_MINUTES) sleep.push({ startMin: stopM, endMin: DIAL_DAY_MINUTES });
  }

  const summary = computeDaySummary(dayTasks, null, dayWindow);

  return {
    blocks,
    sleep,
    effortMinutes: summary.effortMinutes,
    restoreMinutes: summary.restoreMinutes,
    sleepMinutes: hasWindow ? startM + (DIAL_DAY_MINUTES - stopM) : null,
    unblockedMinutes: summary.unblockedMinutes,
  };
}

/**
 * The block the hub should narrate: the one running now (latest-starting
 * cover wins, so a nested block beats its container), else the next upcoming
 * one. Returns {block, current} or null when the rest of the day is clear.
 */
export function findDialFocusBlock(blocks, nowMin) {
  let running = null;
  for (const b of blocks) {
    if (b.startMin <= nowMin && nowMin < b.endMin) {
      if (!running || b.startMin >= running.startMin) running = b;
    }
  }
  if (running) return { block: running, current: true };
  const next = (blocks || []).find((b) => b.startMin > nowMin);
  return next ? { block: next, current: false } : null;
}
