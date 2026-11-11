import React from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../context/FeaturesContext.jsx';
import { getProjectColor } from '../utils/colorUtils.js';
import { NEW_PROJECT_ID, withPendingProject } from '../utils/pendingProject.js';
import { draftWithProjectDefaults, seedTaskDefaultsFor } from '../utils/projectTaskDefaults.js';
import { findGoalGeneralProject, generalValue, goalIdOfGeneralValue } from '../utils/goalGeneralProject.js';
import TaskProjectPicker from './TaskProjectPicker.jsx';
import { readDefaultTaskDuration } from '../utils/defaultTaskDuration.js';

/**
 * The task modals' project field, desktop and phone: the active projects by
 * area and goal (TaskProjectPicker, #2279), and "New project…", which turns
 * the field into a name and an optional goal. That project is created when
 * the task is saved (utils/pendingProject.js). So is a goal's "General"
 * project (#2365, utils/goalGeneralProject.js), picked under its goal: it
 * needs no name, so the field stays the picker, showing it.
 */
export default function TaskProjectField({ newTask, setNewTask }) {
  const { t } = useTranslation();
  const { darkMode, borderClass, textSecondary, hoverBg, mobileEditingTask } = useDayPlannerCtx();
  const { goals, projects, areas = [] } = useFeaturesCtx();
  const fieldClass = `w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white placeholder-gray-400' : 'bg-white text-stone-900 placeholder-stone-400'}`;
  const activeGoals = goals.filter(g => g.status !== 'archived');

  // A colour picked in the modal stays, and becomes the new project's; a
  // goal's colour fills in where none was (utils/pendingProject.js).
  const pendingWith = (newProject) => withPendingProject(newTask, newProject, goals);

  const pendingGeneral = newTask.projectId === NEW_PROJECT_ID && !!newTask.newProject?.general;

  if (newTask.projectId === NEW_PROJECT_ID && !pendingGeneral) {
    const pending = newTask.newProject || { title: '', goalId: '' };
    return (
      <div data-task-new-project className="space-y-2">
        <label className={`block text-sm ${textSecondary} mb-1`} htmlFor="task-new-project-name">{t('task.project')}</label>
        <div className="flex gap-2">
          <input
            id="task-new-project-name"
            autoFocus
            required
            value={pending.title}
            onChange={(e) => setNewTask({ ...newTask, newProject: { ...pending, title: e.target.value } })}
            placeholder={t('goals.projectTitlePlaceholder')}
            aria-label={t('task.newProjectName')}
            className={fieldClass}
          />
          <button
            type="button"
            data-task-new-project-cancel
            onClick={() => {
              // Back to the list: a goal's colour that filled in goes with
              // the pending project; a colour that was picked stays.
              const { newProject: dropped, color, ...rest } = newTask;
              const keep = color && color !== dropped?.goalColor ? { color } : {};
              setNewTask({ ...rest, ...keep, projectId: null, assignedUserSyncIds: [] });
            }}
            className={`flex-shrink-0 px-2 rounded-lg border ${borderClass} ${textSecondary} ${hoverBg}`}
            aria-label={t('task.chooseExistingProject')}
            title={t('task.chooseExistingProject')}
          >
            <X size={16} />
          </button>
        </div>
        {activeGoals.length > 0 && (
          <select
            value={pending.goalId || ''}
            onChange={(e) => setNewTask(pendingWith({ ...pending, goalId: e.target.value }))}
            aria-label={t('goals.goalOptional')}
            className={fieldClass}
          >
            <option value="">{t('goals.noGoalStandalone')}</option>
            {activeGoals.map(g => <option key={g.id} value={g.id}>{g.title}</option>)}
          </select>
        )}
        <p className={`text-xs ${textSecondary}`}>{t('task.newProjectHint')}</p>
      </div>
    );
  }

  // A choice in the picker: '' for no project, NEW_PROJECT_ID for
  // "New project…", or a project's id.
  //
  // A NEW task also takes the project's New task defaults (#2336, utils/
  // projectTaskDefaults.js): duration, notes, checklist and tags, swapped for
  // the next project's on a change while they are still as the last one left
  // them. Editing an existing task never does: the defaults are for creation,
  // and what the task already holds is the user's.
  const creating = !mobileEditingTask;
  // A General project still to be made is not in the list yet: what it will
  // start with is what its goal (else its area) holds for new projects.
  const generalTo = (goalId) => ({ taskDefaults: seedTaskDefaultsFor(goalId, { goals, areas }) });
  const previous = pendingGeneral
    ? generalTo(newTask.newProject.goalId)
    : (newTask.projectId ? projects.find(p => p.id === newTask.projectId) : null);
  const choose = (value) => {
    const generalGoalId = goalIdOfGeneralValue(value);
    if (generalGoalId !== null) {
      // The goal's General project: the one it has, else one made on save.
      const existing = findGoalGeneralProject(projects, generalGoalId);
      if (existing) { choose(existing.id); return; }
      const goal = goals.find(g => String(g.id) === generalGoalId);
      if (!goal) return;
      const base = creating ? draftWithProjectDefaults(newTask, previous, generalTo(goal.id), { defaultDuration: readDefaultTaskDuration() }) : newTask;
      const pending = withPendingProject(base, { title: t('goals.generalProject'), goalId: goal.id, general: true }, goals);
      // Its colour is the goal's, as an existing project's is its own when picked.
      setNewTask({ ...pending, color: getProjectColor({}, goal) });
      return;
    }
    if (value === NEW_PROJECT_ID) {
      // A project made here has no defaults yet: take back the last one's.
      const base = creating ? draftWithProjectDefaults(newTask, previous, null, { defaultDuration: readDefaultTaskDuration() }) : newTask;
      setNewTask(withPendingProject(base, { title: '', goalId: '' }, goals));
      return;
    }
    const pid = value || null;
    const proj = pid ? projects.find(p => p.id === pid) : null;
    const parentGoal = proj?.goalId ? goals.find(g => g.id === proj.goalId) : null;
    // Copy-at-creation inheritance: adopting a project stamps its
    // effective color and assigned users onto the draft task
    // (deselecting clears the inherited users).
    const base = creating ? draftWithProjectDefaults(newTask, previous, proj, { defaultDuration: readDefaultTaskDuration() }) : newTask;
    setNewTask({
      ...base,
      projectId: pid,
      ...(proj ? { color: getProjectColor(proj, parentGoal) } : {}),
      assignedUserSyncIds: proj?.assignedUserSyncIds || [],
    });
  };

  return (
    <div>
      <label className={`block text-sm ${textSecondary} mb-1`} htmlFor="task-project-picker">{t('task.project')}</label>
      <TaskProjectPicker
        id="task-project-picker"
        value={pendingGeneral ? generalValue(newTask.newProject.goalId) : (newTask.projectId || '')}
        onChange={choose}
      />
      {pendingGeneral && <p data-task-general-pending className={`text-xs ${textSecondary} mt-1`}>{t('task.newProjectHint')}</p>}
    </div>
  );
}
