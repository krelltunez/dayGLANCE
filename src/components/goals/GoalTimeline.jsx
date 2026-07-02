import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../../context/DayPlannerContext.jsx';
import { TAILWIND_TO_HEX } from '../../utils/colorUtils.js';
import { calculateGoalProgress } from '../../utils/goalProgress.js';

/** Hex value for a Tailwind bg-* class, falling back to blue. */
const toHex = (bgClass) => TAILWIND_TO_HEX[bgClass] || '#3b82f6';

/** Blend a #rrggbb hex toward white by `amt` (0..1); returns an rgb() string. */
const lighten = (hex, amt) => {
  const c = (i) => { const v = parseInt(hex.slice(i, i + 2), 16); return Math.round(v + (255 - v) * amt); };
  return `rgb(${c(1)}, ${c(3)}, ${c(5)})`;
};
/** Blend a #rrggbb hex toward black by `amt` (0..1); returns an rgb() string.
 *  Used for the text-pill backgrounds so labels keep contrast on any bar. */
const darken = (hex, amt) => {
  const f = 1 - amt;
  const c = (i) => Math.max(0, Math.min(255, Math.round(parseInt(hex.slice(i, i + 2), 16) * f)));
  return `rgb(${c(1)}, ${c(3)}, ${c(5)})`;
};

// Fade applied to open-ended (no target) bars: the bar dissolves into the page
// background instead of fading to a hardcoded colour, so it works in any theme.
const OPEN_ENDED_MASK = 'linear-gradient(to right, #000 0%, #000 55%, transparent 100%)';

const PERIODS = [
  { key: '1m', label: '1M', months: 1 },
  { key: '3m', label: '3M', months: 3 },
  { key: '6m', label: '6M', months: 6 },
  { key: '1y', label: '1Y', months: 12 },
  { key: '2y', label: '2Y', months: 24 },
];

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const TOP_PAD = 24;     // space above the first row
const BOTTOM_PAD = 30;  // space for the month labels below the last row
const ROW_H = 44;       // per-goal row height (px)
const BAR_H = 28;       // bar height (px)
const HEADER_H = 30;    // area group header height (px)
const CHAR_PX = 5.7;    // rough width of a pill character, for label-fit estimates

const goalStartMs = (goal) => {
  if (goal.startDate) return new Date(goal.startDate + 'T00:00:00').getTime();
  if (goal.createdAt) return new Date(goal.createdAt).getTime();
  return null;
};
const goalEndMs = (goal) => (goal.targetDate ? new Date(goal.targetDate + 'T00:00:00').getTime() : null);

/**
 * Temporal (Gantt/roadmap) view of goals grouped by Area. Each goal is a bar
 * from its start → target date: the remaining portion is a light tint of the
 * goal's colour and the completed portion is the full swatch colour (a fuel
 * gauge). Labels ride in darker pills so they stay legible on any bar. The left
 * edge is fixed at the current month; the period selector zooms out (1M–2Y).
 */
const GoalTimeline = ({ goals, projects, areas = [], selectedGoalId, onSelectGoal }) => {
  const { darkMode, textPrimary, textSecondary, tasks, unscheduledTasks, isMobile } = useDayPlannerCtx();
  const { t } = useTranslation();
  const [periodKey, setPeriodKey] = useState('6m');
  const period = PERIODS.find(p => p.key === periodKey) || PERIODS[2];

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

  const { leftEdge, span, monthTicks, nowYear } = useMemo(() => {
    const now = new Date();
    const left = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    const right = new Date(now.getFullYear(), now.getMonth() + period.months, 1, 0, 0, 0, 0);
    const ticks = [];
    for (let i = 0; i <= period.months; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      ticks.push({ ms: d.getTime(), month: d.getMonth(), year: d.getFullYear() });
    }
    return { leftEdge: left.getTime(), span: right.getTime() - left.getTime(), monthTicks: ticks, nowYear: now.getFullYear() };
  }, [period.months]);

  const frac = (ms) => Math.max(0, Math.min(1, (ms - leftEdge) / span));
  const rightEdgeMs = leftEdge + span;

  let labelEvery;
  if (period.months <= 6) labelEvery = 1;
  else if (period.months <= 12) labelEvery = isMobile ? 2 : 1;
  else labelEvery = isMobile ? 4 : 3;

  // Short date like "Dec 20", adding the year only when it isn't the current one.
  const fmtDate = (ymd) => {
    const d = new Date(ymd + 'T00:00:00');
    const base = `${MONTH_ABBR[d.getMonth()]} ${d.getDate()}`;
    return d.getFullYear() === nowYear ? base : `${base} '${String(d.getFullYear()).slice(2)}`;
  };
  const daysLabel = (goal) => {
    if (!goal.targetDate) return null;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const diff = Math.ceil((new Date(goal.targetDate + 'T00:00:00') - today) / 86400000);
    if (diff === 0) return t('goals.dueToday');
    if (diff < 0) return t('goals.daysOverdue', { count: Math.abs(diff) });
    return t('goals.daysLeft', { count: diff });
  };

  // Per-goal geometry + metadata, in-range only, sorted by start.
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
      built.push({
        goal,
        leftPct: sPct,
        widthPct: Math.max(ePct - sPct, 1.2),
        clippedLeft: startMs != null && startMs < leftEdge,
        clippedRight: !openEnded && endMs > rightEdgeMs,
        openEnded,
        progress: calculateGoalProgress(goal.id, projects, allTasks),
        projCount: projects.filter(p => p.goalId === goal.id && p.status !== 'archived').length,
      });
    }
    return built.sort((a, b) => (goalStartMs(a.goal) ?? leftEdge) - (goalStartMs(b.goal) ?? leftEdge));
  }, [goals, projects, allTasks, leftEdge, span]); // eslint-disable-line react-hooks/exhaustive-deps

  // Group rows by area (ordered), with an unassigned group last.
  const groups = useMemo(() => {
    const sortedAreas = [...areas].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const byArea = new Map();
    const noArea = [];
    for (const r of rows) {
      const aid = r.goal.areaId;
      const area = aid && sortedAreas.find(a => a.id === aid);
      if (area) { if (!byArea.has(aid)) byArea.set(aid, []); byArea.get(aid).push(r); }
      else noArea.push(r);
    }
    const gs = [];
    for (const a of sortedAreas) { const rs = byArea.get(a.id); if (rs && rs.length) gs.push({ area: a, rows: rs }); }
    if (noArea.length) gs.push({ area: null, rows: noArea });
    return gs;
  }, [rows, areas]);

  const hiddenCount = goals.length - rows.length;
  const gridColor = darkMode ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';

  const renderBar = (row) => {
    const { goal, leftPct, widthPct, clippedLeft, clippedRight, openEnded, progress, projCount } = row;
    const hex = toHex(goal.color);
    const selected = goal.id === selectedGoalId;
    const pct = Math.round(progress * 100);
    const trackColor = lighten(hex, 0.5);   // remaining portion: light tint of swatch
    const fillColor = hex;                    // completed portion: true swatch colour
    const pillBg = darken(hex, 0.45);         // darker same-family bg → white text reads

    const dLabel = daysLabel(goal);
    const projLabel = t('goals.projectCount', { count: projCount });
    const endLabel = openEnded ? null : (goal.targetDate ? fmtDate(goal.targetDate) : null);
    const pctLabel = `${pct}%`;

    const leftText = [goal.title, dLabel, projLabel].filter(Boolean).join('  ·  ');
    const rightText = [endLabel, pctLabel].filter(Boolean).join('  ·  ');
    const combinedText = openEnded
      ? [goal.title, projLabel, pctLabel].filter(Boolean).join('  ·  ')
      : [leftText, rightText].filter(Boolean).join('  ·  ');

    const barWpx = (widthPct / 100) * chartW;
    const barLeftPx = (leftPct / 100) * chartW;
    const est = (s) => s.length * CHAR_PX + 18;
    const estL = est(leftText), estR = est(rightText), estC = est(combinedText);

    // Placement: split (two pills inside) → combined inside → combined outside.
    let mode, outLeft = 0, outAlign = 'left';
    if (!openEnded && chartW > 0 && barWpx >= estL + estR + 12) {
      mode = 'split';
    } else if (chartW === 0 || barWpx >= estC + 6) {
      mode = 'inside';
    } else {
      mode = 'outside';
      const rightPos = barLeftPx + barWpx + 6;
      if (rightPos + estC <= chartW) { outLeft = rightPos; outAlign = 'left'; }
      else if (barLeftPx - estC - 6 >= 0) { outLeft = barLeftPx - 6; outAlign = 'right'; }
      else { mode = 'inside'; } // nowhere to go — clip inside
    }

    const Pill = ({ children, className = '' }) => (
      <span
        className={`relative z-10 inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium text-white whitespace-nowrap ${className}`}
        style={{ background: pillBg }}
      >
        {children}
      </span>
    );

    const tooltip = [
      goal.title,
      goal.startDate ? `${t('goals.start')}: ${fmtDate(goal.startDate)}` : null,
      goal.targetDate ? `${t('goals.target')}: ${fmtDate(goal.targetDate)}` : t('goals.noTarget'),
      dLabel,
      projLabel,
      t('goals.completePct', { pct }),
    ].filter(Boolean).join('\n');

    const dimmed = selectedGoalId && !selected;
    return (
      <div
        key={goal.id}
        className="relative w-full flex items-center transition-opacity duration-200"
        style={{ height: ROW_H, opacity: dimmed ? 0.32 : 1 }}
      >
        <button
          onClick={() => onSelectGoal?.(goal.id)}
          className="absolute flex items-center px-1.5"
          style={{
            left: `${leftPct}%`,
            width: `${widthPct}%`,
            height: BAR_H,
            justifyContent: mode === 'split' ? 'space-between' : 'flex-start',
            background: trackColor,
            borderTopLeftRadius: clippedLeft ? 0 : 8,
            borderBottomLeftRadius: clippedLeft ? 0 : 8,
            borderTopRightRadius: clippedRight || openEnded ? 0 : 8,
            borderBottomRightRadius: clippedRight || openEnded ? 0 : 8,
            borderLeft: clippedLeft ? `2px dotted ${fillColor}` : 'none',
            overflow: 'hidden',
            boxShadow: selected ? `0 0 0 2px ${darkMode ? '#0f172a' : '#ffffff'}, 0 0 0 4px ${fillColor}` : 'none',
            ...(openEnded ? { maskImage: OPEN_ENDED_MASK, WebkitMaskImage: OPEN_ENDED_MASK } : {}),
          }}
          title={tooltip}
        >
          {/* Completion fill (fuel gauge) */}
          <div className="absolute inset-y-0 left-0 pointer-events-none" style={{ width: `${pct}%`, background: fillColor }} />
          {mode === 'split' && (<><Pill>{leftText}</Pill><Pill>{rightText}</Pill></>)}
          {mode === 'inside' && (<Pill className="max-w-full overflow-hidden"><span className="truncate">{combinedText}</span></Pill>)}
        </button>

        {mode === 'outside' && chartW > 0 && (
          <button
            onClick={() => onSelectGoal?.(goal.id)}
            className="absolute z-10"
            style={outAlign === 'left'
              ? { left: outLeft, top: '50%', transform: 'translateY(-50%)' }
              : { left: outLeft, top: '50%', transform: 'translate(-100%, -50%)' }}
            title={tooltip}
          >
            <Pill>{combinedText}</Pill>
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Period selector */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className={`text-xs font-medium ${textSecondary} mr-1`}>{t('goals.range')}</span>
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
          {t('goals.noGoalsInRange')}
        </div>
      ) : (
        <div ref={chartRef} className="relative w-full">
          {/* Month gridlines + labels (behind the bars) */}
          <div className="pointer-events-none absolute inset-0">
            {monthTicks.map((tick, i) => {
              if (i % labelEvery !== 0) return null;
              const x = frac(tick.ms) * 100;
              const atRightEdge = x > 99;
              return (
                <div key={tick.ms} className="absolute" style={{ left: `${x}%`, top: TOP_PAD, bottom: BOTTOM_PAD, width: 1, background: gridColor }}>
                  <span
                    className={`absolute text-[10px] ${textSecondary} opacity-70 whitespace-nowrap`}
                    style={{ bottom: -BOTTOM_PAD + 8, ...(atRightEdge ? { right: 2, textAlign: 'right' } : { left: 2 }) }}
                  >
                    {MONTH_ABBR[tick.month]}{tick.month === 0 ? ` '${String(tick.year).slice(2)}` : ''}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Grouped rows */}
          <div style={{ paddingTop: TOP_PAD, paddingBottom: BOTTOM_PAD }}>
            {groups.map((g) => (
              <div key={g.area?.id || '__none__'}>
                <div
                  className="relative z-10 flex items-center gap-1.5 transition-opacity duration-200"
                  style={{ height: HEADER_H, opacity: selectedGoalId && !g.rows.some(r => r.goal.id === selectedGoalId) ? 0.32 : 1 }}
                >
                  <span
                    className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{ background: g.area ? toHex(g.area.color) : (darkMode ? '#6b7280' : '#9ca3af') }}
                  />
                  <span className={`text-xs font-semibold ${textPrimary} truncate`}>
                    {g.area ? (g.area.name || t('goals.untitledArea')) : t('goals.noDefinedArea')}
                  </span>
                </div>
                {g.rows.map(renderBar)}
              </div>
            ))}
          </div>
        </div>
      )}

      {hiddenCount > 0 && (
        <p className={`text-xs ${textSecondary} opacity-60`}>
          {t('goals.goalsOutsideRange', { count: hiddenCount })}
        </p>
      )}
    </div>
  );
};

export default GoalTimeline;
