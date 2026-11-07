import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Leaf, MoreHorizontal, Zap } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../context/FeaturesContext.jsx';
import DayWindowMenu from './DayWindowMenu.jsx';
import { dateToString, formatShortDate } from '../utils/taskUtils.js';
import { computeDaySummary } from '../utils/daySummary.js';
import { formatDuration } from '../utils/formatDuration.js';
import { HOUR_GUTTER_W } from '../constants/timeline.js';
import { caretSpots, pickCaretSpot } from '../utils/stripCaret.js';

// Collapse choice is a per-window view preference, same class as
// minimizedSections. Default collapsed: the strip only collapses on touch
// devices, where timeline vertical space is the scarce resource, and the
// collapsed pill still carries the headline numbers.
const COLLAPSE_KEY = 'day-planner-summary-strip-collapsed';

// Desktop's own flag, for the gutter caret (#2118). A separate key because it
// is a different control: a tablet turned between portrait (the touch pill)
// and landscape (this caret) would otherwise have one choice drive both.
// Default EXPANDED, unlike the touch strip: on desktop the strip used to be
// always on, and it is the timeline's entry point for the day window.
export const DESKTOP_COLLAPSE_KEY = 'day-planner-summary-strip-desktop-collapsed';

// Where the caret sits in the hour gutter is measured, not assumed: see
// utils/stripCaret.js.

const readStored = (key) => {
  try { return localStorage.getItem(key); } catch { return null; }
};
const writeStored = (key, value) => {
  try { localStorage.setItem(key, value); } catch { /* the session keeps the in-memory choice */ }
};

// Exported (with summaryPillClass) so TitlebarSummaryStrip renders the exact
// same pills — one definition, no drift between the strip and the title bar.
export const EFFORT_DOT = '#6366f1'; // indigo — matches the END marker
export const RESTORE_DOT = '#22c55e'; // green-500 — leaf-green per review; the START marker keeps its teal

export const summaryPillClass = (darkMode) =>
  `flex items-center gap-1.5 px-2.5 py-1 rounded-full flex-shrink-0 border shadow-sm backdrop-blur-sm ${
    darkMode ? 'bg-gray-900/85 border-gray-700' : 'bg-white/90 border-stone-200'
  }`;

/**
 * Summary strip: rolls the viewed day's timeline blocks into a row of pills —
 * the day/date, unblocked time, the Effort/Restore split, and total time per
 * #tag. Normally sticky inside the timeline's scroll container so it costs no
 * layout height, with pointer events scoped to the pills so the grid stays
 * clickable around them.
 *
 * The unblocked pill carries a three-dot menu for the day's START/STOP window
 * (useDayWindows). The open state lives in featuresCtx, not here, so the
 * START/END marker chips on the grid can open the same popover. The menu is a
 * sibling of the pill row, not a child — the row scrolls/wraps and would clip
 * anything popping out of it.
 *
 * On a day with no blocks AND no declared window there are no numbers to show,
 * so the strip renders a single quiet "Set day window" pill instead — the
 * entry point for the one-time setup (sticky-forward defaults mean that once
 * set, future days inherit it and the hint never reappears).
 *
 * Each pill carries its own opaque-ish blurred background instead of the row
 * having one — floating over arbitrary block colors, per-pill backdrop-blur +
 * border + shadow is what keeps the text legible.
 *
 * All data comes from context; the math lives in utils/daySummary.js.
 *
 * @param compact Touch timeline variant — phone AND tablet, which share this
 *              component with desktop but not its input model: collapsible to a
 *              single pill (a tap target, and timeline vertical space is the
 *              scarce resource on a touch device), and the expanded row STACKS
 *              instead of scrolling horizontally, because a horizontally
 *              scrollable row inside a vertically scrolling timeline is a
 *              gesture conflict. Desktop passes nothing.
 * @param fabClearance Right padding for the phone's new-task FAB (fixed
 *              right-4 w-14, z-40 — above this row's z-30). Phone only: tablet
 *              and desktop have no floating button over the timeline, and the
 *              gap would just be dead space.
 * @param staticPlacement In-flow instead of sticky — used by LIST view, where a
 *              sticky overlay reads as an extension of the list's spine. Static
 *              places the strip after the day's content as its own element.
 * @param titlebarPills The macOS title bar is currently carrying today's pills
 *              (DesktopLayout, Electron on darwin, no task running). The bar is
 *              pinned to TODAY, so when today is also the viewed day the two
 *              readouts say the same thing — the strip then hides its pills and
 *              leaves the numbers to the bar. Any other day still needs the
 *              strip, since the bar cannot describe it. Never set alongside
 *              compact: the title bar only exists on macOS desktop.
 */
export default function SummaryStrip({ compact = false, fabClearance = false, staticPlacement = false, titlebarPills = false, gutterInset = HOUR_GUTTER_W }) {
  const {
    selectedDate, getTasksForDate, listEndOfDayTime, visibleDays, isToday,
    darkMode, textPrimary, textSecondary,
  } = useDayPlannerCtx();
  const {
    getDayWindow,
    dayWindowMenuOpen: menuOpen, setDayWindowMenuOpen: setMenuOpen,
  } = useFeaturesCtx();
  const { t } = useTranslation();

  // Desktop and landscape tablet: the floating, horizontal strip collapses
  // into a caret over the hour gutter instead of into a pill (#2118). DAY view
  // never scrolls, so anything the strip covers there cannot be reached; the
  // gutter's foot is the one spot of a timeline nothing else uses.
  const gutterCaret = !compact && !staticPlacement;
  const collapseKey = compact ? COLLAPSE_KEY : DESKTOP_COLLAPSE_KEY;

  const [collapsed, setCollapsed] = useState(() => (
    compact ? readStored(COLLAPSE_KEY) !== '0'
      : gutterCaret ? readStored(DESKTOP_COLLAPSE_KEY) === '1'
      : false
  ));
  const toggle = () => {
    setCollapsed((c) => {
      writeStored(collapseKey, c ? '0' : '1');
      return !c;
    });
  };

  const dateStr = dateToString(selectedDate);
  const dayWindow = getDayWindow?.(dateStr) ?? null;

  // Tag filter deliberately bypassed: a filtered timeline still occupies the
  // whole day, and computing "unblocked" from a filtered subset would report
  // hidden hours as free.
  const summary = useMemo(
    () => computeDaySummary(getTasksForDate(selectedDate), listEndOfDayTime, dayWindow),
    [getTasksForDate, selectedDate, listEndOfDayTime, dayWindow],
  );

  const pill = summaryPillClass(darkMode);

  const unblockedLabel = (
    <span className="flex items-baseline gap-1">
      <span className={`font-semibold ${textPrimary}`}>{formatDuration(summary.unblockedMinutes ?? 0, t)}</span>
      <span className={textSecondary}>{t('strip.unblocked')}</span>
    </span>
  );

  // Compact Effort/Restore readout for the collapsed pill: dots + values, no
  // words. Always included rather than fit-detected — at ~90px it fits beside
  // the unblocked figure on any phone ≥320px, so measurement machinery would
  // buy nothing.
  const energyCompact = summary.blockedMinutes > 0 && (
    <span className="flex items-center gap-1">
      <Zap size={12} className="flex-shrink-0" style={{ color: EFFORT_DOT }} />
      <span className={textSecondary}>{formatDuration(summary.effortMinutes, t)}</span>
      <Leaf size={12} className="flex-shrink-0 ml-0.5" style={{ color: RESTORE_DOT }} />
      <span className={textSecondary}>{formatDuration(summary.restoreMinutes, t)}</span>
    </span>
  );

  // The date pill pins which day the numbers describe — only worth its place
  // when the timeline shows more than one day. Every compact caller today is a
  // single-day timeline (phone, and portrait tablet at visibleDays 1), where it
  // would just restate the date already in the header; the visibleDays test is
  // what keeps that true rather than assuming it, since the compact layouts
  // have no room to spare and would otherwise carry a redundant row. Desktop
  // keeps it unconditionally — a horizontal row has the width, and narrowing
  // that is not this change's business.
  const showDatePill = !compact || visibleDays > 1;

  // Empty day, no declared window: no numbers to show, so the strip becomes the
  // one-time setup hint. Once a window is set anywhere, sticky-forward defaults
  // cover every future day and this state never recurs.
  const isEmptyHint = summary.unblockedMinutes === null;

  // Redundant with the macOS title bar: same day, same numbers, and the bar is
  // actually rendering them. The empty-day hint is deliberately excluded — the
  // title bar omits it (setup lives in the timeline), so hiding here would leave
  // a fresh day with no way to set the window at all.
  const pillsHidden = titlebarPills && isToday && !isEmptyHint;

  // Static (LIST) gets real top padding: it sits right under the day's
  // closing "Good work" line and needs visible separation from it.
  const container = staticPlacement
    ? `relative pt-4 pb-2 pl-2 pointer-events-none ${fabClearance ? 'pr-20' : 'pr-2'}`
    : `sticky bottom-0 z-30 pb-2 pointer-events-none ${fabClearance ? 'pr-20' : 'pr-2'}`;

  // The sticky strip floats over a timeline, and every timeline view opens with
  // an hour gutter. Starting at the container's left edge put the first pill
  // over the hour labels, which the pills say nothing about — they are the DAY's
  // numbers and belong over the day columns. Clearing the gutter also frees
  // WEEK's end-hour toggle, which hangs at the foot of that same column.
  //
  // LIST (staticPlacement) has no gutter and keeps its flush left padding. The
  // width is a prop because the phone's timeline runs a narrower column than
  // the desktop one, and over-indenting a phone would cost more than the
  // overlap did.
  const leftInset = staticPlacement ? undefined : gutterInset + 8;

  // Nothing to fold away when the title bar carries the pills, and the empty-day
  // hint stays out regardless: it is the timeline's only way to set a day
  // window, and it disappears for good once one is set.
  const showCaret = gutterCaret && !pillsHidden && !isEmptyHint;

  // The caret prefers the gutter's right edge, beside the pills, and moves only
  // when something marked `data-gutter-foot` is there (WEEK's end-hour toggle,
  // or its last row's label when rows are short). Re-measured when the
  // timeline resizes, re-renders or scrolls (a zoomed WEEK scrolls its foot
  // into view), coalesced to one measurement a frame.
  const containerRef = useRef(null);
  const [caretSpot, setCaretSpot] = useState(() => caretSpots(gutterInset)[0]);
  useLayoutEffect(() => {
    if (!showCaret) return undefined;
    const el = containerRef.current;
    const host = el?.parentElement;
    if (!el || !host) return undefined;
    const spots = caretSpots(gutterInset);
    let raf = 0;
    const measure = () => {
      raf = 0;
      const marks = [...host.querySelectorAll('[data-gutter-foot]')].map((m) => m.getBoundingClientRect());
      const spot = pickCaretSpot(spots, el.getBoundingClientRect(), marks);
      setCaretSpot((prev) => (prev.left === spot.left && prev.bottom === spot.bottom ? prev : spot));
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(measure); };
    measure();
    const ro = new ResizeObserver(schedule);
    ro.observe(host);
    // Settles on its own: a measurement that changes the caret's style
    // triggers one more, which finds the same spot and sets nothing.
    const mo = new MutationObserver(schedule);
    mo.observe(host, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
    host.addEventListener('scroll', schedule, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      mo.disconnect();
      host.removeEventListener('scroll', schedule);
    };
  }, [showCaret, gutterInset]);

  return (
    <div ref={containerRef} className={container} style={leftInset ? { paddingLeft: leftInset } : undefined}>
      {showCaret && (
        <button
          onClick={toggle}
          aria-expanded={!collapsed}
          aria-label={collapsed ? t('strip.showSummary') : t('strip.hideSummary')}
          title={collapsed ? t('strip.showSummary') : t('strip.hideSummary')}
          className={`absolute pointer-events-auto w-5 h-[26px] rounded-full flex items-center justify-center border shadow-sm backdrop-blur-sm ${textSecondary} hover:opacity-80 ${
            darkMode ? 'bg-gray-900/85 border-gray-700' : 'bg-white/90 border-stone-200'
          }`}
          style={{ left: caretSpot.left, bottom: caretSpot.bottom }}
        >
          {collapsed ? <ChevronRight size={13} /> : <ChevronLeft size={13} />}
        </button>
      )}
      {menuOpen && (
        <DayWindowMenu
          dateStr={dateStr}
          onClose={() => setMenuOpen(false)}
          anchorClass="absolute bottom-full mb-1"
          anchorStyle={{ left: leftInset ?? 8 }}
        />
      )}
      {/* Pills hidden (or folded into the caret), popover still mounted: the grid's START/END marker chips
          open it through the shared featuresCtx flag and this is its only host
          on the timeline, so unmounting the whole strip would leave them dead. */}
      {pillsHidden ? null : isEmptyHint ? (
        <button
          onClick={() => setMenuOpen(true)}
          className={`${pill} pointer-events-auto text-xs ${textSecondary} hover:opacity-80`}
        >
          <MoreHorizontal size={13} className="flex-shrink-0" />
          {t('strip.setDayWindow')}
        </button>
      ) : gutterCaret && collapsed ? null : compact && collapsed ? (
        <button onClick={toggle} className={`${pill} pointer-events-auto max-w-full text-xs`}>
          <ChevronUp size={13} className={`flex-shrink-0 ${textSecondary}`} />
          {unblockedLabel}
          {energyCompact && <span className={textSecondary}>·</span>}
          {energyCompact}
        </button>
      ) : (() => {
        // On a touch device the whole unblocked pill toggles the collapse —
        // symmetric with the collapsed pill, which expands from a tap anywhere
        // on it. Only the three-dot menu opts out (stopPropagation). The caret
        // stays as a visual indicator, not the sole target.
        // Day/date heading — see showDatePill for when it earns its place.
        const datePill = showDatePill && (
          <span className={pill}>
            <span className={`font-medium ${textPrimary}`}>{formatShortDate(selectedDate)}</span>
          </span>
        );

        const unblockedPill = (
          <span
            className={`${pill} ${compact ? 'cursor-pointer' : ''}`}
            onClick={compact ? toggle : undefined}
          >
            {compact && <ChevronDown size={13} className={`-ml-1 flex-shrink-0 ${textSecondary}`} />}
            {unblockedLabel}
            <button
              onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen); }}
              className={`-mr-1 p-0.5 rounded-full ${textSecondary} hover:opacity-70`}
              aria-label="Day window options"
            >
              <MoreHorizontal size={13} />
            </button>
          </span>
        );

        // Energy axis — one combined pill so it reads as a ratio, not a
        // scorecard. Dots reuse the day-window marker palette (indigo/teal)
        // for one coherent color family. Hidden when the day has no blocks
        // (an empty declared window has nothing to classify).
        // Zap deliberately matches the Energy item in the task context menu, so
        // the readout and its override control share a glyph. Leaf is the calm
        // side; an exercise glyph would be wrong here — the classifier files
        // running/gym under RESTORE, and icons must not contradict the numbers.
        const energyPill = summary.blockedMinutes > 0 && (
          <span className={pill}>
            <Zap size={13} className="flex-shrink-0" style={{ color: EFFORT_DOT }} />
            <span className={textPrimary}>{t('strip.effort')}</span>
            <span className={textSecondary}>{formatDuration(summary.effortMinutes, t)}</span>
            <Leaf size={13} className="flex-shrink-0 ml-0.5" style={{ color: RESTORE_DOT }} />
            <span className={textPrimary}>{t('strip.restore')}</span>
            <span className={textSecondary}>{formatDuration(summary.restoreMinutes, t)}</span>
          </span>
        );

        // Planned-vs-done, quiet until there is progress: with nothing done a
        // chip reads exactly as before (total minutes — no "0m/4h" scolding at
        // 8am). Once something completes it becomes done/planned. Denominator
        // is COMPLETABLE minutes: read-only calendar events are fixtures with
        // no completion to track, so a tag whose total includes them shows a
        // smaller denominator than its headline total — that is the honest
        // number, not a bug.
        const chipValue = (total, done, completable) =>
          done > 0 ? `${formatDuration(done, t)}/${formatDuration(completable, t)}` : formatDuration(total, t);

        const tagChips = (
          <>
            {summary.categories.map((c) => (
              <span key={c.tag} className={pill}>
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: c.colorHex }} />
                <span className={textPrimary}>#{c.tag}</span>
                <span className={textSecondary}>{chipValue(c.minutes, c.doneMinutes, c.completableMinutes)}</span>
              </span>
            ))}
            {summary.untaggedMinutes > 0 && (
              <span className={pill}>
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${darkMode ? 'bg-gray-500' : 'bg-stone-400'}`} />
                <span className={textSecondary}>
                  {t('strip.untagged')} {chipValue(summary.untaggedMinutes, summary.untaggedDoneMinutes, summary.untaggedCompletableMinutes)}
                </span>
              </span>
            )}
          </>
        );

        // Floating touch strip: the unblocked pill is the ANCHOR — it keeps
        // the exact bottom-left position it has when collapsed, so the
        // collapse target never moves. Everything else fans out UPWARD in its
        // own row: energy directly above, tag chips above that. One pill per
        // row on the anchor levels also keeps the fan-out clear of the
        // new-task FAB — unblocked + energy side by side could not wrap
        // (anchor stability) and slid underneath it on narrow phones. The
        // in-flow LIST strip reads top-down instead, so there everything
        // stays one wrapping row growing downward.
        if (compact && !staticPlacement) {
          return (
            <div className="pointer-events-auto w-fit max-w-full flex flex-col items-start gap-1.5 text-xs">
              <div className="flex flex-wrap items-center gap-1.5">{tagChips}</div>
              {energyPill && <div className="flex items-center">{energyPill}</div>}
              <div className="flex items-center">{unblockedPill}</div>
            </div>
          );
        }

        return (
          <div className={`pointer-events-auto w-fit max-w-full flex items-center gap-1.5 text-xs ${
            compact ? 'flex-wrap' : `overflow-x-auto ${darkMode ? 'dark-scrollbar' : ''}`
          }`}>
            {datePill}
            {unblockedPill}
            {energyPill}
            {tagChips}
          </div>
        );
      })()}
    </div>
  );
}
