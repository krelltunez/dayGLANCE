// "New project…" in the task modals' project picker: the project is named
// in the modal and created only when the task is saved, so a cancelled
// modal leaves nothing behind.
//
// While it is pending, newTask.projectId holds NEW_PROJECT_ID, so the modal
// treats the task as a project task (the Unscheduled option, the button label,
// and a disabled priority control), and newTask.newProject holds the name and
// goal. The DEADLINE control stays live for it: an unscheduled project task is
// an inbox task and the deadline is an inbox field, which is what the project
// row's own picker already assumed (#2116 review). Every path that saves
// newTask (addTask, saveMobileEditTask) passes it through createPendingProject
// first, which swaps in the real id.
import { PROJECT_FALLBACK_COLOR } from './colorUtils.js';
import { seedTaskDefaults } from './projectTaskDefaults.js';

export const NEW_PROJECT_ID = '__new-project__';

/**
 * The fields a new project is created with. Its colour is the one the task
 * shows in the modal, so a colour picked there is the project's too;
 * without one, its goal's, as the project form defaults it, then blue.
 * Under a goal, it starts with the New task defaults the goal (else its
 * area) holds for new projects, as the project form seeds them.
 */
export function newProjectFields({ title, goal, area = null, color = null }) {
  const taskDefaults = goal ? seedTaskDefaults(goal, area) : undefined;
  return {
    title: title.trim(),
    ...(goal ? { goalId: goal.id } : {}),
    color: color || goal?.color || PROJECT_FALLBACK_COLOR,
    assignedUserSyncIds: goal?.assignedUserSyncIds || [],
    ...(taskDefaults ? { taskDefaults } : {}),
  };
}

/**
 * newTask with `newProject` pending, as the picker sets it: on choosing
 * "New project…" and on each change of its goal.
 *
 * A colour the user picked, before choosing "New project…" or after, is
 * kept: it becomes the project's as well as the task's. A goal's colour
 * fills in only where none was picked, and follows the goal while it is the
 * goal's (newProject.goalColor remembers which colour that was, so a
 * colour picked since is told apart from it). The goal's assigned users
 * stamp the task, as choosing an existing project's do.
 */
export function withPendingProject(newTask, newProject, goals = []) {
  const goal = newProject.goalId ? goals.find((g) => g.id === newProject.goalId) || null : null;
  const picked = newTask.color && newTask.color !== newTask.newProject?.goalColor ? newTask.color : null;
  const goalColor = picked ? null : (goal?.color || null);
  const { color: _shown, ...rest } = newTask;
  return {
    ...rest,
    ...(picked || goalColor ? { color: picked || goalColor } : {}),
    projectId: NEW_PROJECT_ID,
    newProject: { ...newProject, goalColor },
    assignedUserSyncIds: goal?.assignedUserSyncIds || [],
  };
}

/**
 * newTask ready to save: a pending project created through addProject and
 * its id in place of the placeholder. With nothing pending, newTask as it
 * is. A placeholder without a name never reaches a task: it is dropped, and
 * the task saves without a project.
 *
 * Returns the project created too, since the app's project list does not
 * hold it until the next render, and a task tagged #obsidian writes its
 * project to its line as it is created.
 *
 * @returns {{ newTask: object, project: object | null }}
 */
export function createPendingProject(newTask, { addProject, goals = [], areas = [] }) {
  if (newTask?.projectId !== NEW_PROJECT_ID) return { newTask, project: null };
  const { newProject, projectId: _placeholder, ...rest } = newTask;
  const title = (newProject?.title || '').trim();
  if (!title) return { newTask: rest, project: null };
  const goal = newProject.goalId ? goals.find((g) => g.id === newProject.goalId) || null : null;
  const area = goal?.areaId ? areas.find((a) => a.id === goal.areaId) || null : null;
  const project = addProject(newProjectFields({ title, goal, area, color: rest.color }));
  // The task takes the project's colour, which is the one it showed, or the
  // project's default where it showed the default.
  return { newTask: { ...rest, projectId: project.id, color: project.color }, project };
}
