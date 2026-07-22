import { useMemo, useState } from 'react';
import { useDayPlannerCtx } from '../../context/DayPlannerContext.jsx';
import { dateToString, extractTags } from '../../utils/taskUtils.js';
import { EMPTY_SCHED_FILTERS, hasActiveSchedFilters, taskMatchesSchedFilters } from '../../utils/schedAgenda.js';

export const INITIAL_DAYS = 14;
export const LOAD_MORE_DAYS = 14;

/**
 * Shared state for the SCHED agenda (mobile SchedView + desktop
 * SchedDashboard): the rolling day window anchored on selectedDate,
 * filter state, filter options derived from the visible window, the
 * empty-days preference, and the add-task-on-day helper.
 */
export default function useSchedAgendaState() {
  const {
    selectedDate, tasks, expandedRecurringTasks,
    getTasksForDate,
    setNewTask, setShowAddTask,
  } = useDayPlannerCtx();

  const [daysShown, setDaysShown] = useState(INITIAL_DAYS);
  const [filters, setFilters] = useState(EMPTY_SCHED_FILTERS);
  const [showEmptyDays, setShowEmptyDays] = useState(
    () => localStorage.getItem('day-planner-sched-show-empty') === 'true'
  );

  const toggleEmptyDays = () => setShowEmptyDays(v => {
    localStorage.setItem('day-planner-sched-show-empty', String(!v));
    return !v;
  });

  const showMoreDays = () => setDaysShown(n => n + LOAD_MORE_DAYS);

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

  // Filter options offered in the UI come from the visible window.
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

  const filtersActive = hasActiveSchedFilters(filters);
  const visibleDays = days.filter(d => showEmptyDays || d.tasks.length > 0);

  const addTaskOnDay = (dateStr) => {
    setNewTask({ title: '', startTime: '09:00', duration: 30, date: dateStr, isAllDay: false, recurrence: null });
    setShowAddTask(true);
  };

  return {
    days, visibleDays, filtersActive,
    filters, setFilters,
    availableColors, availableTags,
    showEmptyDays, toggleEmptyDays,
    showMoreDays,
    addTaskOnDay,
  };
}
