import { computeDaySummary } from './daySummary.js';
import { deriveBlockEnergy } from './energyAxis.js';
import { frameColorToHex, taskColorToHex } from './colorUtils.js';
import { getMoonAltitude, getMoonIllumination } from './lunar.js';
import { getPeakSunElevation, getSunElevation, getSunTimes, POLAR_DAY } from './solar.js';
import { assignLanes } from './intervalLanes.js';
import { continuationsFromPreviousDay } from '@glance-apps/agenda-core';
import { extractTags, stripWikilinks } from './taskUtils.js';

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
 * Split overlapping blocks onto concentric lanes so a double-booked hour
 * stops overdrawing itself. Classic interval partitioning, but scoped to
 * each CLUSTER of transitively-overlapping blocks rather than the whole
 * day: one double-booking at breakfast must not thin the ring for a clean
 * afternoon, and a day with no overlaps (the common one) keeps every wedge
 * at the band's full depth exactly as before.
 *
 * Lane 0 is innermost. Greedy assignment by start time therefore puts the
 * earliest, longest block deepest and pushes each newcomer outward, which
 * is the reading we want: a block nested inside a container ends up on the
 * outer luminous rim — the same "nested wins" rule the hub already follows
 * (findDialFocusBlock).
 *
 * Blocks that merely touch (one ends where the next starts) do not overlap;
 * padDialSegment's gap already separates those along the ring.
 *
 * @param blocks Ring blocks sorted by startMin (computeDialModel's order).
 * @returns New block objects carrying {lane, laneCount}, in the same order.
 */
export function assignDialLanes(blocks) {
  // The packing itself is shared with the time grids and the month view
  // (intervalLanes.js); the dial only names its own semantics for it.
  return assignLanes(blocks);
}

// Radial breathing room between lanes, in viewBox units. Yields on crowded
// clusters (same principle as padDialSegment's gap) so four-deep overlaps
// still leave each lane thick enough to carry its luminous edge.
export const DIAL_LANE_GAP = 6;

/**
 * The radial band one lane occupies inside the schedule ring. A single lane
 * takes the whole band, so the unstacked day is byte-identical to what the
 * dial drew before lanes existed.
 */
export function dialLaneBand(rInner, rOuter, lane = 0, laneCount = 1) {
  if (!(laneCount > 1)) return { rInner, rOuter };
  const span = rOuter - rInner;
  const gap = Math.min(DIAL_LANE_GAP, span / (laneCount * 5));
  const depth = (span - gap * (laneCount - 1)) / laneCount;
  const base = rInner + lane * (depth + gap);
  return { rInner: fmt(base), rOuter: fmt(base + depth) };
}

/**
 * Roll one day's tasks + declared day window into everything the dial draws.
 *
 * @param dayTasks  The date's tasks (the getTasksForDate shape). Same scope
 *                  rules as computeDaySummary: only timed blocks count.
 * @param dayWindow Resolved {start, stop} 'HH:MM' markers or null.
 * @param prevDayTasks The PREVIOUS date's tasks, or null. Only their
 *                  overnight overrun is used — the part that lands after
 *                  this day's midnight.
 * @returns {{
 *   blocks: Array<{id, title, startMin, endMin, kind: 'effort'|'restore',
 *                  completed: boolean, lane: number, laneCount: number,
 *                  endsNextDay?: boolean, endMinTrue?: number,
 *                  startedPrevDay?: boolean, startMinTrue?: number}>,
 *   allDay: Array<{id, title, completed, completable, colorHex}>,
 *                                       // no hour, so never on the ring
 *   sleep: Array<{startMin, endMin}>,   // outside the day window; empty without full markers
 *   effortMinutes: number,
 *   restoreMinutes: number,
 *   sleepMinutes: number|null,          // null = no declared window, nothing honest to show
 *   unblockedMinutes: number|null,      // computeDaySummary semantics
 * }}
 */
export function computeDialModel(dayTasks, dayWindow = null, prevDayTasks = null) {
  // Shared shape for anything that becomes a wedge.
  const toBlock = (t) => ({
    id: t.id,
    title: t.title || '',
    kind: deriveBlockEnergy(t),
    completed: !!t.completed,
    // Fixture rule (same as computeDaySummary): a read-only imported
    // calendar event has no completion to toggle.
    completable: !(t.imported && !t.isTaskCalendar),
    colorHex: taskColorToHex(t.color, t.nativeCalendarColor),
  });
  const timedOnly = (t) => t && !t.isAllDay && t.startTime && (t.duration || 0) > 0;

  const owned = (dayTasks || [])
    .filter(timedOnly)
    .map((t) => {
      const startMin = timeToMin(t.startTime);
      const rawEnd = startMin + (t.duration || 0);
      return {
        ...toBlock(t),
        startMin,
        // The ring is one revolution, so a block running past midnight is
        // CLIPPED for geometry — wrapping it around would read as morning.
        // The true end is kept for every readout, though: the hub, the
        // sheet, the screen-reader label and the "time left" phrase all
        // speak the hour the block actually ends, not the boundary.
        endMin: Math.min(DIAL_DAY_MINUTES, rawEnd),
        endsNextDay: rawEnd > DIAL_DAY_MINUTES,
        endMinTrue: rawEnd > DIAL_DAY_MINUTES ? rawEnd - DIAL_DAY_MINUTES : null,
      };
    });

  // The same overrun seen from the other side: last night's block still
  // occupies this morning, so it is drawn from midnight for as long as it
  // runs. Only the geometry crosses over — the totals below never see these
  // (they come from computeDaySummary over dayTasks alone), because the
  // minutes belong to the day the task is filed under. In practice that
  // divergence is invisible: unblocked time is measured inside the declared
  // day window, and an overnight spill lands before it. The carry itself is
  // the one rule every timeline shares (agenda-core overnight.js, #2278).
  const carried = continuationsFromPreviousDay(prevDayTasks)
    .map(({ task: t, minutes }) => ({
      ...toBlock(t),
      startMin: 0,
      endMin: minutes,
      startedPrevDay: true,
      startMinTrue: timeToMin(t.startTime),
    }));

  const blocks = assignDialLanes([...carried, ...owned]
    .filter((b) => b.endMin > b.startMin)
    .sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin));

  // All-day items: the day's context rather than its schedule — a holiday, a
  // birthday, an OOO, or anything the user un-timed (inboxMove and the
  // drag-to-all-day handlers set isAllDay with startTime cleared). Keyed on
  // the FLAG, never on a missing startTime: an Obsidian date-only line
  // arrives as isAllDay with startTime '00:00' (packages/obsidian-format
  // taskLines.js), and drawing that at midnight would invent an hour it
  // does not have. They carry no honest minutes, so every total below is
  // deliberately left untouched by them.
  //
  // Incomplete first, then completed, stable within each group: on a wall
  // panel the still-standing context is what earns the space.
  const allDay = (dayTasks || [])
    .filter((t) => t && t.isAllDay)
    .map((t) => ({
      id: t.id,
      title: t.title || '',
      completed: !!t.completed,
      completable: !(t.imported && !t.isTaskCalendar),
      colorHex: taskColorToHex(t.color, t.nativeCalendarColor),
    }))
    .sort((a, b) => Number(a.completed) - Number(b.completed));

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
    allDay,
    sleep,
    effortMinutes: summary.effortMinutes,
    restoreMinutes: summary.restoreMinutes,
    sleepMinutes: hasWindow ? startM + (DIAL_DAY_MINUTES - stopM) : null,
    unblockedMinutes: summary.unblockedMinutes,
  };
}

// ── Frames ──────────────────────────────────────────────────────────────────
// docs/day-dial-frames-spec.html. A frame is drawn as an ENCLOSURE around the
// span of the block band it covers: an outline just outside each edge of the
// band, joined by radial end caps. Nothing else on the face moves for it.
//
// Every length here is a fraction of the block band's width, from the widget
// spec (band 129–151pt, 22pt wide): the outline sits 3pt inside the band's
// inner edge and 2pt outside its outer edge (the gaps either side of it), a
// nested frame steps 3.2pt inward per level, and the stroke is 1.8pt (the
// spec drew 1.2pt; on devices that read too faint, so the widgets thickened
// it). The in-app dial sets its own width (DayDial.jsx). Stated
// as fractions so the in-app dial (band 300–385 in its 1000-unit viewBox)
// scales the same design rather than copying point values, and the three
// renderers take the same numbers (dayDial.vectors.json `dialFrameRadii`).
const FRAME_SPEC_BAND = 22;
export const DIAL_FRAME_INNER_GAP = 3 / FRAME_SPEC_BAND;
export const DIAL_FRAME_OUTER_GAP = 2 / FRAME_SPEC_BAND;
export const DIAL_FRAME_STEP = 3.2 / FRAME_SPEC_BAND;
export const DIAL_FRAME_STROKE = 1.8 / FRAME_SPEC_BAND;
export const DIAL_FRAME_OPACITY = 0.45;
/**
 * The deepest drawn level. One step in (3.2 of 22) already puts the outline
 * on the band's own edges; a second would draw it through the wedges'
 * fills and rims, where it stops reading as an enclosure. Deeper frames draw
 * at this level: the enclosure is still visible, only its depth is not.
 */
export const DIAL_FRAME_MAX_DEPTH = 1;
/**
 * The shortest frame drawn as an enclosure. Ten minutes is 5.5pt of arc at
 * the widget's inner outline, about the smallest span whose two end caps
 * still read as a box rather than as one thick tick. The editor's own floor
 * is 15 minutes; this only guards a per-day exception squeezed below it. A
 * shorter frame is still in the model (the hub and the percentage see it).
 */
export const DIAL_FRAME_MIN_MINUTES = 10;

/** The outline's two radii and stroke for a frame at `depth`, on a band. */
export function dialFrameRadii(rInner, rOuter, depth = 0) {
  const w = rOuter - rInner;
  const d = Math.max(0, Math.min(DIAL_FRAME_MAX_DEPTH, depth));
  return {
    inner: rInner - DIAL_FRAME_INNER_GAP * w + d * DIAL_FRAME_STEP * w,
    outer: rOuter + DIAL_FRAME_OUTER_GAP * w - d * DIAL_FRAME_STEP * w,
    width: DIAL_FRAME_STROKE * w,
  };
}

const mergeSpans = (spans) => {
  const sorted = spans.filter((x) => x.endMin > x.startMin)
    .sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
  const out = [];
  for (const x of sorted) {
    const last = out[out.length - 1];
    if (last && x.startMin <= last.endMin) last.endMin = Math.max(last.endMin, x.endMin);
    else out.push({ startMin: x.startMin, endMin: x.endMin });
  }
  return out;
};
const spanLength = (spans) => spans.reduce((sum, x) => sum + (x.endMin - x.startMin), 0);

/**
 * The day's frames as the dial draws and reads them, and the Frames metric.
 *
 * `instances` are frameInstancesForDate's ({frameId, label, color, start,
 * end}), each optionally with `slots`: its free time, computeAvailableSlots's
 * [{start, end}] computed WITHOUT the now floor, so a reader can take "still
 * available" at any minute (dialFrameAvailableMinutes) rather than at the
 * push. `blocks` are computeDialModel's.
 *
 *  - Midnight: the editor refuses end <= start, so a frame never crosses it.
 *    One that arrives that way anyway (a hand-edited or synced record) is
 *    dropped rather than guessed at; the span is clamped to the day.
 *  - Nesting: the model has none, but a per-day exception or a resize can
 *    leave one frame inside another (the overlap check runs only in the
 *    editor). Depth is containment: how many frames wholly enclose this one
 *    (an identical span counts the earlier frame as the outer), capped at
 *    DIAL_FRAME_MAX_DEPTH. Frames that overlap WITHOUT one containing the
 *    other both stay at depth 0; their outlines cross where they overlap,
 *    which is the truth of the day.
 *  - percent: scheduled block minutes inside frames ÷ frame minutes. Blocks
 *    are the ring's own (tasks and calendar events, done or not; sleep and
 *    routines are never in `blocks`), merged, so lanes do not count twice.
 *    Frame minutes are the union of the TOP-LEVEL frames, so neither nesting
 *    nor an overlap counts a minute twice. A frame with nothing in it is 0 %.
 *    null when the day has no frames: there is no honest number to show.
 *
 * @returns {{frames: Array<{id, name, colorHex, startMin, endMin, depth,
 *   slots: Array<{startMin, endMin}>}>, percent: number|null}}
 */
export function computeDialFrames(instances, blocks = []) {
  const frames = (instances || [])
    .map((f) => ({
      id: f.frameId ?? f.id ?? null,
      name: f.label || '',
      colorHex: frameColorToHex(f.color),
      startMin: Math.max(0, timeToMin(f.start)),
      endMin: Math.min(DIAL_DAY_MINUTES, timeToMin(f.end)),
      slots: (f.slots || [])
        .map((x) => ({ startMin: timeToMin(x.start), endMin: timeToMin(x.end) }))
        .filter((x) => x.endMin > x.startMin),
    }))
    .filter((f) => f.endMin > f.startMin);

  const encloses = (outer, oi, inner, ii) => oi !== ii
    && outer.startMin <= inner.startMin && outer.endMin >= inner.endMin
    && (outer.startMin !== inner.startMin || outer.endMin !== inner.endMin || oi < ii);
  const levels = frames.map((f, i) => frames.filter((g, j) => encloses(g, j, f, i)).length);
  const out = frames
    .map((f, i) => ({ ...f, depth: Math.min(DIAL_FRAME_MAX_DEPTH, levels[i]) }))
    .sort((a, b) => a.startMin - b.startMin || a.depth - b.depth);

  if (frames.length === 0) return { frames: out, percent: null };
  const framed = mergeSpans(frames.filter((_, i) => levels[i] === 0));
  const busy = mergeSpans(blocks || []);
  let filled = 0;
  for (const f of framed) {
    for (const b of busy) filled += Math.max(0, Math.min(f.endMin, b.endMin) - Math.max(f.startMin, b.startMin));
  }
  const total = spanLength(framed);
  return { frames: out, percent: total > 0 ? Math.round((filled / total) * 100) : null };
}

/** The frame the hub speaks for at `nowMin`: the innermost one it is inside. */
export function dialCurrentFrame(frames, nowMin) {
  if (nowMin == null) return null;
  let pick = null;
  for (const f of frames || []) {
    if (f.startMin <= nowMin && nowMin < f.endMin
      && (!pick || f.depth > pick.depth || (f.depth === pick.depth && f.startMin >= pick.startMin))) pick = f;
  }
  return pick;
}

/**
 * Free minutes still ahead in a frame at `nowMin`: its slots from the later
 * of their start and now. What GLANCE's "available" pill shows (its slots
 * are the same computeAvailableSlots, floored at now when it is computed).
 */
export function dialFrameAvailableMinutes(frame, nowMin) {
  return (frame?.slots || []).reduce(
    (sum, x) => sum + Math.max(0, x.endMin - Math.max(x.startMin, nowMin ?? 0)), 0);
}

const hexToRgb = (hex) => {
  const m = /^#([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
};

/**
 * Pull any task color into the dial's single pastel-emissive family: keep
 * the hue, cap saturation, pin lightness. Task palettes are saturated
 * 400–600-series colors (and native calendar events arrive in arbitrary,
 * often dark, hues) — drawn raw they would shatter the instrument's
 * reserved palette, so every wedge speaks its task's hue in the dial's
 * voice. Unparseable input falls back to the effort blue.
 */
export function muteDialColor(hex) {
  return muteDialColorWith(hex, 0.5, 0.73);
}

/**
 * A frame's enclosure on the ring: the same hue rule, SOFTENED — saturation
 * capped lower and lightness pulled down — so the outline sits below the block
 * rims in weight and the needle stays the brightest thing on the face
 * (docs/day-dial-frames-spec.html, "Softest"). The hub's frame title uses the
 * standard muteDialColor instead: same hue, a stronger mute level, on purpose.
 */
export const DIAL_FRAME_MUTE = { satCap: 0.28, light: 0.62 };
export function muteDialFrameColor(hex) {
  return muteDialColorWith(hex, DIAL_FRAME_MUTE.satCap, DIAL_FRAME_MUTE.light);
}

/** muteDialColor with the saturation cap and pinned lightness as inputs. */
export function muteDialColorWith(hex, satCap, light) {
  const rgb = hexToRgb(hex);
  if (!rgb) return DIAL_COLORS.effort;
  const [r, g, b] = rgb;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  if (max !== min) {
    const d = max - min;
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  const l0 = (max + min) / 2;
  const s0 = max === min ? 0 : (max - min) / (1 - Math.abs(2 * l0 - 1));

  const s = Math.min(s0, satCap);
  const l = light;

  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h * 6) % 2) - 1));
  const m2 = l - c / 2;
  const seg = Math.floor(h * 6) % 6;
  const [r1, g1, b1] = [
    [c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x],
  ][seg];
  const toHex = (v) => Math.round((v + m2) * 255).toString(16).padStart(2, '0');
  return `#${toHex(r1)}${toHex(g1)}${toHex(b1)}`;
}

/**
 * WMO weather code → precipitation kind, or null for dry conditions. The
 * dial's weather ring only marks precipitation: it is the one condition
 * that changes a decision, so it earns ink where cloud-cover taxonomy
 * would not.
 */
export function classifyPrecip(code) {
  if (code == null) return null;
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95) return 'rain';
  return null;
}

/**
 * Contiguous precipitation spells from an hour-keyed forecast map
 * ({ hour: {code, ...} }). Adjacent hours of the same kind merge into one
 * run; a kind change splits (a rain hour then a snow hour is two runs).
 * Returns [{kind: 'rain'|'snow', startMin, endMin}] in day order.
 */
export function precipRuns(hourlyByHour) {
  const runs = [];
  let cur = null;
  for (let h = 0; h < 24; h++) {
    const kind = classifyPrecip(hourlyByHour?.[h]?.code);
    if (kind && cur?.kind === kind && cur.endMin === h * 60) {
      cur.endMin = (h + 1) * 60;
    } else if (kind) {
      cur = { kind, startMin: h * 60, endMin: (h + 1) * 60 };
      runs.push(cur);
    } else {
      cur = null;
    }
  }
  return runs;
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

/**
 * Routines placed on today's clock, as bars for the dial's outer track.
 *
 * Routines are a TODAY-ONLY construct in this app — useRoutines clears and
 * rolls todayRoutines at midnight, and every planner surface gates on the
 * date being today — so the caller passes null on any other date and the
 * track simply is not drawn. A routine with no time set never reaches the
 * dial either: it has no hour, and the ring is a clock.
 *
 * The bar's length is the routine's real scheduled duration (the default is
 * 15 minutes but it is editable in 15-minute steps, so a routine can run
 * hours). Overlapping routines take lanes exactly as schedule blocks do —
 * assignDialLanes only cares about startMin/endMin.
 *
 * @param routines    todayRoutines (id, name, startTime, duration, isAllDay).
 * @param completions routineCompletions: {id -> dateStr} for anything done.
 * @returns Array<{id, title, startMin, endMin, completed, isRoutine: true,
 *                 endsNextDay, endMinTrue, lane, laneCount}> in time order.
 */
export function computeDialRoutines(routines, completions = {}) {
  return assignDialLanes((routines || [])
    .filter((r) => r && !r.isAllDay && r.startTime && (r.duration || 0) > 0)
    .map((r) => {
      const startMin = timeToMin(r.startTime);
      const rawEnd = startMin + (r.duration || 0);
      return {
        id: r.id,
        // `title`, not `name`: every readout on the dial — hub, sheet,
        // screen-reader label — speaks one field.
        title: r.name || '',
        startMin,
        // Same rule as a schedule block: the ring is one revolution, so the
        // geometry clips at midnight while the readouts keep the true end.
        endMin: Math.min(DIAL_DAY_MINUTES, rawEnd),
        endsNextDay: rawEnd > DIAL_DAY_MINUTES,
        endMinTrue: rawEnd > DIAL_DAY_MINUTES ? rawEnd - DIAL_DAY_MINUTES : null,
        completed: !!completions?.[r.id],
        isRoutine: true,
      };
    })
    .filter((b) => b.endMin > b.startMin)
    .sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin));
}

/**
 * Where a keyboard selection starts when focus first reaches the ring: the
 * block the hub is already narrating, so tabbing in lands on "now" rather
 * than on an arbitrary end of the day. Once today is spent (nothing running,
 * nothing ahead) the last block is the useful entry — that is the hour just
 * finished. Another date has no "now", so it starts at the top of the day.
 *
 * @returns The block to select, or null on a day with no timed blocks.
 */
export function initialDialSelection(blocks, nowMin = null) {
  const list = blocks || [];
  if (!list.length) return null;
  if (nowMin === null) return list[0];
  const focus = findDialFocusBlock(list, nowMin);
  return focus ? focus.block : list[list.length - 1];
}

/**
 * Move a keyboard selection through the day in time order. Clamps at both
 * ends rather than wrapping — Home/End are the deliberate way to reach the
 * extremes, and a selection that silently jumps from 23:00 back to 06:00
 * loses the "walking forward through the day" reading. A selection that has
 * gone stale (its block edited away) re-enters from the end the caller was
 * heading toward.
 *
 * @param blocks    Ring blocks in computeDialModel order (by start time).
 * @param currentId id of the selected block, or null for none.
 * @param delta     Steps to move; negative walks back toward midnight.
 * @returns The newly selected block, or null on a day with no blocks.
 */
export function stepDialSelection(blocks, currentId, delta) {
  const list = blocks || [];
  if (!list.length) return null;
  const i = list.findIndex((b) => b.id === currentId);
  if (i === -1) return delta < 0 ? list[list.length - 1] : list[0];
  return list[Math.max(0, Math.min(list.length - 1, i + delta))];
}


// ── Focus sessions ──────────────────────────────────────────────────────────
//
// Where the day's focus sessions actually landed. Focus mode can only run
// inside a block that is already on the ring (it requires an in-progress
// timed task with 45+ minutes left), so this layer answers one question the
// wedges cannot: which of those blocks did the work actually happen in.
//
// The log stores one span per session. Adjacent spans are merged here rather
// than at write time: back-to-back sessions inside one block are one stretch
// of focus to look at, while the day's session COUNT is already kept
// separately, so nothing is lost by drawing them as one.

/** Spans closer than this are drawn as one — a gap too small to read. */
export const FOCUS_MERGE_GAP_MIN = 2;

/**
 * The day's focus spans, clipped to the day and merged where they touch.
 *
 * @param focusLog The persisted log, keyed by date string.
 * @param dateStr  The day being drawn.
 * @returns Array of {startMin, endMin}, in time order, within [0, 1440].
 */
export function computeFocusSpans(focusLog, dateStr) {
  const raw = focusLog?.[dateStr]?.spans;
  if (!Array.isArray(raw) || raw.length === 0) return [];

  const clipped = raw
    .map((s) => ({
      startMin: Math.max(0, Math.min(DIAL_DAY_MINUTES, Number(s?.start))),
      // A session that ran past midnight is clipped at the day's end; the
      // remainder belongs to a day this entry does not describe.
      endMin: Math.max(0, Math.min(DIAL_DAY_MINUTES, Number(s?.end))),
    }))
    .filter((s) => Number.isFinite(s.startMin) && Number.isFinite(s.endMin)
      && s.endMin > s.startMin)
    .sort((a, b) => a.startMin - b.startMin);

  const merged = [];
  for (const span of clipped) {
    const last = merged[merged.length - 1];
    if (last && span.startMin - last.endMin <= FOCUS_MERGE_GAP_MIN) {
      last.endMin = Math.max(last.endMin, span.endMin);
    } else {
      merged.push({ ...span });
    }
  }
  return merged;
}

/**
 * Whether a block can start a focus session right now.
 *
 * Focus mode derives its block from the current time, not from whatever was
 * tapped, so offering the action anywhere else would silently focus a
 * different block than the one asked for. Routines are not the schedule and
 * cannot host a session.
 *
 * @param block  A dial block, or a routine bar.
 * @param nowMin Minutes past midnight, or null on a day with no now line.
 */
export function canStartFocusFromBlock(block, nowMin) {
  if (!block || nowMin == null || block.isRoutine) return false;
  if (block.startMin === undefined || block.endMin === undefined) return false;
  return block.startMin <= nowMin && nowMin < block.endMin;
}

/** Total minutes of focus the day's spans cover, once merged. */
export function focusSpanMinutes(spans) {
  return (spans || []).reduce((sum, s) => sum + (s.endMin - s.startMin), 0);
}

// ── Daylight band ───────────────────────────────────────────────────────────
//
// The lit part of the day, drawn as a soft arc hugging the schedule ring's
// inner edge — in among the weather, where it belongs, rather than out in
// the tick field where the ticks stripe through it.
//
// Its EXTENT comes from getSunTimes, the same function that places the
// sunrise/sunset hairlines, so the band always begins and ends exactly at
// the marks. Its INTENSITY comes from the sun's elevation through the day,
// computed locally: that means the band works on any date the dial can page
// to and keeps working offline, which a fetched forecast could not (six days
// of coverage against a dial with no end stops).
//
// Two things intensity deliberately does NOT do. It does not renormalise per
// day — the reference is the site's own best noon of the year, so a December
// arc really is shorter AND dimmer than a June one instead of every day
// peaking alike. And it never falls to nothing: the floor keeps a midwinter
// day present, which is when the shape of the day is most worth seeing.

/** Opacity at the horizons — the band's quietest, never invisible. */
export const DAYLIGHT_FLOOR = 0.05;
/** Opacity at an overhead summer noon under a clear sky. */
export const DAYLIGHT_PEAK = 0.2;
/** Angular resolution of the gradient: 4 minutes = 1° of dial. */
export const DAYLIGHT_STEP_MIN = 4;

// UV index taken as "full strength" — the bottom of the WHO's "very high"
// band. Pinning it at the 11+ extreme instead would reserve a full-strength
// band for the desert and leave an ordinary clear summer day visibly dim.
const UV_REFERENCE = 8;
// However flat the light, a lit day still reads as lit.
const UV_MIN_SCALE = 0.4;

/**
 * The daylight band as a list of arc steps, each with its own opacity.
 *
 * @param date    The local day being drawn.
 * @param coords  {lat, lon}, or null when no location is configured.
 * @param sun     getSunTimes' result for that date and place.
 * @param uvMax   The day's peak UV index, or null when the forecast doesn't
 *                reach this date. Present, it scales the whole band: this is
 *                the one term that knows about the sky rather than the
 *                geometry, so haze, cloud and thin mountain air all land
 *                here. Absent, the band is pure geometry.
 * @returns Array of {startMin, endMin, opacity}, empty when nothing is lit.
 */
export function computeDaylightBand(date, coords, sun, uvMax = null) {
  if (!coords || !sun) return [];

  // Polar night draws nothing; polar day is lit end to end. Otherwise the
  // band runs sunrise → sunset, wrapping midnight if it has to.
  let startMin;
  let endMin;
  if (sun.polar === POLAR_DAY) {
    startMin = 0;
    endMin = DIAL_DAY_MINUTES;
  } else if (sun.polar || sun.sunriseMin == null || sun.sunsetMin == null) {
    return [];
  } else {
    startMin = sun.sunriseMin;
    endMin = sun.sunsetMin > sun.sunriseMin ? sun.sunsetMin : sun.sunsetMin + DIAL_DAY_MINUTES;
  }

  const peakSin = Math.sin((getPeakSunElevation(coords.lat) * Math.PI) / 180);
  const uvScale = uvMax == null
    ? 1
    : Math.min(1, Math.max(UV_MIN_SCALE, uvMax / UV_REFERENCE));

  const steps = [];
  for (let m = startMin; m < endMin; m += DAYLIGHT_STEP_MIN) {
    const stop = Math.min(m + DAYLIGHT_STEP_MIN, endMin);
    const elev = getSunElevation(date, coords.lat, coords.lon, (m + stop) / 2);
    // Below the horizon only at the very edges, where the local elevation
    // curve and the rise/set solution disagree by a minute or two; the floor
    // is the honest answer there either way.
    const lit = Math.max(0, Math.sin((elev * Math.PI) / 180)) / (peakSin || 1);
    // Minutes stay unwrapped (a band crossing midnight runs past 1440);
    // the geometry converts minutes to an angle, which wraps on its own.
    steps.push({
      startMin: m,
      endMin: stop,
      opacity: DAYLIGHT_FLOOR
        + (DAYLIGHT_PEAK - DAYLIGHT_FLOOR) * Math.min(1, lit) * uvScale,
    });
  }
  return steps;
}

/** The day's peak UV from the dial's hourly weather, or null without one. */
export function dialPeakUv(hourly) {
  if (!hourly) return null;
  let max = null;
  for (let h = 0; h < 24; h++) {
    const uv = hourly[h]?.uv;
    if (Number.isFinite(uv)) max = max == null ? uv : Math.max(max, uv);
  }
  return max;
}


// ── Day completion ──────────────────────────────────────────────────────────
//
// How much of the day's planned work is actually done, weighted by minutes
// rather than by block count: this face is about time, so a two-hour block
// counts for more than a fifteen-minute errand.
//
// Deliberately NOT drawn as an arc on the ring. Angle means time of day
// everywhere else on this dial — wedges, sleep, daylight, routines, the
// focus rail, the ticks — so a sweep that encoded a fraction would read as
// a span of hours (40% from midnight reads as "until 09:36"). It rides a
// corner subdial instead, where no angle is claiming to be a clock.
//
// Read-only imported calendar events are left out of both halves: someone
// else's meeting is not yours to complete, so counting it would peg the
// figure below 100% on any day with one in it. All-day items are left out
// too — they have no minutes to weigh.

/**
 * The day's completion, by scheduled minutes.
 *
 * @param dayTasks The day's tasks, already filtered by the layer toggles.
 * @returns {{doneMinutes: number, totalMinutes: number, fraction: number,
 *           remaining: Array}} `fraction` is 0 when there is nothing to do,
 *          so an empty day reads as an empty ring rather than a full one.
 *          `remaining` is the incomplete blocks, in time order.
 */
/**
 * The minutes a scheduled task contributes to the day's readouts, or 0 when
 * it contributes none. Shared so every complication measured in minutes
 * counts the same day: same fixture rule computeDialModel uses, where a
 * read-only imported event has no completion to toggle and so no stake in
 * how the day went.
 */
export function dialTaskMinutes(task) {
  if (!task || task.isAllDay || !task.startTime) return 0;
  if (task.imported && !task.isTaskCalendar) return 0;
  return Math.max(0, Number(task.duration) || 0);
}

export function computeDayCompletion(dayTasks) {
  let doneMinutes = 0;
  let totalMinutes = 0;
  const remaining = [];

  for (const t of dayTasks || []) {
    const minutes = dialTaskMinutes(t);
    if (!minutes) continue;
    totalMinutes += minutes;
    if (t.completed) doneMinutes += minutes;
    else remaining.push(t);
  }

  remaining.sort((a, b) => timeToMin(a.startTime) - timeToMin(b.startTime));
  return {
    doneMinutes,
    totalMinutes,
    fraction: totalMinutes > 0 ? doneMinutes / totalMinutes : 0,
    remaining,
  };
}


// ── Hub date fit ────────────────────────────────────────────────────────────
//
// The date is the hub's headline and sits across the middle of the face,
// where the weather ring puts a temperature at r=250 on the horizontal. That
// leaves half the face, less a temperature glyph at each end, for the line to
// live in — about 0.44 of the dial's width once a gutter is kept so the two
// never kiss.
//
// A long month in a narrow face busts it: measured on a 360px Android the
// drawn dial is 338px and "September 10" renders 179px (0.53 of it), landing
// 5px INSIDE the 8° on either side. The same string clears by 12px on a 390px
// iPhone, which is why this is a measurement and not a breakpoint — the dial
// is sized by the space the modal gives it, not by the viewport.
//
// The answer is to abbreviate the month rather than shrink the type: the font
// is already clamped to its 28px floor on a phone, and a headline that shrank
// further would lose the job it is there to do.

/** Share of the dial's width the date line may occupy before it crowds. */
export const DIAL_DATE_MAX_FRAC = 0.44;

/**
 * Whether the full date fits the hub at this size.
 *
 * @param textPx Rendered width of the LONG form, measured. Measuring the
 *               long form specifically is what keeps this stable: deciding
 *               from the rendered line would let an abbreviation that fits
 *               flip the answer back and forth.
 * @param dialPx The dial's drawn diameter.
 * @returns true when unmeasured, so the first paint shows the full date and
 *          only gives it up once something is known to be wrong.
 */
export function dialDateFits(textPx, dialPx) {
  if (!textPx || !dialPx) return true;
  return textPx <= dialPx * DIAL_DATE_MAX_FRAC;
}

/**
 * The long-form label of every date in `date`'s month, for the hub's date
 * probe. The probe stacks them and reports the WIDEST, so the long-or-short
 * call is made once per month: measured date by date, a phone's November read
 * "November 1" and then "Nov 24" a few weeks later. A tablet that fits the
 * widest keeps every name; locale-formatted, so each language is measured in
 * its own month names rather than against a list of English ones.
 *
 * @param {Date} date
 * @param {string} locale
 * @returns {string[]}
 */
export function monthDateLabels(date, locale) {
  const y = date.getFullYear();
  const m = date.getMonth();
  const days = new Date(y, m + 1, 0).getDate();
  return Array.from({ length: days }, (_, i) =>
    new Date(y, m, i + 1, 12).toLocaleDateString(locale, { month: 'long', day: 'numeric' }));
}

// A sunrise/sunset mark rides its hairline out to the hour-label radius, so
// a sun time within about half an hour of a label parks the glyph on the
// text ("6☼AM" for an August sunrise at 6:09). The label yields for those
// weeks — the hairline and glyph name the station more precisely than the
// text does. Distance is circular so a white-nights sunset at 23:50 clears
// the midnight label too.
export const SUN_LABEL_CLEARANCE_MIN = 30;

export function dialLabelYieldsToSun(labelMin, sun) {
  return [sun?.sunriseMin, sun?.sunsetMin].some((m) => {
    if (m == null) return false;
    const d = Math.abs(m - labelMin) % DIAL_DAY_MINUTES;
    return Math.min(d, DIAL_DAY_MINUTES - d) < SUN_LABEL_CLEARANCE_MIN;
  });
}

/**
 * Whether an hour label yields to the alarm mark (dialAlarmMark): only once it
 * stands at its real time, where its glyph shares the labels' radius band.
 * At 00 (tomorrow's alarm) it sits beside the label instead.
 */
export function dialLabelYieldsToAlarm(labelMin, alarm) {
  if (!alarm || alarm.mode !== 'today') return false;
  const d = Math.abs(alarm.min - labelMin) % DIAL_DAY_MINUTES;
  return Math.min(d, DIAL_DAY_MINUTES - d) < SUN_LABEL_CLEARANCE_MIN;
}

// A precipitation run's arc is broken around the glyph that marks it, and the
// two share one radius. Stacking them at separate radii is not an option: the
// only clear annulus between the temperature numerals and the daylight band's
// inner edge is about 15 units, and the glyph alone needs 13 of it.
export const PRECIP_INSET_MIN = 4;
export const PRECIP_GAP_MIN = 14;
export const PRECIP_MIN_STUB_MIN = 6;

/**
 * The drawable segments of a precipitation run's arc: the run, inset at both
 * ends, with a gap opened at its midpoint for the glyph — the way a
 * chronograph scale breaks around its markers rather than running under them.
 *
 * Returns [[startMin, endMin], ...] — two stubs normally, or none when the run
 * is too short to leave a visible stub on either side, in which case the glyph
 * carries the mark by itself.
 */
export function precipArcSegments(run, {
  inset = PRECIP_INSET_MIN,
  gap = PRECIP_GAP_MIN,
  minStub = PRECIP_MIN_STUB_MIN,
} = {}) {
  const from = run.startMin + inset;
  const to = run.endMin - inset;
  const mid = (run.startMin + run.endMin) / 2;
  const segments = [[from, mid - gap / 2], [mid + gap / 2, to]];
  return segments.every(([s, e]) => e - s >= minStub) ? segments : [];
}

// The moon shares the daylight band's track, and takes over when the sun
// leaves it. That is not just tidiness: the band means "light this body is
// giving you", and a moon in a blue sky is giving you none. It is up during
// the day about as often as at night, so without the clip the two bands would
// overlap on the same annulus for half of every month, and the track would
// stop meaning one thing.

/** Brightest the moon band ever gets — a full moon, high, on a clear night. */
export const MOONLIGHT_PEAK = 0.20;
/** Its quietest, at the horizon. Both are scaled by the lit fraction. */
export const MOONLIGHT_FLOOR = 0.012;
/**
 * Full moonlight is around a 400,000th of sunlight, so a band that scaled
 * with the real ratio would be invisible. These numbers are not that ratio —
 * they are the readable floor of the same track — but they keep the ORDER
 * right: the brightest moon this dial can draw lands at the dimmest daylight
 * it can draw (DAYLIGHT_FLOOR), and both stay well under the now-line.
 */
export const MOON_ALTITUDE_REFERENCE = 45;

/**
 * The moon band as a list of arc steps, each with its own opacity: the
 * portion of the night the moon is actually above the horizon, scaled by how
 * high it is and how much of its disc is lit.
 *
 * Sampling minute by minute rather than deriving spans from moonrise and
 * moonset, because the interesting cases are the awkward ones — the moon that
 * sets at 04:00 and rises again at 22:00 puts two separate spans in one local
 * day, and at high latitudes it may do neither.
 *
 * @param date   The local day being drawn.
 * @param coords {lat, lon}, or null when no location is configured.
 * @param sun    getSunTimes' result for that date and place, used to clip the
 *               band to the hours the sun is down.
 * @returns {{steps: Array<{startMin, endMin, opacity}>, glyphMin: number|null,
 *            fraction: number, waxing: boolean}} `glyphMin` is the middle of
 *          the longest unbroken stretch — where the phase glyph goes — or
 *          null when no stretch is long enough to hold one.
 */
export function computeMoonBand(date, coords, sun) {
  const none = { steps: [], glyphMin: null, fraction: 0, waxing: true };
  if (!coords || !sun) return none;

  const { fraction, waxing } = getMoonIllumination(
    new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12));

  const sunUp = sunUpPredicate(sun);
  const steps = [];

  for (let m = 0; m < DIAL_DAY_MINUTES; m += DAYLIGHT_STEP_MIN) {
    const mid = m + DAYLIGHT_STEP_MIN / 2;
    if (sunUp(mid)) continue;
    const alt = getMoonAltitude(
      new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, mid), coords.lat, coords.lon);
    if (alt <= 0) continue;

    const lit = Math.min(1, Math.sin((alt * Math.PI) / 180)
      / Math.sin((MOON_ALTITUDE_REFERENCE * Math.PI) / 180));
    steps.push({
      startMin: m,
      endMin: m + DAYLIGHT_STEP_MIN,
      // Kept, not just consumed: the glyph goes where the moon rides highest,
      // and that is a question about the steps rather than about the geometry
      // that drew them.
      alt,
      // Scaled by the lit fraction throughout, floor included: a new moon
      // overhead is still a dark sky, and drawing it as a band would say
      // otherwise.
      opacity: Math.round(
        (MOONLIGHT_FLOOR + (MOONLIGHT_PEAK - MOONLIGHT_FLOOR) * lit) * fraction * 1e4) / 1e4,
    });
  }
  return { steps, glyphMin: moonGlyphMinute(steps), fraction, waxing };
}

/** A stretch shorter than this is left to speak for itself, unglyphed. */
export const MOON_GLYPH_MIN_RUN = 60;
/**
 * How far the glyph is kept off a stretch's ends. The disc is radius 9 at
 * r=292, which is about seven minutes of arc at its widest, plus room to read
 * as sitting IN the band rather than falling off it.
 */
export const MOON_GLYPH_EDGE_PAD_MIN = 12;

/**
 * The band's steps grouped into unbroken stretches, each carrying the minute
 * the moon rides highest within it.
 *
 * One local day routinely holds two stretches — the moon sets before dawn and
 * is back before the next midnight — which is the case that rules out
 * deriving the band from a single moonrise/moonset pair.
 *
 * @param steps Consecutive {startMin, endMin, alt} steps in day order.
 * @returns Array of {startMin, endMin, peakMin, peakAlt}, one per stretch.
 */
export function moonStretches(steps) {
  const runs = [];
  for (const step of steps) {
    const last = runs[runs.length - 1];
    const mid = (step.startMin + step.endMin) / 2;
    const alt = Number.isFinite(step.alt) ? step.alt : -Infinity;
    if (last && last.endMin === step.startMin) {
      last.endMin = step.endMin;
      if (alt > last.peakAlt) { last.peakAlt = alt; last.peakMin = mid; }
    } else {
      runs.push({ startMin: step.startMin, endMin: step.endMin, peakMin: mid, peakAlt: alt });
    }
  }
  return runs;
}

/**
 * Where the phase glyph goes: the moon's apex — the minute it rides highest —
 * in whichever drawn stretch it climbs highest in.
 *
 * The midpoint of the longest stretch was the first rule here, and reading
 * the face showed why it was wrong: the middle of a span is not a fact about
 * the moon, so the glyph wandered left or right of where the moon actually
 * was and jumped between the two as the stretches changed shape night to
 * night. The apex is a real moment and sits where the eye expects it.
 *
 * The reason the midpoint was chosen in the first place still stands, so it
 * is handled rather than avoided: clipping to the sun-down hours routinely
 * cuts a stretch off while the moon is still climbing, which puts the highest
 * DRAWN minute flush against the sunrise hairline. Held off the ends by
 * MOON_GLYPH_EDGE_PAD_MIN, the glyph stays inside the band it belongs to and
 * still reads as "highest just as the sun came up", which is what happened.
 */
function moonGlyphMinute(steps) {
  const best = moonStretches(steps)
    .filter((run) => run.endMin - run.startMin >= MOON_GLYPH_MIN_RUN)
    .reduce((a, b) => (a && a.peakAlt >= b.peakAlt ? a : b), null);
  if (!best) return null;
  return Math.min(
    Math.max(best.peakMin, best.startMin + MOON_GLYPH_EDGE_PAD_MIN),
    best.endMin - MOON_GLYPH_EDGE_PAD_MIN,
  );
}

/** Is the sun above the horizon at this minute? Reads getSunTimes' result. */
function sunUpPredicate(sun) {
  if (sun.polar === POLAR_DAY) return () => true;
  if (sun.polar || sun.sunriseMin == null || sun.sunsetMin == null) return () => false;
  const { sunriseMin, sunsetMin } = sun;
  return sunsetMin > sunriseMin
    ? (m) => m >= sunriseMin && m < sunsetMin
    // Sunset before sunrise on the clock: the lit span wraps midnight.
    : (m) => m >= sunriseMin || m < sunsetMin;
}

/**
 * The hour-by-hour sky for the home-screen widget, derived here and shipped
 * in the widget snapshot rather than re-solved natively. The widget's sky
 * ring is 24 hour-aligned segments (docs/day-dial-widget-handoff.md §4), so
 * this is the per-hour sample of exactly what computeDaylightBand and
 * computeMoonBand draw: the same solar elevation, the same lunar altitude,
 * the same peak-normalisation, and the same rule that the moon band is
 * clipped to the hours the sun is down. Only the final opacity mapping is
 * left to the consumer — a strength in [0, 1] is what it wants, and the
 * dial's own floor/peak constants are the dial's business.
 *
 * Strength is purely astronomical. The in-app daylight band also scales by
 * the forecast's peak UV (computeDaylightBand's uvScale); the widget has no
 * weather feed, and a band that dims on an overcast day is a nicety the
 * 6pt ring cannot show anyway.
 *
 * @param date   The local calendar day to describe.
 * @param coords {lat, lon} or null. Null → null: with no location there is
 *               nothing honest to draw, same as the in-app layers.
 * @returns {null|{
 *   sunriseMin: number|null, sunsetMin: number|null, polar: 'day'|'night'|null,
 *   hours: Array<{sun: number, moon: number}>,   // 24, sampled at hh:30
 *   moon: {fraction: number, waxing: boolean, glyphMin: number|null},
 *   southern: boolean,   // observer below the equator: mirror the moon's lit limb
 * }}
 */
export function computeSkySnapshot(date, coords) {
  if (!coords || !Number.isFinite(coords.lat) || !Number.isFinite(coords.lon)) return null;
  const sun = getSunTimes(date, coords.lat, coords.lon);
  const sunUp = sunUpPredicate(sun);
  const peakSin = Math.sin((getPeakSunElevation(coords.lat) * Math.PI) / 180) || 1;
  const moonRef = Math.sin((MOON_ALTITUDE_REFERENCE * Math.PI) / 180);
  const { fraction, waxing } = getMoonIllumination(
    new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12));
  const round = (v) => Math.round(v * 1e3) / 1e3;

  const hours = [];
  for (let h = 0; h < 24; h++) {
    const mid = h * 60 + 30;
    const elev = getSunElevation(date, coords.lat, coords.lon, mid);
    const sunStrength = Math.min(1, Math.max(0, Math.sin((elev * Math.PI) / 180)) / peakSin);

    let moonStrength = 0;
    if (!sunUp(mid)) {
      const alt = getMoonAltitude(
        new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, mid), coords.lat, coords.lon);
      if (alt > 0) {
        moonStrength = Math.min(1, Math.sin((alt * Math.PI) / 180) / moonRef) * fraction;
      }
    }
    hours.push({ sun: round(sunStrength), moon: round(moonStrength) });
  }

  return {
    sunriseMin: sun.sunriseMin,
    sunsetMin: sun.sunsetMin,
    polar: sun.polar,
    hours,
    // glyphMin from the same stretch logic the dial uses, so the widget's
    // moon glyph and the dial's sit at the same minute.
    moon: { fraction: round(fraction), waxing, glyphMin: computeMoonBand(date, coords, sun).glyphMin },
    // The sign of the latitude and nothing more: the widget mirrors the moon
    // glyph for a southern observer (as DayDial.jsx does) without ever being
    // sent the coordinates.
    southern: coords.lat < 0,
  };
}

/**
 * The whole local day as the home-screen widget's ring wants it: every timed
 * block whether or not it is done or over, plus the sleep window and the
 * routines, in one start-sorted list with just enough per block to draw it.
 *
 * Why this exists: the agenda-shaped parts of the widget snapshot are built
 * from todayAgenda, which hides a completed task once it has ended (that is
 * right for an agenda — a done thing leaves the list). A dial draws the day's
 * shape, so a completed 9 AM block still has to be on the ring at 3 PM, dimmed.
 * This projection comes from computeDialModel instead, the same model the
 * in-app dial renders, so the widget and the dial cannot disagree about what
 * the day looks like.
 *
 * Deliberately NOT here: notes, subtasks, project links, anything the ring
 * and hub do not draw. Titles ARE here, on every block rather than only the
 * running one: the widget renders a 24-hour timeline from one snapshot, and
 * whichever block is "current" changes with the entry being rendered, not
 * with when the snapshot was pushed. The hub at entry 40 of 96 needs that
 * entry's block's title, and the app may be suspended by then.
 *
 * @param opts.date          'YYYY-MM-DD' of the day described.
 * @param opts.dayTasks      The day's tasks (getTasksForDate shape, no tag filter).
 * @param opts.prevDayTasks  Yesterday's, for the overnight carry (see computeDialModel).
 * @param opts.dayWindow     {start, stop} 'HH:MM' or null → no sleep blocks.
 * @param opts.routines      Today's routines or null.
 * @param opts.routineCompletions  {id: bool}.
 * @param opts.frames        The day's frame instances, each with its unfloored
 *                           `slots` (see computeDialFrames), or null.
 * @returns {{date: string, blocks: Array<{
 *   type: 'task'|'event'|'routine'|'sleep',
 *   startMin: number, durationMin: number,   // durationMin is the DRAWN span, clipped at midnight
 *   id?, title?, tag?, kind?: 'effort'|'restore', completed?: boolean, colorHex?,
 *   lane?: number, laneCount?: number,
 *   endsNextDay?: true, endMinTrue?: number, startedPrevDay?: true,
 * }>, allDay: Array<{id, title, completed: boolean, colorHex}>,
 *   frames: Array<{name, colorHex, startMin, endMin, depth, slots: Array<[startMin, endMin]>}>,
 *   totals: {effortMinutes: number, restoreMinutes: number,
 *            sleepMinutes: number|null, unblockedMinutes: number|null,
 *            framesPercent: number|null}}}
 */
export function projectDialSnapshot({
  date, dayTasks, prevDayTasks = null, dayWindow = null, routines = null, routineCompletions = null,
  frames = null,
}) {
  const model = computeDialModel(dayTasks, dayWindow, prevDayTasks);
  const bars = computeDialRoutines(routines, routineCompletions);
  // Same cleaning the Up Next projection applies: wikilinks and #tags out of
  // the display title; the first tag kept separately for the hub's italic line.
  const cleanTitle = (t) => stripWikilinks(t || '').replace(/#\S+/g, '').replace(/\s+/g, ' ').trim();
  // The widget decodes this with a strict JSONDecoder (WidgetModels.swift):
  // `id` is String?, the minute fields are Int?, and ONE mismatch anywhere in
  // the array fails the whole snapshot, blanking every iOS widget. Every id
  // producer in the app emits strings and every duration path emits whole
  // minutes today, but this list carries every block of the day, so the wire
  // shape is pinned here rather than trusted: ids stringified, minutes rounded.
  const idStr = (v) => (v == null ? null : String(v));
  const minute = (n) => Math.round(n);
  const clipFlags = (b) => ({
    ...(b.endsNextDay ? { endsNextDay: true, endMinTrue: minute(b.endMinTrue) } : {}),
    ...(b.startedPrevDay ? { startedPrevDay: true } : {}),
  });

  const blocks = [
    ...model.blocks.map((b) => ({
      // A read-only imported calendar event is the one thing on the ring
      // that is not the user's own block; computeDialModel already knows
      // it as "not completable".
      type: b.completable ? 'task' : 'event',
      id: idStr(b.id),
      title: cleanTitle(b.title),
      tag: extractTags(b.title)[0] ?? null,
      startMin: minute(b.startMin),
      durationMin: minute(b.endMin - b.startMin),
      kind: b.kind,
      completed: b.completed,
      colorHex: b.colorHex,
      lane: b.lane,
      laneCount: b.laneCount,
      ...clipFlags(b),
    })),
    ...bars.map((r) => ({
      type: 'routine',
      id: idStr(r.id),
      title: cleanTitle(r.title),
      startMin: minute(r.startMin),
      durationMin: minute(r.endMin - r.startMin),
      completed: r.completed,
      lane: r.lane,
      laneCount: r.laneCount,
      ...clipFlags(r),
    })),
    ...model.sleep.map((seg) => ({
      type: 'sleep',
      startMin: minute(seg.startMin),
      durationMin: minute(seg.endMin - seg.startMin),
    })),
  ].sort((a, b) => a.startMin - b.startMin || a.durationMin - b.durationMin);

  // The two cards the Android dial draws beside the ring when its placement
  // has room (the in-app dial's All Day pill and legend): the day's all-day
  // items, incomplete first, and the legend's totals. Computed here, by the
  // model the in-app dial reads, so no platform re-derives them. Routines are
  // counted off `blocks`; focus has no widget readout.
  const allDay = model.allDay.map((a) => ({
    id: idStr(a.id),
    title: cleanTitle(a.title),
    completed: a.completed,
    colorHex: a.colorHex,
  }));
  const wholeOrNull = (n) => (n == null ? null : minute(n));
  const totals = {
    effortMinutes: minute(model.effortMinutes),
    restoreMinutes: minute(model.restoreMinutes),
    sleepMinutes: wholeOrNull(model.sleepMinutes),
    unblockedMinutes: wholeOrNull(model.unblockedMinutes),
  };

  // Frames: part of the shape of the day, not its state, so projected days
  // carry them too. The dial's own list rather than the snapshot's
  // `sections`, which cannot be reused: today's sections drop frames that
  // have ended and frames with nothing free and nothing in them, while the
  // ring draws the whole day's frames; and a section carries its task rows,
  // which the ring already has as blocks. Free time ships as the frame's
  // unfloored slots, so each entry reads "still available" at its own minute.
  const dialFrames = computeDialFrames(frames, model.blocks);
  totals.framesPercent = dialFrames.percent;
  const framesOut = dialFrames.frames.map((f) => ({
    name: f.name,
    colorHex: f.colorHex,
    startMin: minute(f.startMin),
    endMin: minute(f.endMin),
    depth: f.depth,
    slots: f.slots.map((x) => [minute(x.startMin), minute(x.endMin)]),
  }));

  return { date, blocks, allDay, frames: framesOut, totals };
}

/**
 * The lit portion of a moon disc of radius `r`, as an SVG path centred on the
 * origin: the limb on one side, the terminator — a semi-ellipse whose width
 * collapses to nothing at the quarters — on the other.
 *
 * @param r        Disc radius in user units.
 * @param fraction Lit portion of the disc, 0 (new) to 1 (full).
 * @param waxing   Lit on the right (northern hemisphere) when true.
 * @param mirror   Flip the lit side, for southern-hemisphere observers.
 * @returns An SVG path `d`, empty-area at new moon and a full circle at full.
 */
export function moonPhasePath(r, fraction, waxing, mirror = false) {
  const k = Math.max(0, Math.min(1, fraction));
  const rx = Math.round(r * Math.abs(1 - 2 * k) * 1e3) / 1e3;
  // Past half, the terminator bulges away from the lit limb rather than
  // toward it, which is a change of arc direction, not of radius.
  const sweep = k < 0.5 ? 0 : 1;
  const x = waxing === !mirror ? 1 : -1;
  return `M 0 ${-r} A ${r} ${r} 0 0 ${x > 0 ? 1 : 0} 0 ${r}`
    + ` A ${rx} ${r} 0 0 ${x > 0 ? sweep : 1 - sweep} 0 ${-r} Z`;
}

/**
 * How much of today's scheduled time sits on work that is filed under a
 * project — the Aligned readout.
 *
 * The sibling of computeDayCompletion, on the same denominator and a
 * different axis: Done asks how much of today you finished, Aligned asks how
 * much of it pointed at something you said mattered. Together they are the
 * two questions a planned day can be wrong about.
 *
 * "Aligned" means filed under a project that still exists, not under a
 * project that carries a goal. Projects are the unit tasks attach to and
 * goals sit above them, so a project without a goal is still deliberate
 * structure rather than a stray hour; and a task pointing at a deleted
 * project is counted unaligned rather than silently credited.
 *
 * @param dayTasks The day's scheduled tasks.
 * @param projects Every project, for resolving names and for the existence
 *                 check. Missing or empty means nothing can be aligned.
 * @returns {{alignedMinutes, totalMinutes, fraction,
 *            byProject: Array<{id, title, minutes}>,
 *            unaligned: Array<object>}} `byProject` is heaviest first;
 *          `unaligned` is the day's own order, so it reads as a to-file list.
 */
export function computeDayAlignment(dayTasks, projects) {
  const known = new Map((projects || []).map((p) => [p.id, p]));
  const minutesById = new Map();
  const unaligned = [];
  let alignedMinutes = 0;
  let totalMinutes = 0;

  for (const t of dayTasks || []) {
    const minutes = dialTaskMinutes(t);
    if (!minutes) continue;
    totalMinutes += minutes;
    const project = t.projectId ? known.get(t.projectId) : null;
    if (project) {
      alignedMinutes += minutes;
      minutesById.set(project.id, (minutesById.get(project.id) || 0) + minutes);
    } else {
      unaligned.push(t);
    }
  }

  unaligned.sort((a, b) => timeToMin(a.startTime) - timeToMin(b.startTime));
  const byProject = [...minutesById.entries()]
    .map(([id, minutes]) => ({ id, title: known.get(id)?.title || '', minutes }))
    .sort((a, b) => b.minutes - a.minutes);

  return {
    alignedMinutes,
    totalMinutes,
    fraction: totalMinutes > 0 ? alignedMinutes / totalMinutes : 0,
    byProject,
    unaligned,
  };
}

/**
 * One project's completion, counted in tasks rather than minutes.
 *
 * Minutes are the dial's unit everywhere else, and deliberately not here: a
 * project's tasks span weeks and most of them are unscheduled, so they carry
 * no duration to weigh. Tasks are the only thing every one of them has.
 *
 * @param project  The project to measure, or null.
 * @param allTasks Every task, scheduled and unscheduled. Filtered here rather
 *                 than by the caller so the count cannot silently narrow to
 *                 one day's worth.
 * @returns {{done, total, fraction, remaining: Array<object>}} `remaining` is
 *          the open tasks, soonest-dated first and undated last.
 */
export function computeProjectProgress(project, allTasks) {
  const mine = (allTasks || []).filter((t) => t && t.projectId === project?.id);
  const remaining = mine.filter((t) => !t.completed);
  // Dated work first, in date order; undated work keeps its own order after
  // it. A project's backlog is mostly undated, so sorting it by a field it
  // does not have would shuffle it arbitrarily on every render.
  remaining.sort((a, b) => {
    const ad = a.deadline || a.date || '';
    const bd = b.deadline || b.date || '';
    if (!ad && !bd) return 0;
    if (!ad) return 1;
    if (!bd) return -1;
    return ad < bd ? -1 : ad > bd ? 1 : 0;
  });
  const done = mine.length - remaining.length;
  return {
    done,
    total: mine.length,
    fraction: mine.length > 0 ? done / mine.length : 0,
    remaining,
  };
}

/** Corners a complication can ride, in the order DialComplications slots them. */
export const COMPLICATION_SLOT_COUNT = 4;

/**
 * The stored slot list, normalised to one entry per corner.
 *
 * Positional from the start, and it always was: the old list of switched-on
 * keys was read straight into the corners in order, so reading a saved value
 * this way puts every existing face back exactly where it was. Anything short
 * is padded with empty corners, anything long is cut.
 *
 * @param stored Whatever came out of storage.
 * @returns An array of COMPLICATION_SLOT_COUNT entries, each a key or null.
 */
export function normaliseComplicationSlots(stored) {
  const from = Array.isArray(stored) ? stored : [];
  return Array.from({ length: COMPLICATION_SLOT_COUNT },
    (_, i) => (typeof from[i] === 'string' && from[i] ? from[i] : null));
}

/**
 * Put `key` in corner `index`, and hand that corner's old occupant to
 * wherever `key` came from.
 *
 * Swapping rather than clearing, because the common edit is "no, that one
 * belongs over there": moving a readout across the face would otherwise mean
 * emptying its old corner first and would silently drop whatever was in the
 * new one. A swap loses nothing and reads as the drag this deliberately is
 * not.
 *
 * @param slots Current slots (normalised).
 * @param index Corner being set.
 * @param key   What to put there, or null to empty it.
 * @returns A new slots array.
 */
export function assignComplicationSlot(slots, index, key) {
  const next = normaliseComplicationSlots(slots);
  if (index < 0 || index >= COMPLICATION_SLOT_COUNT) return next;
  const displaced = next[index];
  const heldAt = key ? next.indexOf(key) : -1;
  next[index] = key || null;
  // Only when it was somewhere else: re-picking a corner's own value is a
  // no-op, not a swap with itself.
  if (heldAt !== -1 && heldAt !== index) next[heldAt] = displaced;
  return next;
}
