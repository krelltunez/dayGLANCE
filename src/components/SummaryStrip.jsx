import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { formatShortDate } from '../utils/taskUtils.js';
import { computeDaySummary, formatMinutes } from '../utils/daySummary.js';

// Collapse choice is a per-window view preference, same class as
// minimizedSections. Default collapsed: the strip only collapses on phone,
// where timeline vertical space is tightest, and the collapsed pill still
// carries the headline number.
const COLLAPSE_KEY = 'day-planner-summary-strip-collapsed';

/**
 * Summary strip (phase 1): rolls the viewed day's timeline blocks into a row of
 * pills floating over the bottom of the timeline — the day/date, unblocked
 * time, and total time per #tag. Sticky inside the timeline's scroll container,
 * so it costs no layout height; the pill row is width-fit with pointer events
 * scoped to itself, so the grid stays clickable around it.
 *
 * Each pill carries its own opaque-ish blurred background instead of the row
 * having one — floating over arbitrary block colors, per-pill backdrop-blur +
 * border + shadow is what keeps the text legible.
 *
 * All data comes from context; the math lives in utils/daySummary.js.
 *
 * @param phone Phone timeline variant: collapsible to a single pill, no date
 *              pill (the phone timeline shows exactly one day, so the heading
 *              would restate the header), and right clearance for the new-task
 *              FAB (fixed right-4 w-14, z-40 — above this row's z-30) so pills
 *              never slide underneath it. Desktop/tablet pass nothing.
 */
export default function SummaryStrip({ phone = false }) {
  const {
    selectedDate, getTasksForDate, listEndOfDayTime,
    darkMode, textPrimary, textSecondary,
  } = useDayPlannerCtx();

  const [collapsed, setCollapsed] = useState(
    () => phone && localStorage.getItem(COLLAPSE_KEY) !== '0',
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
  // opposite of the truth. Render nothing rather than an empty row.
  if (summary.unblockedMinutes === null) return null;

  const pill = `flex items-center gap-1.5 px-2.5 py-1 rounded-full flex-shrink-0 border shadow-sm backdrop-blur-sm ${
    darkMode ? 'bg-gray-900/85 border-gray-700' : 'bg-white/90 border-stone-200'
  }`;

  const unblockedLabel = (
    <span className="flex items-baseline gap-1">
      <span className={`font-semibold ${textPrimary}`}>{formatMinutes(summary.unblockedMinutes)}</span>
      <span className={textSecondary}>unblocked</span>
    </span>
  );

  return (
    <div className={`sticky bottom-0 z-30 pl-2 pb-2 pointer-events-none ${phone ? 'pr-20' : 'pr-2'}`}>
      {phone && collapsed ? (
        <button onClick={toggle} className={`${pill} pointer-events-auto max-w-full text-xs`}>
          <ChevronUp size={13} className={`flex-shrink-0 ${textSecondary}`} />
          {unblockedLabel}
        </button>
      ) : (
        <div className={`pointer-events-auto w-fit max-w-full flex items-center gap-1.5 overflow-x-auto text-xs ${darkMode ? 'dark-scrollbar' : ''}`}>
          {/* Day/date heading — pins which day the numbers describe, which the
              multi-day desktop view otherwise leaves ambiguous. The phone
              timeline shows exactly one day, so there it is dropped. */}
          {!phone && (
            <span className={pill}>
              <span className={`font-medium ${textPrimary}`}>{formatShortDate(selectedDate)}</span>
            </span>
          )}
          <span className={pill}>{unblockedLabel}</span>
          {summary.categories.map((c) => (
            <span key={c.tag} className={pill}>
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: c.colorHex }} />
              <span className={textPrimary}>#{c.tag}</span>
              <span className={textSecondary}>{formatMinutes(c.minutes)}</span>
            </span>
          ))}
          {summary.untaggedMinutes > 0 && (
            <span className={pill}>
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${darkMode ? 'bg-gray-500' : 'bg-stone-400'}`} />
              <span className={textSecondary}>untagged {formatMinutes(summary.untaggedMinutes)}</span>
            </span>
          )}
          {phone && (
            <button onClick={toggle} className={`${pill} ${textSecondary}`} aria-label="Collapse summary">
              <ChevronDown size={13} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
