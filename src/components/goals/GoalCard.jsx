import React, { forwardRef } from 'react';
import { Calendar, ChevronDown, ChevronRight, Edit2 } from 'lucide-react';
import { useDayPlannerCtx } from '../../context/DayPlannerContext.jsx';
import { calculateGoalProgress } from '../../utils/goalProgress.js';
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
  ({ goal, projects, isCollapsed, onToggleCollapse, onEdit }, ref) => {
    const {
      tasks, unscheduledTasks,
      darkMode,
      borderClass, textPrimary, textSecondary, hoverBg,
    } = useDayPlannerCtx();

    const allTasks = [...tasks, ...unscheduledTasks];
    const progress = calculateGoalProgress(goal.id, projects, allTasks);
    const goalColor = goal.color || 'bg-blue-500';

    // Days remaining until target date
    let daysLabel = null;
    let daysUrgent = false;
    if (goal.targetDate) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const target = new Date(goal.targetDate + 'T00:00:00');
      const diff = Math.ceil((target - today) / (1000 * 60 * 60 * 24));
      if (diff === 0) { daysLabel = 'Due today'; daysUrgent = true; }
      else if (diff < 0) { daysLabel = `${Math.abs(diff)}d overdue`; daysUrgent = true; }
      else if (diff <= 7) { daysLabel = `${diff}d left`; daysUrgent = true; }
      else { daysLabel = `${diff}d left`; }
    }

    return (
      <div
        ref={ref}
        className={`rounded-xl overflow-hidden border-2 w-full ${
          darkMode ? 'border-gray-600' : 'border-stone-200'
        }`}
        style={{ borderTopColor: 'transparent', borderLeftColor: 'transparent', borderRightColor: 'transparent' }}
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
          <button
            onClick={onToggleCollapse}
            className="flex-shrink-0 text-white/80 hover:text-white transition-colors"
            aria-label={isCollapsed ? 'Expand projects' : 'Collapse projects'}
          >
            {isCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
          </button>
        </div>

        {/* Body */}
        <div
          className={`px-3 py-2 flex flex-col gap-2 ${
            darkMode ? 'bg-gray-800' : 'bg-white'
          }`}
        >
          {/* Target date */}
          {daysLabel && (
            <div className="flex items-center gap-1.5">
              <Calendar size={12} className={daysUrgent ? 'text-amber-500' : textSecondary} />
              <span
                className={`text-xs font-medium ${
                  daysUrgent ? 'text-amber-500' : textSecondary
                }`}
              >
                {daysLabel}
              </span>
            </div>
          )}

          {/* Description */}
          {goal.description && (
            <p className={`text-xs ${textSecondary} leading-snug line-clamp-2`}>
              {goal.description}
            </p>
          )}

          {/* Progress */}
          <GoalProgress progress={progress} color={goalColor} />

          {/* Project count */}
          <span className={`text-xs ${textSecondary}`}>
            {projects.length} project{projects.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>
    );
  }
);

GoalCard.displayName = 'GoalCard';

export default GoalCard;
