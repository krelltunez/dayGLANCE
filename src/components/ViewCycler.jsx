import React from 'react';
import JoboViewIcon from './JoboViewIcon.jsx';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { cyclerStates, nextState, VIEW_LABEL_KEYS, VIEW_SHORTCUT_KEYS } from '../constants/views.js';
import ViewMenu from './ViewMenu.jsx';
import useViewListPress, { LONG_PRESS_MS } from '../hooks/useViewListPress.js';


const ORANGE = '#fe8b00';

const MultiIcon = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <rect x="2" y="2" width="16" height="16" rx="2" fill={ORANGE} />
  </svg>
);

const DayIcon = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <rect x="1"  y="2" width="5" height="16" rx="1" fill={ORANGE} fillOpacity="1"    />
    <rect x="7.5" y="2" width="5" height="16" rx="1" fill={ORANGE} fillOpacity="0.55" />
    <rect x="14" y="2" width="5" height="16" rx="1" fill={ORANGE} fillOpacity="0.28" />
  </svg>
);

const WeekIcon = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
    {[0, 3, 6, 9, 12, 15, 18].map((x, i) => (
      <rect
        key={i}
        x={x}
        y="2"
        width="2"
        height="16"
        rx="1"
        fill={ORANGE}
        fillOpacity={i === 0 || i === 6 ? 0.5 : 1}
      />
    ))}
  </svg>
);

const SchedIcon = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
    {/* Day-group headers with task blocks beneath — the agenda silhouette */}
    <rect x="2" y="2"    width="9"  height="2.5" rx="1" fill={ORANGE} />
    <rect x="2" y="6"    width="16" height="3.5" rx="1" fill={ORANGE} fillOpacity="0.7" />
    <rect x="2" y="11.5" width="9"  height="2.5" rx="1" fill={ORANGE} />
    <rect x="2" y="15.5" width="16" height="3.5" rx="1" fill={ORANGE} fillOpacity="0.7" />
  </svg>
);

const MonthIcon = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
    {/* Four squares: a month as a grid of weeks */}
    <rect x="2"  y="2"  width="7" height="7" rx="1.5" fill={ORANGE} />
    <rect x="11" y="2"  width="7" height="7" rx="1.5" fill={ORANGE} />
    <rect x="2"  y="11" width="7" height="7" rx="1.5" fill={ORANGE} />
    <rect x="11" y="11" width="7" height="7" rx="1.5" fill={ORANGE} />
  </svg>
);

// JOBO: plan versus actual. Three bars gaining opacity left to right, read as
// Original Plan → Final Plan → Do: an intention becoming what actually
// happened. It is DayIcon run backwards on purpose. DAY fades from today into
// the days ahead; JOBO fills from the plan into the record. The two views are
// the same three-bar family, so the two glyphs should rhyme rather than differ.
// JOBO's icon is shared with the phone toggle.
const JoboIcon = () => <JoboViewIcon size={20} />;

const ICONS = { multi: MultiIcon, day: DayIcon, week: WeekIcon, sched: SchedIcon, month: MonthIcon, jobo: JoboIcon };

// The long press, re-exported for the tests that time it.
export { LONG_PRESS_MS };

const ViewCycler = () => {
  const { setViewMode, effectiveViewMode, textSecondary, canShowViewCycler, showDayDial, hiddenViews } = useDayPlannerCtx();
  const { t } = useTranslation();
  const label = t(VIEW_LABEL_KEYS[effectiveViewMode]);

  // Narrow desktop (1-2 columns) offers MULTI, SCHED and MONTH — DAY/WEEK need
  // the full 3-column breakpoint. MONTH steps out while the Day Dial is up,
  // and views turned off on this device are out altogether.
  const states = cyclerStates(canShowViewCycler, !!showDayDial, hiddenViews?.desktop);

  // Display + cycle from effectiveViewMode, not the raw stored mode: a stored
  // DAY/WEEK at narrow width renders as MULTI, and the picker must agree with
  // what's actually on screen.
  const cycle = () => setViewMode(nextState(states, effectiveViewMode));

  // A click cycles; a long press or a right-click opens the list of views
  // (hooks/useViewListPress.js, shared with the phone's MobileViewToggle).
  const { buttonRef, menuAnchor, closeMenu, consumeClick, pressProps } = useViewListPress();

  const Icon = ICONS[effectiveViewMode] || MultiIcon;

  return (
    <>
    <button
      ref={buttonRef}
      onClick={() => {
        if (consumeClick()) return;
        cycle();
      }}
      {...pressProps}
      aria-haspopup="menu"
      aria-expanded={!!menuAnchor}
      className="flex flex-col items-center justify-center gap-0.5 w-full h-full py-1 hover:bg-black/5 dark:hover:bg-white/5 transition-colors rounded select-none [-webkit-touch-callout:none]"
      title={t('sched.viewTooltip', 'View: {{view}} ({{keys}} or C to switch; right-click or long-press to pick)', { view: label, keys: states.map((v) => VIEW_SHORTCUT_KEYS[v]).join('/') })}
      aria-label={t('sched.viewAria', 'Current view: {{view}}. Click to cycle view, or right-click or long-press to pick one.', { view: label })}
    >
      <Icon />
      <span
        className={`text-[11px] font-semibold tracking-widest uppercase ${textSecondary} leading-none`}
      >
        {label}
      </span>
    </button>
    {menuAnchor && (
      <ViewMenu
        states={states}
        current={effectiveViewMode}
        icons={ICONS}
        anchor={menuAnchor}
        onPick={(view) => { closeMenu({ restoreFocus: true }); setViewMode(view); }}
        onClose={closeMenu}
      />
    )}
    </>
  );
};

export default ViewCycler;
