import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useDayPlannerCtx } from '../../context/DayPlannerContext.jsx';
import { TAILWIND_TO_HEX } from '../../utils/colorUtils.js';
import { calculateGoalProgress } from '../../utils/goalProgress.js';

/** Hex value for a Tailwind bg-* class, falling back to blue. */
const toHex = (bgClass) => TAILWIND_TO_HEX[bgClass] || '#3b82f6';

/** Scale a #rrggbb hex toward black by `amt` (0..1); returns an rgb() string.
 *  Used to darken bar colours enough that white on-bar text stays legible for
 *  every palette hue, including light ones like yellow. */
const darken = (hex, amt) => {
  const f = 1 - amt;
  const c = (i) => Math.max(0, Math.min(255, Math.round(parseInt(hex.slice(i, i + 2), 16) * f)));
  return `rgb(${c(1)}, ${c(3)}, ${c(5)})`;
};

// Fade applied to open-ended (no target) bars: the bar dissolves into the page
// background instead of fading to a hardcoded colour, so it works in any theme.
const OPEN_ENDED_MASK = 'linear-gradient(to right, #000 0%, #000 55%, transparent 100%)';

// Period presets shown along the top. `months` is the width of the window that
// starts at the first day of the current month (the fixed left edge).
const PERIODS = [
  { key: '1m', label: '1M', months: 1 },
  { key: '3m', label: '3M', months: 3 },
  { key: '6m', label: '6M', months: 6 },
  { key: '1y', label: '1Y', months: 12 },
  { key: '2y', label: '2Y', months: 24 },
];

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Vertical breathing room: space under the "Today" label before the first bar,
// and above the month labels below the last bar.
const TOP_PAD = 24;
const BOTTOM_PAD = 30;
const ROW_H = 44;   // per-goal row height (px)
const BAR_H = 28;   // bar height (px)
const CHAR_PX = 6.4; // rough width of a text-xs character, for label-fit estimate

/** Parse a goal's effective start: explicit startDate ('YYYY-MM-DD') or, for
 *  goals created before the field existed, its createdAt timestamp. */
const goalStartMs = (goal) => {
  if (goal.startDate) return new Date(goal.startDate + 'T00:00:00').getTime();
  if (goal.createdAt) return new Date(goal.createdAt).getTime();
  return null;
};
/** Parse a goal's target date to ms, or null when it has none (open-ended). */
const goalEndMs = (goal) => (goal.targetDate ? new Date(goal.targetDate + 'T00:00:00').getTime() : null);

/**
 * Temporal (Gantt-style) view of goals. Each goal is a horizontal bar spanning
 * its start → target date, coloured with the goal's colour, whose fill acts as a
 * completion fuel gauge. The window's left edge is fixed at the first day of the
 * current month; the period selector zooms the right edge out (1M–2Y). The view
 * is static (no horizontal scroll) — bars are clipped to the window. The goal
 * title sits inside its bar, or just outside when the bar is too short to hold it.
 */
const GoalTimeline = ({ goals, projects, onEditGoal }) => {
  const { darkMode, textPrimary, textSecondary, tasks, unscheduledTasks } = useDayPlannerCtx();
  const [periodKey, setPeriodKey] = useState('6m');
  const period = PERIODS.find(p => p.key === periodKey) || PERIODS[2];

  // Measured chart width, so we can decide per-bar whether the title fits inside
  // and keep the right edge from being clipped.
  const chartRef = useRef(null);
  const [chartW, setChartW] = useState(0);
  useEffect(() => {
    const el = chartRef.current;
    if (!el) return;
    const update = () => setChartW(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const allTasks = useMemo(() => [...(tasks || []), ...(unscheduledTasks || [])], [tasks, unscheduledTasks]);

  // Window bounds: [first day of current month, +N months). Computed once per
  // render from `now`; the day granularity is enough for a month-scale chart.
  const { leftEdge, span, todayMs, monthTicks } = useMemo(() => {
    const now = new Date();
    const left = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    const right = new Date(now.getFullYear(), now.getMonth() + period.months, 1, 0, 0, 0, 0);
    const leftMs = left.getTime();
    const rightMs = right.getTime();
    const ticks = [];
    for (let i = 0; i <= period.months; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      ticks.push({ ms: d.getTime(), month: d.getMonth(), year: d.getFullYear() });
    }
    return { leftEdge: leftMs, rightEdge: rightMs, span: rightMs - leftMs, todayMs: now.getTime(), monthTicks: ticks };
  }, [period.months]);

  // Fraction (0..1) of the window a given timestamp sits at.
  const frac = (ms) => Math.max(0, Math.min(1, (ms - leftEdge) / span));
  const rightEdgeMs = leftEdge + span;

  // Label density: monthly up to a year, quarterly beyond, so 2Y stays legible.
  const labelEvery = period.months > 12 ? 3 : 1;

  // Build per-goal bar geometry, keeping only goals whose span intersects the
  // window. Sorted by start so bars cascade top→bottom.
  const rows = useMemo(() => {
    const built = [];
    for (const goal of goals) {
      const startMs = goalStartMs(goal);
      const endMs = goalEndMs(goal);
      const effectiveStart = startMs == null ? leftEdge : startMs;
      const openEnded = endMs == null;
      const intersects = openEnded
        ? effectiveStart <= rightEdgeMs
        : effectiveStart <= rightEdgeMs && endMs >= leftEdge;
      if (!intersects) continue;

      const sPct = frac(Math.min(effectiveStart, rightEdgeMs)) * 100;
      const ePct = (openEnded ? 1 : frac(endMs)) * 100;
      const progress = calculateGoalProgress(goal.id, projects, allTasks);
      built.push({
        goal,
        leftPct: sPct,
        widthPct: Math.max(ePct - sPct, 1.2),
        clippedLeft: startMs != null && startMs < leftEdge,
        clippedRight: !openEnded && endMs > rightEdgeMs,
        openEnded,
        progress,
      });
    }
    return built.sort((a, b) => (goalStartMs(a.goal) ?? leftEdge) - (goalStartMs(b.goal) ?? leftEdge));
  }, [goals, projects, allTasks, leftEdge, span]); // eslint-disable-line react-hooks/exhaustive-deps

  const hiddenCount = goals.length - rows.length;
  const todayPct = frac(todayMs) * 100;
  const gridColor = darkMode ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
  const chartHeight = TOP_PAD + rows.length * ROW_H + BOTTOM_PAD;

  return (
    <div className="flex flex-col gap-3">
      {/* Period selector */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className={`text-xs font-medium ${textSecondary} mr-1`}>Range</span>
        {PERIODS.map(p => (
          <button
            key={p.key}
            onClick={() => setPeriodKey(p.key)}
            className={`px-2.5 py-1 text-xs font-medium rounded-lg transition-colors ${
              p.key === periodKey
                ? 'bg-blue-600 text-white'
                : darkMode ? 'bg-gray-700 text-gray-300 hover:bg-gray-600' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className={`text-sm ${textSecondary} opacity-60 py-8 text-center`}>
          No goals fall within this range.
        </div>
      ) : (
        <div ref={chartRef} className="relative w-full" style={{ height: chartHeight }}>
          {/* Month gridlines + labels + today marker (behind the bars) */}
          <div className="pointer-events-none absolute inset-0">
            {monthTicks.map((tick, i) => {
              const x = frac(tick.ms) * 100;
              const atRightEdge = x > 99;
              return (
                <div
                  key={tick.ms}
                  className="absolute"
                  style={{ left: `${x}%`, top: TOP_PAD, bottom: BOTTOM_PAD, width: 1, background: gridColor }}
                >
                  {i % labelEvery === 0 && (
                    <span
                      className={`absolute text-[10px] ${textSecondary} opacity-70 whitespace-nowrap`}
                      style={{
                        bottom: -BOTTOM_PAD + 8,
                        ...(atRightEdge ? { right: 2, textAlign: 'right' } : { left: 2 }),
                      }}
                    >
                      {MONTH_ABBR[tick.month]}{tick.month === 0 ? ` '${String(tick.year).slice(2)}` : ''}
                    </span>
                  )}
                </div>
              );
            })}
            {/* Today marker */}
            {todayPct >= 0 && todayPct <= 100 && (
              <div
                className="absolute"
                style={{ left: `${todayPct}%`, top: TOP_PAD, bottom: BOTTOM_PAD, width: 2, background: '#ef4444' }}
              >
                <span className="absolute left-1 text-[10px] font-semibold text-red-500 whitespace-nowrap" style={{ top: -TOP_PAD + 2 }}>
                  Today
                </span>
              </div>
            )}
          </div>

          {/* Bars */}
          <div className="absolute left-0 right-0" style={{ top: TOP_PAD }}>
            {rows.map(({ goal, leftPct, widthPct, clippedLeft, clippedRight, openEnded, progress }) => {
              const hex = toHex(goal.color);
              const pct = Math.round(progress * 100);
              const fillColor = darken(hex, 0.24);   // completed portion
              const trackColor = darken(hex, 0.58);   // remaining portion (darker)
              const textShadow = '0 1px 2px rgba(0,0,0,0.4)';
              const barLeftPx = (leftPct / 100) * chartW;
              const barWpx = (widthPct / 100) * chartW;
              const titlePx = goal.title.length * CHAR_PX + 18;
              // Decide title placement. Inside when the bar can hold title + %,
              // otherwise just outside (right if it fits, else left of the bar).
              let placement = 'inside';
              let outsideLeftPx = 0;
              let outsideAlign = 'left';
              if (chartW > 0 && barWpx < titlePx + 34) {
                const rightPos = barLeftPx + barWpx + 6;
                if (rightPos + titlePx <= chartW) {
                  placement = 'right'; outsideLeftPx = rightPos; outsideAlign = 'left';
                } else if (barLeftPx - titlePx - 6 >= 0) {
                  placement = 'left'; outsideLeftPx = barLeftPx - 6; outsideAlign = 'right';
                } else {
                  placement = 'inside';
                }
              }
              const outsideLabel = `${goal.title} · ${pct}%`;
              return (
                <div key={goal.id} className="relative w-full flex items-center" style={{ height: ROW_H }}>
                  {/* Bar */}
                  <button
                    onClick={() => onEditGoal?.(goal)}
                    className="absolute flex items-center gap-1.5 px-2"
                    style={{
                      left: `${leftPct}%`,
                      width: `${widthPct}%`,
                      height: BAR_H,
                      justifyContent: openEnded ? 'flex-start' : 'space-between',
                      background: trackColor,
                      borderTopLeftRadius: clippedLeft ? 0 : 8,
                      borderBottomLeftRadius: clippedLeft ? 0 : 8,
                      borderTopRightRadius: clippedRight || openEnded ? 0 : 8,
                      borderBottomRightRadius: clippedRight || openEnded ? 0 : 8,
                      borderLeft: clippedLeft ? `2px dotted ${fillColor}` : 'none',
                      overflow: 'hidden',
                      ...(openEnded ? { maskImage: OPEN_ENDED_MASK, WebkitMaskImage: OPEN_ENDED_MASK } : {}),
                    }}
                    title={`${goal.title} — ${pct}% complete`}
                  >
                    {/* Completion fill (fuel gauge) */}
                    <div
                      className="absolute inset-y-0 left-0 pointer-events-none"
                      style={{ width: `${pct}%`, background: fillColor }}
                    />
                    {placement === 'inside' && (
                      openEnded ? (
                        // Open-ended bars fade out on the right, so keep the title
                        // and % grouped at the left where the bar is fully opaque.
                        <span className="relative z-10 flex items-center gap-1.5 min-w-0">
                          <span className="text-xs font-medium text-white truncate" style={{ textShadow }}>{goal.title}</span>
                          <span className="text-[10px] font-semibold tabular-nums text-white flex-shrink-0" style={{ textShadow }}>{pct}%</span>
                        </span>
                      ) : (
                        <>
                          <span className="relative z-10 text-xs font-medium text-white truncate" style={{ textShadow }}>
                            {goal.title}
                          </span>
                          <span className="relative z-10 text-[10px] font-semibold tabular-nums text-white flex-shrink-0" style={{ textShadow }}>
                            {pct}%
                          </span>
                        </>
                      )
                    )}
                  </button>

                  {/* Outside label for short bars */}
                  {placement !== 'inside' && chartW > 0 && (
                    <button
                      onClick={() => onEditGoal?.(goal)}
                      className={`absolute text-xs font-medium whitespace-nowrap ${textPrimary} hover:text-blue-500 transition-colors`}
                      style={
                        outsideAlign === 'left'
                          ? { left: outsideLeftPx, top: '50%', transform: 'translateY(-50%)' }
                          : { left: outsideLeftPx, top: '50%', transform: 'translate(-100%, -50%)' }
                      }
                      title={outsideLabel}
                    >
                      {outsideLabel}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {hiddenCount > 0 && (
        <p className={`text-xs ${textSecondary} opacity-60`}>
          {hiddenCount} goal{hiddenCount === 1 ? '' : 's'} outside this range (ended before the current month or start beyond the window).
        </p>
      )}
    </div>
  );
};

export default GoalTimeline;
