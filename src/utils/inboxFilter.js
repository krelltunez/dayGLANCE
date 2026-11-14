// What the Inbox shows: the one filter behind the Inbox list, the sidebar
// badge, the dial's Inbox complication and the GLANCElauncher's Inbox count
// (utils/launcherSnapshot.js), so every surface counts the same tasks. Pure:
// the preferences come in as values (readInboxFilterPrefs reads them where
// there is storage), so the headless refresh, with no React state, filters
// exactly as the app does.

import { extractTags } from './taskUtils.js';
import { notBucketed } from './bucketList.js';

// How the Inbox list is ordered (#2394): by priority, as it always was, or by
// deadline. Device-local like the filters beside it, under a prefixed key so
// the device-settings backup carries it (utils/deviceSettings.js).
export const INBOX_SORT_KEY = 'day-planner-inbox-sort';
export const INBOX_SORT_PRIORITY = 'priority';
export const INBOX_SORT_DEADLINE = 'deadline';
/** A stored or passed sort as one of the two: anything but 'deadline' is the priority order. */
export const inboxSortOf = (value) => (value === INBOX_SORT_DEADLINE ? INBOX_SORT_DEADLINE : INBOX_SORT_PRIORITY);

/** The Inbox filter preferences and its sort, device-local, as the app's initialisers read them. */
export function readInboxFilterPrefs(storage = globalThis.localStorage) {
  const get = (key) => { try { return storage?.getItem(key) ?? null; } catch { return null; } };
  const list = (key) => { try { const v = JSON.parse(get(key) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };
  let priority = 0;
  try { const saved = get('inboxPriorityFilter'); priority = saved ? JSON.parse(saved) : 0; } catch { priority = 0; }
  return {
    // 0 = show all, 1-3 = show that priority and above.
    inboxPriorityFilter: priority,
    hideCompletedInbox: get('hideCompletedInbox') === 'true',
    // Default true (hide): project tasks live on their project card unless the user opts in.
    hideProjectTasksInbox: get('hideProjectTasksInbox') !== 'false',
    hideStandaloneTasksInbox: get('hideStandaloneTasksInbox') === 'true',
    inboxTagFilter: list('inboxTagFilter'),
    inboxProjectFilter: list('inboxProjectFilter'),
    inboxSort: inboxSortOf(get(INBOX_SORT_KEY)),
  };
}

const tagsInto = (set, title) => extractTags(title).forEach((tag) => set.add(tag));

/**
 * Tags the GLANCE tag-filter UIs offer: every task's, but no Bucket List
 * item's (its tasks never appear in the filtered views, so a bucket-only tag
 * would be a filter that matches nothing) and no imported event's. The same
 * rules as useComputedViews' one-pass filterableTags, which builds allTags
 * alongside; inboxFilter.test.js holds the two Inboxes equal.
 */
export function filterableTagsOf({ tasks = [], unscheduledTasks = [], recurringTasks = [] }) {
  const set = new Set();
  tasks.filter((t) => !t.imported).forEach((t) => tagsInto(set, t.title));
  unscheduledTasks.filter((t) => !t.imported && notBucketed(t)).forEach((t) => tagsInto(set, t.title));
  recurringTasks.forEach((t) => tagsInto(set, t.title));
  return Array.from(set).sort();
}

/**
 * The saved project and tag filters minus selections that no longer exist (a
 * deleted project, a tag whose last task was renamed). Applied verbatim they
 * would match nothing while the filter still reads as on, so stale selections
 * are ignored at READ time rather than pruned from the preference: tasks and
 * tags keep arriving after the first load (#2137 review). The same array comes
 * back when nothing is stale, so memoised callers stay stable.
 */
export function liveInboxProjectFilter(saved = [], projects = []) {
  if (!saved || saved.length === 0) return saved || [];
  const live = new Set((projects || []).map((p) => String(p.id)));
  const kept = saved.filter((id) => live.has(String(id)));
  return kept.length === saved.length ? saved : kept;
}

export function liveInboxTagFilter(saved = [], filterableTags = []) {
  if (!saved || saved.length === 0) return saved || [];
  const kept = saved.filter((tag) => filterableTags.includes(tag));
  return kept.length === saved.length ? saved : kept;
}

const deadlineOf = (task) => (typeof task?.deadline === 'string' ? task.deadline : '');

/**
 * The Inbox as the user sees it, sorted: open tasks first, then by priority,
 * highest first. Under `inboxSort: 'deadline'` (#2394) the open tasks with a
 * deadline lead, soonest first (a YYYY-MM-DD string, so it compares as text),
 * and priority orders the tasks that share a date and the ones with none.
 * Tasks the sort cannot tell apart keep their stored order either way. The
 * sort decides only the order: which tasks are in the Inbox, and so every
 * count, is the same under both.
 * When goals/projects are on, project tasks live on their project card unless
 * the user opts in; if the feature is off, that exclusion is lifted.
 */
export function filterInboxTasks(unscheduledTasks = [], {
  inboxPriorityFilter = 0, hideCompletedInbox = false, hideProjectTasksInbox = true, hideStandaloneTasksInbox = false,
  liveProjectFilter = [], liveTagFilter = [], goalsProjectsEnabled = false, isVisibleForUser = () => true,
  inboxSort = INBOX_SORT_PRIORITY,
} = {}) {
  const byDeadline = inboxSortOf(inboxSort) === INBOX_SORT_DEADLINE;
  return unscheduledTasks
    // Bucket List items never appear in the Inbox: the Inbox nags, the Bucket doesn't.
    .filter(notBucketed)
    .filter((task) => !task.archived)
    // Multi-user: only tasks assigned to "me" (or unassigned).
    .filter((task) => isVisibleForUser(task))
    .filter((task) => {
      if (!goalsProjectsEnabled) return true;
      // Specific projects selected: only their tasks.
      if (liveProjectFilter.length > 0) return task.projectId && liveProjectFilter.includes(task.projectId);
      if (hideProjectTasksInbox && task.projectId) return false;
      if (hideStandaloneTasksInbox && !task.projectId) return false;
      return true;
    })
    .filter((task) => inboxPriorityFilter === 0 || (task.priority || 0) >= inboxPriorityFilter)
    .filter((task) => !(task.completed && task.deadline))
    .filter((task) => !hideCompletedInbox || !task.completed)
    .filter((task) => {
      if (liveTagFilter.length === 0) return true;
      const taskTags = extractTags(task.title);
      return liveTagFilter.some((tag) => taskTags.includes(tag));
    })
    .sort((a, b) => {
      // Completed tasks always sink below incomplete ones.
      if (a.completed !== b.completed) return a.completed ? 1 : -1;
      if (byDeadline) {
        const da = deadlineOf(a);
        const db = deadlineOf(b);
        if (da !== db) {
          if (!da) return 1;
          if (!db) return -1;
          return da.localeCompare(db);
        }
      }
      return (b.priority || 0) - (a.priority || 0);
    });
}

/** The Inbox count every surface shows: the filtered Inbox without example tasks (the dial's expression). */
export const inboxCountOf = (filteredInbox = []) => filteredInbox.filter((t) => !t.isExample).length;

/**
 * The whole chain from stored state, for a caller with no React state (the
 * headless refresh): the same prefs, live filters and filter the app runs.
 */
export function inboxFromStorage({ tasks = [], unscheduledTasks = [], recurringTasks = [], projects = [], goalsProjectsEnabled = false, isVisibleForUser = () => true, storage } = {}) {
  const prefs = readInboxFilterPrefs(storage);
  const filterableTags = filterableTagsOf({ tasks, unscheduledTasks, recurringTasks });
  return filterInboxTasks(unscheduledTasks, {
    ...prefs,
    liveProjectFilter: liveInboxProjectFilter(prefs.inboxProjectFilter, projects),
    liveTagFilter: liveInboxTagFilter(prefs.inboxTagFilter, filterableTags),
    goalsProjectsEnabled, isVisibleForUser,
  });
}
