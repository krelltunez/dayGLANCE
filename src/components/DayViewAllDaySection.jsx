import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Check, Inbox, Pencil, SkipForward, Trash2 } from 'lucide-react';
import { renderTitleWithoutTags } from '../utils/textFormatting.jsx';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../context/FeaturesContext.jsx';

// ── AllDayChip — matches multi-view card style ────────────────────────────────

const AllDayChip = ({ task, getTaskCalendarStyle, darkMode, openMobileEditTask }) => {
  const {
    isTablet,
    toggleComplete, postponeTask, moveToInbox, moveToRecycleBin,
  } = useDayPlannerCtx();

  const isImported = task.imported && !task.isTaskCalendar;
  const isRecurring = typeof task.id === 'string' && task.id.startsWith('recurring-');
  const calStyle = (isImported || task.isTaskCalendar) ? getTaskCalendarStyle(task, darkMode) : {};

  return (
    <div
      onClick={() => openMobileEditTask(task, false)}
      className={`${task.isTaskCalendar ? '' : task.color} rounded-lg shadow-sm cursor-pointer flex-shrink-0 ${task.completed && !isImported ? 'opacity-50' : ''}`}
      style={calStyle}
      title={task.title}
    >
      <div className="px-2 py-1 text-white">
        <div className="flex items-center gap-1.5 min-w-0">
          {(!task.imported || task.isTaskCalendar) && (
            <button
              onClick={(e) => { e.stopPropagation(); toggleComplete(task.id); }}
              className={`rounded flex-shrink-0 border-2 border-white w-3.5 h-3.5 flex items-center justify-center transition-colors ${task.completed ? 'bg-white/40' : 'bg-white/20'} hover:bg-white/30`}
            >
              {task.completed && <Check size={9} strokeWidth={3} />}
            </button>
          )}
          <span className={`text-xs font-semibold truncate flex-1 min-w-0 max-w-[160px] ${task.completed ? 'line-through' : ''}`}>
            {renderTitleWithoutTags(task.title)}
          </span>
          {!isTablet && !isImported && (
            <div className="flex items-center gap-0.5 flex-shrink-0">
              <button
                onClick={(e) => { e.stopPropagation(); postponeTask(task.id); }}
                className="hover:bg-white/20 rounded p-0.5 transition-colors text-white/80"
                title="Postpone"
              >
                <SkipForward size={10} />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); openMobileEditTask(task, false); }}
                className="hover:bg-white/20 rounded p-0.5 transition-colors text-white/80"
                title="Edit"
              >
                <Pencil size={10} />
              </button>
              {isRecurring ? (
                <button
                  onClick={(e) => { e.stopPropagation(); moveToRecycleBin(task.id); }}
                  className="hover:bg-white/20 rounded p-0.5 transition-colors text-white/80"
                  title="Delete"
                >
                  <Trash2 size={10} />
                </button>
              ) : (
                <button
                  onClick={(e) => { e.stopPropagation(); moveToInbox(task.id); }}
                  className="hover:bg-white/20 rounded p-0.5 transition-colors text-white/80"
                  title="To Inbox"
                >
                  <Inbox size={10} />
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ── GroupChips — one date group with 2-row height cap + "+N more" popover ────

const CHIP_ROW_H = 32; // px: approximate height of one chip row
const ROW_GAP = 4;     // px: gap-1 = 4px
const MAX_ROWS = 2;
const MAX_H = CHIP_ROW_H * MAX_ROWS + ROW_GAP * (MAX_ROWS - 1);

const GroupChips = ({ tasks, darkMode, textSecondary, borderClass, cardBg, getTaskCalendarStyle, openMobileEditTask }) => {
  const ghostRef = useRef(null);
  const overflowRef = useRef(null);
  const [limit, setLimit] = useState(null); // null = show all
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

  // Click-outside dismisses the overflow popover
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
      {/* Ghost render for measurement — invisible, no pointer events */}
      <div
        ref={ghostRef}
        className="absolute top-1.5 left-1.5 right-1.5 flex flex-wrap gap-1 opacity-0 pointer-events-none"
        aria-hidden="true"
      >
        {tasks.map(t => (
          <AllDayChip key={t.id} task={t} darkMode={darkMode} getTaskCalendarStyle={getTaskCalendarStyle} openMobileEditTask={openMobileEditTask} />
        ))}
      </div>

      {/* Visible chips */}
      <div className="flex flex-wrap gap-1">
        {shown.map(t => (
          <AllDayChip
            key={t.id}
            task={t}
            darkMode={darkMode}
            getTaskCalendarStyle={getTaskCalendarStyle}
            openMobileEditTask={openMobileEditTask}
          />
        ))}

        {/* "+N more" overflow chip + popover */}
        {overflowTasks.length > 0 && (
          <div ref={overflowRef} className="relative flex-shrink-0">
            <button
              onClick={() => setOverflowOpen(v => !v)}
              className={`text-xs font-medium px-2 py-1 rounded-md ${darkMode ? 'bg-gray-600 text-gray-200 hover:bg-gray-500' : 'bg-stone-200 text-stone-600 hover:bg-stone-300'} transition-colors`}
            >
              +{overflowTasks.length} more
            </button>
            {overflowOpen && (
              <div className={`absolute top-full left-0 mt-1 z-50 rounded-lg shadow-xl border ${borderClass} ${cardBg} p-2 min-w-[160px] max-w-[260px] flex flex-col gap-1`}>
                {overflowTasks.map(t => (
                  <AllDayChip
                    key={t.id}
                    task={t}
                    darkMode={darkMode}
                    getTaskCalendarStyle={getTaskCalendarStyle}
                    openMobileEditTask={() => { setOverflowOpen(false); openMobileEditTask(t, false); }}
                  />
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
    getTasksForDate, getTaskCalendarStyle,
    openMobileEditTask,
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
      {/* ALL DAY gutter label — matches multi-view all-day section */}
      <div className={`w-16 flex-shrink-0 px-2 py-2 text-xs font-semibold ${textSecondary} border-r ${borderClass} flex items-start justify-center`}>
        ALL DAY
      </div>
      {/* Date groups — each spans `count` columns proportionally */}
      <div className="flex flex-1 min-w-0">
        {groupsWithTasks.map((group, idx) => (
          <div key={group.dateStr} style={{ flex: group.count }} className={`min-w-0 ${idx > 0 ? `border-l ${borderClass}` : ''}`}>
            <GroupChips
              tasks={group.tasks}
              darkMode={darkMode}
              textSecondary={textSecondary}
              borderClass={borderClass}
              cardBg={cardBg}
              getTaskCalendarStyle={getTaskCalendarStyle}
              openMobileEditTask={openMobileEditTask}
            />
          </div>
        ))}
      </div>
    </div>
  );
};

export default DayViewAllDaySection;
