import { useMemo, useState } from 'react';
import { useDayPlannerCtx } from '../../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../../context/FeaturesContext.jsx';
import { dateToString, extractTags } from '../../utils/taskUtils.js';
import { EMPTY_SCHED_FILTERS, hasActiveSchedFilters, taskMatchesSchedFilters, limitRecurringToNextInstance, schedFiltersEqual } from '../../utils/schedAgenda.js';

export const INITIAL_DAYS = 14;
export const LOAD_MORE_DAYS = 14;

const PRESETS_KEY = 'day-planner-sched-filter-presets';

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
    scheduleTaskAtNextSlot,
  } = useDayPlannerCtx();
  const { isVisibleForUser } = useFeaturesCtx();

  const [daysShown, setDaysShown] = useState(INITIAL_DAYS);
  const [filters, setFilters] = useState(EMPTY_SCHED_FILTERS);
  const [showEmptyDays, setShowEmptyDays] = useState(
    () => localStorage.getItem('day-planner-sched-show-empty') === 'true'
  );
  // Collapse each recurring series to its next incomplete occurrence so
  // daily/weekly tasks don't flood the agenda. View preference, not a filter —
  // it doesn't count toward the active-filter badge.
  const [nextInstanceOnly, setNextInstanceOnly] = useState(
    () => localStorage.getItem('day-planner-sched-next-instance-only') === 'true'
  );

  // Saved filter presets — named color/tag/project combos, persisted across
  // sessions and shared by the mobile sheet and the desktop rail.
  const [filterPresets, setFilterPresets] = useState(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(PRESETS_KEY) || '[]');
      return Array.isArray(raw)
        ? raw
            .filter(p => p && p.id && p.name && p.filters)
            .map(p => ({ ...p, filters: { ...EMPTY_SCHED_FILTERS, ...p.filters } }))
        : [];
    } catch { return []; }
  });

  const persistPresets = (next) => {
    localStorage.setItem(PRESETS_KEY, JSON.stringify(next));
    return next;
  };

  const saveFilterPreset = (name) => {
    const trimmed = (name || '').trim();
    if (!trimmed || !hasActiveSchedFilters(filters)) return;
    setFilterPresets(prev => persistPresets([...prev, { id: crypto.randomUUID(), name: trimmed, filters }]));
  };

  const deleteFilterPreset = (id) =>
    setFilterPresets(prev => persistPresets(prev.filter(p => p.id !== id)));

  // Tapping the already-active preset clears the filters (toggle semantics).
  const applyFilterPreset = (preset) =>
    setFilters(f => schedFiltersEqual(preset.filters, f)
      ? EMPTY_SCHED_FILTERS
      : { ...EMPTY_SCHED_FILTERS, ...preset.filters });

  const toggleEmptyDays = () => setShowEmptyDays(v => {
    localStorage.setItem('day-planner-sched-show-empty', String(!v));
    return !v;
  });

  const toggleNextInstanceOnly = () => setNextInstanceOnly(v => {
    localStorage.setItem('day-planner-sched-next-instance-only', String(!v));
    return !v;
  });

  const showMoreDays = () => setDaysShown(n => n + LOAD_MORE_DAYS);

  // Unfiltered agenda window (day → tasks), all-day first then by start time.
  const rawDays = useMemo(() => {
    const out = [];
    for (let i = 0; i < daysShown; i++) {
      const date = new Date(selectedDate);
      date.setDate(date.getDate() + i);
      // Second arg opts out of the app-wide tag filter — SCHED has its own
      // filter panel, and the invisible global filter made freshly-tagged
      // tasks vanish from the agenda.
      const dayTasks = getTasksForDate(date, false)
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

  const days = useMemo(() => {
    const base = nextInstanceOnly ? limitRecurringToNextInstance(rawDays) : rawDays;
    return base.map(d => ({ ...d, tasks: d.tasks.filter(task => taskMatchesSchedFilters(task, filters)) }));
  }, [rawDays, filters, nextInstanceOnly]);

  const filtersActive = hasActiveSchedFilters(filters);
  const visibleDays = days.filter(d => showEmptyDays || d.tasks.length > 0);

  // Incomplete tasks scheduled before today AND before the visible window, so
  // they never duplicate a rendered day group. Plain tasks only: imported
  // events just passed (nothing actionable), and recurring occurrences are
  // generated per-day rather than lingering in the tasks list.
  const overdueTasks = useMemo(() => {
    const todayStr = dateToString(new Date());
    const windowStartStr = dateToString(selectedDate);
    return tasks
      .filter(task =>
        task.date && task.date < todayStr && task.date < windowStartStr &&
        !task.completed && !task.archived && !task.isExample && !task.imported &&
        isVisibleForUser(task))
      .filter(task => taskMatchesSchedFilters(task, filters))
      .sort((a, b) => a.date.localeCompare(b.date) || (a.startTime || '').localeCompare(b.startTime || ''));
  }, [tasks, selectedDate, filters, isVisibleForUser]);

  // Moves an overdue/agenda task to today's next open quarter-hour slot.
  const rescheduleToToday = (task) => scheduleTaskAtNextSlot(task.id, false);

  const addTaskOnDay = (dateStr) => {
    setNewTask({ title: '', startTime: '09:00', duration: 30, date: dateStr, isAllDay: false, recurrence: null });
    setShowAddTask(true);
  };

  return {
    days, visibleDays, filtersActive,
    overdueTasks, rescheduleToToday,
    filters, setFilters,
    filterPresets, saveFilterPreset, deleteFilterPreset, applyFilterPreset,
    availableColors, availableTags,
    showEmptyDays, toggleEmptyDays,
    nextInstanceOnly, toggleNextInstanceOnly,
    showMoreDays,
    addTaskOnDay,
  };
}
