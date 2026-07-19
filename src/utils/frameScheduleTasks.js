import { extractTags } from './taskUtils.js';

// Builds the task list for the Manually Schedule (frame schedule) modal.
//
// Filtering rules, in order:
// - never show completed or example tasks (pre-existing behavior)
// - only tasks visible to the current user (same isVisibleForUser rule
//   applied by every other surface: visible when multi-user is off, the task
//   is unassigned, or it is assigned to "me")
// - only tasks with no deadline or a deadline on the frame's date
// - when applyInboxFilters is true, mirror the inbox list's own filters
//   (see useComputedViews.filteredUnscheduledTasks):
//   - inboxProjectFilter non-empty: keep only tasks in one of those projects
//   - inboxTagFilter non-empty: keep only tasks whose #tags match one
// - when affinityOnly is true and the frame has a tagAffinity, keep only
//   tasks whose #tags contain at least one affinity tag (the same exact-tag
//   rule Smart Schedule's auto-fill prompt applies)
//
// Sort: tasks with a deadline first, then by priority (descending).
export function filterFrameScheduleTasks(unscheduledTasks, {
  dateStr,
  isVisibleForUser = () => true,
  inboxTagFilter = [],
  inboxProjectFilter = [],
  applyInboxFilters = false,
  tagAffinity = [],
  affinityOnly = false,
} = {}) {
  return (unscheduledTasks || [])
    .filter(t => !t.completed && !t.isExample && (!t.deadline || t.deadline === dateStr))
    .filter(t => isVisibleForUser(t))
    .filter(t => {
      if (!applyInboxFilters) return true;
      if (inboxProjectFilter.length > 0 && !(t.projectId && inboxProjectFilter.includes(t.projectId))) return false;
      if (inboxTagFilter.length > 0) {
        const taskTags = extractTags(t.title);
        return inboxTagFilter.some(tag => taskTags.includes(tag));
      }
      return true;
    })
    .filter(t => {
      if (!affinityOnly || tagAffinity.length === 0) return true;
      const taskTags = extractTags(t.title);
      return tagAffinity.some(tag => taskTags.includes(tag));
    })
    .sort((a, b) => {
      const aHasDeadline = a.deadline ? 1 : 0;
      const bHasDeadline = b.deadline ? 1 : 0;
      if (bHasDeadline !== aHasDeadline) return bHasDeadline - aHasDeadline;
      return (b.priority || 0) - (a.priority || 0);
    });
}
