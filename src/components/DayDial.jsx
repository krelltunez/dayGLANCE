import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { stripWikilinks } from '../utils/taskUtils.js';
import { formatMinutes } from '../utils/daySummary.js';
import {
  DIAL_COLORS,
  DIAL_DAY_MINUTES,
  computeDialModel,
  dialArcPath,
  dialIntensity,
  dialPoint,
  dialSectorPath,
  dialTicks,
  findDialFocusBlock,
  padDialSegment,
  precipRuns,
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
const TICK_STYLE = {
  hour:    { r1: 400, r2: 436, width: 2.5, opacity: 0.45 },
  quarter: { r1: 404, r2: 428, width: 1.6, opacity: 0.22 },
  minor:   { r1: 407, r2: 421, width: 1.0, opacity: 0.10 },
};

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

function Segment({ startMin, endMin, color, dim = false, padStart = true, padEnd = true }) {
  const [s, e] = padDialSegment(startMin, endMin, 3, padStart, padEnd);
  if (e <= s) return null;
  const { fillOpacity, edgeOpacity, edgeWidth } = dialIntensity(endMin - startMin);
  const mute = dim ? 0.45 : 1;
  const edge = dialArcPath(CX, CY, R_EDGE, s, e);
  return (
    <g>
      <path
        d={dialSectorPath(CX, CY, R_INNER, R_EDGE, s, e)}
        fill={color}
        fillOpacity={fillOpacity * mute}
      />
      {/* Soft halo under the crisp edge — one glowing rim reads better at
          distance than any texture. */}
      <path
        d={edge}
        fill="none" stroke={color} strokeLinecap="round"
        strokeWidth={edgeWidth * 2.4} strokeOpacity={0.35 * edgeOpacity * mute}
        filter="url(#dial-glow)"
      />
      <path
        d={edge}
        fill="none" stroke={color} strokeLinecap="round"
        strokeWidth={edgeWidth} strokeOpacity={edgeOpacity * mute}
      />
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

function NowLine({ nowMin }) {
  const deg = (nowMin / 1440) * 360;
  const dot = dialPoint(CX, CY, R_EDGE, nowMin);
  return (
    <g>
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
 * @param date            Date object the dial describes (hub typography).
 * @param nowMin          Minutes-since-midnight for the now line, or null to
 *                        hide it (viewing a day other than today).
 * @param formatTime      App-level 'HH:MM' → display formatter (12/24h aware).
 * @param use24HourClock  Picks the cardinal hour label set.
 * @param sun             {sunriseMin, sunsetMin} minutes-of-day (either may
 *                        be null in polar seasons), or null to omit the
 *                        solar layer entirely (no location known).
 */
const DayDial = ({ dayTasks, dayWindow, date, nowMin = null, formatTime, use24HourClock = false, sun = null, hourlyWeather = null }) => {
  const { t, i18n } = useTranslation();

  const model = useMemo(
    () => computeDialModel(dayTasks, dayWindow),
    [dayTasks, dayWindow],
  );

  const focus = nowMin !== null ? findDialFocusBlock(model.blocks, nowMin) : null;

  const minToHHMM = (m) =>
    `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

  const weekday = date.toLocaleDateString(i18n.language, { weekday: 'long' });
  const dateLabel = date.toLocaleDateString(i18n.language, { month: 'long', day: 'numeric' });

  // Compact when the container is width-constrained (portrait-ish): there,
  // the side labels and their viewBox margin cost actual dial diameter, so
  // both go. In a height-constrained container the margin only letterboxes
  // and everything stays. Measured, not media-queried — the same component
  // must judge a phone, a tray popup, and a rotated wall panel correctly.
  const wrapRef = useRef(null);
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([entry]) => {
      setCompact(entry.contentRect.width < entry.contentRect.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const legend = [
    { key: 'effort', label: t('dial.effort', 'Effort'), color: DIAL_COLORS.effort, minutes: model.effortMinutes },
    { key: 'restore', label: t('dial.restore', 'Restore'), color: DIAL_COLORS.restore, minutes: model.restoreMinutes },
    ...(model.sleepMinutes !== null
      ? [{ key: 'sleep', label: t('dial.sleep', 'Sleep'), color: DIAL_COLORS.sleep, minutes: model.sleepMinutes }]
      : []),
    ...(model.unblockedMinutes !== null
      ? [{ key: 'unblocked', label: t('dial.unblocked', 'Unblocked'), color: DIAL_COLORS.unblocked, minutes: model.unblockedMinutes }]
      : []),
  ];

  return (
    <div className="w-full h-full flex flex-col items-center justify-center gap-2 select-none">
      <div ref={wrapRef} className="relative w-full flex-1 min-h-0 flex items-center justify-center">
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

          {/* Hour labels every 3 hours, cardinals weighted above the rest. */}
          {HOUR_LABELS.filter((l) => !(compact && l.side)).map((l) => {
            const p = dialPoint(CX, CY, 478, l.min);
            return (
              <text
                key={l.min}
                x={p.x} y={p.y}
                textAnchor="middle" dominantBaseline="central"
                fill="#ffffff" fillOpacity={l.cardinal ? 0.4 : 0.26}
                style={{ fontSize: l.cardinal ? 26 : 21, letterSpacing: '0.25em', fontWeight: 500 }}
              >
                {use24HourClock ? l.h24 : l.h12}
              </text>
            );
          })}

          {/* Sleep — the declared night, quiet lavender. Its two halves stay
              flush at midnight so the night reads as one mass. */}
          {model.sleep.map((seg) => (
            <Segment
              key={`sleep-${seg.startMin}`}
              startMin={seg.startMin} endMin={seg.endMin}
              color={DIAL_COLORS.sleep}
              padStart={seg.startMin !== 0}
              padEnd={seg.endMin !== DIAL_DAY_MINUTES}
            />
          ))}

          {/* Solar hairlines — under the schedule, over the night. */}
          {sun?.sunriseMin != null && <SunMark min={sun.sunriseMin} kind="rise" />}
          {sun?.sunsetMin != null && <SunMark min={sun.sunsetMin} kind="set" />}

          {/* Weather ring — only for dates the hourly forecast covers. */}
          {hourlyWeather && <WeatherRing hourly={hourlyWeather} />}

          {/* Schedule blocks — completed ones stay (the hour is spent) but
              recede so the remaining day carries the light. */}
          {model.blocks.map((b) => (
            <Segment
              key={b.id}
              startMin={b.startMin} endMin={b.endMin}
              color={DIAL_COLORS[b.kind] || DIAL_COLORS.effort}
              dim={b.completed}
            />
          ))}

          {nowMin !== null && <NowLine nowMin={nowMin} />}
        </svg>

        {/* Hub — HTML overlay so the brand serif and tracking behave. */}
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none px-[18%]">
          <div className="text-white/40 text-[clamp(10px,1.6vmin,16px)] font-medium tracking-[0.35em] uppercase">
            {weekday}
          </div>
          <div className="font-brand text-white text-[clamp(28px,7vmin,64px)] leading-tight mt-1">
            {dateLabel}
          </div>
          <div className="w-24 border-t border-white/15 my-[1.5vmin]" />
          {focus ? (
            <>
              <div className="text-white/85 text-[clamp(13px,2.4vmin,22px)] font-medium truncate max-w-full">
                {stripWikilinks(focus.block.title)}
              </div>
              <div className="text-white/40 text-[clamp(11px,1.8vmin,16px)] mt-0.5">
                {focus.current
                  ? t('dial.until', 'until {{time}}', { time: formatTime(minToHHMM(focus.block.endMin)) })
                  : t('dial.next', 'next at {{time}}', { time: formatTime(minToHHMM(focus.block.startMin)) })}
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
      </div>

      {/* Legend — short enumerable facts, quiet enough to leave the now line
          the loudest thing on the wall. */}
      <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-2 rounded-2xl bg-white/[0.04] px-8 py-3">
        {legend.map((item) => (
          <div key={item.key} className="flex items-center gap-2.5">
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: item.color }} />
            <div className="leading-tight">
              <div className="text-white/45 text-xs">{item.label}</div>
              <div className="text-white/90 text-sm font-medium tabular-nums">{formatMinutes(item.minutes)}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default DayDial;
