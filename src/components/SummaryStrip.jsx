import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { computeDaySummary, formatMinutes } from '../utils/daySummary.js';

// Collapse choice is a per-window view preference, same class as
// minimizedSections. Default collapsed: the strip only collapses on phone,
// where timeline vertical space is tightest, and the collapsed line still
// carries the headline number.
const COLLAPSE_KEY = 'day-planner-summary-strip-collapsed';

/**
 * Summary strip (phase 1): rolls the viewed day's timeline blocks into one
 * glanceable row — unblocked time plus total time per #tag. Sticks to the
 * bottom of the timeline's scroll container, so it stays visible over the grid
 * without costing the layout any fixed height.
 *
 * All data comes from context; the math lives in utils/daySummary.js.
 *
 * @param collapsible Phone only — renders a one-line summary that expands on
 *                    tap. Desktop/tablet pass nothing and are always expanded.
 */
export default function SummaryStrip({ collapsible = false }) {
  const {
    selectedDate, getTasksForDate, listEndOfDayTime,
    darkMode, cardBg, borderClass, textPrimary, textSecondary,
  } = useDayPlannerCtx();

  const [collapsed, setCollapsed] = useState(
    () => collapsible && localStorage.getItem(COLLAPSE_KEY) !== '0',
  );
  const toggle = () => {
    setCollapsed((c) => {
      localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1');
      return !c;
    });
  };

  // Tag filter deliberately bypassed: a filtered timeline still occupies the
  // whole day, and computing "unblocked" from a filtered subset would report
  // hidden hours as free.
  const summary = useMemo(
    () => computeDaySummary(getTasksForDate(selectedDate, false), listEndOfDayTime),
    [getTasksForDate, selectedDate, listEndOfDayTime],
  );

  // Empty day: nothing to summarize, and "0m unblocked" would claim the
  // opposite of the truth. Render nothing rather than an empty bar.
  if (summary.unblockedMinutes === null) return null;

  const chipBg = darkMode ? 'bg-white/10' : 'bg-black/5';
  const topCategory = summary.categories[0];

  const unblockedLabel = (
    <span className="flex items-baseline gap-1 flex-shrink-0">
      <span className={`font-semibold ${textPrimary}`}>{formatMinutes(summary.unblockedMinutes)}</span>
      <span className={textSecondary}>unblocked</span>
    </span>
  );

  return (
    <div className={`sticky bottom-0 z-30 ${cardBg} border-t ${borderClass} px-3 py-1.5 text-xs`}>
      {collapsible && collapsed ? (
        <button onClick={toggle} className="w-full flex items-center gap-2 text-left">
          <ChevronUp size={14} className={`flex-shrink-0 ${textSecondary}`} />
          {unblockedLabel}
          {topCategory && (
            <span className={`truncate ${textSecondary}`}>
              · #{topCategory.tag} {formatMinutes(topCategory.minutes)}
            </span>
          )}
        </button>
      ) : (
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0 flex items-center gap-2 overflow-x-auto whitespace-nowrap">
            {unblockedLabel}
            {summary.categories.map((c) => (
              <span key={c.tag} className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full flex-shrink-0 ${chipBg}`}>
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: c.colorHex }} />
                <span className={textPrimary}>#{c.tag}</span>
                <span className={textSecondary}>{formatMinutes(c.minutes)}</span>
              </span>
            ))}
            {summary.untaggedMinutes > 0 && (
              <span className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full flex-shrink-0 ${chipBg}`}>
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${darkMode ? 'bg-gray-500' : 'bg-stone-400'}`} />
                <span className={textSecondary}>untagged {formatMinutes(summary.untaggedMinutes)}</span>
              </span>
            )}
          </div>
          {collapsible && (
            <button onClick={toggle} className={`flex-shrink-0 p-0.5 ${textSecondary}`} aria-label="Collapse summary">
              <ChevronDown size={14} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
