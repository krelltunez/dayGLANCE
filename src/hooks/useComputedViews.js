import { useMemo, useCallback } from 'react';
import { dateToString, extractTags } from '../utils/taskUtils.js';

export default function useComputedViews({
  tasks,
  unscheduledTasks,
  recurringTasks,
  selectedDate,
  selectedTags,
  inboxPriorityFilter,
  hideCompletedInbox,
  goalsProjectsEnabled,
}) {
  // Tasks for the currently selected date
  const todayTasks = useMemo(
    () => tasks.filter(t => t.date === dateToString(selectedDate)),
    [tasks, selectedDate]
  );

  // All unique tags from all task sources (excludes imported events)
  const allTags = useMemo(() => {
    const tagSet = new Set();
    tasks.filter(t => !t.imported).forEach(task => {
      extractTags(task.title).forEach(tag => tagSet.add(tag));
    });
    unscheduledTasks.filter(t => !t.imported).forEach(task => {
      extractTags(task.title).forEach(tag => tagSet.add(tag));
    });
    recurringTasks.forEach(template => {
      extractTags(template.title).forEach(tag => tagSet.add(tag));
    });
    return Array.from(tagSet).sort();
  }, [tasks, unscheduledTasks, recurringTasks]);

  // Incomplete scheduled tasks from today (used by rescheduling feature)
  const incompleteTodayTasks = useMemo(() => {
    const todayStr = dateToString(new Date());
    return tasks.filter(t => t.date === todayStr && !t.completed && !t.imported && !t.isExample);
  }, [tasks]);

  // Filter tasks by selected tags (OR logic - show tasks matching ANY selected tag)
  // Untagged tasks are always shown — the filter only scopes tagged tasks
  const filterByTags = useCallback((taskList) => {
    return taskList.filter(task => {
      const taskTags = extractTags(task.title);
      // Imported events and untagged tasks always shown
      if (task.imported || taskTags.length === 0) return true;
      // If no tags are selected, hide tagged tasks
      if (selectedTags.length === 0) return false;
      // Show tagged tasks only if they match a selected tag
      return selectedTags.some(tag => taskTags.includes(tag));
    });
  }, [selectedTags]);

  // Inbox tasks filtered by priority and completion status.
  // When goalsProjectsEnabled, tasks tied to a project live on the dashboard
  // instead of the inbox — they get their own home in the project card.
  // If the feature is toggled off, the exclusion is lifted so nothing is hidden.
  const filteredUnscheduledTasks = useMemo(
    () => unscheduledTasks
      .filter(task => !goalsProjectsEnabled || !task.projectId)
      .filter(task => inboxPriorityFilter === 0 || (task.priority || 0) >= inboxPriorityFilter)
      .filter(task => !(task.completed && task.deadline))
      .filter(task => !hideCompletedInbox || !task.completed)
      .sort((a, b) => (b.priority || 0) - (a.priority || 0)),
    [unscheduledTasks, inboxPriorityFilter, hideCompletedInbox, goalsProjectsEnabled]
  );

  // Today's tasks filtered by tag selection
  const filteredTodayTasks = useMemo(
    () => filterByTags(todayTasks),
    [filterByTags, todayTasks]
  );

  return {
    todayTasks,
    allTags,
    incompleteTodayTasks,
    filterByTags,
    filteredUnscheduledTasks,
    filteredTodayTasks,
  };
}
