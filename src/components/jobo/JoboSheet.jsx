import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../../context/DayPlannerContext.jsx';
import useSheetDismissal from '../../hooks/useSheetDismissal.js';

/**
 * A near-full-height sheet for JOBO on the phone (slice 8, step 3): the
 * Check and the statistics. It takes MONTH's day sheet's dismissal
 * (hooks/useSheetDismissal.js): the back button, a pull down from the top of
 * its content or on its handle, the left-edge swipe, Escape, the X and the
 * backdrop. Every one of them leaves through the sheet's history entry, so a
 * later back press is never swallowed by a stale one; `children` may be a
 * function given that same `dismiss`, for a close button of its own.
 *
 * It sits under the task form (z-[80]), so a Check action that opens the
 * form opens it over the sheet, and closing the form comes back to it. For
 * that the two must share a stacking context: the app shell is
 * position: fixed, which makes it one, so the sheet is placed inside it
 * (sheetHost) rather than on <body>, where z-[60] outranked the whole shell
 * and every form in it.
 */
export const sheetHost = (doc = typeof document === 'undefined' ? null : document) =>
  (typeof doc?.querySelector === 'function' ? doc.querySelector('.app-shell') : null) || doc?.body || null;

export default function JoboSheet({ historyKey, title, subtitle, onClose, children, ...rest }) {
  const { t } = useTranslation();
  const { cardBg, borderClass, textPrimary, textSecondary, hoverBg } = useDayPlannerCtx() || {};
  const scrollRef = useRef(null);
  const [entered, setEntered] = useState(false);
  useEffect(() => { const id = requestAnimationFrame(() => setEntered(true)); return () => cancelAnimationFrame(id); }, []);
  const { dismiss, dragOffset, dragging, handleProps, contentProps } = useSheetDismissal({
    open: true, key: historyKey, onClose, scrollRef,
  });
  return createPortal(
    <div className="fixed inset-0 z-[60] flex flex-col justify-end" role="presentation" {...rest}>
      <div className="absolute inset-0 bg-black/40" onClick={dismiss} data-jobo-sheet-backdrop />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`relative w-full sm:max-w-2xl sm:mx-auto ${cardBg} ${textPrimary} rounded-t-2xl shadow-xl flex flex-col
          h-[90vh] ${dragging ? '' : 'transition-transform duration-200 ease-out'}`}
        style={{ transform: `translateY(${entered ? dragOffset : 2000}px)`, paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        <div {...handleProps} data-jobo-sheet-handle className={`relative shrink-0 flex items-center gap-2 px-4 pt-3 pb-2 border-b ${borderClass} cursor-grab active:cursor-grabbing select-none`}>
          <div className="absolute left-1/2 -translate-x-1/2 top-1.5 w-10 h-1 rounded-full bg-stone-300 dark:bg-gray-600" aria-hidden="true" />
          <div className="min-w-0 pt-1">
            <div className="text-sm font-semibold truncate">{title}</div>
            {subtitle && <div className={`text-xs truncate ${textSecondary}`}>{subtitle}</div>}
          </div>
          <button type="button" onClick={dismiss} aria-label={t('common.close')} data-jobo-sheet-close
            className={`ml-auto p-1.5 rounded-lg ${textSecondary} ${hoverBg}`}>
            <X size={16} />
          </button>
        </div>
        <div ref={scrollRef} {...contentProps} className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
          {typeof children === 'function' ? children(dismiss) : children}
        </div>
      </div>
    </div>,
    sheetHost(),
  );
}
