import React from 'react';
import AllDayTaskCard from './AllDayTaskCard.jsx';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../context/FeaturesContext.jsx';

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
      <div className={`w-16 flex-shrink-0 px-3 py-2 text-xs font-semibold ${textSecondary} border-r ${borderClass}`}>
        ALL DAY
      </div>
      {/* Date groups — each spans `count` columns proportionally */}
      <div className="flex flex-1 min-w-0">
        {groupsWithTasks.map((group, idx) => (
          <div
            key={group.dateStr}
            style={{ flex: group.count }}
            className={`min-w-0 p-2 space-y-1 ${idx > 0 ? `border-l ${borderClass}` : ''}`}
          >
            {group.tasks.map(task => (
              <div
                key={task.id}
                className={`notes-panel-container relative ${task.completed && (!task.imported || task.isTaskCalendar) ? 'opacity-50' : ''}`}
              >
                <AllDayTaskCard task={task} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
};

export default DayViewAllDaySection;
