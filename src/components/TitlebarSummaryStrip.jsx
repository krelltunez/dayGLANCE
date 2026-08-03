import { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Leaf, MoreHorizontal, Zap } from 'lucide-react';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../context/FeaturesContext.jsx';
import { dateToString, formatShortDate } from '../utils/taskUtils.js';
import { computeDaySummary, formatMinutes } from '../utils/daySummary.js';
import { summaryPillClass, EFFORT_DOT, RESTORE_DOT } from './SummaryStrip.jsx';
import DayWindowMenu from './DayWindowMenu.jsx';

/**
 * macOS title bar summary strip — TODAY's headline numbers in the otherwise
 * empty hiddenInset title bar. The bar is app-rendered chrome (DesktopLayout's
 * 28px drag-region div), so these are literally the same pills as the
 * in-timeline strip: class and dot palette are imported from SummaryStrip,
 * not copied, and the math is the same computeDaySummary call.
 *
 * The unblocked pill is INTERACTIVE (WebkitAppRegion no-drag, the one
 * carve-out): it opens the same shared DayWindowMenu the timeline strip uses,
 * editing TODAY's window — portaled to document.body and opened DOWNWARD,
 * because the title bar div is overflow-hidden and sits at the top of the
 * screen. Everything else stays drag area, so window-dragging keeps working
 * across the rest of the bar.
 *
 * Always describes TODAY (a title bar is global chrome, not tied to the
 * selected date) and yields entirely to the NOW bar while a task is running —
 * DesktopLayout renders one or the other, never both.
 *
 * Content order matches the strip: date, unblocked, Effort/Restore, tag chips
 * (with the same quiet-until-progress done/planned values). The untagged chip
 * and empty-day setup hint are omitted — bar width is finite and setup lives
 * in the timeline. Overflowing chips clip at the right edge.
 */
export default function TitlebarSummaryStrip() {
  const {
    getTasksForDate, listEndOfDayTime, currentTime,
    darkMode, textPrimary, textSecondary,
  } = useDayPlannerCtx();
  const { getDayWindow } = useFeaturesCtx();

  const [menuOpen, setMenuOpen] = useState(false);
  const [menuLeft, setMenuLeft] = useState(12);
  const pillRef = useRef(null);

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

  const openMenu = () => {
    // Anchor the popover under the pill, clamped so its 288px box stays
    // on-screen at narrow window widths.
    const r = pillRef.current?.getBoundingClientRect();
    if (r) setMenuLeft(Math.max(8, Math.min(r.left, window.innerWidth - 296)));
    setMenuOpen(true);
  };

  return (
    <div className="flex items-center gap-1.5 text-xs font-normal overflow-hidden max-w-full">
      <span className={pill}>
        <span className={`font-medium ${textPrimary}`}>{formatShortDate(new Date(currentTime))}</span>
      </span>
      <span
        ref={pillRef}
        className={`${pill} cursor-pointer hover:opacity-80`}
        style={{ WebkitAppRegion: 'no-drag' }}
        onClick={openMenu}
      >
        <span className={`font-semibold ${textPrimary}`}>{formatMinutes(summary.unblockedMinutes)}</span>
        <span className={textSecondary}>unblocked</span>
        <MoreHorizontal size={13} className={`-mr-1 flex-shrink-0 ${textSecondary}`} />
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
      {menuOpen && createPortal(
        <DayWindowMenu
          dateStr={todayStr}
          onClose={() => setMenuOpen(false)}
          anchorClass="fixed"
          anchorStyle={{ top: 34, left: menuLeft }}
        />,
        document.body,
      )}
    </div>
  );
}
