import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../../context/DayPlannerContext.jsx';
import SchedView from '../sched/SchedView.jsx';
import useSheetDismissal from '../../hooks/useSheetDismissal.js';
import { formatLocalizedDate } from '../../utils/localeFormatting.js';

// Month view day sheet (step 4). Tapping a cell opens this: the day's agenda
// rendered by SCHED scoped to that one date, so the cards, completion
// toggles and edit affordances are exactly the ones people already know.
// A bottom sheet at ~88% of the height on every platform (a sheet, not a
// popup anchored to the cell), with the content scrolling inside it.
//
// Dismissal: Escape; browser and Android back through a pushed history
// entry (the Android WebView pops it with goBack()); pull-down from the top
// of the content and a drag on the handle; a left-edge swipe for iOS, which
// has no free back gesture; the backdrop; and the close button. All of it
// is one controller (utils/sheetDismissal.js) so each path closes once.
//
// Stacking: z-[46], above the month overlay and the tab bar (40), below the
// filter popup and the task editors (50, 80) that open from inside it.

export const MONTH_DAY_SHEET_HISTORY_KEY = 'monthDaySheet';

/**
 * @param {object} props
 * @param {string} props.date       YYYY-MM-DD; the sheet shows this one day
 * @param {() => void} props.onClose
 */
export default function MonthDaySheet({ date, onClose }) {
  const { cardBg, borderClass, textPrimary, textSecondary, hoverBg } = useDayPlannerCtx();
  const { t, i18n } = useTranslation();
  const scrollRef = useRef(null);
  const [entered, setEntered] = useState(false);
  useEffect(() => { const id = requestAnimationFrame(() => setEntered(true)); return () => cancelAnimationFrame(id); }, []);

  const { dismiss, dragOffset, dragging, handleProps, contentProps } = useSheetDismissal({
    open: !!date, key: MONTH_DAY_SHEET_HISTORY_KEY, onClose, scrollRef,
  });
  if (!date) return null;

  const language = i18n.resolvedLanguage || i18n.language || 'en';
  const title = formatLocalizedDate(new Date(`${date}T12:00:00`), { weekday: 'long', month: 'long', day: 'numeric' }, language);

  return (
    <div data-month-day-sheet={date} className="fixed inset-0 z-[46] flex flex-col justify-end" role="presentation">
      <div data-month-day-sheet-backdrop className="absolute inset-0 bg-black/40" onClick={dismiss} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`relative w-full sm:max-w-2xl sm:mx-auto ${cardBg} ${textPrimary} rounded-t-2xl shadow-xl flex flex-col
          h-[88vh] ${dragging ? '' : 'transition-transform duration-200 ease-out'}`}
        style={{
          transform: `translateY(${entered ? dragOffset : 2000}px)`,
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        }}
      >
        <div data-month-day-sheet-handle {...handleProps} className={`shrink-0 flex items-center gap-2 px-3 pt-2 pb-1 border-b ${borderClass} cursor-grab active:cursor-grabbing select-none`}>
          <div className="absolute left-1/2 -translate-x-1/2 top-1.5 w-10 h-1 rounded-full bg-stone-300 dark:bg-gray-600" aria-hidden="true" />
          <span className="text-sm font-semibold pt-2 truncate">{title}</span>
          <button
            type="button"
            onClick={dismiss}
            aria-label={t('common.close')}
            className={`ml-auto mt-1 p-1.5 rounded-lg ${textSecondary} ${hoverBg}`}
          >
            <X size={16} />
          </button>
        </div>
        <div ref={scrollRef} {...contentProps} data-month-day-sheet-content className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
          <SchedView dateRange={{ from: date, to: date }} embedded />
        </div>
      </div>
    </div>
  );
}
