// The last project a task was saved with from the task editor (#2274). The
// editor's project picker offers it pinned at the top of its list as a
// one-tap choice; a new task still starts with no project, since the editor
// is deliberately pressure-free and never chooses for the user.
//
// A preference of this device, like the picker's folds: not synced, not a
// task field, and not scoped to a user (device preferences are not, and the
// picker lists every project whoever is viewing). Storage may be unavailable:
// nothing is then remembered and nothing is pinned.
import { NEW_PROJECT_ID } from './pendingProject.js';

export const LAST_USED_PROJECT_KEY = 'day-planner-task-project-last-used';

/** The remembered project id, or null. */
export function readLastUsedProject() {
  try { return localStorage.getItem(LAST_USED_PROJECT_KEY) || null; } catch { return null; }
}

/**
 * Remembers the project of a task the editor saved. A task saved with no
 * project leaves the last one in place; the "New project…" placeholder is
 * never remembered (the save swaps in the real id first).
 */
export function rememberLastUsedProject(projectId) {
  if (!projectId || projectId === NEW_PROJECT_ID) return;
  try { localStorage.setItem(LAST_USED_PROJECT_KEY, projectId); } catch { /* not remembered */ }
}

/**
 * The project to pin: the remembered one while it still exists and the
 * picker would list it (not archived, not completed), else null.
 */
export function pinnedLastUsedProject(projectId, projects = []) {
  if (!projectId) return null;
  const project = projects.find((p) => p && p.id === projectId);
  if (!project || project.status === 'archived' || project.status === 'completed') return null;
  return project;
}
