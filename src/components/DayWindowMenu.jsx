import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../context/FeaturesContext.jsx';
import ClockTimePicker from './ClockTimePicker.jsx';

/**
 * The day-window (Starts/Ends) popover — ONE implementation shared by
 * SummaryStrip (opens upward over the timeline, absolutely positioned in its
 * container) and TitlebarSummaryStrip (portaled to body, opening downward
 * under the macOS title bar). Positioning belongs to the CALLER via
 * anchorClass/anchorStyle on the popover box; the full-screen backdrop and the
 * clock-picker portal are handled here.
 *
 * Menu edits act on the RESOLVED window (day entry or inherited default) —
 * what the user sees in the inputs is what gets stored. Setting either bound
 * is sticky-forward (also becomes the default); Clear affects this day only.
 *
 * The clock picker is PORTALED to document.body (established pattern:
 * ProjectCard, SchedTaskCard): SummaryStrip's container is
 * pointer-events-none (inherited, which made an in-place picker
 * click-transparent) and its sticky z-30 stacking context would cap the
 * picker's z-[90] under root-level chrome like the phone FAB. Unset bounds
 * seed the clock at 08:00 / 22:00 so it has a hand to start from.
 */
export default function DayWindowMenu({ dateStr, onClose, anchorClass = '', anchorStyle }) {
  const {
    darkMode, textPrimary, textSecondary, borderClass, cardBg,
    use24HourClock, isTablet, formatTime,
  } = useDayPlannerCtx();
  const { getDayWindow, setDayWindow, clearDayWindow } = useFeaturesCtx();
  const { t } = useTranslation();

  // Which bound the clock picker is editing: 'start' | 'stop' | null.
  const [pickerField, setPickerField] = useState(null);

  const dayWindow = getDayWindow?.(dateStr) ?? null;

  // Escape closes the popover, matching the other popovers (InboxFilterPopover,
  // DeadlinePickerPopover). While the clock picker is open Escape belongs to it:
  // it dismisses the picker and leaves the menu up, so the user lands back where
  // they were rather than losing the whole popover in one keypress.
  useEffect(() => {
    if (pickerField) return undefined;
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [pickerField, onClose]);

  const updateWindow = (field, value) => {
    setDayWindow(dateStr, {
      start: field === 'start' ? (value || null) : dayWindow?.start ?? null,
      stop: field === 'stop' ? (value || null) : dayWindow?.stop ?? null,
    });
  };

  // Trigger buttons open the same clock picker used everywhere else in the app
  // (FrameEditor, reminders, routines) instead of a bare native time input.
  const timeBtnCls = `px-2.5 py-1 rounded-lg border text-xs font-medium ${darkMode ? 'bg-gray-800 border-gray-600 text-gray-200 hover:bg-gray-700' : 'bg-white border-stone-300 text-stone-800 hover:bg-stone-50'}`;

  return (
    <>
      {/* Backdrop closes on any outside tap/click. */}
      <div className="fixed inset-0 z-40 pointer-events-auto" onClick={onClose} />
      <div
        className={`${anchorClass} z-50 pointer-events-auto w-72 rounded-lg border shadow-xl p-3 space-y-2.5 text-xs ${cardBg} ${borderClass}`}
        style={anchorStyle}
      >
        <div className={`font-semibold ${textPrimary}`}>{t('strip.dayWindow')}</div>
        <p className={textSecondary}>{t('strip.dayWindowDesc')}</p>
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-1.5">
            <span className={textSecondary}>{t('strip.starts')}</span>
            <button onClick={() => setPickerField('start')} className={timeBtnCls}>
              {dayWindow?.start ? formatTime(dayWindow.start) : t('strip.set')}
            </button>
          </span>
          <span className="flex items-center gap-1.5">
            <span className={textSecondary}>{t('strip.ends')}</span>
            <button onClick={() => setPickerField('stop')} className={timeBtnCls}>
              {dayWindow?.stop ? formatTime(dayWindow.stop) : t('strip.set')}
            </button>
          </span>
        </div>
        <button
          onClick={() => { clearDayWindow(dateStr); onClose(); }}
          className={`w-full py-1 rounded border ${borderClass} ${textSecondary} hover:opacity-80`}
        >
          {t('strip.clearForDay')}
        </button>
      </div>
      {pickerField && createPortal(
        <ClockTimePicker
          value={(pickerField === 'start' ? dayWindow?.start : dayWindow?.stop) ?? (pickerField === 'start' ? '08:00' : '22:00')}
          onChange={(t) => { updateWindow(pickerField, t); setPickerField(null); }}
          onClose={() => setPickerField(null)}
          darkMode={darkMode} isTablet={isTablet ?? false} use24HourClock={use24HourClock}
        />,
        document.body,
      )}
    </>
  );
}
