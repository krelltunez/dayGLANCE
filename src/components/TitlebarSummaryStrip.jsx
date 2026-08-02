import { useMemo } from 'react';
import { Leaf, Zap } from 'lucide-react';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../context/FeaturesContext.jsx';
import { dateToString } from '../utils/taskUtils.js';
import { computeDaySummary, formatMinutes } from '../utils/daySummary.js';
import { summaryPillClass, EFFORT_DOT, RESTORE_DOT } from './SummaryStrip.jsx';

/**
 * macOS title bar summary strip — TODAY's headline numbers in the otherwise
 * empty hiddenInset title bar. The bar is app-rendered chrome (DesktopLayout's
 * 28px drag-region div), so these are literally the same pills as the
 * in-timeline strip: class and dot palette are imported from SummaryStrip,
 * not copied, and the math is the same computeDaySummary call.
 *
 * Deliberately DISPLAY-ONLY: the whole bar stays a WebkitAppRegion drag area —
 * no buttons, no day-window menu (the in-timeline strip owns editing), so
 * nothing here needs no-drag carve-outs and dragging the window keeps working
 * everywhere in the bar.
 *
 * Always describes TODAY (a title bar is global chrome, not tied to the
 * selected date) and yields entirely to the NOW bar while a task is running —
 * DesktopLayout renders one or the other, never both.
 *
 * Content order matches the strip: unblocked, Effort/Restore, tag chips (with
 * the same quiet-until-progress done/planned values). The untagged chip and
 * empty-day setup hint are omitted — bar width is finite and setup lives in
 * the timeline. Overflowing chips clip at the right edge.
 */
export default function TitlebarSummaryStrip() {
  const {
    getTasksForDate, listEndOfDayTime, currentTime,
    darkMode, textPrimary, textSecondary,
  } = useDayPlannerCtx();
  const { getDayWindow } = useFeaturesCtx();

  // currentTime ticks every minute, so the numbers roll forward while the
  // window sits idle and the date flips correctly at midnight.
  const todayStr = dateToString(currentTime);
  const summary = useMemo(
    () => computeDaySummary(
      getTasksForDate(new Date(currentTime), false),
      listEndOfDayTime,
      getDayWindow?.(todayStr) ?? null,
    ),
    [getTasksForDate, listEndOfDayTime, getDayWindow, currentTime, todayStr],
  );

  // Nothing to measure (empty day, no declared window): leave the bar empty.
  if (summary.unblockedMinutes === null) return null;

  const pill = summaryPillClass(darkMode);
  const chipValue = (total, done, completable) =>
    done > 0 ? `${formatMinutes(done)}/${formatMinutes(completable)}` : formatMinutes(total);

  return (
    <div className="flex items-center gap-1.5 text-xs font-normal overflow-hidden max-w-full">
      <span className={pill}>
        <span className={`font-semibold ${textPrimary}`}>{formatMinutes(summary.unblockedMinutes)}</span>
        <span className={textSecondary}>unblocked</span>
      </span>
      {summary.blockedMinutes > 0 && (
        <span className={pill}>
          <Zap size={12} className="flex-shrink-0" style={{ color: EFFORT_DOT }} />
          <span className={textSecondary}>{formatMinutes(summary.effortMinutes)}</span>
          <Leaf size={12} className="flex-shrink-0 ml-0.5" style={{ color: RESTORE_DOT }} />
          <span className={textSecondary}>{formatMinutes(summary.restoreMinutes)}</span>
        </span>
      )}
      {summary.categories.map((c) => (
        <span key={c.tag} className={pill}>
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: c.colorHex }} />
          <span className={textPrimary}>#{c.tag}</span>
          <span className={textSecondary}>{chipValue(c.minutes, c.doneMinutes, c.completableMinutes)}</span>
        </span>
      ))}
    </div>
  );
}
