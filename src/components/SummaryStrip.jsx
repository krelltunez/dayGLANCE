import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, MoreHorizontal } from 'lucide-react';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../context/FeaturesContext.jsx';
import ClockTimePicker from './ClockTimePicker.jsx';
import { dateToString, formatShortDate } from '../utils/taskUtils.js';
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
 * The unblocked pill carries a three-dot menu for the day's START/STOP window
 * (useDayWindows): set or clear the day's bounds, sticky-forward. The menu is a
 * sibling of the pill row, not a child — the row scrolls horizontally and would
 * clip anything popping out of it.
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
    darkMode, textPrimary, textSecondary, borderClass, cardBg,
    use24HourClock, isTablet, formatTime,
  } = useDayPlannerCtx();
  const { getDayWindow, setDayWindow, clearDayWindow } = useFeaturesCtx();

  const [collapsed, setCollapsed] = useState(
    () => phone && localStorage.getItem(COLLAPSE_KEY) !== '0',
  );
  const toggle = () => {
    setCollapsed((c) => {
      localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1');
      return !c;
    });
  };

  const [menuOpen, setMenuOpen] = useState(false);
  // Which bound the clock picker is editing: 'start' | 'stop' | null.
  const [pickerField, setPickerField] = useState(null);

  const dateStr = dateToString(selectedDate);
  const dayWindow = getDayWindow?.(dateStr) ?? null;

  // Tag filter deliberately bypassed: a filtered timeline still occupies the
  // whole day, and computing "unblocked" from a filtered subset would report
  // hidden hours as free.
  const summary = useMemo(
    () => computeDaySummary(getTasksForDate(selectedDate, false), listEndOfDayTime, dayWindow),
    [getTasksForDate, selectedDate, listEndOfDayTime, dayWindow],
  );

  // Empty day with no declared window: nothing to summarize, and "0m unblocked"
  // would claim the opposite of the truth. Render nothing rather than an empty
  // row. (With START/STOP set, an empty day IS measurable and renders.)
  if (summary.unblockedMinutes === null) return null;

  const pill = `flex items-center gap-1.5 px-2.5 py-1 rounded-full flex-shrink-0 border shadow-sm backdrop-blur-sm ${
    darkMode ? 'bg-gray-900/85 border-gray-700' : 'bg-white/90 border-stone-200'
  }`;

  // Menu edits act on the RESOLVED window (day entry or inherited default) —
  // what the user sees in the inputs is what gets stored. Setting either bound
  // is sticky-forward (also becomes the default); Clear affects this day only.
  const updateWindow = (field, value) => {
    setDayWindow(dateStr, {
      start: field === 'start' ? (value || null) : dayWindow?.start ?? null,
      stop: field === 'stop' ? (value || null) : dayWindow?.stop ?? null,
    });
  };

  // Trigger buttons open the same clock picker used everywhere else in the app
  // (FrameEditor, reminders, routines) instead of a bare native time input.
  const timeBtnCls = `px-2.5 py-1 rounded-lg border text-xs font-medium ${darkMode ? 'bg-gray-800 border-gray-600 text-gray-200 hover:bg-gray-700' : 'bg-white border-stone-300 text-stone-800 hover:bg-stone-50'}`;

  const unblockedLabel = (
    <span className="flex items-baseline gap-1">
      <span className={`font-semibold ${textPrimary}`}>{formatMinutes(summary.unblockedMinutes)}</span>
      <span className={textSecondary}>unblocked</span>
    </span>
  );

  return (
    <div className={`sticky bottom-0 z-30 pl-2 pb-2 pointer-events-none ${phone ? 'pr-20' : 'pr-2'}`}>
      {menuOpen && (
        <>
          {/* Backdrop closes on any outside tap/click. */}
          <div className="fixed inset-0 z-40 pointer-events-auto" onClick={() => setMenuOpen(false)} />
          <div className={`absolute bottom-full mb-1 left-2 z-50 pointer-events-auto w-60 rounded-lg border shadow-xl p-3 space-y-2.5 text-xs ${cardBg} ${borderClass}`}>
            <div className={`font-semibold ${textPrimary}`}>Day window</div>
            <p className={textSecondary}>
              Applies to this and future days. Unblocked time is measured between
              the <span className={`font-semibold ${textPrimary}`}>Starts</span> and{' '}
              <span className={`font-semibold ${textPrimary}`}>Ends</span> window.
            </p>
            <div className="flex items-center justify-between gap-2">
              <span className={textSecondary}>Starts</span>
              <button onClick={() => setPickerField('start')} className={timeBtnCls}>
                {dayWindow?.start ? formatTime(dayWindow.start) : 'Set…'}
              </button>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className={textSecondary}>Ends</span>
              <button onClick={() => setPickerField('stop')} className={timeBtnCls}>
                {dayWindow?.stop ? formatTime(dayWindow.stop) : 'Set…'}
              </button>
            </div>
            <button
              onClick={() => { clearDayWindow(dateStr); setMenuOpen(false); }}
              className={`w-full py-1 rounded border ${borderClass} ${textSecondary} hover:opacity-80`}
            >
              Clear for this day
            </button>
          </div>
          {/* Same clock picker as FrameEditor/reminders/routines — full-screen
              overlay at z-[90], above the menu. Unset bounds seed with a
              sensible default so the clock has a hand to start from. */}
          {pickerField && (
            <ClockTimePicker
              value={(pickerField === 'start' ? dayWindow?.start : dayWindow?.stop) ?? (pickerField === 'start' ? '08:00' : '22:00')}
              onChange={(t) => { updateWindow(pickerField, t); setPickerField(null); }}
              onClose={() => setPickerField(null)}
              darkMode={darkMode} isTablet={isTablet ?? false} use24HourClock={use24HourClock}
            />
          )}
        </>
      )}
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
          <span className={pill}>
            {phone && (
              <button onClick={toggle} className={`-ml-1 p-0.5 rounded-full ${textSecondary} hover:opacity-70`} aria-label="Collapse summary">
                <ChevronDown size={13} />
              </button>
            )}
            {unblockedLabel}
            <button
              onClick={() => setMenuOpen((o) => !o)}
              className={`-mr-1 p-0.5 rounded-full ${textSecondary} hover:opacity-70`}
              aria-label="Day window options"
            >
              <MoreHorizontal size={13} />
            </button>
          </span>
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
        </div>
      )}
    </div>
  );
}
