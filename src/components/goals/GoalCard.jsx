import React, { forwardRef } from 'react';
import { AlertTriangle, Calendar, CircleCheckBig, Edit2, FolderOpen, Layers, Plus } from 'lucide-react';
import { useDayPlannerCtx } from '../../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../../context/FeaturesContext.jsx';
import { calculateGoalProgress } from '../../utils/goalProgress.js';
import { isProjectStalled } from '../../utils/projectProgress.js';
import GoalProgress from './GoalProgress.jsx';

/**
 * GoalCard — a single goal node in the dashboard flowchart.
 *
 * Used in both the desktop flowchart (as a node with SVG line anchor)
 * and as the header card on each mobile carousel page.
 *
 * `ref` is forwarded so GoalDashboard can measure the card's position
 * for drawing SVG connector lines to child ProjectCards.
 *
 * Props:
 *   goal             — the goal object
 *   projects         — child projects (goalId === goal.id, non-archived)
 *   isCollapsed      — whether child projects are hidden
 *   onToggleCollapse — called when the collapse chevron is clicked
 *   onEdit           — called when the edit button is clicked
 */
const GoalCard = forwardRef(
  ({ goal, projects, onEdit, onNewProject }, ref) => {
    const {
      tasks, unscheduledTasks,
      darkMode,
      borderClass, textPrimary, textSecondary, hoverBg,
    } = useDayPlannerCtx();
    const { updateGoal } = useFeaturesCtx();

    const allTasks = [...tasks, ...unscheduledTasks];
    const progress = calculateGoalProgress(goal.id, projects, allTasks);
    const goalColor = goal.color || 'bg-blue-500';

    // Days remaining until target date
    let daysLabel = null;
    let daysUrgent = false;
    let isOverdue = false;
    if (goal.targetDate) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const target = new Date(goal.targetDate + 'T00:00:00');
      const diff = Math.ceil((target - today) / (1000 * 60 * 60 * 24));
      if (diff === 0) { daysLabel = 'Due today'; daysUrgent = true; }
      else if (diff < 0) { daysLabel = `${Math.abs(diff)}d overdue`; daysUrgent = true; isOverdue = true; }
      else if (diff <= 7) { daysLabel = `${diff}d left`; daysUrgent = true; }
      else { daysLabel = `${diff}d left`; }
    }

    // Caution: goal is overdue or has at least one stalled child project
    const hasStalledProject = projects.some(p => isProjectStalled(p.id, allTasks, p));
    const showCaution = isOverdue || hasStalledProject;
    // All non-archived projects complete → offer one-click completion
    const nonArchivedProjects = projects.filter(p => p.status !== 'archived');
    const allProjectsDone = nonArchivedProjects.length > 0 && progress >= 1;
    const isCompleted = goal.status === 'completed';

    return (
      <div
        ref={ref}
        className={`rounded-xl overflow-hidden border-2 w-full ${
          darkMode ? 'border-gray-600' : 'border-stone-200'
        }`}
        style={{ opacity: isCompleted ? 0.45 : 1, borderTopColor: 'transparent', borderLeftColor: 'transparent', borderRightColor: 'transparent' }}
      >
        {/* Colored header */}
        <div className={`${goalColor} px-3 py-2.5 flex items-center gap-2`}>
          <span className="flex-1 text-white font-semibold text-sm leading-tight truncate">
            {goal.title}
          </span>
          <button
            onClick={onEdit}
            className="flex-shrink-0 text-white/70 hover:text-white transition-colors p-0.5 rounded"
            aria-label="Edit goal"
          >
            <Edit2 size={13} />
          </button>
        </div>

        {/* Body */}
        <div
          className={`px-3 py-2 flex flex-col gap-2 ${
            darkMode ? 'bg-gray-800' : 'bg-white'
          }`}
        >
          {/* Target date + caution, or Completed label */}
          {isCompleted ? (
            <p className="text-xs text-emerald-500">Completed</p>
          ) : (daysLabel || showCaution || allProjectsDone) ? (
            <div className="flex items-center gap-1.5">
              {daysLabel && (
                <>
                  <Calendar size={12} className={daysUrgent ? 'text-amber-500' : textSecondary} />
                  <span className={`text-xs font-medium ${daysUrgent ? 'text-amber-500' : textSecondary}`}>
                    {daysLabel}
                  </span>
                </>
              )}
              {showCaution && !allProjectsDone && (
                <AlertTriangle size={12} className="text-amber-500 ml-auto flex-shrink-0" />
              )}
              {allProjectsDone && (
                <button
                  onClick={() => updateGoal(goal.id, { status: 'completed' })}
                  className="ml-auto flex-shrink-0 text-emerald-500 hover:text-emerald-400 transition-colors"
                  aria-label="Mark goal complete"
                >
                  <CircleCheckBig size={13} />
                </button>
              )}
            </div>
          ) : null}

          {/* Description */}
          {goal.description && (
            <p className={`text-xs ${textSecondary} leading-snug line-clamp-2`}>
              {goal.description}
            </p>
          )}

          {/* Progress */}
          <GoalProgress progress={progress} color={goalColor} />

          {/* Project count + percentage, or empty state */}
          {projects.length === 0 ? (
            <div className="flex flex-col items-center gap-1.5 py-2">
              <FolderOpen size={18} className={`${textSecondary} opacity-50`} />
              <span className={`text-xs ${textSecondary} opacity-60`}>No projects yet</span>
              {onNewProject && (
                <button
                  type="button"
                  onClick={onNewProject}
                  className="flex items-center gap-1 text-xs text-emerald-500 hover:text-emerald-600 transition-colors"
                >
                  <Layers size={11} /> Add project
                </button>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className={`text-xs ${textSecondary}`}>
                  {projects.length} project{projects.length !== 1 ? 's' : ''}
                </span>
                {onNewProject && (
                  <button
                    type="button"
                    onClick={onNewProject}
                    className={`flex items-center gap-0.5 text-xs ${textSecondary} opacity-60 hover:opacity-100 transition-opacity`}
                  >
                    <Plus size={10} /> Add
                  </button>
                )}
              </div>
              <span className={`text-xs font-medium ${progress >= 1 ? 'text-green-500' : textSecondary}`}>
                {Math.round(progress * 100)}%
              </span>
            </div>
          )}
        </div>
      </div>
    );
  }
);

GoalCard.displayName = 'GoalCard';

export default GoalCard;
