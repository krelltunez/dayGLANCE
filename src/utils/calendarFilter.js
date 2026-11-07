// The calendar filter (#2307): what the calendar views leave out, on this
// device only. Two parts, applied together:
//
// - the TAG filter (useTagFilter's selectedTags): a tagged task shows only if
//   one of its tags is selected; untagged tasks and imported events always show;
// - HIDE PROJECTS (useTagFilter's hiddenProjects): a task whose project the
//   user ticked is left out, e.g. "Household" while at work.
//
// It is a VIEW filter and nothing else, both its parts. A hidden task still
// occupies its time: frames' free slots, scheduling, day occupancy, the frame
// nudge, focus, the dial, widget and launcher snapshots and the MCP read model
// read the day without it. In App.jsx it rides getCalendarTasksForDate,
// getDayDisplayForDate and the continuations only; getTasksForDate is the day
// as it holds, with no filter (hooks/useDayReads.js).
//
// Pure, so the rules and the count are tested without the app.

import { extractTags, dateToString } from './taskUtils.js';
import { isActiveProject } from './inboxProjectGroups.js';

export const HIDDEN_PROJECTS_KEY = 'day-planner-hidden-projects';

/** The saved list, as the hook's initialiser reads it: anything unreadable is no list. */
export function readHiddenProjects(storage = globalThis.localStorage) {
  try {
    const parsed = JSON.parse(storage?.getItem(HIDDEN_PROJECTS_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * The tag filter's rule (OR): untagged tasks and imported events always show;
 * with no tag selected, tagged tasks are hidden; otherwise a tagged task shows
 * when it carries a selected tag.
 */
export function passesTagFilter(task, selectedTags = []) {
  const taskTags = extractTags(task.title);
  if (task.imported || taskTags.length === 0) return true;
  if (selectedTags.length === 0) return false;
  return selectedTags.some((tag) => taskTags.includes(tag));
}

const NONE = new Set();

/**
 * The saved hidden list minus what the "Hide projects" section does not offer:
 * an archived, completed, deleted or unknown project, or every project while
 * Goals & Projects is off. Ignored at READ time, never pruned from the saved
 * list (the Inbox filter's rule, #2137): projects keep arriving after the
 * first load, and one unarchived comes back hidden as it was. Whatever is
 * live can therefore always be unticked in the section.
 *
 * @returns {Set<string>} project ids as strings
 */
export function liveHiddenProjectIds(hidden = [], projects = [], { enabled = true } = {}) {
  if (!enabled || !Array.isArray(hidden) || hidden.length === 0) return NONE;
  const offered = new Set((projects || []).filter(isActiveProject).map((p) => String(p.id)));
  const live = new Set();
  for (const id of hidden) if (id != null && offered.has(String(id))) live.add(String(id));
  return live.size ? live : NONE;
}

/** Whether hide-projects leaves this task out. A task with no project never is. */
export function isHiddenByProject(task, liveHidden = NONE) {
  if (!liveHidden.size || !task) return false;
  const { projectId } = task;
  if (projectId == null || projectId === '') return false;
  return liveHidden.has(String(projectId));
}

/**
 * The calendar filter as one function over a list of rows: the tag filter and
 * hide-projects together. Returns the list itself when nothing is left out.
 */
export function makeCalendarFilter({ selectedTags = [], liveHidden = NONE } = {}) {
  return (list) => {
    const kept = list.filter((task) => passesTagFilter(task, selectedTags) && !isHiddenByProject(task, liveHidden));
    return kept.length === list.length ? list : kept;
  };
}

const range = (from, to) => {
  const out = [];
  const last = new Date(`${to}T12:00:00`);
  for (const d = new Date(`${from}T12:00:00`); d <= last; d.setDate(d.getDate() + 1)) out.push(dateToString(d));
  return out;
};

/**
 * The dates the calendar on screen draws with the filter applied, for the
 * filter button's count. `mode` is the view on screen: the desktop cycler's
 * (effectiveViewMode), or on a phone and an upright tablet the toggle's
 * (mobileViewMode, whose 'grid' is MULTI's timeline). SCHED is none: it opts
 * out of the calendar filter and has its own.
 *
 * @returns {string[]} 'YYYY-MM-DD', no duplicates
 */
export function calendarFilterDates({
  mode, selectedDate, visibleDates = [], weekViewDates = [], dayViewColumns = [], monthViewRange = null,
}) {
  let dates;
  switch (mode) {
    case 'sched': return [];
    case 'month':
      dates = monthViewRange?.from && monthViewRange?.to ? range(monthViewRange.from, monthViewRange.to) : [];
      break;
    case 'week': dates = weekViewDates.map(dateToString); break;
    case 'day': dates = dayViewColumns.map((col) => col.dateStr || dateToString(col.date)); break;
    case 'list':
    case 'jobo': dates = selectedDate ? [dateToString(selectedDate)] : []; break;
    default: dates = visibleDates.map(dateToString);
  }
  return [...new Set(dates)];
}

/**
 * How many of the dates' rows the filter leaves out: the tag filter and
 * hide-projects together, each task counted once. `rowsForDate` is the day's
 * rows before any filter (getTasksForDate(date)'s map).
 */
export function countHiddenOnDates(dateStrs, rowsForDate, filter) {
  let hidden = 0;
  for (const dateStr of dateStrs) {
    const all = rowsForDate(dateStr) || [];
    if (all.length) hidden += all.length - filter(all).length;
  }
  return hidden;
}
