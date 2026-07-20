import React, { useMemo, useState } from 'react';
import { ChevronDown, Eye, EyeOff, ListFilter, Plus } from 'lucide-react';
import { useDayPlannerCtx } from '../../context/DayPlannerContext.jsx';
import { useTranslation } from 'react-i18next';
import { dateToString, extractTags } from '../../utils/taskUtils.js';
import { EMPTY_SCHED_FILTERS, hasActiveSchedFilters, taskMatchesSchedFilters } from '../../utils/schedAgenda.js';
import SchedTaskCard from './SchedTaskCard.jsx';
import SchedFilterPopup from './SchedFilterPopup.jsx';

const INITIAL_DAYS = 14;
const LOAD_MORE_DAYS = 14;

/**
 * SCHED — scrollable day-grouped agenda of scheduled tasks, starting at the
 * currently selected day. Third mobile/tablet view alongside GRID and LIST;
 * the desktop dashboard variant reuses the same building blocks.
 */
const SchedView = () => {
  const {
    selectedDate, tasks, expandedRecurringTasks,
    getTasksForDate,
    darkMode, cardBg, borderClass, textPrimary, textSecondary, hoverBg,
    setNewTask, setShowAddTask,
  } = useDayPlannerCtx();
  const { t } = useTranslation();

  const [daysShown, setDaysShown] = useState(INITIAL_DAYS);
  const [filters, setFilters] = useState(EMPTY_SCHED_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  const [showEmptyDays, setShowEmptyDays] = useState(
    () => localStorage.getItem('day-planner-sched-show-empty') === 'true'
  );

  const toggleEmptyDays = () => setShowEmptyDays(v => {
    localStorage.setItem('day-planner-sched-show-empty', String(!v));
    return !v;
  });

  // Unfiltered agenda window (day → tasks), all-day first then by start time.
  const rawDays = useMemo(() => {
    const out = [];
    for (let i = 0; i < daysShown; i++) {
      const date = new Date(selectedDate);
      date.setDate(date.getDate() + i);
      const dayTasks = getTasksForDate(date)
        .filter(task => !task.isExample)
        .sort((a, b) =>
          ((a.isAllDay ? 0 : 1) - (b.isAllDay ? 0 : 1)) ||
          (a.startTime || '').localeCompare(b.startTime || '')
        );
      out.push({ date, dateStr: dateToString(date), tasks: dayTasks });
    }
    return out;
    // getTasksForDate reads tasks + expandedRecurringTasks internally.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, daysShown, tasks, expandedRecurringTasks]);

  // Filter options offered by the popup come from the visible window.
  const { availableColors, availableTags } = useMemo(() => {
    const colors = new Set();
    const tags = new Set();
    rawDays.forEach(d => d.tasks.forEach(task => {
      if (task.color) colors.add(task.color);
      extractTags(task.title || '').forEach(tag => tags.add(tag));
    }));
    return { availableColors: colors, availableTags: [...tags].sort() };
  }, [rawDays]);

  const days = useMemo(() =>
    rawDays.map(d => ({ ...d, tasks: d.tasks.filter(task => taskMatchesSchedFilters(task, filters)) })),
    [rawDays, filters]
  );

  const todayStr = dateToString(new Date());
  const tomorrowStr = dateToString(new Date(Date.now() + 86400000));

  const dayLabel = (day) => {
    const base = day.date.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
    if (day.dateStr === todayStr) return `${t('common.today', 'Today')} · ${base}`;
    if (day.dateStr === tomorrowStr) return `${t('common.tomorrow', 'Tomorrow')} · ${base}`;
    return base;
  };

  const addTaskOnDay = (dateStr) => {
    setNewTask({ title: '', startTime: '09:00', duration: 30, date: dateStr, isAllDay: false, recurrence: null });
    setShowAddTask(true);
  };

  const filtersActive = hasActiveSchedFilters(filters);
  const visibleDays = days.filter(d => showEmptyDays || d.tasks.length > 0);

  return (
    <div className="flex flex-col gap-3 px-3 pb-24 pt-2">
      {/* Controls */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setShowFilters(true)}
          className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border transition-colors ${
            filtersActive
              ? 'bg-blue-600 text-white border-blue-600'
              : `${borderClass} ${textSecondary} ${hoverBg}`
          }`}
        >
          <ListFilter size={13} />
          Filter{filtersActive ? ` · ${filters.colors.length + filters.tags.length + filters.projectIds.length}` : ''}
        </button>
        <button
          onClick={toggleEmptyDays}
          className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border ${borderClass} ${textSecondary} ${hoverBg} transition-colors`}
          title={showEmptyDays ? 'Hide empty days' : 'Show empty days'}
        >
          {showEmptyDays ? <Eye size={13} /> : <EyeOff size={13} />}
          Empty days
        </button>
      </div>

      {/* Day groups */}
      {visibleDays.map(day => (
        <div key={day.dateStr} className="flex flex-col gap-1.5">
          <div className={`text-xs font-semibold uppercase tracking-wide ${day.dateStr === todayStr ? 'text-blue-500' : textSecondary} pt-1`}>
            {dayLabel(day)}
          </div>
          {day.tasks.length > 0 ? (
            day.tasks.map(task => <SchedTaskCard key={task.id} task={task} />)
          ) : (
            <button
              onClick={() => addTaskOnDay(day.dateStr)}
              className={`flex items-center justify-center gap-1.5 rounded-xl border border-dashed ${borderClass} py-2.5 text-xs ${textSecondary} ${hoverBg} transition-colors`}
            >
              <Plus size={13} />
              {t('task.addTask', 'Add task')}
            </button>
          )}
        </div>
      ))}

      {visibleDays.length === 0 && (
        <p className={`text-sm ${textSecondary} text-center py-8`}>
          {filtersActive ? 'No tasks match the current filters.' : 'Nothing scheduled in this window.'}
        </p>
      )}

      {/* Extend window */}
      <button
        onClick={() => setDaysShown(n => n + LOAD_MORE_DAYS)}
        className={`flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium ${textSecondary} ${hoverBg} rounded-xl border ${borderClass} transition-colors`}
      >
        <ChevronDown size={13} />
        Show {LOAD_MORE_DAYS} more days
      </button>

      {showFilters && (
        <SchedFilterPopup
          filters={filters}
          setFilters={setFilters}
          availableColors={availableColors}
          availableTags={availableTags}
          onClose={() => setShowFilters(false)}
        />
      )}
    </div>
  );
};

export default SchedView;
