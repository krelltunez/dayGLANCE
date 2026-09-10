import { computeDaySummary } from './daySummary.js';
import { deriveBlockEnergy } from './energyAxis.js';
import { taskColorToHex } from './colorUtils.js';
import { getPeakSunElevation, getSunElevation, POLAR_DAY } from './solar.js';

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
  const out = [];
  let cluster = [];
  let clusterEnd = -Infinity;
  let laneEnds = [];

  // One cluster's lane count applies to every block in it, so a wedge keeps
  // the same depth for as long as the pile-up lasts instead of stepping
  // radially mid-cluster.
  const flush = () => {
    for (const b of cluster) out.push({ ...b, laneCount: laneEnds.length });
    cluster = [];
    laneEnds = [];
  };

  for (const b of blocks || []) {
    if (b.startMin >= clusterEnd) {
      flush();
      clusterEnd = b.endMin;
    } else {
      clusterEnd = Math.max(clusterEnd, b.endMin);
    }
    let lane = laneEnds.findIndex((end) => end <= b.startMin);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = b.endMin;
    cluster.push({ ...b, lane });
  }
  flush();
  return out;
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
  // day window, and an overnight spill lands before it.
  const carried = (prevDayTasks || [])
    .filter(timedOnly)
    .map((t) => {
      const startMin = timeToMin(t.startTime);
      const rawEnd = startMin + (t.duration || 0);
      return {
        ...toBlock(t),
        startMin: 0,
        endMin: Math.min(DIAL_DAY_MINUTES, rawEnd - DIAL_DAY_MINUTES),
        startedPrevDay: true,
        startMinTrue: startMin,
      };
    })
    .filter((b) => b.endMin > 0);

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

  const s = Math.min(s0, 0.5);
  const l = 0.73;

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
export function computeDayCompletion(dayTasks) {
  let doneMinutes = 0;
  let totalMinutes = 0;
  const remaining = [];

  for (const t of dayTasks || []) {
    if (!t || t.isAllDay || !t.startTime) continue;
    // Same fixture rule computeDialModel uses: a read-only imported event
    // has no completion to toggle.
    if (t.imported && !t.isTaskCalendar) continue;
    const minutes = Math.max(0, Number(t.duration) || 0);
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
