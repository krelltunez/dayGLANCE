import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  ChevronDown,
  CircleCheckBig,
  ChevronLeft,
  ChevronRight,
  Edit2,
  Flag,
  FolderOpen,
  GitBranch,
  Layers,
  RotateCcw,
  X,
} from 'lucide-react';
import { useDayPlannerCtx } from '../../context/DayPlannerContext.jsx';
import { TASK_COLORS, TAILWIND_TO_HEX } from '../../utils/colorUtils.js';
import { calculateGoalProgress } from '../../utils/goalProgress.js';
import { isProjectStalled } from '../../utils/projectProgress.js';
import GoalCard from './GoalCard.jsx';
import GoalProgress from './GoalProgress.jsx';
import ProjectCard from '../projects/ProjectCard.jsx';
import ConfirmDialog from '../ConfirmDialog.jsx';

// ─── Tiny helpers ─────────────────────────────────────────────────────────────

/** Returns the hex value for a Tailwind bg-* class, falling back to blue. */
const toHex = (bgClass) => TAILWIND_TO_HEX[bgClass] || '#3b82f6';

/** Returns a light background for a Tailwind bg-* class. */
const toLightBg = (bgClass, dark) => {
  const hex = toHex(bgClass);
  return dark
    ? `${hex}22` // ~13% opacity
    : `${hex}18`; // ~9% opacity
};

// ─── Goal sorting helpers ─────────────────────────────────────────────────────

/**
 * 0 = completed  (left side of carousel)
 * 1 = overdue    (left side)
 * 2 = active / upcoming / no date  (right side, default focus)
 */
function categorizeGoal(goal) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (goal.status === 'completed') return 0;
  if (goal.targetDate && new Date(goal.targetDate + 'T00:00:00') < today) return 1;
  return 2;
}

function sortGoalsForCarousel(goals) {
  return [...goals].sort((a, b) => {
    const ca = categorizeGoal(a);
    const cb = categorizeGoal(b);
    if (ca !== cb) return ca - cb;
    if (!a.targetDate && !b.targetDate) return 0;
    if (!a.targetDate) return 1;
    if (!b.targetDate) return -1;
    return (
      new Date(a.targetDate + 'T00:00:00') - new Date(b.targetDate + 'T00:00:00')
    );
  });
}

function findDefaultActiveIdx(sortedGoals) {
  const idx = sortedGoals.findIndex(g => categorizeGoal(g) === 2);
  return idx === -1 ? 0 : idx;
}

// ─── Goal form (create / edit) ────────────────────────────────────────────────

const GoalForm = ({ initial, childProjects = [], onSave, onCancel, onDelete, mobile }) => {
  const { darkMode, cardBg, borderClass, textPrimary, textSecondary, hoverBg } =
    useDayPlannerCtx();

  const [title, setTitle] = useState(initial?.title || '');
  const [description, setDescription] = useState(initial?.description || '');
  const [targetDate, setTargetDate] = useState(initial?.targetDate || '');
  const [color, setColor] = useState(initial?.color || TASK_COLORS[0].class);
  const [status, setStatus] = useState(initial?.status || 'active');

  // "Completed" only available when all child projects are completed (or none exist)
  const activeChildProjects = childProjects.filter(p => p.status !== 'archived');
  const canComplete = activeChildProjects.length === 0 || activeChildProjects.every(p => p.status === 'completed');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!title.trim()) return;
    onSave({ title: title.trim(), description: description.trim(), targetDate: targetDate || undefined, color, status });
  };

  return (
    <form
      onSubmit={handleSubmit}
      className={`${mobile ? '' : `${cardBg} rounded-2xl shadow-2xl max-w-sm`} p-5 w-full flex flex-col gap-4`}
      onClick={e => e.stopPropagation()}
    >
      <h3 className={`text-base font-semibold ${textPrimary}`}>
        {initial ? 'Edit Goal' : 'New Goal'}
      </h3>

      {/* Title */}
      <div className="flex flex-col gap-1">
        <label className={`text-xs font-medium ${textSecondary}`}>Title *</label>
        <input
          autoFocus
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="e.g. Launch v2.0"
          className={`px-3 py-2 text-sm rounded-lg border ${borderClass} focus:outline-none focus:ring-2 focus:ring-blue-500 ${
            darkMode ? 'bg-gray-700 text-gray-100 placeholder-gray-500' : 'bg-white text-stone-900 placeholder-stone-400'
          }`}
        />
      </div>

      {/* Description */}
      <div className="flex flex-col gap-1">
        <label className={`text-xs font-medium ${textSecondary}`}>Description</label>
        <textarea
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="Optional description…"
          rows={2}
          className={`px-3 py-2 text-sm rounded-lg border ${borderClass} focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none ${
            darkMode ? 'bg-gray-700 text-gray-100 placeholder-gray-500' : 'bg-white text-stone-900 placeholder-stone-400'
          }`}
        />
      </div>

      {/* Target date */}
      <div className="flex flex-col gap-1">
        <label className={`text-xs font-medium ${textSecondary}`}>Target date</label>
        <input
          type="date"
          value={targetDate}
          onChange={e => setTargetDate(e.target.value)}
          className={`px-3 py-2 text-sm rounded-lg border ${borderClass} focus:outline-none focus:ring-2 focus:ring-blue-500 ${
            darkMode ? 'bg-gray-700 text-gray-100' : 'bg-white text-stone-900'
          }`}
        />
      </div>

      {/* Color */}
      <div className="flex flex-col gap-1.5">
        <label className={`text-xs font-medium ${textSecondary}`}>Color</label>
        <div className="grid grid-cols-9 gap-2 w-full">
          {TASK_COLORS.map(c => (
            <button
              key={c.class}
              type="button"
              onClick={() => setColor(c.class)}
              className={`w-7 h-7 rounded-full ${c.class} transition-transform ${
                color === c.class ? 'ring-2 ring-offset-2 ring-blue-500 scale-110' : 'hover:scale-110'
              }`}
              aria-label={c.name}
            />
          ))}
        </div>
      </div>

      {/* Preview */}
      <div
        className="h-1.5 rounded-full w-full"
        style={{ background: toHex(color) }}
      />

      {/* Status — edit only */}
      {initial && (
        <div className="flex flex-col gap-1.5">
          <label className={`text-xs font-medium ${textSecondary}`}>Status</label>
          <div className={`flex rounded-lg border ${borderClass} overflow-hidden`}>
            {[
              { value: 'active', label: 'Active' },
              { value: 'completed', label: 'Completed', disabled: !canComplete },
              { value: 'archived', label: 'Archived' },
            ].map(opt => (
              <button
                key={opt.value}
                type="button"
                disabled={opt.disabled}
                onClick={() => !opt.disabled && setStatus(opt.value)}
                className={`flex-1 py-2 text-sm font-medium transition-colors border-r last:border-r-0 ${borderClass} ${
                  status === opt.value
                    ? 'bg-blue-600 text-white'
                    : opt.disabled
                    ? `${textSecondary} opacity-30 cursor-not-allowed`
                    : `${textSecondary} ${hoverBg}`
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {!canComplete && (
            <p className={`text-xs ${textSecondary} opacity-60`}>
              Complete all projects first to mark this goal as done.
            </p>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 items-center">
        {initial && onDelete && (
          <button
            type="button"
            onClick={onDelete}
            className={`text-sm px-3 py-1.5 rounded-lg transition-colors ${
              darkMode
                ? 'text-red-400 hover:bg-red-900/20'
                : 'text-red-500 hover:bg-red-50'
            }`}
          >
            Delete Goal
          </button>
        )}
        <div className="flex gap-2 ml-auto">
          <button
            type="button"
            onClick={onCancel}
            className={`px-3 py-1.5 text-sm rounded-lg ${hoverBg} ${textSecondary} transition-colors`}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!title.trim()}
            className="px-4 py-1.5 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {initial ? 'Save' : 'Create Goal'}
          </button>
        </div>
      </div>
    </form>
  );
};

// ─── Project form (create / edit) ─────────────────────────────────────────────

const ProjectForm = ({ initial, goals, onSave, onCancel, mobile }) => {
  const { darkMode, cardBg, borderClass, textPrimary, textSecondary, hoverBg, tasks, unscheduledTasks } =
    useDayPlannerCtx();

  const [title, setTitle] = useState(initial?.title || '');
  const [description, setDescription] = useState(initial?.description || '');
  const [goalId, setGoalId] = useState(initial?.goalId || '');
  const [status, setStatus] = useState(initial?.status || 'active');

  // "Completed" only available when all project tasks are completed (or none exist)
  const projectTasks = initial
    ? [...tasks, ...unscheduledTasks].filter(t => t.projectId === initial.id && !t.archived)
    : [];
  const canComplete = projectTasks.length === 0 || projectTasks.every(t => t.completed);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!title.trim()) return;
    onSave({ title: title.trim(), description: description.trim(), goalId: goalId || undefined, status });
  };

  const activeGoals = goals.filter(g => g.status !== 'archived');

  return (
    <form
      onSubmit={handleSubmit}
      className={`${mobile ? '' : `${cardBg} rounded-2xl shadow-2xl max-w-sm`} p-5 w-full flex flex-col gap-4`}
      onClick={e => e.stopPropagation()}
    >
      <h3 className={`text-base font-semibold ${textPrimary}`}>
        {initial ? 'Edit Project' : 'New Project'}
      </h3>

      {/* Title */}
      <div className="flex flex-col gap-1">
        <label className={`text-xs font-medium ${textSecondary}`}>Title *</label>
        <input
          autoFocus
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="e.g. Cloud Sync"
          className={`px-3 py-2 text-sm rounded-lg border ${borderClass} focus:outline-none focus:ring-2 focus:ring-blue-500 ${
            darkMode ? 'bg-gray-700 text-gray-100 placeholder-gray-500' : 'bg-white text-stone-900 placeholder-stone-400'
          }`}
        />
      </div>

      {/* Description */}
      <div className="flex flex-col gap-1">
        <label className={`text-xs font-medium ${textSecondary}`}>Description</label>
        <textarea
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="Optional description…"
          rows={2}
          className={`px-3 py-2 text-sm rounded-lg border ${borderClass} focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none ${
            darkMode ? 'bg-gray-700 text-gray-100 placeholder-gray-500' : 'bg-white text-stone-900 placeholder-stone-400'
          }`}
        />
      </div>

      {/* Goal */}
      <div className="flex flex-col gap-1">
        <label className={`text-xs font-medium ${textSecondary}`}>Goal (optional)</label>
        <select
          value={goalId}
          onChange={e => setGoalId(e.target.value)}
          className={`px-3 py-2 text-sm rounded-lg border ${borderClass} focus:outline-none focus:ring-2 focus:ring-blue-500 ${
            darkMode ? 'bg-gray-700 text-gray-100' : 'bg-white text-stone-900'
          }`}
        >
          <option value="">— No goal (standalone) —</option>
          {activeGoals.map(g => (
            <option key={g.id} value={g.id}>{g.title}</option>
          ))}
        </select>
      </div>

      {/* Status — edit only */}
      {initial && (
        <div className="flex flex-col gap-1.5">
          <label className={`text-xs font-medium ${textSecondary}`}>Status</label>
          <div className={`flex rounded-lg border ${borderClass} overflow-hidden`}>
            {[
              { value: 'active', label: 'Active' },
              { value: 'completed', label: 'Completed', disabled: !canComplete },
              { value: 'archived', label: 'Archived' },
            ].map(opt => (
              <button
                key={opt.value}
                type="button"
                disabled={opt.disabled}
                onClick={() => !opt.disabled && setStatus(opt.value)}
                className={`flex-1 py-2 text-sm font-medium transition-colors border-r last:border-r-0 ${borderClass} ${
                  status === opt.value
                    ? 'bg-blue-600 text-white'
                    : opt.disabled
                    ? `${textSecondary} opacity-30 cursor-not-allowed`
                    : `${textSecondary} ${hoverBg}`
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {!canComplete && (
            <p className={`text-xs ${textSecondary} opacity-60`}>
              Complete all tasks first to mark this project as done.
            </p>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 justify-end">
        <button
          type="button"
          onClick={onCancel}
          className={`px-3 py-1.5 text-sm rounded-lg ${hoverBg} ${textSecondary} transition-colors`}
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!title.trim()}
          className="px-4 py-1.5 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {initial ? 'Save' : 'Create Project'}
        </button>
      </div>
    </form>
  );
};

// ─── Overlay backdrop for inline forms ────────────────────────────────────────

const FormOverlay = ({ children, onClose, mobile, cardBg }) => {
  if (mobile) {
    return (
      <div
        className="fixed inset-0 z-[60] flex flex-col justify-end"
        onClick={onClose}
      >
        <div className="bg-black/50 absolute inset-0" />
        <div
          className={`relative ${cardBg} rounded-t-2xl shadow-xl max-h-[85vh] overflow-y-auto`}
          style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}
          onClick={e => e.stopPropagation()}
        >
          {children}
        </div>
      </div>
    );
  }
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      {children}
    </div>
  );
};

// ─── Goal mini card (carousel side slots) ────────────────────────────────────

const GoalMiniCard = ({ goal, onClick }) => {
  const { darkMode, textPrimary, textSecondary, tasks, unscheduledTasks, projects, updateGoal } = useDayPlannerCtx();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const hex = toHex(goal.color || 'bg-blue-500');
  const isCompleted = goal.status === 'completed';

  let daysLabel = null;
  let labelColor = textSecondary;
  let isOverdue = false;
  if (goal.targetDate) {
    const diff = Math.ceil(
      (new Date(goal.targetDate + 'T00:00:00') - today) / 86400000
    );
    daysLabel =
      diff === 0 ? 'Due today' : diff < 0 ? `${Math.abs(diff)}d overdue` : `${diff}d left`;
    if (diff <= 7) labelColor = 'text-amber-500';
    if (diff < 0) isOverdue = true;
  }

  const allTasks = [...tasks, ...unscheduledTasks];
  const childProjects = projects.filter(p => p.goalId === goal.id && p.status !== 'archived');
  const hasStalledProject = childProjects.some(p => isProjectStalled(p.id, allTasks, p));
  const showCaution = isOverdue || hasStalledProject;
  const goalProgress = calculateGoalProgress(goal.id, childProjects, allTasks);
  const allProjectsDone = childProjects.length > 0 && goalProgress >= 1;

  return (
    <div
      onClick={onClick}
      style={{ opacity: isCompleted ? 0.45 : 1, borderLeft: `3px solid ${hex}`, borderRight: `3px solid ${hex}` }}
      className={`w-52 cursor-pointer rounded-xl px-3 py-3 transition-all select-none ${
        darkMode ? 'bg-gray-800 hover:bg-gray-700' : 'bg-stone-50 hover:bg-stone-100'
      }`}
    >
      <p className={`text-sm font-semibold ${textPrimary} leading-tight truncate`}>
        {goal.title}
      </p>
      {(!isCompleted && (daysLabel || showCaution || allProjectsDone)) ? (
        <div className="flex items-center gap-1 mt-0.5">
          {daysLabel && <span className={`text-xs ${labelColor}`}>{daysLabel}</span>}
          {showCaution && !allProjectsDone && (
            <AlertTriangle size={11} className="text-amber-500 ml-auto flex-shrink-0" />
          )}
          {allProjectsDone && (
            <button
              onClick={e => { e.stopPropagation(); updateGoal(goal.id, { status: 'completed' }); }}
              className="ml-auto flex-shrink-0 text-emerald-500 hover:text-emerald-400 transition-colors"
              aria-label="Mark goal complete"
            >
              <CircleCheckBig size={12} />
            </button>
          )}
        </div>
      ) : isCompleted ? (
        <p className="text-xs mt-0.5 text-emerald-500">Completed</p>
      ) : null}
      <div className={`mt-2 w-full h-1 rounded-full ${darkMode ? 'bg-gray-700' : 'bg-stone-200'}`}>
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${Math.round(goalProgress * 100)}%`, background: hex }}
        />
      </div>
    </div>
  );
};

// ─── Desktop carousel layout ──────────────────────────────────────────────────

const DesktopDashboard = ({
  activeGoals,
  activeProjects,
  onEditGoal,
  onEditProject,
  onFocusClick,
  onNewProject,
  goalCardRefs,
  projectCardRefs,
}) => {
  const { darkMode, textPrimary, textSecondary, borderClass, hoverBg } =
    useDayPlannerCtx();

  const containerRef = useRef(null);
  const [svgLines, setSvgLines] = useState([]);
  const [svgSize, setSvgSize] = useState({ w: 0, h: 0 });

  // Sort goals: completed/overdue → left, active/upcoming → right (default focus)
  const sortedGoals = useMemo(() => sortGoalsForCarousel(activeGoals), [activeGoals]);
  const [activeGoalIdx, setActiveGoalIdx] = useState(
    () => findDefaultActiveIdx(sortedGoals)
  );

  // Clamp index whenever the goals list changes length
  const safeIdx = sortedGoals.length > 0
    ? Math.min(activeGoalIdx, sortedGoals.length - 1)
    : 0;

  const activeGoal = sortedGoals[safeIdx] || null;
  const prevGoal = safeIdx > 0 ? sortedGoals[safeIdx - 1] : null;
  const nextGoal = safeIdx < sortedGoals.length - 1 ? sortedGoals[safeIdx + 1] : null;

  const goalProjects = useMemo(
    () => (activeGoal ? activeProjects.filter(p => p.goalId === activeGoal.id) : []),
    [activeGoal, activeProjects]
  );

  const standaloneProjects = useMemo(
    () => activeProjects.filter(p => !p.goalId),
    [activeProjects]
  );

  // ── SVG connector lines ──────────────────────────────────────────────────────
  const recalc = useCallback(() => {
    if (!containerRef.current) return;
    const base = containerRef.current.getBoundingClientRect();
    const lines = [];

    if (activeGoal) {
      const goalEl = goalCardRefs.current[activeGoal.id];
      if (goalEl) {
        const gr = goalEl.getBoundingClientRect();
        const gx = gr.left - base.left + gr.width / 2;
        const gy = gr.top - base.top + gr.height;
        const goalHex = toHex(activeGoal.color || 'bg-blue-500');

        for (const proj of goalProjects) {
          const projEl = projectCardRefs.current[proj.id];
          if (!projEl) continue;
          const pr = projEl.getBoundingClientRect();
          const px = pr.left - base.left + pr.width / 2;
          const py = pr.top - base.top;
          const midY = gy + (py - gy) * 0.5;
          lines.push({
            d: `M ${gx} ${gy} C ${gx} ${midY} ${px} ${midY} ${px} ${py}`,
            color: goalHex,
          });
        }
      }
    }

    setSvgLines(lines);
    setSvgSize({ w: base.width, h: base.height });
  }, [activeGoal, goalProjects, goalCardRefs, projectCardRefs]);

  useLayoutEffect(() => {
    recalc();
  }, [recalc]);

  useEffect(() => {
    const ro = new ResizeObserver(recalc);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [recalc]);

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div ref={containerRef} className="relative min-h-[200px]">
      {/* SVG overlay — behind cards (z-0), non-interactive */}
      <svg
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: svgSize.w,
          height: svgSize.h,
          pointerEvents: 'none',
          zIndex: 0,
          overflow: 'visible',
        }}
      >
        {svgLines.map((line, i) => (
          <path
            key={i}
            d={line.d}
            stroke={line.color}
            strokeWidth={2}
            strokeOpacity={0.55}
            fill="none"
            strokeDasharray="6 4"
          />
        ))}
      </svg>

      {/* Goal carousel */}
      {sortedGoals.length > 0 && (
        <>
          {/* Dot indicators */}
          {sortedGoals.length > 1 && (
            <div className="relative z-10 flex items-center justify-center gap-1.5 mb-4">
              {sortedGoals.map((g, i) => (
                <button
                  key={g.id}
                  onClick={() => setActiveGoalIdx(i)}
                  className={`rounded-full transition-all ${
                    i === safeIdx
                      ? 'w-4 h-2.5 bg-blue-500'
                      : `w-2.5 h-2.5 ${darkMode ? 'bg-gray-600' : 'bg-stone-300'}`
                  }`}
                />
              ))}
            </div>
          )}

          {/* Row: [←] [prev mini] [main GoalCard] [next mini] [→] */}
          <div className="relative z-10 flex items-center justify-center gap-3 mb-10">
            {/* Prev arrow */}
            {sortedGoals.length > 1 && (
              <button
                onClick={() => setActiveGoalIdx(i => Math.max(0, i - 1))}
                disabled={safeIdx === 0}
                className={`flex-shrink-0 p-1.5 rounded-full ${hoverBg} disabled:opacity-20 transition-colors`}
              >
                <ChevronLeft size={20} className={textSecondary} />
              </button>
            )}

            {/* Prev mini card slot */}
            {sortedGoals.length > 1 && (
              <div className="flex-shrink-0">
                {prevGoal ? (
                  <GoalMiniCard
                    goal={prevGoal}
                    onClick={() => setActiveGoalIdx(safeIdx - 1)}
                  />
                ) : (
                  <div className="w-52" />
                )}
              </div>
            )}

            {/* Main goal card */}
            <div className="relative z-10 w-72 flex-shrink-0">
              <GoalCard
                ref={el => { goalCardRefs.current[activeGoal.id] = el; }}
                goal={activeGoal}
                projects={goalProjects}
                onEdit={() => onEditGoal(activeGoal)}
                onNewProject={() => onNewProject(activeGoal.id)}
              />
            </div>

            {/* Next mini card slot */}
            {sortedGoals.length > 1 && (
              <div className="flex-shrink-0">
                {nextGoal ? (
                  <GoalMiniCard
                    goal={nextGoal}
                    onClick={() => setActiveGoalIdx(safeIdx + 1)}
                  />
                ) : (
                  <div className="w-52" />
                )}
              </div>
            )}

            {/* Next arrow */}
            {sortedGoals.length > 1 && (
              <button
                onClick={() => setActiveGoalIdx(i => Math.min(sortedGoals.length - 1, i + 1))}
                disabled={safeIdx === sortedGoals.length - 1}
                className={`flex-shrink-0 p-1.5 rounded-full ${hoverBg} disabled:opacity-20 transition-colors`}
              >
                <ChevronRight size={20} className={textSecondary} />
              </button>
            )}
          </div>

          {/* Projects for the active goal */}
          {goalProjects.length > 0 && (() => {
            const activeProjs = goalProjects.filter(p => p.status !== 'completed');
            const doneProjs = goalProjects.filter(p => p.status === 'completed');
            return (
              <div className="relative z-10 mb-8">
                {activeProjs.length > 0 && (
                  <div className="flex flex-wrap gap-4 mb-3 justify-center">
                    {activeProjs.map(proj => (
                      <ProjectCard
                        key={proj.id}
                        ref={el => { projectCardRefs.current[proj.id] = el; }}
                        project={proj}
                        onFocusClick={onFocusClick}
                        onEditClick={() => onEditProject?.(proj)}
                      />
                    ))}
                  </div>
                )}
                {doneProjs.length > 0 && (
                  <div className="flex flex-wrap gap-4 justify-center">
                    {doneProjs.map(proj => (
                      <ProjectCard
                        key={proj.id}
                        ref={el => { projectCardRefs.current[proj.id] = el; }}
                        project={proj}
                        onFocusClick={onFocusClick}
                        onEditClick={() => onEditProject?.(proj)}
                        compact
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })()}
        </>
      )}

      {/* Standalone projects */}
      {standaloneProjects.length > 0 && (
        <div className={`relative z-10 pt-6 border-t ${borderClass}`}>
          <div className="flex items-center justify-between mb-4">
            <h3 className={`text-sm font-semibold ${textSecondary} uppercase tracking-wider`}>
              Standalone Projects
            </h3>
            <button
              onClick={() => onNewProject(null)}
              className={`flex items-center gap-1.5 text-xs ${textSecondary} ${hoverBg} rounded-lg px-2 py-1 transition-colors`}
            >
              <Layers size={12} /> Add Standalone Project
            </button>
          </div>
          {(() => {
            const activeProjs = standaloneProjects.filter(p => p.status !== 'completed');
            const doneProjs = standaloneProjects.filter(p => p.status === 'completed');
            return (
              <>
                {activeProjs.length > 0 && (
                  <div className="flex flex-wrap gap-4 mb-3">
                    {activeProjs.map(proj => (
                      <ProjectCard
                        key={proj.id}
                        ref={el => { projectCardRefs.current[proj.id] = el; }}
                        project={proj}
                        onFocusClick={onFocusClick}
                        onEditClick={() => onEditProject?.(proj)}
                      />
                    ))}
                  </div>
                )}
                {doneProjs.length > 0 && (
                  <div className="flex flex-wrap gap-4">
                    {doneProjs.map(proj => (
                      <ProjectCard
                        key={proj.id}
                        ref={el => { projectCardRefs.current[proj.id] = el; }}
                        project={proj}
                        onFocusClick={onFocusClick}
                        onEditClick={() => onEditProject?.(proj)}
                        compact
                      />
                    ))}
                  </div>
                )}
              </>
            );
          })()}
        </div>
      )}

      {/* Empty state */}
      {activeGoals.length === 0 && standaloneProjects.length === 0 && (
        <div className="relative z-10 flex flex-col items-center justify-center py-16 gap-3">
          <div className={`w-14 h-14 rounded-full flex items-center justify-center ${
            darkMode ? 'bg-gray-700' : 'bg-stone-100'
          }`}>
            <GitBranch size={28} className={textSecondary} />
          </div>
          <p className={`text-sm font-medium ${textPrimary}`}>No goals or projects yet</p>
          <p className={`text-xs ${textSecondary} text-center max-w-xs`}>
            Create a goal to track long-term progress, or add a standalone project to organise tasks without a goal.
          </p>
        </div>
      )}
    </div>
  );
};

// ─── Mobile carousel layout ───────────────────────────────────────────────────

const MobileDashboard = ({
  activeGoals,
  activeProjects,
  onEditGoal,
  onEditProject,
  onFocusClick,
  onNewProject,
}) => {
  const {
    darkMode, textPrimary, textSecondary, hoverBg,
    tasks: scheduledTasks,
    unscheduledTasks,
    updateGoal,
  } = useDayPlannerCtx();

  const scrollRef = useRef(null);
  const swipeRef = useRef(null); // { startX, startY, locked }
  const pageRef = useRef(0);    // mirror of `page` for use inside event handlers

  // Same sort order as desktop: completed/overdue → left, active/upcoming → right
  const sortedGoals = useMemo(() => sortGoalsForCarousel(activeGoals), [activeGoals]);
  const defaultPageIdx = useMemo(() => findDefaultActiveIdx(sortedGoals), [sortedGoals]);
  const [page, setPage] = useState(defaultPageIdx);

  const standaloneProjects = activeProjects.filter(p => !p.goalId);
  const pages = [
    ...sortedGoals.map(g => ({ type: 'goal', goal: g })),
    { type: 'standalone' },
  ];
  const totalPages = pages.length;
  const totalPagesRef = useRef(totalPages);
  useEffect(() => { totalPagesRef.current = totalPages; }, [totalPages]);
  useEffect(() => { pageRef.current = page; }, [page]);

  // Scroll to the main goal on mount (instant, no animation)
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || defaultPageIdx === 0) return;
    requestAnimationFrame(() => {
      el.scrollLeft = defaultPageIdx * el.clientWidth;
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const goToPage = (idx) => {
    scrollRef.current?.scrollTo({
      left: idx * scrollRef.current.clientWidth,
      behavior: 'smooth',
    });
  };

  // JS swipe handler attached with { passive: false } so we can call
  // preventDefault() on horizontal gestures. This is necessary in Android
  // WebView where CSS touch-action on vertically-scrollable children does
  // not reliably propagate horizontal gestures to the scroll-snap container.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const onStart = (e) => {
      const t = e.touches[0];
      swipeRef.current = { startX: t.clientX, startY: t.clientY, locked: null };
    };

    const onMove = (e) => {
      const s = swipeRef.current;
      if (!s) return;
      const t = e.touches[0];
      const dx = t.clientX - s.startX;
      const dy = t.clientY - s.startY;
      if (s.locked === null && (Math.abs(dx) > 6 || Math.abs(dy) > 6)) {
        s.locked = Math.abs(dx) >= Math.abs(dy) ? 'h' : 'v';
      }
      if (s.locked === 'h') {
        e.preventDefault(); // block vertical / native WebView back-gesture
      }
    };

    const onEnd = (e) => {
      const s = swipeRef.current;
      swipeRef.current = null;
      if (!s || s.locked !== 'h') return;
      const dx = e.changedTouches[0].clientX - s.startX;
      if (Math.abs(dx) < 40) return; // too small — treat as tap
      if (dx < 0) goToPage(Math.min(totalPagesRef.current - 1, pageRef.current + 1));
      else         goToPage(Math.max(0, pageRef.current - 1));
    };

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove',  onMove,  { passive: false });
    el.addEventListener('touchend',   onEnd,   { passive: true });
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove',  onMove);
      el.removeEventListener('touchend',   onEnd);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Empty state — no goals and no standalone projects
  if (sortedGoals.length === 0 && standaloneProjects.length === 0) {
    return (
      <div className="flex flex-col flex-1 items-center justify-center gap-3 px-6">
        <div className={`w-14 h-14 rounded-full flex items-center justify-center ${darkMode ? 'bg-gray-700' : 'bg-stone-100'}`}>
          <GitBranch size={28} className={textSecondary} />
        </div>
        <p className={`text-sm font-medium ${textPrimary}`}>No goals or projects yet</p>
        <p className={`text-xs ${textSecondary} text-center`}>
          Create a goal to track long-term progress, or add a standalone project to organise tasks without a goal.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Dot indicators + page navigation — at top */}
      <div className="flex items-center justify-center gap-3 py-3 flex-shrink-0">
        <button
          onClick={() => goToPage(Math.max(0, page - 1))}
          disabled={page === 0}
          className={`p-1 rounded-full ${hoverBg} disabled:opacity-30 transition-colors`}
        >
          <ChevronLeft size={16} className={textSecondary} />
        </button>

        <div className="flex items-center gap-1.5">
          {pages.map((_, i) => (
            <button
              key={i}
              onClick={() => goToPage(i)}
              className={`rounded-full transition-all ${
                i === page
                  ? 'w-4 h-2.5 bg-blue-500'
                  : `w-2.5 h-2.5 ${darkMode ? 'bg-gray-600' : 'bg-stone-300'}`
              }`}
            />
          ))}
        </div>

        <button
          onClick={() => goToPage(Math.min(totalPages - 1, page + 1))}
          disabled={page === totalPages - 1}
          className={`p-1 rounded-full ${hoverBg} disabled:opacity-30 transition-colors`}
        >
          <ChevronRight size={16} className={textSecondary} />
        </button>
      </div>

      {/* Carousel */}
      <div
        ref={scrollRef}
        className="goal-carousel flex-1 min-h-0 flex overflow-x-auto overflow-y-hidden"
        style={{
          scrollSnapType: 'x mandatory',
          WebkitOverflowScrolling: 'touch',
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
        }}
        onScroll={e => {
          const p = Math.round(e.target.scrollLeft / e.target.clientWidth);
          if (p !== page) setPage(p);
        }}
      >
        {pages.map((pg) => {
          if (pg.type === 'goal') {
            const goal = pg.goal;
            const goalColor = goal.color || 'bg-blue-500';
            const goalHex = toHex(goalColor);
            const children = activeProjects.filter(p => p.goalId === goal.id);
            return (
              <div
                key={goal.id}
                className="flex-shrink-0 w-full h-full overflow-y-auto overflow-x-hidden px-4 pb-4"
                style={{ scrollSnapAlign: 'start' }}
              >
                {/* Goal header card */}
                {(() => {
                  const allTasks = [...scheduledTasks, ...unscheduledTasks];
                  const goalProgress = calculateGoalProgress(goal.id, activeProjects, allTasks);
                  const nonArchivedProjects = activeProjects.filter(p => p.goalId === goal.id);
                  const isCompleted = goal.status === 'completed';
                  const allProjectsDone = nonArchivedProjects.length > 0 && goalProgress >= 1;
                  const hasStalledProject = nonArchivedProjects.some(p => isProjectStalled(p.id, allTasks, p));
                  let daysLabel = null, daysUrgent = false, isOverdue = false;
                  if (goal.targetDate) {
                    const today = new Date(); today.setHours(0, 0, 0, 0);
                    const diff = Math.ceil((new Date(goal.targetDate + 'T00:00:00') - today) / 86400000);
                    daysLabel = diff === 0 ? 'Due today' : diff < 0 ? `${Math.abs(diff)}d overdue` : `${diff}d left`;
                    daysUrgent = diff <= 7;
                    isOverdue = diff < 0;
                  }
                  const showCaution = isOverdue || hasStalledProject;
                  return (
                    <div
                      className="rounded-xl p-4 mb-4 mt-2"
                      style={{ opacity: isCompleted ? 0.45 : 1, background: toLightBg(goalColor, darkMode), borderLeft: `4px solid ${goalHex}` }}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex flex-col gap-1 flex-1 min-w-0">
                          <span
                            className="text-base font-bold leading-tight"
                            style={{ color: goalHex }}
                          >
                            {goal.title}
                          </span>
                          {goal.description && (
                            <p className={`text-xs ${textSecondary} leading-snug`}>
                              {goal.description}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          {!isCompleted && allProjectsDone && (
                            <button
                              onClick={() => updateGoal(goal.id, { status: 'completed' })}
                              className="text-emerald-500 hover:text-emerald-400 transition-colors"
                              aria-label="Mark goal complete"
                            >
                              <CircleCheckBig size={16} />
                            </button>
                          )}
                          <button
                            onClick={() => onEditGoal(goal)}
                            className={`p-1 rounded-lg ${hoverBg} ${textSecondary} transition-colors`}
                            aria-label="Edit goal"
                          >
                            <Edit2 size={14} />
                          </button>
                        </div>
                      </div>
                      {/* Completed label OR date/caution row */}
                      {isCompleted ? (
                        <p className="text-xs mt-2 font-medium text-emerald-500">Completed</p>
                      ) : (daysLabel || showCaution) ? (
                        <div className="flex items-center gap-1.5 mt-2">
                          {daysLabel && (
                            <p className={`text-xs font-medium ${daysUrgent ? 'text-amber-500' : textSecondary}`}>
                              {daysLabel}
                            </p>
                          )}
                          {showCaution && !allProjectsDone && (
                            <AlertTriangle size={12} className="text-amber-500 ml-auto flex-shrink-0" />
                          )}
                        </div>
                      ) : null}
                      {/* Progress bar */}
                      {!isCompleted && (
                        <div className="mt-3">
                          <GoalProgress progress={goalProgress} color={goalColor} />
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Child project cards */}
                {children.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 py-8">
                    <FolderOpen size={24} className={textSecondary} />
                    <p className={`text-sm ${textSecondary}`}>No projects yet</p>
                    <button
                      onClick={() => onNewProject(goal.id)}
                      className="flex items-center gap-1.5 text-sm text-emerald-500 hover:text-emerald-600"
                    >
                      <Layers size={14} /> Add project
                    </button>
                  </div>
                ) : (() => {
                  const activeProjs = children.filter(p => p.status !== 'completed');
                  const doneProjs = children.filter(p => p.status === 'completed');
                  return (
                    <div className="flex flex-col gap-3">
                      {activeProjs.map(proj => (
                        <ProjectCard
                          key={proj.id}
                          project={proj}
                          onFocusClick={onFocusClick}
                          onEditClick={() => onEditProject?.(proj)}
                        />
                      ))}
                      {doneProjs.map(proj => (
                        <ProjectCard
                          key={proj.id}
                          project={proj}
                          onFocusClick={onFocusClick}
                          onEditClick={() => onEditProject?.(proj)}
                          compact
                        />
                      ))}
                    </div>
                  );
                })()}
              </div>
            );
          }

          // Standalone page
          const activeStandalone = standaloneProjects.filter(p => p.status !== 'completed');
          const doneStandalone = standaloneProjects.filter(p => p.status === 'completed');
          return (
            <div
              key="standalone"
              className="flex-shrink-0 w-full h-full overflow-y-auto overflow-x-hidden px-4 pb-4"
              style={{ scrollSnapAlign: 'start' }}
            >
              <div className="mt-2 mb-4">
                <span className={`text-xs font-semibold uppercase tracking-wider ${textSecondary}`}>
                  Standalone Projects
                </span>
              </div>

              {standaloneProjects.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-8">
                  <FolderOpen size={24} className={textSecondary} />
                  <p className={`text-sm ${textSecondary}`}>No standalone projects</p>
                  <button
                    onClick={() => onNewProject(null)}
                    className="flex items-center gap-1.5 text-sm text-emerald-500 hover:text-emerald-600"
                  >
                    <Layers size={14} /> Add Standalone Project
                  </button>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {activeStandalone.map(proj => (
                    <ProjectCard
                      key={proj.id}
                      project={proj}
                      onFocusClick={onFocusClick}
                      onEditClick={() => onEditProject?.(proj)}
                    />
                  ))}
                  {doneStandalone.map(proj => (
                    <ProjectCard
                      key={proj.id}
                      project={proj}
                      onFocusClick={onFocusClick}
                      onEditClick={() => onEditProject?.(proj)}
                      compact
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ─── GoalDashboard modal ──────────────────────────────────────────────────────

const GoalDashboard = ({ embedded = false, addGoalTrigger = 0, addProjectTrigger = 0 }) => {
  const {
    showGoalsDashboard, setShowGoalsDashboard,
    goals, projects,
    tasks,
    addGoal, updateGoal, deleteGoal,
    addProject, updateProject,
    enterProjectFocusMode,
    getTodayStr,
    showAddTask, setShowAddTask, setShowNewTaskDeadlinePicker,
    isMobile,
    darkMode,
    cardBg, borderClass, textPrimary, textSecondary, hoverBg,
  } = useDayPlannerCtx();

  const [goalForm, setGoalForm] = useState(null);
  const [projectForm, setProjectForm] = useState(null);
  const [confirmDialog, setConfirmDialog] = useState(null); // { title, message, onConfirm }
  const [showArchived, setShowArchived] = useState(false);
  const [focusNoTasksProject, setFocusNoTasksProject] = useState(null);

  // Trigger props from header buttons (mobile embedded mode)
  useEffect(() => { if (addGoalTrigger > 0) setGoalForm({ editing: null }); }, [addGoalTrigger]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (addProjectTrigger > 0) setProjectForm({ editing: null, defaultGoalId: null }); }, [addProjectTrigger]); // eslint-disable-line react-hooks/exhaustive-deps

  // Refs for SVG line calculation (desktop only)
  const goalCardRefs = useRef({});
  const projectCardRefs = useRef({});

  const activeGoals = goals.filter(g => g.status !== 'archived');
  const activeProjects = projects.filter(p => p.status !== 'archived');
  const archivedGoals = goals.filter(g => g.status === 'archived');
  const archivedProjects = projects.filter(p => p.status === 'archived');
  const archivedCount = archivedGoals.length + archivedProjects.length;

  const handleSaveGoal = (fields) => {
    if (goalForm.editing) {
      updateGoal(goalForm.editing.id, fields);
    } else {
      addGoal(fields);
    }
    setGoalForm(null);
  };

  const handleDeleteGoal = (goalId) => {
    setGoalForm(null);
    setConfirmDialog({
      title: 'Delete Goal',
      message: 'Its projects will become standalone. This cannot be undone.',
      onConfirm: () => {
        projects
          .filter(p => p.goalId === goalId)
          .forEach(p => updateProject(p.id, { goalId: undefined }));
        deleteGoal(goalId);
        setConfirmDialog(null);
      },
    });
  };

  const handleSaveProject = (fields) => {
    if (projectForm.editing) {
      updateProject(projectForm.editing.id, fields);
    } else {
      addProject(fields);
    }
    setProjectForm(null);
  };

  const handleFocusClick = useCallback((project) => {
    const todayStr = getTodayStr();
    const projectTodayTasks = tasks.filter(
      t => t.date === todayStr && t.projectId === project.id && !t.completed && !t.isAllDay
    );
    if (projectTodayTasks.length > 0) {
      if (!embedded) setShowGoalsDashboard(false);
      enterProjectFocusMode(project, projectTodayTasks);
    } else {
      setFocusNoTasksProject(project);
    }
  }, [tasks, getTodayStr, embedded, setShowGoalsDashboard, enterProjectFocusMode]);

  // Escape key — use capture phase so this fires before useModalClose and other handlers.
  // GoalDashboard owns all Escape behavior while it's visible.
  useEffect(() => {
    if (!showGoalsDashboard && !embedded) return;
    const handler = (e) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation(); // prevent all other keydown listeners
      e.preventDefault();
      if (showAddTask) {
        // Close task edit modal without closing dashboard
        setShowAddTask(false);
        setShowNewTaskDeadlinePicker(false);
        return;
      }
      if (goalForm) { setGoalForm(null); return; }
      if (projectForm) { setProjectForm(null); return; }
      if (!embedded) setShowGoalsDashboard(false);
    };
    document.addEventListener('keydown', handler, true); // capture phase
    return () => document.removeEventListener('keydown', handler, true);
  }, [showGoalsDashboard, embedded, goalForm, projectForm, showAddTask,
      setShowAddTask, setShowNewTaskDeadlinePicker, setShowGoalsDashboard]);

  if (!showGoalsDashboard && !embedded) return null;

  // ── Embedded mode: renders as inline tab content (mobile Goals tab) ──────
  if (embedded) {
    return (
      <>
        {/* Body */}
        <div className="flex-1 flex flex-col overflow-hidden min-h-0">
          <MobileDashboard
            activeGoals={activeGoals}
            activeProjects={activeProjects}
            onEditGoal={goal => setGoalForm({ editing: goal })}
            onEditProject={proj => setProjectForm({ editing: proj, defaultGoalId: null })}
            onFocusClick={handleFocusClick}
            onNewProject={defaultGoalId => setProjectForm({ editing: null, defaultGoalId })}
          />
          {archivedCount > 0 && (
            <div className={`border-t ${borderClass} px-4 py-3 flex-shrink-0`}>
              <button
                onClick={() => setShowArchived(v => !v)}
                className={`flex items-center gap-2 text-sm ${textSecondary} ${hoverBg} px-2 py-1.5 rounded-lg transition-colors w-full`}
              >
                <Archive size={14} />
                <span>Archived ({archivedCount})</span>
                <ChevronDown size={14} className={`ml-auto transition-transform duration-200 ${showArchived ? 'rotate-180' : ''}`} />
              </button>
              {showArchived && (
                <div className="flex gap-4 mt-2">
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs font-medium ${textSecondary} opacity-60 uppercase tracking-wider mb-1.5 px-2`}>Goals</p>
                    {archivedGoals.length === 0 ? (
                      <p className={`text-xs ${textSecondary} opacity-40 px-2 py-1`}>No archived goals</p>
                    ) : (
                      <div className="flex flex-col gap-1">
                        {archivedGoals.map(g => (
                          <div key={g.id} className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg ${hoverBg} min-w-0`}>
                            <Flag size={11} className="text-blue-400 flex-shrink-0" />
                            <span className={`text-xs ${textSecondary} flex-1 min-w-0 truncate`}>{g.title}</span>
                            <button onClick={() => updateGoal(g.id, { status: 'active' })} className={`flex-shrink-0 flex items-center gap-0.5 text-xs px-1.5 py-0.5 rounded ${darkMode ? 'text-blue-400 hover:bg-blue-900/30' : 'text-blue-600 hover:bg-blue-50'}`}>
                              <RotateCcw size={9} /> Restore
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className={`w-px self-stretch ${darkMode ? 'bg-gray-700' : 'bg-stone-200'}`} />
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs font-medium ${textSecondary} opacity-60 uppercase tracking-wider mb-1.5 px-2`}>Projects</p>
                    {archivedProjects.length === 0 ? (
                      <p className={`text-xs ${textSecondary} opacity-40 px-2 py-1`}>No archived projects</p>
                    ) : (
                      <div className="flex flex-col gap-1">
                        {archivedProjects.map(p => (
                          <div key={p.id} className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg ${hoverBg} min-w-0`}>
                            <Layers size={11} className="text-emerald-400 flex-shrink-0" />
                            <span className={`text-xs ${textSecondary} flex-1 min-w-0 truncate`}>{p.title}</span>
                            <button onClick={() => updateProject(p.id, { status: 'active' })} className={`flex-shrink-0 flex items-center gap-0.5 text-xs px-1.5 py-0.5 rounded ${darkMode ? 'text-blue-400 hover:bg-blue-900/30' : 'text-blue-600 hover:bg-blue-50'}`}>
                              <RotateCcw size={9} /> Restore
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        {goalForm && (
          <FormOverlay onClose={() => setGoalForm(null)} mobile cardBg={cardBg}>
            <GoalForm initial={goalForm.editing} onSave={handleSaveGoal} onDelete={goalForm.editing ? () => handleDeleteGoal(goalForm.editing.id) : undefined} onCancel={() => setGoalForm(null)} mobile />
          </FormOverlay>
        )}
        {projectForm && (
          <FormOverlay onClose={() => setProjectForm(null)} mobile cardBg={cardBg}>
            <ProjectForm initial={projectForm.editing} goals={goals} defaultGoalId={projectForm.defaultGoalId} onSave={handleSaveProject} onCancel={() => setProjectForm(null)} mobile />
          </FormOverlay>
        )}
        {confirmDialog && (
          <ConfirmDialog title={confirmDialog.title} message={confirmDialog.message} onConfirm={confirmDialog.onConfirm} onCancel={() => setConfirmDialog(null)} />
        )}
        {focusNoTasksProject && (
          <ConfirmDialog
            title="No tasks scheduled today"
            message={`"${focusNoTasksProject.title}" has no incomplete tasks on today's timeline. Schedule a task for today to start a Project Focus session.`}
            onConfirm={() => setFocusNoTasksProject(null)}
            onCancel={() => setFocusNoTasksProject(null)}
            confirmLabel="Got it"
            hideCancelButton
          />
        )}
      </>
    );
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto"
        style={{ padding: '24px 16px' }}
        onClick={() => setShowGoalsDashboard(false)}
      >
        <div className="absolute inset-0 bg-black/50" />

        {/* Panel */}
        <div
          className={`relative ${cardBg} w-full flex flex-col rounded-2xl shadow-2xl max-w-6xl max-h-[85vh]`}
          style={{ overflow: 'hidden' }}
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className={`flex-shrink-0 border-b ${borderClass} ${cardBg}`}>
            <div className="flex items-center justify-between px-5 py-4">
              <div className="flex items-center gap-3">
                <GitBranch size={20} className="text-blue-500" />
                <h2 className={`text-base font-semibold ${textPrimary}`}>
                  Goals &amp; Projects
                </h2>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setGoalForm({ editing: null })}
                  className="flex items-center gap-1.5 text-sm text-blue-500 hover:text-blue-600 font-medium px-2 py-1 rounded-lg transition-colors"
                >
                  <Flag size={15} /> Add Goal
                </button>
                <button
                  onClick={() => setProjectForm({ editing: null, defaultGoalId: null })}
                  className="flex items-center gap-1.5 text-sm text-emerald-500 hover:text-emerald-600 font-medium px-2 py-1 rounded-lg transition-colors"
                >
                  <Layers size={15} /> Add Project
                </button>
                <button
                  onClick={() => setShowGoalsDashboard(false)}
                  className={`p-1.5 rounded-lg ${
                    darkMode ? 'bg-white/10 hover:bg-white/20' : 'bg-stone-100 hover:bg-stone-200'
                  } transition-colors`}
                  aria-label="Close"
                >
                  <X size={16} className={textSecondary} />
                </button>
              </div>
            </div>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto overflow-x-hidden">
            <div className="p-6">
              <DesktopDashboard
                  activeGoals={activeGoals}
                  activeProjects={activeProjects}
                  onEditGoal={goal => setGoalForm({ editing: goal })}
                  onEditProject={proj => setProjectForm({ editing: proj, defaultGoalId: null })}
                  onFocusClick={handleFocusClick}
                  onNewProject={defaultGoalId => setProjectForm({ editing: null, defaultGoalId })}
                  goalCardRefs={goalCardRefs}
                  projectCardRefs={projectCardRefs}
                />
            </div>

            {/* Archived section */}
            {archivedCount > 0 && (
              <div className={`border-t ${borderClass} px-6 py-3`}>
                <button
                  onClick={() => setShowArchived(v => !v)}
                  className={`flex items-center gap-2 text-sm ${textSecondary} ${hoverBg} px-2 py-1.5 rounded-lg transition-colors w-full`}
                >
                  <Archive size={14} />
                  <span>Archived ({archivedCount})</span>
                  <ChevronDown
                    size={14}
                    className={`ml-auto transition-transform duration-200 ${showArchived ? 'rotate-180' : ''}`}
                  />
                </button>

                {showArchived && (
                  <div className="flex gap-4 mt-2">
                    {/* Goals column */}
                    <div className="flex-1 min-w-0">
                      <p className={`text-xs font-medium ${textSecondary} opacity-60 uppercase tracking-wider mb-1.5 px-2`}>Goals</p>
                      {archivedGoals.length === 0 ? (
                        <p className={`text-xs ${textSecondary} opacity-40 px-2 py-1`}>No archived goals</p>
                      ) : (
                        <div className="grid grid-cols-2 gap-1">
                          {archivedGoals.map(g => (
                            <div
                              key={g.id}
                              className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg ${hoverBg} min-w-0`}
                            >
                              <Flag size={11} className="text-blue-400 flex-shrink-0" />
                              <span className={`text-xs ${textSecondary} flex-1 min-w-0 truncate`}>{g.title}</span>
                              <button
                                onClick={() => updateGoal(g.id, { status: 'active' })}
                                className={`flex-shrink-0 flex items-center gap-0.5 text-xs px-1.5 py-0.5 rounded ${
                                  darkMode ? 'text-blue-400 hover:bg-blue-900/30' : 'text-blue-600 hover:bg-blue-50'
                                }`}
                              >
                                <RotateCcw size={9} /> Restore
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Divider */}
                    <div className={`w-px self-stretch ${darkMode ? 'bg-gray-700' : 'bg-stone-200'}`} />

                    {/* Projects column */}
                    <div className="flex-1 min-w-0">
                      <p className={`text-xs font-medium ${textSecondary} opacity-60 uppercase tracking-wider mb-1.5 px-2`}>Projects</p>
                      {archivedProjects.length === 0 ? (
                        <p className={`text-xs ${textSecondary} opacity-40 px-2 py-1`}>No archived projects</p>
                      ) : (
                        <div className="grid grid-cols-2 gap-1">
                          {archivedProjects.map(p => (
                            <div
                              key={p.id}
                              className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg ${hoverBg} min-w-0`}
                            >
                              <Layers size={11} className="text-emerald-400 flex-shrink-0" />
                              <span className={`text-xs ${textSecondary} flex-1 min-w-0 truncate`}>{p.title}</span>
                              <button
                                onClick={() => updateProject(p.id, { status: 'active' })}
                                className={`flex-shrink-0 flex items-center gap-0.5 text-xs px-1.5 py-0.5 rounded ${
                                  darkMode ? 'text-blue-400 hover:bg-blue-900/30' : 'text-blue-600 hover:bg-blue-50'
                                }`}
                              >
                                <RotateCcw size={9} /> Restore
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Goal create/edit form overlay */}
      {goalForm && (
        <FormOverlay onClose={() => setGoalForm(null)} mobile={isMobile} cardBg={cardBg}>
          <GoalForm
            initial={goalForm.editing}
            childProjects={goalForm.editing ? projects.filter(p => p.goalId === goalForm.editing.id) : []}
            onSave={handleSaveGoal}
            onCancel={() => setGoalForm(null)}
            onDelete={goalForm.editing ? () => handleDeleteGoal(goalForm.editing.id) : undefined}
            mobile={isMobile}
          />
        </FormOverlay>
      )}

      {/* Project create/edit form overlay */}
      {projectForm && (
        <FormOverlay onClose={() => setProjectForm(null)} mobile={isMobile} cardBg={cardBg}>
          <ProjectForm
            initial={projectForm.editing}
            goals={goals}
            onSave={handleSaveProject}
            onCancel={() => setProjectForm(null)}
            mobile={isMobile}
          />
        </FormOverlay>
      )}

      {confirmDialog && (
        <ConfirmDialog
          title={confirmDialog.title}
          message={confirmDialog.message}
          onConfirm={confirmDialog.onConfirm}
          onCancel={() => setConfirmDialog(null)}
        />
      )}
      {focusNoTasksProject && (
        <ConfirmDialog
          title="No tasks scheduled today"
          message={`"${focusNoTasksProject.title}" has no incomplete tasks on today's timeline. Schedule a task for today to start a Project Focus session.`}
          onConfirm={() => setFocusNoTasksProject(null)}
          onCancel={() => setFocusNoTasksProject(null)}
          confirmLabel="Got it"
          hideCancelButton
        />
      )}
    </>
  );
};

export default GoalDashboard;
