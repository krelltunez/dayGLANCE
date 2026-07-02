import React, { useMemo, useState } from 'react';
import { useDayPlannerCtx } from '../../context/DayPlannerContext.jsx';
import { TAILWIND_TO_HEX, hexToRgba } from '../../utils/colorUtils.js';
import { calculateGoalProgress } from '../../utils/goalProgress.js';

/** Hex value for a Tailwind bg-* class, falling back to blue. */
const toHex = (bgClass) => TAILWIND_TO_HEX[bgClass] || '#3b82f6';

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
 * is static (no horizontal scroll) — bars are clipped to the window.
 */
const GoalTimeline = ({ goals, projects, onEditGoal }) => {
  const { darkMode, textPrimary, textSecondary, tasks, unscheduledTasks, isMobile } = useDayPlannerCtx();
  const [periodKey, setPeriodKey] = useState('6m');
  const period = PERIODS.find(p => p.key === periodKey) || PERIODS[2];

  const allTasks = useMemo(() => [...(tasks || []), ...(unscheduledTasks || [])], [tasks, unscheduledTasks]);

  // Window bounds: [first day of current month, +N months). Computed once per
  // render from `now`; the day granularity is enough for a month-scale chart.
  const { leftEdge, rightEdge, span, todayMs, monthTicks } = useMemo(() => {
    const now = new Date();
    const left = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    const right = new Date(now.getFullYear(), now.getMonth() + period.months, 1, 0, 0, 0, 0);
    const leftMs = left.getTime();
    const rightMs = right.getTime();
    // One tick per month boundary in [left, right].
    const ticks = [];
    for (let i = 0; i <= period.months; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      ticks.push({ ms: d.getTime(), month: d.getMonth(), year: d.getFullYear() });
    }
    return { leftEdge: leftMs, rightEdge: rightMs, span: rightMs - leftMs, todayMs: now.getTime(), monthTicks: ticks };
  }, [period.months]);

  // Fraction (0..1) of the window a given timestamp sits at.
  const frac = (ms) => Math.max(0, Math.min(1, (ms - leftEdge) / span));

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
      // Intersection test against the window.
      const intersects = openEnded
        ? effectiveStart <= rightEdge
        : effectiveStart <= rightEdge && endMs >= leftEdge;
      if (!intersects) continue;

      const sPct = frac(Math.min(effectiveStart, rightEdge)) * 100;
      const ePct = (openEnded ? 1 : frac(endMs)) * 100;
      const progress = calculateGoalProgress(goal.id, projects, allTasks);
      built.push({
        goal,
        leftPct: sPct,
        widthPct: Math.max(ePct - sPct, 1.2),
        clippedLeft: startMs != null && startMs < leftEdge,
        clippedRight: !openEnded && endMs > rightEdge,
        openEnded,
        progress,
      });
    }
    return built.sort((a, b) => (goalStartMs(a.goal) ?? leftEdge) - (goalStartMs(b.goal) ?? leftEdge));
  }, [goals, projects, allTasks, leftEdge, rightEdge, span]); // eslint-disable-line react-hooks/exhaustive-deps

  const hiddenCount = goals.length - rows.length;
  const todayPct = frac(todayMs) * 100;
  const gridColor = darkMode ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
  const LABEL_W = isMobile ? 96 : 148; // left goal-name column

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
        <div className="relative">
          {/* Rows */}
          <div className="flex flex-col">
            {rows.map(({ goal, leftPct, widthPct, clippedLeft, clippedRight, openEnded, progress }) => {
              const hex = toHex(goal.color);
              const pct = Math.round(progress * 100);
              return (
                <div key={goal.id} className="flex items-center h-11">
                  {/* Goal name */}
                  <button
                    onClick={() => onEditGoal?.(goal)}
                    style={{ width: LABEL_W, minWidth: LABEL_W }}
                    className={`text-left text-xs font-medium truncate pr-3 ${textPrimary} hover:text-blue-500 transition-colors`}
                    title={goal.title}
                  >
                    {goal.title}
                  </button>
                  {/* Track */}
                  <div className="relative flex-1 h-7">
                    {/* Bar */}
                    <button
                      onClick={() => onEditGoal?.(goal)}
                      className="absolute top-0 h-7 group"
                      style={{
                        left: `${leftPct}%`,
                        width: `${widthPct}%`,
                        background: hexToRgba(hex, darkMode ? 0.2 : 0.16),
                        borderTopLeftRadius: clippedLeft ? 0 : 8,
                        borderBottomLeftRadius: clippedLeft ? 0 : 8,
                        borderTopRightRadius: clippedRight || openEnded ? 0 : 8,
                        borderBottomRightRadius: clippedRight || openEnded ? 0 : 8,
                        borderLeft: clippedLeft ? `2px dotted ${hex}` : 'none',
                        overflow: 'hidden',
                      }}
                      title={`${goal.title} — ${pct}% complete`}
                    >
                      {/* Completion fill (fuel gauge) */}
                      <div
                        className="absolute inset-y-0 left-0"
                        style={{ width: `${pct}%`, background: hex, opacity: openEnded ? 0.85 : 1 }}
                      />
                      {/* Open-ended fade to signal "no target date" */}
                      {openEnded && (
                        <div
                          className="absolute inset-y-0 right-0 w-1/2"
                          style={{ background: `linear-gradient(to right, transparent, ${darkMode ? 'rgba(17,24,39,0.9)' : 'rgba(255,255,255,0.9)'})` }}
                        />
                      )}
                      {/* Percentage label */}
                      <span
                        className="absolute inset-y-0 right-1.5 flex items-center text-[10px] font-semibold tabular-nums"
                        style={{ color: pct > 55 ? '#fff' : (darkMode ? '#e5e7eb' : '#44403c') }}
                      >
                        {pct}%
                      </span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Month gridlines + today marker overlay (aligned to the track area) */}
          <div
            className="pointer-events-none absolute inset-0"
            style={{ left: LABEL_W }}
          >
            {monthTicks.map((tick, i) => {
              const x = frac(tick.ms) * 100;
              return (
                <div
                  key={tick.ms}
                  className="absolute top-0 bottom-6"
                  style={{ left: `${x}%`, width: 1, background: gridColor }}
                >
                  {i % labelEvery === 0 && (
                    <span
                      className={`absolute -bottom-0.5 text-[10px] ${textSecondary} opacity-70 whitespace-nowrap`}
                      style={{ transform: 'translateX(2px)' }}
                    >
                      {MONTH_ABBR[tick.month]}{tick.month === 0 ? ` '${String(tick.year).slice(2)}` : ''}
                    </span>
                  )}
                </div>
              );
            })}
            {/* Today marker */}
            {todayPct >= 0 && todayPct <= 100 && (
              <div className="absolute top-0 bottom-6" style={{ left: `${todayPct}%`, width: 2, background: '#ef4444' }}>
                <span className="absolute -top-0.5 left-1 text-[10px] font-semibold text-red-500 whitespace-nowrap">Today</span>
              </div>
            )}
          </div>
          {/* Spacer for the axis labels row */}
          <div className="h-6" />
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
