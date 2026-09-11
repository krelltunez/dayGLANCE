import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, Check, ChevronLeft, ChevronRight, CircleDashed, ExternalLink, Leaf, MoonStar, Sparkles, Timer, Undo2, Zap } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { stripWikilinks } from '../utils/taskUtils.js';
import { formatLocalizedDurationMinutes } from '../utils/localeFormatting.js';
import DialComplications from './DialComplications.jsx';
import {
  DIAL_COLORS,
  DIAL_DAY_MINUTES,
  computeDialModel,
  computeDialRoutines,
  dialArcPath,
  dialIntensity,
  dialLaneBand,
  dialPoint,
  dialSectorPath,
  dialTicks,
  dialDateFits,
  dialLabelYieldsToSun,
  canStartFocusFromBlock,
  findDialFocusBlock,
  focusSpanMinutes,
  initialDialSelection,
  muteDialColor,
  padDialSegment,
  precipRuns,
  stepDialSelection,
} from '../utils/dayDial.js';

// The Day Dial: one day as a 24-hour instrument face. Midnight at top,
// clockwise; the schedule is a ring of translucent wedges whose luminous
// outer edge does the work; the now line is the only moving element and the
// only saturated color. Designed for the squint-from-ten-feet test — mass,
// glow, and the now line survive distance, the detail rewards walking closer.
//
// Deliberately a single dark look, independent of the app theme: this is an
// ambient/wall surface, and emissive-on-dark IS the design. All geometry and
// rollups come from utils/dayDial.js; this file only draws.
//
// SVG rather than canvas: arcs, ticks, and text stay crisp from a phone to a
// 4K wall panel, and the same component serves the PWA, Electron, and any
// kiosk view with no per-platform work.

const CX = 500;
const CY = 500;
const R_EDGE = 385;   // luminous outer edge of the schedule ring
const R_INNER = 300;  // inner edge of the wedge band
const R_BEZEL = 424;  // faint chapter ring
const TICKS = dialTicks();

// Tick geometry by kind: one color, three opacities — the cheapest thing
// that makes a dial read as engineered rather than illustrated.
// All-day chip budget, in px: what one chip costs (its dot, gap, and a
// title truncated to max-w-[8rem]) and what the pill spends on its own icon
// and padding. Used to decide how many chips fit before the rest collapse
// into a "+N" — measured against the pill's track, never guessed from a
// viewport breakpoint, because the free width depends on the legend's own
// localized width.
const ALLDAY_CHIP_PX = 110;
const ALLDAY_PILL_CHROME_PX = 80;
// The breathing space between the two pills, straddling the dial's axis.
const ALLDAY_SEAM_GAP_PX = 12;
// The legend shell's own horizontal padding (px-8), added back to its
// measured content to get the width the whole pill wants.
const LEGEND_PILL_PADDING_PX = 64;

const TICK_STYLE = {
  hour:    { r1: 400, r2: 436, width: 2.5, opacity: 0.45 },
  quarter: { r1: 404, r2: 428, width: 1.6, opacity: 0.22 },
  minor:   { r1: 407, r2: 421, width: 1.0, opacity: 0.10 },
};

// Routine track: solid teal bars on their own radius inside the tick field,
// each as long along the ring as the routine is scheduled for (the default
// is 15 minutes, but it is editable in 15-minute steps, so a routine can run
// hours). Teal because that is what a routine already looks like everywhere
// else in the app — the planner draws one as a teal crosshair with a name
// pill, and this is that idiom in polar form.
//
// Kept deliberately quiet: the schedule ring is what the dial is FOR, so the
// bars sit well below it in weight (0.5 against the wedges' 0.45–1.0 edge)
// and only step forward when pointed at. The band is inside the tick field,
// where a mark reads as part of the instrument's own scale rather than as
// something laid over the schedule.
const ROUTINE_COLOR = '#5eead4';   // teal-300, the app's routine colour
const R_ROUTINE_BAND = [404, 432]; // inside the tick field (400–436)

// Daylight rides just inside the schedule ring, among the weather it belongs
// with: the temps are at 250 and the precipitation arc at 292, so this sits
// with them rather than out in the tick field, where the ticks stripe
// straight through a band and it reads as a highlighter mark on a scale.
// The outer edge tucks two units UNDER the wedges (drawn beneath them), which
// is what makes the band feel attached to the ring instead of floating below.
const R_DAYLIGHT_BAND = [282, 302];
const DAYLIGHT_COLOR = '#fcd34d';
// Feathered rather than cut: three concentric sub-bands, the outer two at a
// third strength, so the band has no hard radial edge to read as an object.
const DAYLIGHT_FEATHER = [[0, 0.25, 0.35], [0.25, 0.75, 1], [0.75, 1, 0.35]];

// Focus sessions ride a rail INSIDE the schedule band, not beside it: focus
// mode can only run inside a block that is already on the ring, so the mark
// belongs to that block rather than to a track of its own. 307 clears the
// wedge's own inner edge stroke — a rail sitting exactly on it reads as the
// edge rather than as a separate fact, which is what ruled out the effort
// blue in the mock (it is that stroke's colour).
const R_FOCUS_RAIL = [307, 315];
// Neutral rather than a sixth hue: orange is now, teal routines, violet
// sleep, amber daylight, and the wedges carry the task palette.
const FOCUS_COLOR = '#ffffff';
const FOCUS_OPACITY = 0.42;

const ROUTINE_WEIGHT = 14;
const ROUTINE_OPACITY = 0.5;
const ROUTINE_DONE_OPACITY = 0.18;
const ROUTINE_LIT_OPACITY = 0.95;

// The now line's trailing falloff: a radar-sweep afterglow — a faint wash
// across the whole ring band fading out over the previous hour. An area,
// deliberately not a stroke: an earlier version drew the trail as arcs on
// the segments' own edge radius, where it collided with their luminous
// edges into a muddy blend and read as a detached element. Built from
// overlapping sectors that all end at the needle (SVG has no conic
// gradient): each adds a whisper of opacity, so coverage accumulates
// smoothly toward the needle with no visible banding.
const TRAIL_MINUTES = 60;
const TRAIL_STEPS = 15;
const TRAIL_STEP_OPACITY = 0.011; // ≈0.15 cumulative at the needle

// Chapter labels every 3 hours. Cardinals (12/6 o'clock axes) carry full
// weight; the intermediate hours step down in size and opacity — same
// hierarchy rule as the ticks, so density never turns into noise. The two
// side labels (6 AM / 6 PM) are the only ones that need horizontal margin
// beyond the dial; compact mode drops them entirely and gives that margin
// back to the dial.
const HOUR_LABELS = Array.from({ length: 8 }, (_, i) => {
  const h = i * 3;
  return {
    min: h * 60,
    cardinal: h % 6 === 0,
    side: h === 6 || h === 18,
    h24: String(h).padStart(2, '0'),
    h12: `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'AM' : 'PM'}`,
  };
});

function TickField() {
  return (
    <g stroke="#ffffff" strokeLinecap="butt">
      {TICKS.map(({ min, kind }) => {
        const s = TICK_STYLE[kind];
        const p1 = dialPoint(CX, CY, s.r1, min);
        const p2 = dialPoint(CX, CY, s.r2, min);
        return (
          <line
            key={min}
            x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y}
            strokeWidth={s.width} strokeOpacity={s.opacity}
          />
        );
      })}
    </g>
  );
}

function Segment({
  startMin, endMin, color, fillMute = 1, edgeMute = 1, padStart = true, padEnd = true,
  rInner = R_INNER, rOuter = R_EDGE, selected = false, onEnter, onLeave, onTap,
}) {
  const [s, e] = padDialSegment(startMin, endMin, 3, padStart, padEnd);
  if (e <= s) return null;
  const { fillOpacity, edgeOpacity, edgeWidth } = dialIntensity(endMin - startMin);
  const edge = dialArcPath(CX, CY, rOuter, s, e);
  // Selection — hover, tap, or the keyboard's roving selection — lights the
  // wedge: full luminous edge plus a hairline tracing the whole sector, so
  // a short block still reads as chosen. It overrides the dim tier too; a
  // selected past block has to answer, and this doubles as the keyboard
  // focus indicator (the listbox itself draws nothing).
  const lit = selected ? 1 : fillMute;
  const edgeAlpha = selected ? 1 : edgeOpacity * edgeMute;
  return (
    <g
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onClick={onTap}
      style={onTap ? { cursor: 'pointer' } : undefined}
    >
      <path
        d={dialSectorPath(CX, CY, rInner, rOuter, s, e)}
        fill={color}
        fillOpacity={fillOpacity * lit}
      />
      {/* Soft halo under the crisp edge — one glowing rim reads better at
          distance than any texture. */}
      <path
        d={edge}
        fill="none" stroke={color} strokeLinecap="round"
        strokeWidth={edgeWidth * 2.4} strokeOpacity={0.35 * edgeAlpha}
        filter="url(#dial-glow)"
      />
      <path
        d={edge}
        fill="none" stroke={color} strokeLinecap="round"
        strokeWidth={edgeWidth} strokeOpacity={edgeAlpha}
      />
      {selected && (
        <path
          d={dialSectorPath(CX, CY, rInner, rOuter, s, e)}
          fill="none" stroke="#ffffff" strokeOpacity={0.45} strokeWidth={1.5}
        />
      )}
    </g>
  );
}

// Sunrise/sunset hairline: a single radial stroke spanning the ring band,
// with a one-weight line glyph at the outer tip naming the event — sun for
// rise, moon for set (lucide geometry, so it matches the app's icon
// language; line icons at one weight, never emoji). Dawn is warm amber,
// dusk a cool moonlight blue — the temperature split mirrors the events
// themselves, and both stay at hairline opacity so neither competes with
// the schedule. The overshoot past the bezel lets each mark read as an
// astronomical datum rather than another schedule edge.
const SUN_COLOR = '#fbbf24';  // amber-400 — sunrise
const MOON_COLOR = '#7dd3fc'; // sky-300 — sunset; cooler and greener than the
                              // effort blue (#93c5fd) so the two never read
                              // as the same layer
const SUN_GLYPH_R = 456;     // glyph center: past the bezel, inside the hour labels
const GLYPH_SCALE = 0.9;     // lucide 24-unit grid → ~22 viewBox units

// Lucide 'sun': core circle + 8 rays, one path.
const SUN_RAYS =
  'M12 2v2 M12 20v2 M4.93 4.93l1.41 1.41 M17.66 17.66l1.41 1.41 ' +
  'M2 12h2 M20 12h2 M6.34 17.66l-1.41 1.41 M19.07 4.93l-1.41 1.41';
// Lucide 'moon': the crescent.
const MOON_PATH = 'M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z';

function SunMark({ min, kind }) {
  const p1 = dialPoint(CX, CY, R_INNER - 12, min);
  const p2 = dialPoint(CX, CY, R_BEZEL + 8, min);
  const g = dialPoint(CX, CY, SUN_GLYPH_R, min);
  return (
    <g stroke={kind === 'rise' ? SUN_COLOR : MOON_COLOR} strokeOpacity={0.55} fill="none" strokeLinecap="round">
      <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} strokeWidth={1.5} />
      <g
        strokeWidth={2}
        strokeLinejoin="round"
        transform={`translate(${(g.x - 12 * GLYPH_SCALE).toFixed(2)} ${(g.y - 12 * GLYPH_SCALE).toFixed(2)}) scale(${GLYPH_SCALE})`}
      >
        {kind === 'rise'
          ? <><circle cx="12" cy="12" r="4" /><path d={SUN_RAYS} /></>
          : <path d={MOON_PATH} />}
      </g>
    </g>
  );
}

// Weather ring: hour temperatures as quiet monochrome numerals at the
// 3-hour stations on an inner radius, and precipitation spells as a thin
// arc hugging the band's inner edge — solid for rain, dashed for snow —
// with one line glyph per spell at its center. Deliberately no per-hour
// condition icons and no temperature color ramp: numbers stay data, the
// palette stays the schedule's, and precipitation is the one condition
// that earns ink. Temps sit at r=250, inside the needle's root (265), so
// the moving element never crosses them.
const TEMP_R = 250;
const PRECIP_ARC_R = 292;
const PRECIP_GLYPH_R = 268;

// Lucide 'droplet'; snow is three crossed one-weight lines (a 6-spoke
// star) — lucide's snowflake is too dense at this size.
const DROPLET_PATH =
  'M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z';
const SNOW_PATHS = 'M12 3v18 M4.2 7.5l15.6 9 M19.8 7.5l-15.6 9';

function WeatherRing({ hourly }) {
  const runs = precipRuns(hourly);
  const glyphScale = 0.55;
  return (
    <g>
      {HOUR_LABELS.map(({ min }) => {
        const entry = hourly[min / 60];
        if (!entry || !Number.isFinite(entry.temp)) return null;
        const p = dialPoint(CX, CY, TEMP_R, min);
        return (
          <text
            key={min}
            x={p.x} y={p.y}
            textAnchor="middle" dominantBaseline="central"
            fill="#ffffff" fillOpacity={0.32}
            style={{ fontSize: 16, fontWeight: 500 }}
          >
            {entry.temp}°
          </text>
        );
      })}
      {runs.map((run) => {
        const mid = (run.startMin + run.endMin) / 2;
        const g = dialPoint(CX, CY, PRECIP_GLYPH_R, mid);
        return (
          <g
            key={`${run.kind}-${run.startMin}`}
            stroke="#ffffff" strokeOpacity={0.3} fill="none" strokeLinecap="round"
          >
            <path
              d={dialArcPath(CX, CY, PRECIP_ARC_R, run.startMin + 4, run.endMin - 4)}
              strokeWidth={2.5}
              strokeDasharray={run.kind === 'snow' ? '2 7' : undefined}
            />
            <g
              strokeWidth={2.6} strokeLinejoin="round"
              transform={`translate(${(g.x - 12 * glyphScale).toFixed(2)} ${(g.y - 12 * glyphScale).toFixed(2)}) scale(${glyphScale})`}
            >
              <path d={run.kind === 'rain' ? DROPLET_PATH : SNOW_PATHS} />
            </g>
          </g>
        );
      })}
    </g>
  );
}

/**
 * The lit part of the day. Each step is a 4-minute arc (1° of dial) carrying
 * its own opacity, so the band brightens toward solar noon and fades back to
 * the floor at the horizons — where it meets the sunrise and sunset
 * hairlines, which come from the same solar solution.
 */
function DaylightBand({ steps }) {
  const [r0, r1] = R_DAYLIGHT_BAND;
  return (
    <g fill={DAYLIGHT_COLOR}>
      {steps.map((step) => DAYLIGHT_FEATHER.map(([a, b, weight]) => (
        <path
          key={`${step.startMin}-${a}`}
          // Steps overlap by a hair; butted arcs leave hairline seams.
          d={dialSectorPath(CX, CY, r0 + (r1 - r0) * a, r0 + (r1 - r0) * b,
            step.startMin, step.endMin + 0.6)}
          // Rounded: the raw product is float noise (0.2 x 0.35 prints as
          // 0.06999999999999999) and there are hundreds of these paths.
          fillOpacity={Math.round(step.opacity * weight * 1e4) / 1e4}
        />
      )))}
    </g>
  );
}

/**
 * Where the day's focus sessions actually landed, as a rail inside the
 * schedule band. Drawn over the wedges: the point is which part of a block
 * the work happened in, so it has to read against that block's fill.
 *
 * Overlapping blocks take lanes, but the rail does not — a session is a
 * stretch of the day's clock, not a claim about which of two stacked blocks
 * it belonged to, so one rail at one radius is the honest depth.
 */
function FocusRail({ spans }) {
  const [r0, r1] = R_FOCUS_RAIL;
  return (
    <g fill={FOCUS_COLOR} fillOpacity={FOCUS_OPACITY}>
      {spans.map((span) => (
        <path
          key={span.startMin}
          d={dialSectorPath(CX, CY, r0, r1, span.startMin, span.endMin)}
        />
      ))}
    </g>
  );
}

/**
 * The routine bars. Overlapping routines take lanes in the band exactly as
 * overlapping blocks do on the ring — dialLaneBand splits the track, and a
 * bar is stroked along its lane's centre line so its weight IS the lane's
 * depth (capped, so a single lane never fattens past ROUTINE_WEIGHT).
 */
function RoutineBars({ bars, selectedId, onEnter, onLeave, onTap }) {
  return (
    <g>
      {bars.map((r) => {
        const band = dialLaneBand(R_ROUTINE_BAND[0], R_ROUTINE_BAND[1], r.lane, r.laneCount);
        const mid = (band.rInner + band.rOuter) / 2;
        const weight = Math.min(ROUTINE_WEIGHT, band.rOuter - band.rInner);
        const d = dialArcPath(CX, CY, mid, r.startMin, r.endMin);
        const lit = selectedId === r.id
          ? ROUTINE_LIT_OPACITY
          : (r.completed ? ROUTINE_DONE_OPACITY : ROUTINE_OPACITY);
        return (
          <g
            key={r.id}
            onMouseEnter={() => onEnter(r)}
            onMouseLeave={onLeave}
            onClick={() => onTap(r)}
            style={{ cursor: 'pointer' }}
          >
            {/* A hit area wider than the bar: a 15-minute routine is a short
                capsule, and it still has to be easy to point at. */}
            <path
              d={d} fill="none" stroke="transparent"
              strokeWidth={weight + 16} strokeLinecap="round"
            />
            <path
              d={d} fill="none" stroke={ROUTINE_COLOR} strokeOpacity={lit}
              strokeWidth={weight} strokeLinecap="round"
            />
          </g>
        );
      })}
    </g>
  );
}

// Hub titles: #tags step back — italic, smaller, muted — so the title
// itself carries the highlight.
const splitHubTitle = (title) => {
  const stripped = stripWikilinks(title || '');
  const tags = stripped.match(/#\p{L}[\p{L}\p{N}_]*/gu) || [];
  const text = stripped.replace(/#\p{L}[\p{L}\p{N}_]*/gu, '').replace(/\s+/g, ' ').trim();
  return { text, tags };
};
const renderHubTitle = (title) => splitHubTitle(title).text;
const renderHubTags = (title) => {
  const { tags } = splitHubTitle(title);
  if (!tags.length) return null;
  return (
    <div className="italic text-[clamp(10px,1.6vmin,14px)] text-white/45 mt-0.5">
      {tags.join(' ')}
    </div>
  );
};

function NowLine({ nowMin }) {
  const deg = (nowMin / 1440) * 360;
  const dot = dialPoint(CX, CY, R_EDGE, nowMin);
  return (
    // Decorative throughout, and it sits ON TOP of the wedges: without this
    // the afterglow sectors swallow taps for the whole hour behind the
    // needle, which is precisely the part of the running block someone
    // reaches for to start a focus session.
    <g pointerEvents="none">
      {/* Radar-sweep afterglow: every sector ends at the needle, each one
          starting closer to it, so their tiny opacities stack into a smooth
          ramp — brightest just behind the needle, gone an hour back. */}
      {Array.from({ length: TRAIL_STEPS }, (_, i) => {
        const a = Math.max(0, nowMin - (TRAIL_MINUTES / TRAIL_STEPS) * (i + 1));
        if (a >= nowMin) return null;
        return (
          <path
            key={i}
            d={dialSectorPath(CX, CY, R_INNER, R_EDGE, a, nowMin)}
            fill={DIAL_COLORS.now}
            fillOpacity={TRAIL_STEP_OPACITY}
          />
        );
      })}
      {/* The radius itself rides a rotated group so the minute tick animates
          as a sweep instead of a jump. */}
      <g
        style={{
          transform: `rotate(${deg}deg)`,
          transformOrigin: `${CX}px ${CY}px`,
          transition: 'transform 1.5s cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      >
        {/* Rooted just inside the ring band, never in the hub: the needle
            is a pointer onto the schedule, and the hub's typography stays
            untouched at every dial size (the hub is HTML with minimum font
            sizes, so on small dials its text spans a larger share of the
            viewBox — r=265 clears it even at phone scale). */}
        <line
          x1={CX} y1={CY - 265} x2={CX} y2={CY - R_BEZEL + 14}
          stroke={DIAL_COLORS.now} strokeWidth={3} strokeLinecap="round"
          strokeOpacity={0.9}
        />
      </g>
      {/* Leading dot where the line crosses the event ring. */}
      <circle
        cx={dot.x} cy={dot.y} r={13}
        fill={DIAL_COLORS.now} fillOpacity={0.28} filter="url(#dial-glow)"
        style={{ transition: 'cx 1.5s, cy 1.5s' }}
      />
      <circle
        cx={dot.x} cy={dot.y} r={7} fill={DIAL_COLORS.now}
        style={{ transition: 'cx 1.5s, cy 1.5s' }}
      />
    </g>
  );
}

/**
 * @param dayTasks        The date's tasks (getTasksForDate shape).
 * @param dayWindow       Resolved {start, stop} markers for the date, or null.
 * @param prevDayTasks    The previous date's tasks, for blocks that ran past
 *                        midnight into this one. Null omits the carry-over.
 * @param date            Date object the dial describes (hub typography).
 * @param nowMin          Minutes-since-midnight for the now line, or null to
 *                        hide it (viewing a day other than today).
 * @param formatTime      App-level 'HH:MM' → display formatter (12/24h aware).
 * @param use24HourClock  Picks the cardinal hour label set.
 * @param sun             {sunriseMin, sunsetMin} minutes-of-day (either may
 *                        be null in polar seasons), or null to omit the
 *                        solar layer entirely (no location known).
 */
const DayDial = ({ dayTasks, prevDayTasks = null, routines = null, routineCompletions = null, daylight = null, focusSpans = null, onStartFocus = null, complications = null, onOpenTask = null, onToggleTaskComplete = null, onSetHabitCount = null, onIncrementHabit = null, dayWindow, date, nowMin = null, dayIsPast = false, formatTime, use24HourClock = false, sun = null, hourlyWeather = null, onToggleComplete = null, onOpenInPlanner = null, onStepDay = null, onGoToday = null, chromeVisible = true }) => {
  const { t, i18n } = useTranslation();
  const formatMinutes = (minutes) => formatLocalizedDurationMinutes(minutes, i18n.resolvedLanguage || i18n.language);

  const model = useMemo(
    () => computeDialModel(dayTasks, dayWindow, prevDayTasks),
    [dayTasks, dayWindow, prevDayTasks],
  );

  // Today's routines as bars for the outer track. Null on any other date —
  // routines only exist for today (useRoutines rolls them at midnight), and
  // the dial never fakes a layer it cannot honestly draw.
  const routineBars = useMemo(
    () => computeDialRoutines(routines, routineCompletions),
    [routines, routineCompletions],
  );

  // Everything the arrow keys can walk, in one time-ordered list: the ring's
  // blocks and the routine bars together, so a routine is not a thing only a
  // mouse can reach.
  const selectable = useMemo(
    () => [...model.blocks, ...routineBars].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin),
    [model.blocks, routineBars],
  );

  // Paint inner lanes first: the glow filter spreads past a lane's own band,
  // so the outermost (most specific — see assignDialLanes) wedge has to lay
  // its crisp edge down last.
  const laneOrdered = useMemo(
    () => [...model.blocks].sort((a, b) => a.lane - b.lane),
    [model.blocks],
  );

  const focus = nowMin !== null ? findDialFocusBlock(model.blocks, nowMin) : null;

  // Block inspection: hover or tap a wedge and the hub becomes its readout,
  // reverting to the live display after a beat. Details render in the hub
  // rather than a floating tooltip — the hub IS the instrument's readout,
  // and a tooltip would be foreign chrome on a dial face. Hover holds while
  // the pointer stays; a tap (no hover on touch) gets a fixed dwell.
  const [inspected, setInspected] = useState(null);
  const inspectTimerRef = useRef(null);
  const scheduleInspectClear = (ms) => {
    clearTimeout(inspectTimerRef.current);
    inspectTimerRef.current = setTimeout(() => setInspected(null), ms);
  };
  const inspectEnter = (b) => { clearTimeout(inspectTimerRef.current); setInspected(b); };
  const inspectLeave = () => scheduleInspectClear(1200);
  useEffect(() => () => clearTimeout(inspectTimerRef.current), []);

  // Action sheet: tap = read, tap the same block again = act. (On desktop,
  // hover already inspects, so the first click acts.) The sheet stays in
  // the dial's register — completing from the couch is the point — and
  // "open in planner" is a listed action, never a side effect of touching
  // the glass, so a kiosk can't fall out of the dial by accident. It
  // self-dismisses after a quiet while for the same reason.
  const [sheetBlock, setSheetBlock] = useState(null);
  const sheetTimerRef = useRef(null);
  // Whether this sheet was opened from the keyboard — decides whether it
  // takes focus on open and hands it back on close. A pointer user who
  // never left the glass should not suddenly acquire a focused element.
  const sheetFromKeyRef = useRef(false);
  const openSheet = (b, fromKey = false) => {
    sheetFromKeyRef.current = fromKey;
    setSheetBlock(b);
    clearTimeout(sheetTimerRef.current);
    sheetTimerRef.current = setTimeout(() => setSheetBlock(null), 20_000);
  };
  const closeSheet = () => { clearTimeout(sheetTimerRef.current); setSheetBlock(null); };
  useEffect(() => () => clearTimeout(sheetTimerRef.current), []);

  const inspectTap = (b) => {
    if (inspected?.id === b.id) { openSheet(b); return; }
    clearTimeout(inspectTimerRef.current);
    setInspected(b);
    scheduleInspectClear(4000);
  };

  // Keyboard access to the ring. The wedges live inside an SVG that AT sees
  // as a single image (role="img" prunes its descendants), and they were
  // pointer-only — so completing a block from the keyboard was impossible.
  // Rather than make each wedge a tab stop, the ring is ONE listbox with a
  // roving selection: the same `inspected` state hover already drives, so
  // the hub narrates it and the wedge lights up for free. Selection made
  // this way is persistent — no dwell timer, unlike hover and tap.
  const listRef = useRef(null);
  const selectBlock = (b) => { if (b) inspectEnter(b); };
  const clearSelection = () => { clearTimeout(inspectTimerRef.current); setInspected(null); };

  // Live model + clock for effects that must not re-run on every minute
  // tick (the ref is written during render, as App.jsx does for the dial's
  // own open state).
  const liveRef = useRef(null);
  liveRef.current = { blocks: selectable, nowMin };

  // Paging to another date drops the selection with it — but if the ring
  // still holds focus, re-arm on the new day: a focused ring must never be
  // left without its visible indicator.
  useEffect(() => {
    setSheetBlock(null);
    const focused = typeof document !== 'undefined' && listRef.current === document.activeElement;
    setInspected(focused ? initialDialSelection(liveRef.current.blocks, liveRef.current.nowMin) : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  // The moves themselves, shared by the listbox's own handler and the
  // document-level one below. Reads live state from refs so the mount-once
  // listener never works from a stale day. Returns whether the key was ours.
  const inspectedRef = useRef(null);
  inspectedRef.current = inspected;
  const navigateByKey = (key) => {
    const { blocks, nowMin: liveNow } = liveRef.current;
    if (!blocks.length) return false;
    const current = inspectedRef.current;
    // Arriving from nothing lands on the block the hub is already
    // narrating, never on the top of the day.
    const move = (delta) => selectBlock(current
      ? stepDialSelection(blocks, current.id, delta)
      : initialDialSelection(blocks, liveNow));
    switch (key) {
      // Up/down, not left/right: those page the day at the overlay level,
      // and the schedule answers as the vertical list a listbox always is.
      case 'ArrowDown': move(1); return true;
      case 'ArrowUp': move(-1); return true;
      case 'Home': selectBlock(blocks[0]); return true;
      case 'End': selectBlock(blocks[blocks.length - 1]); return true;
      default: return false;
    }
  };

  const onListKeyDown = (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (!navigateByKey(e.key)) {
      switch (e.key) {
        case 'Enter':
        case ' ':
          if (!inspected) return;
          openSheet(inspected, true);
          break;
        case 'Escape':
          // Only our rung of the Escape ladder: with nothing selected the
          // press belongs to the overlay (leave fullscreen, then close).
          if (!inspected) return;
          clearSelection();
          break;
        default: return;
      }
    }
    e.preventDefault();
    e.stopPropagation();
  };

  // Entering keyboard mode must not cost a single Tab. The dial is a
  // fullscreen, single-purpose overlay, so up/down anywhere in it means
  // "walk my blocks": the ring takes focus and the selection starts. Without
  // this the ring is the LAST focusable in the overlay — reaching it meant
  // tabbing through every corner button first, and finding it again after
  // leaving was worse. A sheet or the layers panel owns the keyboard while
  // it is up. (When the ring already holds focus its own handler runs first
  // and stops propagation, so this never double-steps.)
  const keyEntryRef = useRef(false);
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      if (document.querySelector('[role="dialog"]')) return;
      if (!navigateByKey(e.key)) return;
      e.preventDefault();
      const list = listRef.current;
      if (list && list !== document.activeElement) {
        // The selection is already set; suppress the focus handler's own
        // entry pick so Home/End are not overridden by it.
        keyEntryRef.current = true;
        list.focus();
        keyEntryRef.current = false;
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tabbing in lands on the block the hub is already narrating, so there is
  // always a visible indicator while the ring holds focus.
  const onListFocus = (e) => {
    if (e.target !== e.currentTarget) return;
    if (keyEntryRef.current) return;
    if (!inspected) selectBlock(initialDialSelection(selectable, nowMin));
  };
  const onListBlur = (e) => {
    // Focus moving into the action sheet is not leaving the ring — that
    // selection is exactly what the sheet is about.
    if (sheetBlock) return;
    if (e.currentTarget.contains(e.relatedTarget)) return;
    clearSelection();
  };

  // Keyboard flow through the sheet: focus its first action, trap Tab while
  // it is up (capture phase, so focus can never wander to the chrome
  // behind it), and hand focus back to the ring when it goes away —
  // including when it self-dismisses on its own timer.
  const sheetRef = useRef(null);
  useEffect(() => {
    if (!sheetBlock) return undefined;
    // The listbox node is stable across renders; capture it so the cleanup
    // does not read a ref that may have been detached by then.
    const list = listRef.current;
    const buttons = () => Array.from(sheetRef.current?.querySelectorAll('button') || []);
    if (sheetFromKeyRef.current) buttons()[0]?.focus();
    const onKeyDown = (e) => {
      if (e.key !== 'Tab') return;
      const items = buttons();
      if (!items.length) return;
      e.preventDefault();
      const i = items.indexOf(document.activeElement);
      const next = e.shiftKey
        ? (i <= 0 ? items.length - 1 : i - 1)
        : (i === -1 || i === items.length - 1 ? 0 : i + 1);
      items[next]?.focus();
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      if (sheetFromKeyRef.current && list?.isConnected) list.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheetBlock]);

  // Esc closes the sheet before anything above it (capture phase, so the
  // overlay's own Escape-closes-the-dial handler never sees this press).
  useEffect(() => {
    if (!sheetBlock) return undefined;
    const onKeyDown = (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      closeSheet();
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheetBlock]);

  // A block's real hours on today's clock, which for a block crossing
  // midnight run outside 0–1440: a carried block started before 0, and one
  // ending tomorrow ends past 1440. Every phrase below measures from these,
  // never from the clipped geometry, so "1h left" at 23:30 of a 23:00–01:00
  // block says 1h 30m rather than half an hour.
  const startsAt = (b) => (b.startedPrevDay ? b.startMinTrue - DIAL_DAY_MINUTES : b.startMin);
  const endsAt = (b) => (b.endsNextDay ? DIAL_DAY_MINUTES + b.endMinTrue : b.endMin);
  const blockMinutes = (b) => endsAt(b) - startsAt(b);

  // Relative clock phrase for a block, from the same minute tick as the now
  // line: "45m left" while running, "in 2h 10m" ahead, "ended 1h ago" behind.
  const relLabel = (b) => {
    if (nowMin === null) return null;
    if (startsAt(b) <= nowMin && nowMin < endsAt(b)) {
      return t('dial.timeLeft', '{{left}} left', { left: formatMinutes(endsAt(b) - nowMin) });
    }
    if (startsAt(b) > nowMin) {
      return t('dial.startsIn', 'in {{in}}', { in: formatMinutes(startsAt(b) - nowMin) });
    }
    return t('dial.endedAgo', 'ended {{ago}} ago', { ago: formatMinutes(nowMin - endsAt(b)) });
  };

  // Time flows brightest ahead: a segment wholly behind the now line drops
  // to the dim tier, so the remaining day carries the light and the ring
  // reads as "what's left" from across the room. On other days the whole
  // dial takes one tier — dim for a past date, bright for a future one.
  const isPast = (endMin) => (nowMin !== null ? endMin <= nowMin : dayIsPast);
  // Recede, don't erase: 0.6 keeps the spent day legible as history — late
  // in the evening most of the ring is past, and a harsher tier would
  // blank it entirely.
  const PAST_MUTE = 0.6;
  // Three states behind the ring, told apart by weight alone (never
  // pattern): a block you FINISHED settles into a quiet filled mass, its
  // rim nearly gone — done is not news. One that is merely over, with
  // nothing to tick (a meeting that happened), recedes evenly as before.
  // And one you could have completed and did not keeps its rim at full
  // strength over a hollowed fill, so what is still owed stays legible in
  // the spent part of the ring. That last tier is today's business only:
  // on another date nothing is live to owe, and the whole ring takes one
  // tier as it always has.
  const DONE_EDGE_MUTE = 0.25;
  const UNDONE_FILL_MUTE = 0.35;
  const blockTone = (b) => {
    if (b.completed) return { fill: PAST_MUTE, edge: DONE_EDGE_MUTE };
    const past = nowMin !== null ? endsAt(b) <= nowMin : dayIsPast;
    if (!past) return { fill: 1, edge: 1 };
    // Yesterday's overrun is history the moment it ends: it explains this
    // morning, but it is never something THIS day still owes — it will make
    // its own case on the dial of the day it belongs to.
    if (nowMin !== null && b.completable && !b.startedPrevDay) {
      return { fill: UNDONE_FILL_MUTE, edge: 1 };
    }
    return { fill: PAST_MUTE, edge: PAST_MUTE };
  };
  // Sleep is context, never schedule: even the coming night sits a step
  // below the day's events.
  const SLEEP_MUTE = 0.6;

  const minToHHMM = (m) =>
    `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

  // Clock text for a block in its TRUE hours, with the calendar's own ±1
  // marker on whichever side lands on another date. A block ending exactly
  // at 24:00 is marked too: it ends at the next day's 00:00, and "24:00" is
  // not a time any of the app's formatters should be asked to print.
  const blockClock = (b) => ({
    startText: formatTime(minToHHMM(b.startedPrevDay ? b.startMinTrue : b.startMin)),
    endText: formatTime(minToHHMM((b.endsNextDay ? b.endMinTrue : b.endMin) % DIAL_DAY_MINUTES)),
    startsBefore: !!b.startedPrevDay,
    endsAfter: !!b.endsNextDay || b.endMin === DIAL_DAY_MINUTES,
  });
  // A plain function, not a nested component: it is only ever called, and a
  // component defined mid-render would remount its subtree every time.
  const renderBlockRange = (b) => {
    const c = blockClock(b);
    const mark = (text) => <sup className="text-white/30 ml-0.5">{text}</sup>;
    return (
      <>
        {c.startText}{c.startsBefore && mark('−1')}
        {' – '}
        {c.endText}{c.endsAfter && mark('+1')}
      </>
    );
  };

  // What a screen reader says for one block: the same facts the hub shows,
  // as one sentence. Tags stay in (unlike the hub, which sets them aside
  // typographically — there is no typography in an option label), and the
  // commas give the reader its pauses.
  const blockA11yLabel = (b) => {
    const c = blockClock(b);
    return [
      stripWikilinks(b.title),
      b.isRoutine ? t('dial.routine', 'routine') : null,
      `${c.startText} – ${c.endText}`,
      // Words, not the visual ±1: a screen reader should not have to
      // interpret a superscript.
      c.startsBefore ? t('dial.startedPrevDay', 'started the day before') : null,
      c.endsAfter ? t('dial.endsNextDay', 'ends the next day') : null,
      formatMinutes(blockMinutes(b)),
      b.completed ? t('dial.completed', 'completed') : relLabel(b),
    ].filter(Boolean).join(', ');
  };

  // Option ids must survive any task id (recurring instances carry
  // separators); only whitespace is unusable in an HTML id.
  const optionId = (id) => `dial-opt-${String(id).replace(/\s+/g, '_')}`;

  const weekday = date.toLocaleDateString(i18n.language, { weekday: 'long' });
  const dateLabel = date.toLocaleDateString(i18n.language, { month: 'long', day: 'numeric' });
  // The same date with the month abbreviated, for when the long form would
  // reach the weather temps. Locale-formatted, so every language abbreviates
  // the way it abbreviates rather than being truncated.
  const dateLabelShort = date.toLocaleDateString(i18n.language, { month: 'short', day: 'numeric' });

  // Compact when the component is width-constrained (portrait-ish): there,
  // the side labels and their viewBox margin cost actual dial diameter, so
  // both go. In a height-constrained container the margin only letterboxes
  // and everything stays. Measured, not media-queried — the same component
  // must judge a phone, a tray popup, and a rotated wall panel correctly.
  //
  // CRITICAL: the observed element must be the OUTER box (dial + legend),
  // never the inner dial area. Compact changes the legend's height (row vs
  // 2x2 grid), so measuring anything the legend's size feeds into creates a
  // feedback loop: near the threshold the mode flips every frame — a
  // sustained visible flicker across a ~45px window-width band.
  // The dial's drawn size, for anything positioned against the face itself
  // (the complication slots). The area's box is imposed by the parent flex,
  // so nothing inside it can feed back into this measurement.
  const areaRef = useRef(null);
  const [areaBox, setAreaBox] = useState(null);
  useEffect(() => {
    const el = areaRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setAreaBox((prev) => (prev && prev.width === width && prev.height === height
        ? prev
        : { width, height }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Width of the date's LONG form, measured off a hidden twin that always
  // renders it. Measuring the visible line instead would let an abbreviation
  // that fits flip the decision straight back — this probe's width depends
  // only on the font and the viewport, never on what we chose to show.
  const dateProbeRef = useRef(null);
  const [dateLongPx, setDateLongPx] = useState(null);
  useLayoutEffect(() => {
    const el = dateProbeRef.current;
    if (!el) return undefined;
    const read = () => setDateLongPx((prev) => {
      const w = el.getBoundingClientRect().width;
      return prev !== null && Math.abs(prev - w) < 0.5 ? prev : w;
    });
    read(); // before paint, so the full date never flashes then shrinks
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [dateLabel]);

  const wrapRef = useRef(null);
  const [wrapBox, setWrapBox] = useState(null);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setWrapBox((prev) => (prev && prev.width === width && prev.height === height
        ? prev
        : { width, height }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const compact = !!wrapBox && wrapBox.width < wrapBox.height;

  // The dial's drawn diameter, shared by everything sized against the face.
  const dialPx = areaBox
    ? Math.min(areaBox.height, areaBox.width / (compact ? 1 : 1.12))
    : null;


  // The all-day pill is sized against the LEGEND, never against its own
  // content: it takes the legend's width as a ceiling, so the two read as a
  // matched pair — flanking the centre line in landscape, stacked in
  // compact — instead of one panel ballooning past the other. Room is the
  // narrower of that ceiling and the track the pill actually has.
  //
  // Both measured widths are independent of what the pill decides to show
  // (the legend is sized by its own totals; the track is minmax(0,1fr) of
  // the band), so this cannot feed back into itself — the loop this file
  // already warns about for compact mode.
  const hasAllDay = model.allDay.length > 0;
  const allDayCellRef = useRef(null);
  const legendRef = useRef(null);
  const [bandMetrics, setBandMetrics] = useState(null);
  useEffect(() => {
    if (!hasAllDay || typeof ResizeObserver === 'undefined') return undefined;
    const measure = () => {
      // legendRef sits on the legend's inner w-max box, so this is its
      // NATURAL width whatever the shell around it is doing — the figure
      // the seam test needs, and one that cannot change with what the pill
      // decides to show.
      const contentW = legendRef.current?.getBoundingClientRect().width || 0;
      const legendW = contentW ? contentW + LEGEND_PILL_PADDING_PX : 0;
      const trackW = allDayCellRef.current?.getBoundingClientRect().width || 0;
      if (!legendW && !trackW) return;
      setBandMetrics((prev) => (prev && prev.legendW === legendW && prev.trackW === trackW
        ? prev
        : { legendW, trackW }));
    };
    const ro = new ResizeObserver(measure);
    if (legendRef.current) ro.observe(legendRef.current);
    if (allDayCellRef.current) ro.observe(allDayCellRef.current);
    measure();
    return () => ro.disconnect();
  }, [hasAllDay, compact]);

  // One question decides the band in every orientation: can both pills live
  // on their own side of the centre line, i.e. does the legend fit in half
  // the band at its natural width? Squeezing it instead spills its totals
  // into the lopsided 3+1 the compact grid exists to avoid.
  //
  // This is deliberately NOT a portrait/landscape test. A portrait tablet
  // has ample room for two pills; only a phone genuinely has to stack, and
  // stacking a band that could sit side by side wastes the width and reads
  // as two stranded bars.
  const seamFits = !bandMetrics || !wrapBox
    ? true
    : bandMetrics.legendW <= (wrapBox.width - ALLDAY_SEAM_GAP_PX) / 2;

  // Room for chips. Where the pills stretch (compact) that is simply the
  // track they were given; where they sit at their natural width beside
  // each other (landscape), the legend's width is also the pill's ceiling,
  // so neither side outgrows the other across the seam.
  const allDayRoom = !bandMetrics
    ? null
    : compact
      ? bandMetrics.trackW || null
      : Math.min(bandMetrics.legendW || Infinity, bandMetrics.trackW || Infinity);

  // Chips per row from that room; compact spends a second row rather than a
  // "+N", because portrait is exactly where vertical space is cheap and
  // horizontal space is not. Per-row flooring, never total area: chips are
  // laid out by flex-wrap, so overpromising spills onto a third row.
  const allDayRows = compact ? 2 : 1;
  const allDayFit = allDayRoom === null
    ? null
    : Math.max(1, Math.floor((allDayRoom - ALLDAY_PILL_CHROME_PX) / ALLDAY_CHIP_PX)) * allDayRows;

  // The chip follows the pointer or the keyboard first, and otherwise names
  // the routine running right now — the ambient case, where there is no
  // pointer to follow.
  const chipRoutine = (inspected?.isRoutine && inspected)
    || (nowMin !== null
      ? routineBars.find((r) => r.startMin <= nowMin && nowMin < r.endMin && !r.completed)
      : null)
    || null;

  // Legend glyphs: Zap and Leaf are the summary strip's own effort/restore
  // icons (one vocabulary across surfaces); MoonStar is nocturnal but
  // distinct from the plain crescent marking sunset on the ring; the dashed
  // circle is what unblocked time literally is here — an unclaimed stretch
  // of the dial.
  const legend = [
    { key: 'effort', label: t('dial.effort', 'Effort'), color: DIAL_COLORS.effort, minutes: model.effortMinutes, Icon: Zap },
    { key: 'restore', label: t('dial.restore', 'Restore'), color: DIAL_COLORS.restore, minutes: model.restoreMinutes, Icon: Leaf },
    ...(model.sleepMinutes !== null
      ? [{ key: 'sleep', label: t('dial.sleep', 'Sleep'), color: DIAL_COLORS.sleep, minutes: model.sleepMinutes, Icon: MoonStar }]
      : []),
    ...(model.unblockedMinutes !== null
      ? [{ key: 'unblocked', label: t('dial.unblocked', 'Unblocked'), color: DIAL_COLORS.unblocked, minutes: model.unblockedMinutes, Icon: CircleDashed }]
      : []),
    // Routines are habits, not scheduled work: they are counted, never
    // summed into the minute totals above (those stay a partition of
    // scheduled task time).
    // Focus is time spent INSIDE the blocks above, so summing it into the
    // totals would double-count the same minutes; it gets its own figure.
    ...(focusSpans?.length
      ? [{
        key: 'focus',
        label: t('dial.focus', 'Focus'),
        color: FOCUS_COLOR,
        minutes: focusSpanMinutes(focusSpans),
        Icon: Timer,
      }]
      : []),
    ...(routineBars.length
      ? [{
        key: 'routines',
        label: t('dial.routines', 'Routines'),
        color: ROUTINE_COLOR,
        value: `${routineBars.filter((r) => r.completed).length}/${routineBars.length}`,
        Icon: Sparkles,
      }]
      : []),
  ];

  // Legend — short enumerable facts, quiet enough to leave the now line the
  // loudest thing on the wall.
  const legendPill = (
    <div
      className={`rounded-2xl bg-white/[0.04] px-8 py-3 ${compact ? 'w-full' : 'flex-shrink-0'}`}
    >
      {/* The shell above stretches to its share of the band; this inner box
          keeps its natural width (w-max), which is what the seam test below
          measures. Measuring the shell instead would lock the layout: a
          stretched shell is always wider than half the band, so once the
          band stacked it could never discover that it now fits side by
          side. */}
      <div
        ref={legendRef}
        className={`w-max mx-auto ${
          compact
            // Width-constrained: a deliberate 2×2 grid instead of flex-wrap's
            // lopsided 3+1 spill.
            ? 'grid grid-cols-2 justify-items-start gap-x-10 gap-y-2.5'
            : 'flex flex-wrap items-center justify-center gap-x-8 gap-y-2'
        }`}
      >
        {legend.map((item) => (
          <div key={item.key} className="flex items-center gap-2.5">
            <item.Icon size={15} strokeWidth={1.75} style={{ color: item.color }} aria-hidden="true" />
            <div className="leading-tight">
              <div className="text-white/45 text-xs">{item.label}</div>
              <div className="text-white/90 text-sm font-medium tabular-nums">
              {item.value ?? formatMinutes(item.minutes)}
            </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  // All-day items — the day's context, not its schedule. Deliberately built
  // in the legend's own grammar (icon, label, then the facts) so it reads as
  // a sibling of the totals rather than a new kind of thing, and never on
  // the ring: nothing timeless goes on a time axis. Each title is its own
  // button into the same action sheet the wedges use, so an all-day chore
  // can be completed from the couch; overflow collapses to a quiet "+N"
  // rather than clipping silently.
  const allDayShown = allDayFit === null ? model.allDay : model.allDay.slice(0, allDayFit);
  const allDayHidden = model.allDay.length - allDayShown.length;
  const allDayActionable = !!(onToggleComplete || onOpenInPlanner);
  const allDayPill = (
    <div
      className={`rounded-2xl bg-white/[0.04] px-6 py-3 flex items-center gap-2.5 min-w-0 ${
        compact ? 'w-full' : ''}`}
      style={!compact && allDayRoom ? { maxWidth: allDayRoom } : undefined}
    >
      <CalendarDays size={15} strokeWidth={1.75} className="text-white/45 flex-shrink-0" aria-hidden="true" />
      <div className="leading-tight min-w-0">
        <div className="text-white/45 text-xs">{t('task.allDay', 'All Day')}</div>
        <div className={`flex items-center gap-x-3 min-w-0 ${compact ? 'flex-wrap gap-y-1' : ''}`}>
          {allDayShown.map((item) => {
            const body = (
              <>
                <span
                  className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: muteDialColor(item.colorHex) }}
                />
                {/* Arbitrary value on purpose: Tailwind 3.3 has no numeric
                    max-w-* scale, so max-w-32 would silently generate
                    nothing and let a long title stretch the chip past
                    everything this pill is measured against. */}
                <span className="truncate max-w-[8rem]">{renderHubTitle(item.title)}</span>
              </>
            );
            const tone = item.completed ? 'text-white/40' : 'text-white/90';
            return allDayActionable ? (
              <button
                key={item.id}
                onClick={() => openSheet(item)}
                className={`flex items-center gap-1.5 text-sm font-medium min-w-0 ${tone} hover:text-white transition-colors`}
              >
                {body}
              </button>
            ) : (
              <span key={item.id} className={`flex items-center gap-1.5 text-sm font-medium min-w-0 ${tone}`}>
                {body}
              </span>
            );
          })}
          {allDayHidden > 0 && (
            <span
              className="text-white/45 text-sm flex-shrink-0"
              title={t('dial.allDayMore', '{{count}} more', { count: allDayHidden })}
            >
              +{allDayHidden}
            </span>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div ref={wrapRef} className="w-full h-full flex flex-col items-center justify-center gap-2 select-none">
      <div ref={areaRef} className="relative w-full flex-1 min-h-0 flex items-center justify-center">
        {/* The horizontal viewBox margin exists only for the 3/9-o'clock
            labels, which extend past the dial's square; compact mode drops
            those labels, so it reclaims the margin too. */}
        <svg
          viewBox={compact ? '0 0 1000 1000' : '-60 0 1120 1000'}
          className="h-full w-full max-h-full"
          role="img"
          aria-label={t('dial.aria', 'Day dial: {{date}}', { date: `${weekday} ${dateLabel}` })}
        >
          <defs>
            <filter id="dial-glow" x="-40%" y="-40%" width="180%" height="180%">
              <feGaussianBlur stdDeviation="6" />
            </filter>
          </defs>

          {/* Chapter ring + tick field — the engineered bezel. */}
          <circle cx={CX} cy={CY} r={R_BEZEL} fill="none" stroke="#ffffff" strokeOpacity={0.07} strokeWidth={2} />
          <TickField />

          {/* Hour labels every 3 hours, cardinals weighted above the rest.
              A label yields (fades out) while a sunrise/sunset mark sits on
              its station — see dialLabelYieldsToSun. */}
          {HOUR_LABELS.filter((l) => !(compact && l.side)).map((l) => {
            const p = dialPoint(CX, CY, 478, l.min);
            return (
              <text
                key={l.min}
                x={p.x} y={p.y}
                textAnchor="middle" dominantBaseline="central"
                fill="#ffffff"
                fillOpacity={dialLabelYieldsToSun(l.min, sun) ? 0 : (l.cardinal ? 0.4 : 0.26)}
                style={{ fontSize: l.cardinal ? 26 : 21, letterSpacing: '0.25em', fontWeight: 500 }}
              >
                {use24HourClock ? l.h24 : l.h12}
              </text>
            );
          })}

          {/* Daylight — beneath every other datum on the face, so the night,
              the wedges and the weather all read over the top of it. */}
          {daylight?.length > 0 && <DaylightBand steps={daylight} />}

          {/* Sleep — the declared night, quiet lavender. Its two halves stay
              flush at midnight so the night reads as one mass. */}
          {model.sleep.map((seg) => (
            <Segment
              key={`sleep-${seg.startMin}`}
              startMin={seg.startMin} endMin={seg.endMin}
              color={DIAL_COLORS.sleep}
              fillMute={SLEEP_MUTE * (isPast(seg.endMin) ? PAST_MUTE : 1)}
              edgeMute={SLEEP_MUTE * (isPast(seg.endMin) ? PAST_MUTE : 1)}
              padStart={seg.startMin !== 0}
              padEnd={seg.endMin !== DIAL_DAY_MINUTES}
            />
          ))}

          {/* Solar hairlines — under the schedule, over the night. */}
          {sun?.sunriseMin != null && <SunMark min={sun.sunriseMin} kind="rise" />}
          {sun?.sunsetMin != null && <SunMark min={sun.sunsetMin} kind="set" />}

          {/* Weather ring — only for dates the hourly forecast covers. */}
          {hourlyWeather && <WeatherRing hourly={hourlyWeather} />}

          {/* Schedule blocks — each in its task's own hue, spoken in the
              dial's voice (muteDialColor pins every color into one
              pastel-emissive family). Completed and fully-past blocks stay
              (the hour is spent) but recede to the dim tier. Overlapping
              blocks ride concentric lanes (assignDialLanes) instead of
              painting over each other; an unstacked day still fills the
              whole band. */}
          {laneOrdered.map((b) => {
            const band = dialLaneBand(R_INNER, R_EDGE, b.lane, b.laneCount);
            const tone = blockTone(b);
            return (
              <Segment
                key={b.id}
                startMin={b.startMin} endMin={b.endMin}
                rInner={band.rInner} rOuter={band.rOuter}
                color={muteDialColor(b.colorHex)}
                fillMute={tone.fill}
                edgeMute={tone.edge}
                // Flush against the midnight it crosses, exactly as the
                // declared night meets itself there: the inter-block gap
                // would read as "ends here" on a block that does not.
                padStart={!b.startedPrevDay}
                padEnd={!b.endsNextDay}
                selected={inspected?.id === b.id}
                onEnter={() => inspectEnter(b)}
                onLeave={inspectLeave}
                onTap={() => inspectTap(b)}
              />
            );
          })}

          {/* Focus sessions — over the wedges, since the rail is about which
              part of a block the work landed in. */}
          {focusSpans?.length > 0 && <FocusRail spans={focusSpans} />}

          {routineBars.length > 0 && (
            <RoutineBars
              bars={routineBars}
              selectedId={inspected?.id}
              onEnter={inspectEnter}
              onLeave={inspectLeave}
              onTap={inspectTap}
            />
          )}

          {/* The name chip. A routine bar is unlabelled at rest — five names
              around the ring would be a wall of text — so it speaks when
              pointed at, when the keyboard selects it, or, with no input at
              all, while it is the one running: that is what gives a wall
              panel something to read. */}
          {chipRoutine && (() => {
            const band = dialLaneBand(R_ROUTINE_BAND[0], R_ROUTINE_BAND[1], chipRoutine.lane, chipRoutine.laneCount);
            const mid = (chipRoutine.startMin + chipRoutine.endMin) / 2;
            // Pushed out along the bar's OWN angle, so the chip always
            // reads as belonging to it.
            const p = dialPoint(CX, CY, band.rOuter + 22, mid);
            const right = p.x >= CX;
            const label = renderHubTitle(chipRoutine.title);
            const w = label.length * 8.2 + 26;
            const x = right ? p.x : p.x - w;
            return (
              <g pointerEvents="none">
                <rect
                  x={x} y={p.y - 15} width={w} height={30} rx={15}
                  fill="#0d1f1d" stroke={ROUTINE_COLOR} strokeOpacity={0.45}
                />
                <text
                  x={right ? x + 13 : x + w - 13} y={p.y}
                  textAnchor={right ? 'start' : 'end'} dominantBaseline="central"
                  fill={ROUTINE_COLOR} fillOpacity={0.9}
                  style={{ fontSize: 15, fontWeight: 500 }}
                >
                  {label}
                </text>
              </g>
            );
          })()}

          {nowMin !== null && <NowLine nowMin={nowMin} />}
        </svg>

        {/* Hub — HTML overlay so the brand serif and tracking behave. */}
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none px-[18%]">
          {/* Clock on top — the first read on a wall display. It stays put
              through wedge inspection (only the region below the divider
              swaps), so it belongs with the steady face, not the live
              readout. Today-only, like the needle — and on any other date
              its slot carries the way home instead, so browsing always
              shows either the time or the button back to it. */}
          {nowMin !== null ? (
            <div className="text-white/70 text-[clamp(14px,2.6vmin,24px)] font-medium tabular-nums tracking-wide mb-[0.8vmin]">
              {formatTime(minToHHMM(nowMin))}
            </div>
          ) : onGoToday && (
            <button
              onClick={onGoToday}
              className={`mb-[0.8vmin] rounded-full border border-white/15 px-3.5 py-1 text-[clamp(10px,1.6vmin,14px)] font-medium tracking-[0.2em] uppercase text-white/45 hover:text-white/90 hover:border-white/40 transition-all duration-300 ${
                chromeVisible ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'}`}
              title={t('dial.backToToday', 'Back to today (T)')}
            >
              {t('dial.today', 'Today')}
            </button>
          )}
          {/* Clickable day nav — very subtle chevrons flanking the WEEKDAY
              line, not the serif date: the small-caps day is a short,
              fixed-width line at every viewport, while the date is the
              hub's widest element and would push the controls into the
              ring on a phone. They fade with the rest of the idle chrome
              so the resting face stays a pure instrument; keyboard arrows
              and swipe remain. */}
          <div className="relative">
            {onStepDay && (
              <>
                <button
                  onClick={() => onStepDay(-1)}
                  className={`absolute right-full top-1/2 -translate-y-1/2 mr-[1vmin] p-2 text-white/20 hover:text-white/75 transition-all duration-300 ${
                    chromeVisible ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'}`}
                  title={t('dial.prevDay', 'Previous day (←)')}
                  aria-label={t('dial.prevDay', 'Previous day (←)')}
                >
                  <ChevronLeft size={20} />
                </button>
                <button
                  onClick={() => onStepDay(1)}
                  className={`absolute left-full top-1/2 -translate-y-1/2 ml-[1vmin] p-2 text-white/20 hover:text-white/75 transition-all duration-300 ${
                    chromeVisible ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'}`}
                  title={t('dial.nextDay', 'Next day (→)')}
                  aria-label={t('dial.nextDay', 'Next day (→)')}
                >
                  <ChevronRight size={20} />
                </button>
              </>
            )}
            {/* Fixed min-width (sized to WEDNESDAY, the longest English
                day) so the chevrons anchor to a stable box instead of
                breathing with each day's name length as you page. A longer
                localized weekday just widens the box gracefully. */}
            <div className="min-w-[10em] text-center text-white/40 text-[clamp(10px,1.6vmin,16px)] font-medium tracking-[0.35em] uppercase">
              {weekday}
            </div>
          </div>
          <div className="font-brand text-white text-[clamp(28px,7vmin,64px)] leading-tight mt-1">
            {dialDateFits(dateLongPx, dialPx) ? dateLabel : dateLabelShort}
            {/* The hidden twin the decision is measured from. Out of the
                a11y tree and out of the layout, but laid out enough to have
                a width. */}
            <span
              ref={dateProbeRef}
              aria-hidden="true"
              className="absolute invisible whitespace-nowrap pointer-events-none"
            >
              {dateLabel}
            </span>
          </div>
          <div className="w-24 border-t border-white/15 my-[1.5vmin]" />
          {inspected ? (
            <>
              <div className="flex items-center gap-2 max-w-full">
                <span
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: inspected.isRoutine ? ROUTINE_COLOR : muteDialColor(inspected.colorHex) }}
                />
                <span className="text-white/85 text-[clamp(13px,2.4vmin,22px)] font-medium truncate">
                  {renderHubTitle(inspected.title)}
                </span>
              </div>
              {renderHubTags(inspected.title)}
              <div className="text-white/40 text-[clamp(11px,1.8vmin,16px)] mt-0.5 tabular-nums">
                {renderBlockRange(inspected)}
                {' · '}{formatMinutes(blockMinutes(inspected))}
              </div>
              {(inspected.completed || nowMin !== null) && (
                <div className="text-white/40 text-[clamp(11px,1.8vmin,16px)] mt-0.5">
                  {inspected.completed ? t('dial.completed', 'completed') : relLabel(inspected)}
                </div>
              )}
            </>
          ) : focus ? (
            <>
              <div className="text-white/85 text-[clamp(13px,2.4vmin,22px)] font-medium truncate max-w-full">
                {renderHubTitle(focus.block.title)}
              </div>
              {renderHubTags(focus.block.title)}
              <div className="text-white/40 text-[clamp(11px,1.8vmin,16px)] mt-0.5">
                {focus.current
                  ? t('dial.until', 'until {{time}}', {
                    time: blockClock(focus.block).endText
                      + (blockClock(focus.block).endsAfter ? ' +1' : ''),
                  })
                  : t('dial.next', 'next at {{time}}', { time: blockClock(focus.block).startText })}
                {' · '}{relLabel(focus.block)}
              </div>
            </>
          ) : (
            <div className="text-white/35 text-[clamp(12px,2vmin,18px)]">
              {nowMin !== null
                ? t('dial.clear', 'Nothing else scheduled')
                : t('dial.blocksCount', '{{count}} blocks', { count: model.blocks.length })}
            </div>
          )}
        </div>

        {/* Watch-face complications, positioned off the dial's measured size
            (the viewBox is 1000 units tall, so its drawn height IS the
            dial's diameter in px). */}
        {complications?.length > 0 && (
          <DialComplications
            items={complications}
            dialPx={dialPx}
            onOpenTask={onOpenTask}
            onSetHabitCount={onSetHabitCount}
            onIncrementHabit={onIncrementHabit}
            onToggleComplete={onToggleComplete}
            onToggleTaskComplete={onToggleTaskComplete}
          />
        )}

        {/* The ring's accessibility tree and its single tab stop. The SVG
            above is one image to AT, so the blocks get real semantics here:
            a listbox of visually-hidden options, one per block in time
            order, with aria-activedescendant naming the selected one. It
            draws no pixels and swallows no pointer events — the lit wedge
            and the hub readout are the visible half of this state. */}
        <div
          ref={listRef}
          role="listbox"
          tabIndex={selectable.length ? 0 : -1}
          aria-label={t('dial.blockList', 'Schedule blocks')}
          aria-activedescendant={inspected ? optionId(inspected.id) : undefined}
          onKeyDown={onListKeyDown}
          onFocus={onListFocus}
          onBlur={onListBlur}
          className="absolute inset-0 pointer-events-none outline-none"
        >
          {selectable.map((b) => (
            <div
              key={b.id}
              id={optionId(b.id)}
              role="option"
              aria-selected={inspected?.id === b.id}
              className="sr-only"
            >
              {blockA11yLabel(b)}
            </div>
          ))}
        </div>

        {/* Action sheet — the dial's own register, never planner chrome.
            Backdrop click/tap dismisses; actions dismiss after acting. */}
        {sheetBlock && (() => {
          const live = model.blocks.find((x) => x.id === sheetBlock.id)
            || routineBars.find((x) => x.id === sheetBlock.id)
            || model.allDay.find((x) => x.id === sheetBlock.id)
            || sheetBlock;
          return (
            <div
              className="absolute inset-0 z-20 flex items-center justify-center"
              onClick={closeSheet}
              onTouchEnd={(e) => e.stopPropagation()}
            >
              <div
                ref={sheetRef}
                role="dialog"
                aria-modal="true"
                aria-label={stripWikilinks(live.title)}
                className="w-[min(82%,340px)] rounded-2xl border border-white/10 bg-[#12151c] px-5 py-4 shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: live.isRoutine ? ROUTINE_COLOR : muteDialColor(live.colorHex) }}
                  />
                  <span className="text-white/90 text-base font-medium truncate">
                    {renderHubTitle(live.title)}
                  </span>
                </div>
                <div className="text-white/40 text-xs mt-1 tabular-nums">
                  {live.startMin === undefined
                    ? t('task.allDay', 'All Day')
                    : <>
                        {renderBlockRange(live)}
                        {' · '}{formatMinutes(blockMinutes(live))}
                      </>}
                </div>
                <div className="mt-3.5 space-y-1.5">
                  {(live.completable || live.isRoutine) && onToggleComplete && (
                    <button
                      onClick={() => { onToggleComplete(live); closeSheet(); }}
                      className="w-full flex items-center gap-2.5 rounded-lg bg-white/5 hover:bg-white/10 active:bg-white/15 px-3.5 py-2.5 text-white/85 text-sm transition-colors"
                    >
                      {live.completed ? <Undo2 size={16} className="text-white/50" /> : <Check size={16} className="text-white/50" />}
                      {live.completed
                        ? t('dial.markNotComplete', 'Mark not complete')
                        : t('dial.markComplete', 'Mark complete')}
                    </button>
                  )}
                  {onStartFocus && canStartFocusFromBlock(live, nowMin) && (
                    <button
                      onClick={() => { closeSheet(); onStartFocus(); }}
                      className="w-full flex items-center gap-2.5 rounded-lg bg-white/5 hover:bg-white/10 active:bg-white/15 px-3.5 py-2.5 text-white/85 text-sm transition-colors"
                    >
                      <Timer size={16} className="text-white/50" />
                      {t('dial.startFocus', 'Start focus session')}
                    </button>
                  )}
                  {onOpenInPlanner && (
                    <button
                      onClick={() => { closeSheet(); onOpenInPlanner(live); }}
                      className="w-full flex items-center gap-2.5 rounded-lg bg-white/5 hover:bg-white/10 active:bg-white/15 px-3.5 py-2.5 text-white/85 text-sm transition-colors"
                    >
                      <ExternalLink size={16} className="text-white/50" />
                      {t('dial.openInPlanner', 'Open in planner')}
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })()}
      </div>

      {/* Bottom band. All-day items never go on the ring, and in landscape
          they must not take a row of their own either: the dial is
          height-constrained there, so a second row costs real diameter
          (measured: 45px at 1600×900) while ~570px per side of the legend's
          own row sits empty.
          So the band is two equal tracks meeting on the dial's vertical
          axis — the line under the 12 — with each pill growing outward from
          that seam. Equal tracks (not auto) are what put the seam on the
          axis; capping the pill at the legend's width (above) is what keeps
          the two sides reading as a matched pair rather than one panel
          sprawling. Compact has the opposite budget — no side room, vertical
          to spare — so there they stack, the pill capped to the legend's
          width and spending a second row of chips.
          A day with no all-day items renders exactly as before. */}
      {!hasAllDay ? legendPill : seamFits ? (
        // Two equal tracks, so the seam between the pills lands on the
        // dial's vertical axis — the line under the 12 — and each grows
        // outward from it. Where the pills stretch (compact) they fill
        // their halves and the pair spans the band; in landscape they keep
        // their natural widths against the seam, because the band there is
        // far wider than the dial and full halves would dwarf it.
        <div
          // items-stretch, not items-center: side by side the two pills are
          // one band, so the shorter one (fewer chip rows than the legend
          // has grid rows) matches the taller instead of floating in it.
          className="w-full grid items-stretch gap-x-3"
          style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)' }}
        >
          <div ref={allDayCellRef} className="min-w-0 flex justify-end">{allDayPill}</div>
          <div className="min-w-0 flex justify-start">{legendPill}</div>
        </div>
      ) : compact ? (
        // Only a genuinely narrow band stacks — a phone. Both pills take
        // the whole width, which in compact is also the dial's own width
        // (square viewBox, width the constrained axis), so the block below
        // lines up with the instrument above it.
        <div ref={allDayCellRef} className="w-full flex flex-col items-stretch gap-2">
          {allDayPill}
          {legendPill}
        </div>
      ) : (
        // Landscape too narrow for the seam: keep the legend centred at its
        // natural width with the pill beside it, rather than squeeze it
        // into a spill that costs 44px of dial diameter.
        <div
          className="w-full grid items-stretch"
          style={{ gridTemplateColumns: 'minmax(0,1fr) auto minmax(0,1fr)' }}
        >
          <div ref={allDayCellRef} className="min-w-0 flex justify-end pr-3">{allDayPill}</div>
          {legendPill}
        </div>
      )}
    </div>
  );
};

export default DayDial;
