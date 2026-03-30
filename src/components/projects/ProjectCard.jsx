import React, { forwardRef, useState, useRef } from 'react';
import ConfirmDialog from '../ConfirmDialog.jsx';
import {
  AlertTriangle, Calendar, CheckCircle2, CheckSquare, ChevronDown,
  Edit2, GripVertical, Plus, Square, Target, Trash2, X,
} from 'lucide-react';
import { useDayPlannerCtx } from '../../context/DayPlannerContext.jsx';
import { calculateProjectProgress, isProjectStalled } from '../../utils/projectProgress.js';
import { TAILWIND_TO_HEX } from '../../utils/colorUtils.js';
import ProjectProgress from './ProjectProgress.jsx';

const toHex = (bgClass) => TAILWIND_TO_HEX[bgClass] || '#3b82f6';

/** Renders a task title with #tags italicized. */
const TitleWithTags = ({ title, className }) => {
  const parts = title.split(/(#[a-zA-Z]\w*)/g);
  return (
    <span className={className}>
      {parts.map((part, i) =>
        part.startsWith('#')
          ? <em key={i} className="italic opacity-60">{part}</em>
          : part
      )}
    </span>
  );
};

/**
 * ProjectCard — a single project node in the Goals dashboard.
 *
 * Used in both the desktop flowchart and the mobile carousel.
 * `ref` is forwarded so GoalDashboard can measure card positions for SVG lines.
 *
 * Props:
 *   project      — the project object
 *   onFocusClick — called with the project when the "Project Focus" button is clicked
 *   onEditClick  — called to open the project edit form
 */
const ProjectCard = forwardRef(({ project, onFocusClick, onEditClick, compact }, ref) => {
  const {
    tasks, setTasks,
    unscheduledTasks, setUnscheduledTasks,
    goals,
    deleteProject,
    openMobileEditTask,
    getTodayStr,
    darkMode, isMobile,
    borderClass, textPrimary, textSecondary, hoverBg,
  } = useDayPlannerCtx();

  const isScheduled = (t) => !!tasks.find(s => s.id === t.id);

  const toggleTaskComplete = (taskId) => {
    const scheduled = tasks.find(t => t.id === taskId);
    if (scheduled) {
      setTasks(prev => prev.map(t => t.id === taskId ? { ...t, completed: !t.completed } : t));
      return;
    }
    // Unscheduled: toggle + reorder within project
    setUnscheduledTasks(prev => {
      const updated = prev.map(t => t.id === taskId ? { ...t, completed: !t.completed } : t);
      const nowComplete = updated.find(t => t.id === taskId)?.completed;
      const others = updated.filter(t => !(t.projectId === project.id && t.id === taskId));
      const moved = updated.find(t => t.id === taskId);
      if (nowComplete) {
        const lastProjectIdx = others.reduce((max, t, i) => t.projectId === project.id ? i : max, -1);
        others.splice(lastProjectIdx + 1, 0, moved);
      } else {
        const firstProjectIdx = others.findIndex(t => t.projectId === project.id);
        others.splice(firstProjectIdx === -1 ? 0 : firstProjectIdx, 0, moved);
      }
      return others;
    });
  };

  const [quickAddTitle, setQuickAddTitle] = useState('');
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [tasksExpanded, setTasksExpanded] = useState(false);
  const [compactExpanded, setCompactExpanded] = useState(false);
  const [dragIdx, setDragIdx] = useState(null);
  const [dragOverIdx, setDragOverIdx] = useState(null);
  const touchDragRef = useRef({ active: false, fromIdx: null, overIdx: null });

  const handleDelete = () => setShowConfirm(true);

  const parentGoal = project.goalId ? goals.find(g => g.id === project.goalId) : null;
  const goalHex = parentGoal ? toHex(parentGoal.color || 'bg-blue-500') : null;

  const allTasks = [...tasks, ...unscheduledTasks];
  const projectTasks = allTasks.filter(t => t.projectId === project.id && !t.archived);
  const completedCount = projectTasks.filter(t => t.completed).length;
  const totalCount = projectTasks.length;
  const progress = calculateProjectProgress(project.id, allTasks);
  const stalled = !!project.goalId && isProjectStalled(project.id, allTasks, project);

  // All project tasks: unscheduled (in array order) then scheduled (by date), completed last
  const hasTodayTasks = tasks.some(
    t => t.projectId === project.id && t.date === getTodayStr() && !t.completed && !t.isAllDay
  );

  const projectUnscheduled = unscheduledTasks.filter(t => t.projectId === project.id && !t.archived);
  const projectScheduled = tasks.filter(t => t.projectId === project.id && !t.archived)
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const allProjectDisplayTasks = [
    ...projectScheduled.filter(t => !t.completed),
    ...projectUnscheduled.filter(t => !t.completed),
    ...projectScheduled.filter(t => t.completed),
    ...projectUnscheduled.filter(t => t.completed),
  ];
  const VISIBLE_COUNT = 3;
  const hasMore = allProjectDisplayTasks.length > VISIBLE_COUNT;
  const visibleTasks = tasksExpanded ? allProjectDisplayTasks : allProjectDisplayTasks.slice(0, VISIBLE_COUNT);

  // ── Drag-to-reorder ────────────────────────────────────────────────────────
  const handleDragStart = (e, idx) => {
    setDragIdx(idx);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e, idx) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (idx !== dragOverIdx) setDragOverIdx(idx);
  };

  const handleDrop = (e, idx) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === idx) {
      setDragIdx(null);
      setDragOverIdx(null);
      return;
    }
    const incompleteUnscheduled = projectUnscheduled.filter(t => !t.completed);
    const fromId = incompleteUnscheduled[dragIdx].id;
    const toId = incompleteUnscheduled[idx].id;
    const next = [...unscheduledTasks];
    const fromFull = next.findIndex(t => t.id === fromId);
    const toFull = next.findIndex(t => t.id === toId);
    const [moved] = next.splice(fromFull, 1);
    next.splice(toFull, 0, moved);
    setUnscheduledTasks(next);
    setDragIdx(null);
    setDragOverIdx(null);
  };

  const handleDragEnd = () => {
    setDragIdx(null);
    setDragOverIdx(null);
  };

  // ── Touch drag-to-reorder (mobile) ─────────────────────────────────────────
  const handleGripTouchStart = (e, idx) => {
    touchDragRef.current = { active: true, fromIdx: idx, overIdx: null };
    setDragIdx(idx);
  };

  const handleGripTouchMove = (e) => {
    if (!touchDragRef.current.active) return;
    e.preventDefault();
    const touch = e.touches[0];
    const el = document.elementFromPoint(touch.clientX, touch.clientY);
    const taskEl = el?.closest('[data-drag-idx]');
    if (taskEl) {
      const overIdx = parseInt(taskEl.getAttribute('data-drag-idx'), 10);
      if (!isNaN(overIdx)) {
        touchDragRef.current.overIdx = overIdx;
        setDragOverIdx(overIdx);
      }
    }
  };

  const handleGripTouchEnd = () => {
    if (!touchDragRef.current.active) return;
    const { fromIdx, overIdx } = touchDragRef.current;
    touchDragRef.current = { active: false, fromIdx: null, overIdx: null };
    if (fromIdx !== null && overIdx !== null && fromIdx !== overIdx) {
      const incompleteUnscheduled = projectUnscheduled.filter(t => !t.completed);
      const fromId = incompleteUnscheduled[fromIdx]?.id;
      const toId = incompleteUnscheduled[overIdx]?.id;
      if (fromId && toId) {
        const next = [...unscheduledTasks];
        const fromFull = next.findIndex(t => t.id === fromId);
        const toFull = next.findIndex(t => t.id === toId);
        const [moved] = next.splice(fromFull, 1);
        next.splice(toFull, 0, moved);
        setUnscheduledTasks(next);
      }
    }
    setDragIdx(null);
    setDragOverIdx(null);
  };

  // ── Quick-add ──────────────────────────────────────────────────────────────
  const handleQuickAdd = (e) => {
    e.preventDefault();
    const title = quickAddTitle.trim();
    if (!title) return;
    const newTask = {
      id: crypto.randomUUID(),
      title,
      duration: 30,
      color: parentGoal?.color || 'bg-blue-500',
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

  // ── Compact view for completed projects ───────────────────────────────────
  if (compact) {
    const btnBase = `p-1 rounded-lg transition-colors`;
    const editBtn = darkMode ? 'text-gray-600 hover:text-gray-300 hover:bg-gray-700' : 'text-stone-300 hover:text-stone-600 hover:bg-stone-100';
    const delBtn  = darkMode ? 'text-gray-600 hover:text-red-400 hover:bg-red-900/20' : 'text-stone-300 hover:text-red-500 hover:bg-red-50';
    return (
      <>
        <div
          ref={ref}
          className={`flex flex-col rounded-xl border overflow-hidden ${
            darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-stone-200'
          } ${isMobile ? 'w-full' : 'min-w-[180px] max-w-[240px] w-full'}`}
          style={goalHex ? { borderLeft: `3px solid ${goalHex}88` } : {}}
        >
          {/* Row 1: title + edit/delete */}
          <div className="flex items-center gap-1.5 px-3 pt-2.5 pb-1">
            <span className={`text-sm font-medium ${textPrimary} flex-1 min-w-0 truncate`}>
              {project.title}
            </span>
            <button onClick={() => onEditClick?.()} className={`${btnBase} ${editBtn}`} aria-label="Edit project">
              <Edit2 size={12} />
            </button>
            <button onClick={handleDelete} className={`${btnBase} ${delBtn}`} aria-label="Delete project">
              <Trash2 size={12} />
            </button>
          </div>
          {/* Row 2: Done badge + task count + expand chevron */}
          <div className="flex items-center gap-2 px-3 pb-2.5">
            <span className={`flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full ${
              darkMode ? 'bg-green-900/50 text-green-400' : 'bg-green-50 text-green-600'
            }`}>
              <CheckCircle2 size={10} /> Done
            </span>
            {totalCount > 0 && (
              <span className={`text-xs ${textSecondary} opacity-60`}>{completedCount}/{totalCount} tasks</span>
            )}
            {totalCount > 0 && (
              <button
                onClick={() => setCompactExpanded(v => !v)}
                className={`ml-auto ${btnBase} ${editBtn}`}
                aria-label={compactExpanded ? 'Collapse tasks' : 'Expand tasks'}
              >
                <ChevronDown size={13} className={`transition-transform ${compactExpanded ? 'rotate-180' : ''}`} />
              </button>
            )}
          </div>
          {/* Expanded task list */}
          {compactExpanded && totalCount > 0 && (
            <div className={`border-t px-3 py-2 flex flex-col gap-1 ${
              darkMode ? 'border-gray-700' : 'border-stone-100'
            }`}>
              {allProjectDisplayTasks.map(t => (
                <div key={t.id} className="flex items-center gap-1.5">
                  {t.completed
                    ? <CheckCircle2 size={11} className="text-emerald-500 flex-shrink-0" />
                    : <Square size={11} className={`${textSecondary} opacity-50 flex-shrink-0`} />
                  }
                  <span className={`text-xs ${t.completed ? `line-through ${textSecondary} opacity-50` : textPrimary} truncate`}>
                    {t.title}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
        {showConfirm && (
          <ConfirmDialog
            title={`Delete "${project.title}"?`}
            message="Tasks linked to this project will remain but won't be grouped."
            onConfirm={() => { setShowConfirm(false); deleteProject(project.id); }}
            onCancel={() => setShowConfirm(false)}
          />
        )}
      </>
    );
  }

  return (
    <>
    <div
      ref={ref}
      className={`flex flex-col rounded-xl border overflow-hidden ${
        darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-stone-200'
      } ${isMobile ? 'w-full' : 'min-w-[180px] max-w-[240px] w-full'}`}
    >
      {/* Goal color bar */}
      {goalHex && (
        <div className="h-1.5 flex-shrink-0" style={{ background: goalHex + 'bb' }} />
      )}
      {/* Card body */}
      <div className="flex flex-col gap-2 p-3">
        {/* Header: title + badges + edit + delete */}
        <div className="flex items-start justify-between gap-2">
          <span className={`text-sm font-semibold ${textPrimary} leading-tight flex-1 min-w-0`}>
            {project.title}
          </span>
          <div className="flex items-center gap-1 flex-shrink-0">
            {project.status === 'completed' && (
              <span className={`flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full ${
                darkMode ? 'bg-green-900/50 text-green-400' : 'bg-green-50 text-green-600'
              }`}>
                <CheckCircle2 size={10} />
                Done
              </span>
            )}
            {stalled && project.status !== 'completed' && (
              <span className={`flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full ${
                darkMode ? 'bg-yellow-900/50 text-yellow-400' : 'bg-yellow-50 text-yellow-600'
              }`}>
                <AlertTriangle size={10} />
                Stalled
              </span>
            )}
            <button
              onClick={() => onEditClick?.()}
              className={`p-1 rounded-lg transition-colors ${
                darkMode ? 'text-gray-600 hover:text-gray-300 hover:bg-gray-700' : 'text-stone-300 hover:text-stone-600 hover:bg-stone-100'
              }`}
              aria-label="Edit project"
            >
              <Edit2 size={12} />
            </button>
            <button
              onClick={handleDelete}
              className={`p-1 rounded-lg transition-colors ${
                darkMode ? 'text-gray-600 hover:text-red-400 hover:bg-red-900/20' : 'text-stone-300 hover:text-red-500 hover:bg-red-50'
              }`}
              aria-label="Delete project"
            >
              <Trash2 size={12} />
            </button>
          </div>
        </div>

        {/* Task count */}
        <span className={`text-xs ${textSecondary}`}>
          {completedCount}/{totalCount} task{totalCount !== 1 ? 's' : ''}
        </span>

        {/* Progress bar */}
        <ProjectProgress progress={progress} compact />

        {/* Project Focus button — only when there are incomplete tasks scheduled for today */}
        {hasTodayTasks && (
          <button
            onClick={() => onFocusClick?.(project)}
            className={`flex items-center justify-center gap-1.5 w-full py-1.5 rounded-lg text-xs font-medium transition-colors ${
              darkMode
                ? 'bg-purple-900/40 hover:bg-purple-900/70 text-purple-400'
                : 'bg-purple-50 hover:bg-purple-100 text-purple-700'
            }`}
          >
            <Target size={12} />
            Project Focus
          </button>
        )}

        {/* Unscheduled task list */}
        {allProjectDisplayTasks.length > 0 && (
          <div className={`flex flex-col gap-0.5 pt-2 border-t ${borderClass}`}>
            {visibleTasks.map((t) => {
              const scheduled = isScheduled(t);
              const incompleteUnscheduledIdx = !scheduled && !t.completed
                ? projectUnscheduled.filter(u => !u.completed).findIndex(u => u.id === t.id)
                : -1;
              const draggable = incompleteUnscheduledIdx !== -1;
              return (
                <div
                  key={t.id}
                  data-drag-idx={draggable ? incompleteUnscheduledIdx : undefined}
                  draggable={draggable}
                  onDragStart={draggable ? e => handleDragStart(e, incompleteUnscheduledIdx) : undefined}
                  onDragOver={draggable ? e => handleDragOver(e, incompleteUnscheduledIdx) : undefined}
                  onDrop={draggable ? e => handleDrop(e, incompleteUnscheduledIdx) : undefined}
                  onDragEnd={draggable ? handleDragEnd : undefined}
                  className={`flex items-center rounded-lg select-none transition-colors ${hoverBg} ${
                    draggable && dragIdx === incompleteUnscheduledIdx ? 'opacity-40' : ''
                  } ${
                    draggable && dragOverIdx === incompleteUnscheduledIdx && dragIdx !== incompleteUnscheduledIdx
                      ? darkMode ? 'border-t-2 border-blue-400' : 'border-t-2 border-blue-500'
                      : ''
                  }`}
                  style={goalHex ? { borderLeft: `2px solid ${goalHex}99` } : {}}
                >
                  <button
                    onClick={() => toggleTaskComplete(t.id)}
                    className="flex items-center justify-center flex-shrink-0 pl-1.5 pr-2 py-1.5"
                    aria-label={t.completed ? 'Mark incomplete' : 'Mark complete'}
                  >
                    {t.completed
                      ? <CheckSquare size={12} className="text-green-500" />
                      : <Square size={12} className={`${textSecondary} opacity-60`} />
                    }
                  </button>
                  <button
                    onClick={() => openMobileEditTask?.(t, false)}
                    className="flex items-center gap-1.5 flex-1 min-w-0 pr-1.5 py-1.5"
                  >
                    <TitleWithTags
                      title={t.title}
                      className={`text-xs flex-1 min-w-0 truncate text-left ${
                        t.completed ? `line-through opacity-40 ${textSecondary}` : textSecondary
                      }`}
                    />
                    {scheduled && <Calendar size={10} className={`${textSecondary} opacity-40 flex-shrink-0`} />}
                  </button>
                  {draggable && (
                    <div
                      className={`flex-shrink-0 p-1 cursor-grab touch-none ${textSecondary} opacity-30`}
                      onTouchStart={e => handleGripTouchStart(e, incompleteUnscheduledIdx)}
                      onTouchMove={handleGripTouchMove}
                      onTouchEnd={handleGripTouchEnd}
                      aria-label="Drag to reorder"
                    >
                      <GripVertical size={12} />
                    </div>
                  )}
                </div>
              );
            })}

            {/* Expand / collapse toggle */}
            {hasMore && (
              <button
                onClick={() => setTasksExpanded(v => !v)}
                className={`flex items-center gap-1 text-xs ${textSecondary} ${hoverBg} rounded-lg px-1.5 py-1 transition-colors w-full mt-0.5`}
              >
                <ChevronDown
                  size={11}
                  className={`transition-transform duration-150 ${tasksExpanded ? 'rotate-180' : ''}`}
                />
                {tasksExpanded
                  ? 'Show less'
                  : `${allProjectDisplayTasks.length - VISIBLE_COUNT} more`
                }
              </button>
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

    {showConfirm && (
      <ConfirmDialog
        title={`Delete "${project.title}"?`}
        message="Tasks linked to this project will remain but won't be grouped."
        onConfirm={() => { setShowConfirm(false); deleteProject(project.id); }}
        onCancel={() => setShowConfirm(false)}
      />
    )}
    </>
  );
});

ProjectCard.displayName = 'ProjectCard';

export default ProjectCard;
