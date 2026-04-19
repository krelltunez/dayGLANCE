import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import AllDayTaskCard from './AllDayTaskCard.jsx';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../context/FeaturesContext.jsx';

const CHIP_ROW_H = 40; // approximate AllDayTaskCard height in px
const ROW_GAP = 4;     // gap-1 = 4px
const MAX_ROWS = 2;
const MAX_H = CHIP_ROW_H * MAX_ROWS + ROW_GAP * (MAX_ROWS - 1);

// ── GroupChips — horizontal flex-wrap with 2-row cap + "+N more" popover ─────

const GroupChips = ({ tasks, darkMode, borderClass, cardBg }) => {
  const ghostRef = useRef(null);
  const overflowRef = useRef(null);
  const [limit, setLimit] = useState(null);
  const [overflowOpen, setOverflowOpen] = useState(false);

  useLayoutEffect(() => {
    const el = ghostRef.current;
    if (!el) return;

    const measure = () => {
      const chips = Array.from(el.children);
      if (!chips.length || !tasks.length) { setLimit(null); return; }
      const rowTop = chips[0].offsetTop;
      const maxBottom = rowTop + MAX_H;
      let lastFit = chips.length;
      for (let i = 0; i < chips.length; i++) {
        if (chips[i].offsetTop + chips[i].offsetHeight > maxBottom + 2) {
          lastFit = i;
          break;
        }
      }
      setLimit(lastFit < chips.length ? Math.max(0, lastFit - 1) : null);
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [tasks.length]);

  useEffect(() => {
    if (!overflowOpen) return;
    const onDown = (e) => {
      if (!overflowRef.current?.contains(e.target)) setOverflowOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOverflowOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [overflowOpen]);

  const shown = limit !== null ? tasks.slice(0, limit) : tasks;
  const overflowTasks = limit !== null ? tasks.slice(limit) : [];

  return (
    <div className="relative p-1.5">
      {/* Ghost render for overflow measurement — invisible, no pointer events */}
      <div
        ref={ghostRef}
        className="absolute top-1.5 left-1.5 right-1.5 flex flex-wrap gap-1 opacity-0 pointer-events-none"
        aria-hidden="true"
      >
        {tasks.map(t => (
          <div key={t.id} className="flex-1 min-w-[200px] max-w-[300px]">
            <AllDayTaskCard task={t} fillWidth={false} />
          </div>
        ))}
      </div>

      {/* Visible chips */}
      <div className="flex flex-wrap gap-1">
        {shown.map(t => (
          <div
            key={t.id}
            className={`notes-panel-container relative flex-1 min-w-[200px] max-w-[300px] ${t.completed && (!t.imported || t.isTaskCalendar) ? 'opacity-50' : ''}`}
          >
            <AllDayTaskCard task={t} fillWidth={false} />
          </div>
        ))}

        {/* "+N more" overflow chip + popover */}
        {overflowTasks.length > 0 && (
          <div ref={overflowRef} className="relative flex-shrink-0 self-start">
            <button
              onClick={() => setOverflowOpen(v => !v)}
              className={`text-xs font-medium px-2 py-1 rounded-md ${darkMode ? 'bg-gray-600 text-gray-200 hover:bg-gray-500' : 'bg-stone-200 text-stone-600 hover:bg-stone-300'} transition-colors`}
            >
              +{overflowTasks.length} more
            </button>
            {overflowOpen && (
              <div className={`absolute top-full left-0 mt-1 z-50 rounded-lg shadow-xl border ${borderClass} ${cardBg} p-2 min-w-[200px] max-w-[300px] flex flex-col gap-1`}>
                {overflowTasks.map(t => (
                  <div
                    key={t.id}
                    className={`notes-panel-container relative ${t.completed && (!t.imported || t.isTaskCalendar) ? 'opacity-50' : ''}`}
                    onClick={() => setOverflowOpen(false)}
                  >
                    <AllDayTaskCard task={t} fillWidth={true} />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// ── DayViewAllDaySection ──────────────────────────────────────────────────────

const allDayOrder = (t) => {
  if (t.importSource === 'file') return 0;
  if (t.imported && !t.isTaskCalendar) return 1;
  if (t.isTaskCalendar) return 2;
  if (typeof t.id === 'string' && t.id.startsWith('recurring-')) return 4;
  return 3;
};

const DayViewAllDaySection = () => {
  const {
    darkMode,
    borderClass, textSecondary, cardBg,
    dayViewColumns,
    getTasksForDate,
  } = useDayPlannerCtx();
  const { projectFilter } = useFeaturesCtx();

  // Build date groups (same logic as CalendarHeader day-mode header)
  const dateGroups = [];
  for (const col of dayViewColumns) {
    const last = dateGroups[dateGroups.length - 1];
    if (last && last.dateStr === col.dateStr) {
      last.count++;
    } else {
      dateGroups.push({ dateStr: col.dateStr, date: col.date, count: 1 });
    }
  }

  const groupsWithTasks = dateGroups.map(group => ({
    ...group,
    tasks: getTasksForDate(group.date)
      .filter(t => t.isAllDay && (!projectFilter || t.projectId === projectFilter))
      .sort((a, b) => allDayOrder(a) - allDayOrder(b)),
  }));

  if (!groupsWithTasks.some(g => g.tasks.length > 0)) return null;

  return (
    <div className={`flex border-b ${borderClass} ${cardBg}`}>
      {/*
        Each date group mirrors DayViewColumn exactly: a w-16 gutter + flex-1 chips area.
        This keeps group boundaries pixel-aligned with column boundaries in the timeline.
      */}
      {groupsWithTasks.map((group, idx) => (
        <div
          key={group.dateStr}
          style={{ flex: group.count }}
          className={`flex min-w-0 ${idx > 0 ? `border-l ${borderClass}` : ''}`}
        >
          <div className={`w-16 flex-shrink-0 px-3 py-2 text-xs font-semibold ${textSecondary} border-r ${borderClass}`}>
            {idx === 0 ? 'ALL DAY' : ''}
          </div>
          <div className="flex-1 min-w-0">
            <GroupChips
              tasks={group.tasks}
              darkMode={darkMode}
              borderClass={borderClass}
              cardBg={cardBg}
            />
          </div>
        </div>
      ))}
    </div>
  );
};

export default DayViewAllDaySection;
