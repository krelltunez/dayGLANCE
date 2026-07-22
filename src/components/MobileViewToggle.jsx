import React from 'react';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';

const ORANGE = '#fe8b00';

const GridIcon = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
    <rect x="1"  y="1"  width="7" height="7" rx="1.5" fill={ORANGE} />
    <rect x="10" y="1"  width="7" height="7" rx="1.5" fill={ORANGE} fillOpacity="0.55" />
    <rect x="1"  y="10" width="7" height="7" rx="1.5" fill={ORANGE} fillOpacity="0.55" />
    <rect x="10" y="10" width="7" height="7" rx="1.5" fill={ORANGE} fillOpacity="0.28" />
  </svg>
);

const ListIcon = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
    {/* Vertical spine — flush left */}
    <rect x="1" y="1" width="2" height="16" rx="1" fill={ORANGE} />
    {/* Blocks to the right */}
    <rect x="5" y="2"  width="12" height="4" rx="1" fill={ORANGE} />
    <rect x="5" y="8"  width="12" height="4" rx="1" fill={ORANGE} fillOpacity="0.7" />
    <rect x="5" y="14" width="9"  height="3" rx="1" fill={ORANGE} fillOpacity="0.45" />
  </svg>
);

const SchedIcon = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
    {/* Day-group headers with task blocks beneath — the agenda silhouette */}
    <rect x="1" y="1"  width="8"  height="2.5" rx="1" fill={ORANGE} />
    <rect x="1" y="5"  width="16" height="3.5" rx="1" fill={ORANGE} fillOpacity="0.7" />
    <rect x="1" y="10.5" width="8"  height="2.5" rx="1" fill={ORANGE} />
    <rect x="1" y="14.5" width="16" height="3.5" rx="1" fill={ORANGE} fillOpacity="0.7" />
  </svg>
);

// GRID → LIST → SCHED → GRID
const NEXT_MODE = { grid: 'list', list: 'sched', sched: 'grid' };

const MobileViewToggle = () => {
  const { mobileViewMode, setMobileViewMode, textSecondary } = useDayPlannerCtx();
  const { t } = useTranslation();

  const toggle = () => setMobileViewMode(prev => NEXT_MODE[prev] || 'grid');

  return (
    <button
      onClick={toggle}
      className="flex flex-col items-center justify-center gap-0.5 w-full h-full py-1 hover:bg-black/5 dark:hover:bg-white/5 active:bg-black/10 dark:active:bg-white/10 transition-colors"
      aria-label={t('sched.switchToView', 'Switch to {{view}} view', { view: (NEXT_MODE[mobileViewMode] || 'grid').toUpperCase() })}
      title={t('sched.currentViewTap', 'Current view: {{view}}. Tap to switch.', { view: mobileViewMode.toUpperCase() })}
    >
      {mobileViewMode === 'grid' ? <GridIcon /> : mobileViewMode === 'sched' ? <SchedIcon /> : <ListIcon />}
      <span className={`text-[9px] font-semibold tracking-widest uppercase ${textSecondary} leading-none`}>
        {mobileViewMode.toUpperCase()}
      </span>
    </button>
  );
};

export default MobileViewToggle;
