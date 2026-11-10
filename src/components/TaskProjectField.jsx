import React from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../context/FeaturesContext.jsx';
import { getProjectColor } from '../utils/colorUtils.js';
import { NEW_PROJECT_ID, withPendingProject } from '../utils/pendingProject.js';
import { draftWithProjectDefaults } from '../utils/projectTaskDefaults.js';
import TaskProjectPicker from './TaskProjectPicker.jsx';
import { readDefaultTaskDuration } from '../utils/defaultTaskDuration.js';

/**
 * The task modals' project field, desktop and phone: the active projects by
 * area and goal (TaskProjectPicker, #2279), and "New project…", which turns
 * the field into a name and an optional goal. That project is created when
 * the task is saved (utils/pendingProject.js).
 */
export default function TaskProjectField({ newTask, setNewTask }) {
  const { t } = useTranslation();
  const { darkMode, borderClass, textSecondary, hoverBg, mobileEditingTask } = useDayPlannerCtx();
  const { goals, projects } = useFeaturesCtx();
  const fieldClass = `w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white placeholder-gray-400' : 'bg-white text-stone-900 placeholder-stone-400'}`;
  const activeGoals = goals.filter(g => g.status !== 'archived');

  // A colour picked in the modal stays, and becomes the new project's; a
  // goal's colour fills in where none was (utils/pendingProject.js).
  const pendingWith = (newProject) => withPendingProject(newTask, newProject, goals);

  if (newTask.projectId === NEW_PROJECT_ID) {
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
  const previous = newTask.projectId ? projects.find(p => p.id === newTask.projectId) : null;
  const choose = (value) => {
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
      <TaskProjectPicker id="task-project-picker" value={newTask.projectId || ''} onChange={choose} />
    </div>
  );
}
