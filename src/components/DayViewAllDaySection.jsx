import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import AllDayTaskCard from './AllDayTaskCard.jsx';
import { dateToString } from '../utils/taskUtils.js';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../context/FeaturesContext.jsx';

const CHIP_ROW_H = 40; // approximate AllDayTaskCard height in px
const ROW_GAP = 4;     // gap-1 = 4px
const MAX_ROWS = 2;
const MAX_H = CHIP_ROW_H * MAX_ROWS + ROW_GAP * (MAX_ROWS - 1);

// ── GroupChips — horizontal flex-wrap with 2-row cap + "+N more" popover ─────

const GroupChips = ({ tasks, darkMode, borderClass, cardBg }) => {
  const ghostRef = useRef(null);
  const buttonRef = useRef(null);
  const popoverRef = useRef(null);
  const [limit, setLimit] = useState(null);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [popoverPos, setPopoverPos] = useState({ top: 0, left: 0 });

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
      if (!buttonRef.current?.contains(e.target) && !popoverRef.current?.contains(e.target)) {
        setOverflowOpen(false);
      }
    };
    const onKey = (e) => { if (e.key === 'Escape') setOverflowOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [overflowOpen]);

  const handleTogglePopover = () => {
    if (!overflowOpen && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const popoverWidth = 400;
      const margin = 8;
      let left = rect.left;
      if (left + popoverWidth > window.innerWidth - margin) left = window.innerWidth - popoverWidth - margin;
      setPopoverPos({ top: rect.bottom + 4, left: Math.max(margin, left) });
    }
    setOverflowOpen(v => !v);
  };

  const shown = limit !== null ? tasks.slice(0, limit) : tasks;
  const overflowTasks = limit !== null ? tasks.slice(limit) : [];

  return (
    <div className="relative p-2">
      {/* Ghost render for overflow measurement — invisible, no pointer events */}
      <div
        ref={ghostRef}
        className="absolute top-2 left-2 right-2 flex flex-wrap gap-1 opacity-0 pointer-events-none"
        aria-hidden="true"
      >
        {tasks.map(t => (
          <div key={t.id} className="grow shrink-0 basis-[200px] max-w-[400px]">
            <AllDayTaskCard task={t} fillWidth={false} />
          </div>
        ))}
      </div>

      {/* Visible chips */}
      <div className="flex flex-wrap gap-1">
        {shown.map(t => (
          <div
            key={t.id}
            className={`notes-panel-container relative grow shrink-0 basis-[200px] max-w-[400px] ${t.completed && (!t.imported || t.isTaskCalendar) ? 'opacity-50' : ''}`}
          >
            <AllDayTaskCard task={t} fillWidth={false} />
          </div>
        ))}

        {/* "+N more" overflow chip */}
        {overflowTasks.length > 0 && (
          <div className="relative flex-shrink-0 self-start">
            <button
              ref={buttonRef}
              onClick={handleTogglePopover}
              className={`text-xs font-medium px-2 py-1 rounded-md ${darkMode ? 'bg-gray-600 text-gray-200 hover:bg-gray-500' : 'bg-stone-200 text-stone-600 hover:bg-stone-300'} transition-colors`}
            >
              +{overflowTasks.length} more
            </button>
          </div>
        )}
      </div>

      {/* Overflow popover — fixed to viewport so it doesn't overlap the timeline */}
      {overflowOpen && overflowTasks.length > 0 && (
        <div
          ref={popoverRef}
          style={{ position: 'fixed', top: popoverPos.top, left: popoverPos.left, width: 400, zIndex: 200 }}
          className={`rounded-lg shadow-xl border ${borderClass} ${cardBg} p-2 flex flex-col gap-1 max-h-[60vh] overflow-y-auto`}
        >
          {overflowTasks.map(t => (
            <div
              key={t.id}
              className={`notes-panel-container relative ${t.completed && (!t.imported || t.isTaskCalendar) ? 'opacity-50' : ''}`}
              onClick={() => setOverflowOpen(false)}
            >
              <AllDayTaskCard task={t} fillWidth={false} />
            </div>
          ))}
        </div>
      )}
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
  const { projectFilter, routinesEnabled, todayRoutines, routineCompletions, toggleRoutineCompletion } = useFeaturesCtx();
  const todayStr = dateToString(new Date());

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

  const hasAllDayRoutines = routinesEnabled && todayRoutines.some(r => r.isAllDay);
  if (!groupsWithTasks.some(g => g.tasks.length > 0) && !hasAllDayRoutines) return null;

  return (
    <div className={`border-b ${borderClass} ${cardBg}`} style={{ display: 'grid', gridTemplateColumns: `repeat(${dayViewColumns.length}, 1fr)` }}>
      {groupsWithTasks.map((group, idx) => (
        <div
          key={group.dateStr}
          style={{ gridColumn: `span ${group.count}` }}
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
            {routinesEnabled && group.dateStr === todayStr && todayRoutines.filter(r => r.isAllDay).map(routine => (
              <span
                key={`routine-${routine.id}`}
                className={`rounded-full px-3 py-1 text-xs font-medium inline-block mr-1 mb-1 cursor-pointer ${darkMode ? 'bg-teal-700/80 text-teal-100' : 'bg-teal-600/80 text-white'} ${routineCompletions[routine.id] ? 'line-through opacity-75' : ''}`}
                onClick={() => toggleRoutineCompletion(routine.id)}
              >
                {routine.name}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};

export default DayViewAllDaySection;
