import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { VIEW_LABEL_KEYS, VIEW_SHORTCUT_KEYS } from '../constants/views.js';

const MENU_WIDTH = 176;
const EDGE = 8;

/**
 * Where the menu opens: under the cycler, left edges aligned, kept inside the
 * window. `anchor` is the cycler's bounding rect.
 */
export function viewMenuPosition(anchor, viewportWidth) {
  const left = Math.max(EDGE, Math.min(anchor.left, viewportWidth - MENU_WIDTH - EDGE));
  return { left, top: anchor.bottom + 4 };
}

/**
 * The view list the cycler opens on a right-click or a long press (#2347): the
 * same views the click cycles through, so a hidden view, MONTH under the Day
 * Dial and DAY/WEEK at narrow widths stay out here too. Each row has its icon,
 * name and number key, the current one ticked. A click on the cycler itself
 * still cycles; this is the way to jump straight to one.
 *
 * Portaled to body: the cycler sits in the calendar's sticky header, whose
 * stacking context would cap the menu under the sidebar and the timeline's
 * own popovers.
 */
export default function ViewMenu({ states, current, icons, anchor, onPick, onClose }) {
  const { t } = useTranslation();
  const { textPrimary, textSecondary, cardBg, borderClass, darkMode } = useDayPlannerCtx();
  const listRef = useRef(null);
  // Whether the press now ending began on the backdrop. Only a press that
  // starts there closes the list: on a touch screen the long press that opened
  // it ends with the finger lifting over the new backdrop, and the browser
  // sends that lift a click (and Android a contextmenu) on whatever is under
  // it, which closed the list as it appeared. A mouse press that starts on the
  // cycler is never a click on the backdrop, so desktop never saw this.
  const pressOnBackdrop = useRef(false);

  // Focus the current view's row on open, so the arrow keys start there.
  useEffect(() => {
    const rows = listRef.current?.querySelectorAll?.('[role="menuitemradio"]');
    if (!rows?.length) return;
    const at = Math.max(0, states.indexOf(current));
    rows[at]?.focus?.();
  }, [states, current]);

  const onKeyDown = (e) => {
    if (e.key === 'Escape' || e.key === 'Tab') {
      e.preventDefault();
      onClose({ restoreFocus: true });
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const rows = [...(listRef.current?.querySelectorAll?.('[role="menuitemradio"]') || [])];
    if (!rows.length) return;
    const at = rows.indexOf(document.activeElement);
    const next = e.key === 'Home' ? 0
      : e.key === 'End' ? rows.length - 1
        : e.key === 'ArrowDown' ? (at + 1) % rows.length
          : (at - 1 + rows.length) % rows.length;
    rows[next]?.focus?.();
  };

  const { left, top } = viewMenuPosition(anchor, typeof window !== 'undefined' ? window.innerWidth : 1024);
  const hover = darkMode ? 'hover:bg-white/10 focus:bg-white/10' : 'hover:bg-black/5 focus:bg-black/5';

  return createPortal(
    <>
      {/* Backdrop: a click or right-click that starts outside the list closes it; a right-click there never opens the browser's menu. */}
      <div
        className="fixed inset-0 z-[80]"
        data-view-menu-backdrop
        onPointerDown={() => { pressOnBackdrop.current = true; }}
        onClick={() => {
          if (!pressOnBackdrop.current) return;
          pressOnBackdrop.current = false;
          onClose({ restoreFocus: false });
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          if (!pressOnBackdrop.current) return;
          pressOnBackdrop.current = false;
          onClose({ restoreFocus: false });
        }}
      />
      <div
        ref={listRef}
        role="menu"
        aria-label={t('sched.viewMenu')}
        data-view-menu
        onKeyDown={onKeyDown}
        className={`fixed z-[81] rounded-lg border shadow-xl py-1 ${cardBg} ${borderClass}`}
        style={{ left, top, width: MENU_WIDTH }}
      >
        {states.map((view) => {
          const Icon = icons[view];
          const selected = view === current;
          return (
            <button
              key={view}
              type="button"
              role="menuitemradio"
              aria-checked={selected}
              data-view-menu-item={view}
              onClick={() => onPick(view)}
              className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-left outline-none ${hover}`}
            >
              {Icon ? <Icon /> : null}
              <span className={`flex-1 text-xs font-semibold tracking-widest uppercase ${textPrimary}`}>
                {t(VIEW_LABEL_KEYS[view])}
              </span>
              <span className="w-3.5 flex justify-center">
                {selected && <Check size={14} className={textPrimary} aria-hidden="true" />}
              </span>
              <kbd className={`text-[11px] font-mono ${textSecondary}`}>{VIEW_SHORTCUT_KEYS[view]}</kbd>
            </button>
          );
        })}
      </div>
    </>,
    document.body,
  );
}
