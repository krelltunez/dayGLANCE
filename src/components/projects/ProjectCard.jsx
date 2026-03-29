import React, { forwardRef, useState } from 'react';
import { AlertTriangle, CheckSquare, Plus, X, Zap } from 'lucide-react';
import { useDayPlannerCtx } from '../../context/DayPlannerContext.jsx';
import { calculateProjectProgress, isProjectStalled } from '../../utils/projectProgress.js';
import { TAILWIND_TO_HEX } from '../../utils/colorUtils.js';
import ProjectProgress from './ProjectProgress.jsx';

const toHex = (bgClass) => TAILWIND_TO_HEX[bgClass] || '#3b82f6';

/**
 * ProjectCard — a single project node in the Goals dashboard.
 *
 * Used in both the desktop flowchart and the mobile carousel.
 * `ref` is forwarded so GoalDashboard can measure card positions for SVG lines.
 *
 * Props:
 *   project      — the project object
 *   onFocusClick — called with the project when the "Project Focus" button is clicked
 *                  (actual session scoping is wired in PR 5; button exists here)
 */
const ProjectCard = forwardRef(({ project, onFocusClick }, ref) => {
  const {
    tasks,
    unscheduledTasks, setUnscheduledTasks,
    goals,
    darkMode,
    borderClass, textPrimary, textSecondary, hoverBg,
  } = useDayPlannerCtx();

  const parentGoal = project.goalId ? goals.find(g => g.id === project.goalId) : null;
  const goalHex = parentGoal ? toHex(parentGoal.color || 'bg-blue-500') : null;

  const [quickAddTitle, setQuickAddTitle] = useState('');
  const [showQuickAdd, setShowQuickAdd] = useState(false);

  const allTasks = [...tasks, ...unscheduledTasks];
  const projectTasks = allTasks.filter(t => t.projectId === project.id && !t.archived);
  const completedCount = projectTasks.filter(t => t.completed).length;
  const totalCount = projectTasks.length;
  const progress = calculateProjectProgress(project.id, allTasks);
  const stalled = isProjectStalled(project.id, allTasks);

  // Unscheduled tasks belonging to this project (shown in the card body)
  const projectUnscheduled = unscheduledTasks.filter(t => t.projectId === project.id);

  const handleQuickAdd = (e) => {
    e.preventDefault();
    const title = quickAddTitle.trim();
    if (!title) return;
    const newTask = {
      id: crypto.randomUUID(),
      title,
      duration: 30,
      color: 'bg-blue-500',
      completed: false,
      isAllDay: false,
      notes: '',
      subtasks: [],
      priority: 0,
      projectId: project.id,
      lastModified: new Date().toISOString(),
    };
    setUnscheduledTasks(prev => [...prev, newTask]);
    setQuickAddTitle('');
    setShowQuickAdd(false);
  };

  return (
    <div
      ref={ref}
      className={`flex flex-col rounded-xl border overflow-hidden ${
        darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-stone-200'
      } min-w-[180px] max-w-[240px] w-full`}
    >
      {/* Goal color bar */}
      {goalHex && (
        <div className="h-1.5 flex-shrink-0" style={{ background: goalHex + 'bb' }} />
      )}
      {/* Card body */}
      <div className="flex flex-col gap-2 p-3">
      {/* Header: title + stalled badge */}
      <div className="flex items-start justify-between gap-2">
        <span className={`text-sm font-semibold ${textPrimary} leading-tight`}>
          {project.title}
        </span>
        {stalled && (
          <span
            className={`flex-shrink-0 flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full ${
              darkMode
                ? 'bg-yellow-900/50 text-yellow-400'
                : 'bg-yellow-50 text-yellow-600'
            }`}
          >
            <AlertTriangle size={10} />
            Stalled
          </span>
        )}
      </div>

      {/* Task count */}
      <span className={`text-xs ${textSecondary}`}>
        {completedCount}/{totalCount} task{totalCount !== 1 ? 's' : ''}
      </span>

      {/* Progress bar */}
      <ProjectProgress progress={progress} compact />

      {/* Project Focus button */}
      <button
        onClick={() => onFocusClick?.(project)}
        className={`flex items-center justify-center gap-1.5 w-full py-1.5 rounded-lg text-xs font-medium transition-colors ${
          darkMode
            ? 'bg-amber-900/40 hover:bg-amber-900/70 text-amber-400'
            : 'bg-amber-50 hover:bg-amber-100 text-amber-700'
        }`}
      >
        <Zap size={12} />
        Project Focus
      </button>

      {/* Unscheduled tasks for this project */}
      {projectUnscheduled.length > 0 && (
        <div className={`flex flex-col gap-1 pt-2 border-t ${borderClass}`}>
          {projectUnscheduled.slice(0, 3).map(t => (
            <div key={t.id} className={`flex items-center gap-1.5 text-xs ${textSecondary}`}>
              <CheckSquare
                size={11}
                className={t.completed ? 'text-green-500 flex-shrink-0' : 'flex-shrink-0'}
              />
              <span className={`truncate ${t.completed ? 'line-through opacity-50' : ''}`}>
                {t.title}
              </span>
            </div>
          ))}
          {projectUnscheduled.length > 3 && (
            <span className={`text-xs ${textSecondary} pl-4`}>
              +{projectUnscheduled.length - 3} more
            </span>
          )}
        </div>
      )}

      {/* Inline quick-add task */}
      {showQuickAdd ? (
        <form onSubmit={handleQuickAdd} className="flex gap-1">
          <input
            autoFocus
            value={quickAddTitle}
            onChange={e => setQuickAddTitle(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Escape') {
                setShowQuickAdd(false);
                setQuickAddTitle('');
              }
            }}
            placeholder="Task title…"
            className={`flex-1 min-w-0 text-xs px-2 py-1.5 rounded-lg border ${borderClass} focus:outline-none focus:ring-1 focus:ring-blue-500 ${
              darkMode
                ? 'bg-gray-700 text-gray-100 placeholder-gray-500'
                : 'bg-white text-stone-900 placeholder-stone-400'
            }`}
          />
          <button
            type="submit"
            className="flex-shrink-0 p-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors"
          >
            <Plus size={12} />
          </button>
          <button
            type="button"
            onClick={() => { setShowQuickAdd(false); setQuickAddTitle(''); }}
            className={`flex-shrink-0 p-1.5 rounded-lg ${hoverBg} transition-colors`}
          >
            <X size={12} className={textSecondary} />
          </button>
        </form>
      ) : (
        <button
          onClick={() => setShowQuickAdd(true)}
          className={`flex items-center gap-1.5 text-xs ${textSecondary} ${hoverBg} rounded-lg px-2 py-1.5 transition-colors w-full`}
        >
          <Plus size={12} />
          Add task
        </button>
      )}
      </div>
    </div>
  );
});

ProjectCard.displayName = 'ProjectCard';

export default ProjectCard;
