import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Eye, EyeOff, Plus, X } from 'lucide-react';
import { useDayPlannerCtx } from '../../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../../context/FeaturesContext.jsx';
import { useTranslation } from 'react-i18next';
import { dateToString } from '../../utils/taskUtils.js';
import { getProjectColor, taskColorToHex, hexToRgba } from '../../utils/colorUtils.js';
import { renderFormattedText } from '../../utils/textFormatting.jsx';

// Same iOS detection as ProjectCard: grip-only touch drag on iOS, where
// whole-row HTML5 drag hijacks the gesture (see ProjectCard's IS_IOS note).
const IS_IOS = typeof navigator !== 'undefined' && (
  /iP(hone|ad|od)/.test(navigator.platform || '') ||
  (/Mac/.test(navigator.platform || '') && (navigator.maxTouchPoints || 0) > 1) ||
  (typeof window !== 'undefined' && !!window.DayGlanceIOS)
);
import SchedTaskCard from '../sched/SchedTaskCard.jsx';
import HyperGlanceEditor from './HyperGlanceEditor.jsx';

/**
 * PLANNER — a per-project planning dashboard, themed to the project's color.
 * Bottom sheet on mobile, centered modal on desktop. Hosts the project's
 * notes and hyperGLANCE settings (both moved here from the Edit Project form)
 * plus scheduled/unscheduled task columns with a quick-add.
 */
const ProjectPlanner = ({ project, onClose }) => {
  const {
    isMobile,
    darkMode, cardBg, borderClass, textPrimary, textSecondary, hoverBg,
    tasks, unscheduledTasks, setUnscheduledTasks, reorderUnscheduledTasks,
    openMobileEditTask,
  } = useDayPlannerCtx();
  const { goals, updateProject, isVisibleForUser } = useFeaturesCtx();
  const { t } = useTranslation();

  const parentGoal = project.goalId ? goals.find(g => g.id === project.goalId) : null;
  const projectColor = getProjectColor(project, parentGoal);
  const projectHex = taskColorToHex(projectColor);

  const [notes, setNotes] = useState(project.description || '');
  // Notes behave like the app's other notes panels: Shift+Enter (or clicking
  // away) saves and switches to the formatted preview; clicking the preview
  // returns to editing. Starts in preview when notes already exist.
  const [editingNotes, setEditingNotes] = useState(!(project.description || '').trim());
  const [quickAddTitle, setQuickAddTitle] = useState('');
  const [showCompleted, setShowCompleted] = useState(true);
  const [dragIdx, setDragIdx] = useState(null);
  const [dragOverIdx, setDragOverIdx] = useState(null);
  const touchDragRef = useRef({ active: false, fromIdx: null, overIdx: null });

  const saveNotes = () => {
    if ((project.description || '') !== notes) {
      updateProject(project.id, { description: notes.trim() });
    }
  };

  const closePlanner = () => { saveNotes(); onClose(); };

  // ESC is owned by GoalDashboard's capture-phase priority chain (notes panel
  // → task editor → PLANNER → forms → dashboard) — see its Escape handler.
  // The planner deliberately has no ESC listener of its own; it just needs to
  // flush unsaved notes when the chain unmounts it.
  const notesRef = useRef(notes);
  notesRef.current = notes;
  useEffect(() => () => {
    if ((project.description || '') !== notesRef.current) {
      updateProject(project.id, { description: notesRef.current.trim() });
    }
    // Unmount-only flush; project identity is fixed for a mounted planner.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tapping a task opens the project-flavored editor (isInbox=false, matching
  // ProjectCard's task rows) ON TOP of the planner, which stays open. The
  // planner is rendered at the app top level (App.jsx, beside the task modals)
  // so plain z-index ordering applies: dashboard 60 < planner 70 < editor 80.
  // Do NOT portal it to document.body or nest it inside dashboard DOM — both
  // put it in a different stacking context and break this ordering.
  const editTask = (task) => {
    saveNotes();
    openMobileEditTask(task, false);
  };

  // Project tasks, split into the two columns. Completed tasks sink to the
  // bottom of their column; scheduled tasks group by day.
  const { scheduledDays, unscheduled } = useMemo(() => {
    const mine = (list) => list.filter(task =>
      task.projectId === project.id && !task.archived && isVisibleForUser(task));
    const scheduled = mine(tasks).sort((a, b) =>
      (a.completed ? 1 : 0) - (b.completed ? 1 : 0) ||
      (a.date || '').localeCompare(b.date || '') ||
      (a.startTime || '').localeCompare(b.startTime || ''));
    const byDay = [];
    for (const task of scheduled.filter(task => !task.completed)) {
      const last = byDay[byDay.length - 1];
      if (last && last.dateStr === task.date) last.tasks.push(task);
      else byDay.push({ dateStr: task.date, tasks: [task] });
    }
    const completedScheduled = scheduled.filter(task => task.completed);
    if (showCompleted && completedScheduled.length) byDay.push({ dateStr: null, tasks: completedScheduled });
    let inbox = mine(unscheduledTasks).sort((a, b) => (a.completed ? 1 : 0) - (b.completed ? 1 : 0));
    if (!showCompleted) inbox = inbox.filter(task => !task.completed);
    return { scheduledDays: byDay, unscheduled: inbox };
  }, [tasks, unscheduledTasks, project.id, isVisibleForUser, showCompleted]);

  const hasAnyCompleted = useMemo(() =>
    [...tasks, ...unscheduledTasks].some(task => task.projectId === project.id && !task.archived && task.completed),
    [tasks, unscheduledTasks, project.id]);

  const todayStr = dateToString(new Date());
  const dayHeading = (dateStr) => {
    if (!dateStr) return 'Completed';
    const d = new Date(dateStr + 'T00:00:00');
    const base = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    return dateStr === todayStr ? `${t('common.today', 'Today')} · ${base}` : base;
  };

  // ── Drag-to-reorder (unscheduled column) — mirrors ProjectCard ────────────
  const incompleteUnscheduled = unscheduled.filter(task => !task.completed);

  const applyReorder = (fromIdx, toIdx) => {
    const fromId = incompleteUnscheduled[fromIdx]?.id;
    const toId = incompleteUnscheduled[toIdx]?.id;
    if (!fromId || !toId) return;
    const next = [...unscheduledTasks];
    const fromFull = next.findIndex(task => task.id === fromId);
    const toFull = next.findIndex(task => task.id === toId);
    const [moved] = next.splice(fromFull, 1);
    next.splice(toFull, 0, moved);
    reorderUnscheduledTasks(next);
  };

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
    if (dragIdx !== null && dragIdx !== idx) applyReorder(dragIdx, idx);
    setDragIdx(null);
    setDragOverIdx(null);
  };

  const handleDragEnd = () => {
    setDragIdx(null);
    setDragOverIdx(null);
  };

  // Grip-only touch drag for iOS — document-level non-passive listeners, and
  // dragstart cancelled for the gesture so native HTML5 drag can't hijack it
  // (ProjectCard's proven pattern).
  const handleGripTouchStart = (e, idx) => {
    touchDragRef.current = { active: true, fromIdx: idx, overIdx: null };
    setDragIdx(idx);

    const onMove = (moveEvent) => {
      if (!touchDragRef.current.active) return;
      moveEvent.preventDefault(); // honoured: this listener is non-passive
      const touch = moveEvent.touches[0];
      if (!touch) return;
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
    const preventDrag = (de) => de.preventDefault();
    const onEnd = () => {
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
      document.removeEventListener('touchcancel', onEnd);
      document.removeEventListener('dragstart', preventDrag);
      const { active, fromIdx, overIdx } = touchDragRef.current;
      touchDragRef.current = { active: false, fromIdx: null, overIdx: null };
      if (active && fromIdx !== null && overIdx !== null && fromIdx !== overIdx) {
        applyReorder(fromIdx, overIdx);
      }
      setDragIdx(null);
      setDragOverIdx(null);
    };
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd);
    document.addEventListener('touchcancel', onEnd);
    document.addEventListener('dragstart', preventDrag);
  };

  // Quick-add an unscheduled project task — same inheritance as the card
  // quick-add: effective project color + the project's assigned users.
  const handleQuickAdd = (e) => {
    e.preventDefault();
    const title = quickAddTitle.trim();
    if (!title) return;
    setUnscheduledTasks(prev => [...prev, {
      id: crypto.randomUUID(),
      title,
      duration: 30,
      color: projectColor,
      completed: false,
      isAllDay: false,
      notes: '',
      subtasks: [],
      priority: 0,
      projectId: project.id,
      ...(project.assignedUserSyncIds?.length ? { assignedUserSyncIds: project.assignedUserSyncIds } : {}),
      lastModified: new Date().toISOString(),
    }]);
    setQuickAddTitle('');
  };

  return (
    <div
      className={`fixed inset-0 z-[70] flex ${isMobile ? 'flex-col justify-end' : 'items-center justify-center p-6'}`}
      onClick={closePlanner}
    >
      <div className="absolute inset-0 bg-black/45" />
      <div
        onClick={e => e.stopPropagation()}
        className={`relative ${cardBg} shadow-2xl flex flex-col overflow-hidden ${
          isMobile
            ? 'rounded-t-2xl max-h-[92vh] w-full'
            : 'rounded-2xl w-full max-w-3xl max-h-[85vh]'
        }`}
      >
        {/* Project color bar + header */}
        <div className="h-1.5 flex-shrink-0" style={{ background: projectHex }} />
        <div
          className={`flex items-center justify-between px-4 py-3 border-b ${borderClass} flex-shrink-0`}
          style={{ background: hexToRgba(projectHex, darkMode ? 0.12 : 0.07) }}
        >
          <div className="flex flex-col min-w-0">
            <span className={`text-base font-semibold ${textPrimary} truncate`}>{project.title}</span>
            <span className={`text-xs ${textSecondary}`}>
              {parentGoal ? parentGoal.title : 'Standalone project'} · Planner
            </span>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {hasAnyCompleted && (
              <button
                onClick={() => setShowCompleted(v => !v)}
                className={`flex items-center gap-1.5 text-xs font-medium px-2 py-1.5 rounded-lg ${hoverBg} ${textSecondary} transition-colors`}
                title={showCompleted ? 'Hide completed tasks' : 'Show completed tasks'}
              >
                {showCompleted ? <Eye size={13} /> : <EyeOff size={13} />}
                Completed
              </button>
            )}
            <button
              onClick={closePlanner}
              className={`p-1.5 rounded-lg ${hoverBg}`}
              aria-label="Close planner"
            >
              <X size={16} className={textSecondary} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-y-auto p-4 flex flex-col gap-4">
          {/* Notes — same interaction model as task notes panels */}
          <div className="flex flex-col gap-1">
            <label className={`text-xs font-medium ${textSecondary}`}>Notes</label>
            {editingNotes ? (
              <textarea
                autoFocus={!!(project.description || '').trim()}
                value={notes}
                onChange={e => setNotes(e.target.value)}
                onBlur={() => { saveNotes(); if (notes.trim()) setEditingNotes(false); }}
                onKeyDown={e => {
                  if (e.key === 'Enter' && e.shiftKey) {
                    e.preventDefault();
                    saveNotes();
                    if (notes.trim()) setEditingNotes(false);
                  }
                }}
                placeholder="Add notes... (**bold**, *italic*, __underline__, URLs) - Shift+Enter to save"
                rows={3}
                className={`px-3 py-2 text-sm rounded-lg border ${borderClass} focus:outline-none focus:ring-2 resize-none ${
                  darkMode ? 'bg-gray-700 text-gray-100 placeholder-gray-500' : 'bg-white text-stone-900 placeholder-stone-400'
                }`}
                style={{ '--tw-ring-color': projectHex }}
              />
            ) : (
              <div
                onClick={() => setEditingNotes(true)}
                className={`px-3 py-2 text-sm rounded-lg border ${borderClass} cursor-text whitespace-pre-wrap ${textPrimary} ${hoverBg}`}
                title="Click to edit notes"
              >
                {renderFormattedText(notes)}
              </div>
            )}
          </div>

          {/* Task columns */}
          <div className={`grid gap-4 ${isMobile ? 'grid-cols-1' : 'grid-cols-2'}`}>
            {/* Scheduled */}
            <div className="flex flex-col gap-2 min-w-0">
              <span className={`text-xs font-semibold uppercase tracking-wide ${textSecondary}`}>
                Scheduled
              </span>
              {scheduledDays.length > 0 ? scheduledDays.map(group => (
                <div key={group.dateStr ?? 'completed'} className="flex flex-col gap-1">
                  <span className={`text-[11px] font-semibold ${group.dateStr === todayStr ? 'text-blue-500' : textSecondary} ${group.dateStr ? '' : 'opacity-60'}`}>
                    {dayHeading(group.dateStr)}
                  </span>
                  {group.tasks.map(task => <SchedTaskCard key={task.id} task={task} onEdit={editTask} />)}
                </div>
              )) : (
                <p className={`text-xs ${textSecondary} opacity-70 py-2`}>Nothing scheduled yet.</p>
              )}
            </div>

            {/* Unscheduled */}
            <div className="flex flex-col gap-2 min-w-0">
              <span className={`text-xs font-semibold uppercase tracking-wide ${textSecondary}`}>
                Unscheduled
              </span>
              {unscheduled.length > 0 ? (
                unscheduled.map(task => {
                  const idx = incompleteUnscheduled.findIndex(u => u.id === task.id);
                  const draggable = idx !== -1 && incompleteUnscheduled.length > 1;
                  return (
                    <SchedTaskCard
                      key={task.id}
                      task={task}
                      isInbox
                      onEdit={editTask}
                      dnd={draggable ? {
                        idx,
                        rowDraggable: !IS_IOS,
                        onDragStart: handleDragStart,
                        onDragEnd: handleDragEnd,
                        onDragOver: handleDragOver,
                        onDrop: handleDrop,
                        isSource: dragIdx === idx,
                        isTarget: dragOverIdx === idx && dragIdx !== idx,
                        onGripTouchStart: IS_IOS ? handleGripTouchStart : null,
                      } : null}
                    />
                  );
                })
              ) : (
                <p className={`text-xs ${textSecondary} opacity-70 py-2`}>No unscheduled tasks.</p>
              )}
              <form onSubmit={handleQuickAdd} className="flex gap-2">
                <input
                  value={quickAddTitle}
                  onChange={e => setQuickAddTitle(e.target.value)}
                  placeholder="Add a task…"
                  className={`flex-1 min-w-0 px-2.5 py-1.5 text-sm rounded-lg border ${borderClass} focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                    darkMode ? 'bg-gray-700 text-gray-100 placeholder-gray-500' : 'bg-white text-stone-900 placeholder-stone-400'
                  }`}
                />
                <button
                  type="submit"
                  disabled={!quickAddTitle.trim()}
                  className="px-2.5 py-1.5 rounded-lg text-white disabled:opacity-40 transition-opacity"
                  style={{ background: projectHex }}
                  aria-label="Add task to project"
                >
                  <Plus size={14} />
                </button>
              </form>
            </div>
          </div>

          {/* hyperGLANCE settings (moved here from the Edit Project form) */}
          <HyperGlanceEditor
            value={project.hyperglance}
            onChange={hg => updateProject(project.id, { hyperglance: hg })}
            wide={!isMobile}
          />
        </div>
      </div>
    </div>
  );
};

export default ProjectPlanner;
