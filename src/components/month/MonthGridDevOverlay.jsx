// ┌──────────────────────────────────────────────────────────────────────────┐
// │ TEMPORARY. Month view step 3 dev overlay for MonthGrid on real data.     │
// │ Not linked from the app or the view cycler. Reach it with `?month-grid`  │
// │ on the web or the Electron dev server, or on a device by setting         │
// │ localStorage 'day-planner-dev-month-grid' to '1' (chrome://inspect on a │
// │ debug Android build) and reloading. `?month-grid=demo` opens with the    │
// │ generated demo month instead of real data; the header button toggles.   │
// │ Delete this file and the gate in src/App.jsx once the grid is routed     │
// │ through the view cycler.                                                 │
// └──────────────────────────────────────────────────────────────────────────┘
import React, { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { routinesForDate } from '@glance-apps/agenda-core';
import MonthGrid from './MonthGrid.jsx';
import { tagKind } from '../../utils/monthCellLayout.js';
import { monthOf } from '../../utils/monthGrid.js';
import { generateDemoMonth } from '../../utils/monthDemoData.js';
import { useDayPlannerCtx } from '../../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../../context/FeaturesContext.jsx';

/**
 * The same sources the other views read: getTasksForDate (scheduled tasks,
 * recurring instances, imported and device calendar events, tag filter
 * applied), the routine strip for the one day routines exist on, and the
 * planner's own deadline accessor (inbox tasks due that day).
 */
export function useMonthItemsForDate() {
  const { getTasksForDate, getDeadlineTasksForDate } = useDayPlannerCtx();
  const { routinesEnabled, todayRoutines, routinesDate, routineCompletions } = useFeaturesCtx();
  return useMemo(() => (dateStr) => {
    const date = new Date(`${dateStr}T12:00:00`);
    const tasks = (getTasksForDate(date) || []).filter((t) => !t.isExample);
    const routines = routinesEnabled
      ? tagKind(routinesForDate({ todayRoutines, routinesDate, routineCompletions }, dateStr), 'routine')
        .map((r) => ({ ...r, id: `routine-${r.id}` }))
      : [];
    const deadlines = (getDeadlineTasksForDate?.(dateStr) || []).map((t) => ({
      id: `deadline-${t.id}`, kind: 'deadline', isAllDay: true, completed: !!t.completed, date: dateStr,
    }));
    return [...tasks, ...routines, ...deadlines];
  }, [getTasksForDate, getDeadlineTasksForDate, routinesEnabled, todayRoutines, routinesDate, routineCompletions]);
}

const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/** Demo month as an itemsForDate, shaped like the real adapter's output. */
function useDemoItemsForDate(year, month) {
  return useMemo(() => {
    const { tasks, unscheduled } = generateDemoMonth(year, month, { today: todayStr() });
    return (dateStr) => [
      ...tasks.filter((t) => t.date === dateStr),
      ...unscheduled.filter((u) => u.deadline === dateStr).map((u) => ({ id: `deadline-${u.id}`, kind: 'deadline', isAllDay: true, completed: false, date: dateStr })),
    ];
  }, [year, month]);
}

export default function MonthGridDevOverlay() {
  const { darkMode, weekStartDay, selectedDate } = useDayPlannerCtx();
  const realItemsForDate = useMonthItemsForDate();
  const [shown, setShown] = useState(() => monthOf(selectedDate instanceof Date ? selectedDate : new Date()));
  const [demo, setDemo] = useState(() => { try { return new URLSearchParams(window.location.search).get('month-grid') === 'demo'; } catch { return false; } });
  const demoItemsForDate = useDemoItemsForDate(shown.year, shown.month);
  const itemsForDate = demo ? demoItemsForDate : realItemsForDate;
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;
  return (
    <div className={`fixed inset-0 z-[80] flex flex-col ${darkMode ? 'bg-gray-950 text-gray-100' : 'bg-stone-50 text-stone-900'}`}
      style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <div className="flex items-center gap-3 px-3 py-1 text-[11px] text-stone-500 dark:text-gray-400 shrink-0">
        <span className="font-semibold">Month grid (TEMPORARY dev overlay, real data)</span>
        <span className="hidden sm:inline">tap a cell: logs the date until the day sheet exists</span>
        <button type="button" onClick={() => setDemo((v) => !v)} data-month-grid-demo={demo ? 'on' : 'off'}
          className={`ml-auto px-2 py-0.5 rounded border border-current ${demo ? 'bg-amber-200 text-amber-900 dark:bg-amber-500/30 dark:text-amber-100' : ''}`}>
          {demo ? 'demo month' : 'real data'}
        </button>
        <button type="button" onClick={() => setHidden(true)} aria-label="Close" className="p-1 rounded border border-current">
          <X size={14} />
        </button>
      </div>
      <div className="flex-1 min-h-0">
        <MonthGrid
          year={shown.year}
          month={shown.month}
          itemsForDate={itemsForDate}
          weekStartDay={weekStartDay}
          onNavigate={(year, month) => setShown({ year, month })}
          onSelectDate={(dateStr) => console.log('[month-grid] select', dateStr)}
        />
      </div>
    </div>
  );
}
