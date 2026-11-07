import { useMemo, useCallback } from 'react';
import { dateToString, extractTags } from '../utils/taskUtils.js';
import { notBucketed } from '../utils/bucketList.js';
import { liveHiddenProjectIds, makeCalendarFilter, passesTagFilter } from '../utils/calendarFilter.js';
import { liveInboxProjectFilter as liveProjectFilterOf, liveInboxTagFilter as liveTagFilterOf, filterInboxTasks } from '../utils/inboxFilter.js';

export default function useComputedViews({
  tasks,
  unscheduledTasks,
  recurringTasks,
  selectedDate,
  selectedTags,
  hiddenProjects = [],
  inboxPriorityFilter,
  hideCompletedInbox,
  hideProjectTasksInbox,
  hideStandaloneTasksInbox,
  inboxTagFilter,
  inboxProjectFilter,
  projects,
  goalsProjectsEnabled,
  isVisibleForUser,
}) {
  // Tasks for the currently selected date
  const todayTasks = useMemo(
    () => tasks.filter(t => t.date === dateToString(selectedDate)),
    [tasks, selectedDate]
  );

  // Every tag in use, and the ones the GLANCE tag filters offer, in one pass
  // over the tasks (#2143; it was two). Imported events are left out of both.
  // Bucket List items count for allTags only: their tasks never appear in the
  // filtered views, so a bucket-only tag would be a filter option that matches
  // nothing, but allTags feeds the #-autocomplete and AI context, where bucket
  // vocabulary is useful.
  const { allTags, filterableTags } = useMemo(() => {
    const all = new Set();
    const filterable = new Set();
    const add = (title, offered) => {
      for (const tag of extractTags(title)) {
        all.add(tag);
        if (offered) filterable.add(tag);
      }
    };
    for (const task of tasks) if (!task.imported) add(task.title, true);
    for (const task of unscheduledTasks) if (!task.imported) add(task.title, notBucketed(task));
    for (const template of recurringTasks) add(template.title, true);
    return { allTags: Array.from(all).sort(), filterableTags: Array.from(filterable).sort() };
  }, [tasks, unscheduledTasks, recurringTasks]);

  // Incomplete scheduled tasks from today (used by rescheduling feature)
  const incompleteTodayTasks = useMemo(() => {
    const todayStr = dateToString(new Date());
    return tasks.filter(t => t.date === todayStr && !t.completed && !t.imported && !t.isExample);
  }, [tasks]);

  // Filter tasks by selected tags (OR logic - show tasks matching ANY selected tag)
  // Untagged tasks are always shown — the filter only scopes tagged tasks
  // (utils/calendarFilter.js passesTagFilter).
  const filterByTags = useCallback(
    (taskList) => taskList.filter(task => passesTagFilter(task, selectedTags)),
    [selectedTags],
  );

  // Hide projects (#2307): the saved ids that still name an active project,
  // with Goals & Projects on. Keyed on the ids so an unrelated project edit
  // keeps the same Set, and the calendar filter, from render to render.
  const liveHiddenKey = useMemo(
    () => [...liveHiddenProjectIds(hiddenProjects, projects, { enabled: goalsProjectsEnabled })].sort().join('\u0000'),
    [hiddenProjects, projects, goalsProjectsEnabled],
  );
  const liveHiddenProjects = useMemo(
    () => (liveHiddenKey ? new Set(liveHiddenKey.split('\u0000')) : new Set()),
    [liveHiddenKey],
  );
  // The calendar views' filter: tags and hidden projects together. A VIEW
  // filter only; App.jsx hands it to the display reads and nothing else.
  const filterForCalendar = useMemo(
    () => makeCalendarFilter({ selectedTags, liveHidden: liveHiddenProjects }),
    [selectedTags, liveHiddenProjects],
  );

  // Saved Inbox filters minus stale selections, and the Inbox itself: one
  // filter in utils/inboxFilter.js, shared with the launcher snapshot and the
  // headless refresh so every surface counts the same tasks. The live values
  // are what the filter UIs use for their "active" state; the setters still
  // own the saved preference.
  const liveInboxProjectFilter = useMemo(
    () => liveProjectFilterOf(inboxProjectFilter, projects),
    [inboxProjectFilter, projects],
  );
  const liveInboxTagFilter = useMemo(
    () => liveTagFilterOf(inboxTagFilter, filterableTags),
    [inboxTagFilter, filterableTags],
  );
  const filteredUnscheduledTasks = useMemo(
    () => filterInboxTasks(unscheduledTasks, {
      inboxPriorityFilter, hideCompletedInbox, hideProjectTasksInbox, hideStandaloneTasksInbox,
      liveProjectFilter: liveInboxProjectFilter, liveTagFilter: liveInboxTagFilter,
      goalsProjectsEnabled, isVisibleForUser,
    }),
    [unscheduledTasks, inboxPriorityFilter, hideCompletedInbox, hideProjectTasksInbox,
     hideStandaloneTasksInbox, liveInboxTagFilter, liveInboxProjectFilter, goalsProjectsEnabled,
     isVisibleForUser]
  );

  // Today's tasks filtered by tag selection
  const filteredTodayTasks = useMemo(
    () => filterByTags(todayTasks),
    [filterByTags, todayTasks]
  );

  return {
    todayTasks,
    allTags,
    filterableTags,
    incompleteTodayTasks,
    filterByTags,
    filterForCalendar,
    liveHiddenProjects,
    filteredUnscheduledTasks,
    filteredTodayTasks,
    // What an "a filter is active" indicator should use: a saved selection whose
    // target no longer exists matches nothing and must not light it up.
    liveInboxTagFilter,
    liveInboxProjectFilter,
  };
}
