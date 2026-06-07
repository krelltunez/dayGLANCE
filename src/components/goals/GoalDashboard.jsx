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
  GripVertical,
  Layers,
  Link2,
  LogIn,
  Plus,
  RotateCcw,
  Trash2,
  X,
  Zap,
  // hyperGLANCE icon picker icons
  BookOpen, GraduationCap, Brain, Calculator, FlaskConical, Pencil, Globe, Microscope, BookMarked,
  Briefcase, Code2, LineChart, Target, LayoutDashboard, Clipboard, Users, Mail, Rocket,
  Dumbbell, Heart, Activity, Apple, Moon, Bike, Leaf, Trophy, Flame,
  Music, Camera, Palette, Lightbulb, Wand2, Headphones, Mic, Film, Star,
} from 'lucide-react';
import { useDayPlannerCtx } from '../../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../../context/FeaturesContext.jsx';
import { TASK_COLORS, TAILWIND_TO_HEX, hexToRgba } from '../../utils/colorUtils.js';
import { HG_ICON_GROUPS, HG_COLORS, HG_DAYS } from '../../hooks/useHyperGlance.js';
import { dateToString } from '../../utils/taskUtils.js';
import { calculateGoalProgress } from '../../utils/goalProgress.js';
import { isProjectStalled } from '../../utils/projectProgress.js';
import GoalCard from './GoalCard.jsx';
import { useTranslation } from 'react-i18next';
import GoalProgress from './GoalProgress.jsx';
import ProjectCard from '../projects/ProjectCard.jsx';
import ConfirmDialog from '../ConfirmDialog.jsx';
import DatePicker from '../DatePicker.jsx';
import ClockTimePicker from '../ClockTimePicker.jsx';
import { emitGoalCreate } from '../../intents/emitGoalCreate.js';
import { INTENT_CONFIG_KEY } from '../../intents/useIntentPoller.js';

// ─── Tiny helpers ─────────────────────────────────────────────────────────────

/** Returns the hex value for a Tailwind bg-* class, falling back to blue. */
const toHex = (bgClass) => TAILWIND_TO_HEX[bgClass] || '#3b82f6';

/** Sort projects within a group by sortOrder, preserving array order for items without it. */
const sortByOrder = (projs) =>
  [...projs].sort((a, b) => {
    if (a.sortOrder !== undefined && b.sortOrder !== undefined) return a.sortOrder - b.sortOrder;
    if (a.sortOrder !== undefined) return -1;
    if (b.sortOrder !== undefined) return 1;
    return 0;
  });

/** Returns a light background for a Tailwind bg-* class. */
const toLightBg = (bgClass, dark) => {
  const hex = toHex(bgClass);
  return dark ? hexToRgba(hex, 0.13) : hexToRgba(hex, 0.09);
};

const nextQuarterHour = () => {
  const now = new Date();
  const m = now.getMinutes();
  const next = Math.ceil((m + 1) / 15) * 15;
  const h = (now.getHours() + Math.floor(next / 60)) % 24;
  return `${String(h).padStart(2, '0')}:${String(next % 60).padStart(2, '0')}`;
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

const GoalForm = ({ initial, childProjects = [], onSave, onCancel, onDelete, mobile, showLifeGlanceCheckbox = false }) => {
  const { darkMode, cardBg, borderClass, textPrimary, textSecondary, hoverBg, isMobile } =
    useDayPlannerCtx();
  const { t } = useTranslation();

  const [title, setTitle] = useState(initial?.title || '');
  const [description, setDescription] = useState(initial?.description || '');
  const [targetDate, setTargetDate] = useState(initial?.targetDate || '');
  const [color, setColor] = useState(initial?.color || TASK_COLORS[0].class);
  const [status, setStatus] = useState(initial?.status || 'active');
  const [trackInLifeGlance, setTrackInLifeGlance] = useState(false);

  // "Completed" only available when all child projects are completed (or none exist)
  const activeChildProjects = childProjects.filter(p => p.status !== 'archived');
  const canComplete = activeChildProjects.length === 0 || activeChildProjects.every(p => p.status === 'completed');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!title.trim()) return;
    onSave({ title: title.trim(), description: description.trim(), targetDate: targetDate || undefined, color, status, trackInLifeGlance: showLifeGlanceCheckbox && !initial && trackInLifeGlance });
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
        <label className={`text-xs font-medium ${textSecondary}`}>{t('common.titleRequired')}</label>
        <input
          autoFocus={!initial && !isMobile}
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
        <label className={`text-xs font-medium ${textSecondary}`}>{t('common.targetDate')}</label>
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

      {/* Track in lifeGLANCE — checkbox on create, read-only indicator on edit */}
      {showLifeGlanceCheckbox && !initial && (
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={trackInLifeGlance}
            onChange={e => setTrackInLifeGlance(e.target.checked)}
            className="w-4 h-4 rounded accent-blue-500"
          />
          <span className={`text-sm ${textSecondary}`}>Track in lifeGLANCE</span>
        </label>
      )}
      {initial && (initial.source_app === 'app.lifeglance' || initial.synced_to_lifeglance) && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-500/10 border border-blue-500/20">
          <Link2 size={14} className="text-blue-400 flex-shrink-0" />
          <span className="text-sm text-blue-400">
            {initial.source_app === 'app.lifeglance' ? t('goals.fromLifeGlance') : t('goals.trackedInLifeGlance')}
          </span>
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

// ─── hyperGLANCE icon lookup map ──────────────────────────────────────────────
const HG_ICON_MAP = {
  BookOpen, GraduationCap, Brain, Calculator, FlaskConical, Pencil, Globe, Microscope, BookMarked,
  Briefcase, Code2, LineChart, Target, LayoutDashboard, Clipboard, Users, Mail, Rocket,
  Dumbbell, Heart, Activity, Apple, Moon, Bike, Leaf, Trophy, Flame,
  Music, Camera, Palette, Lightbulb, Wand2, Headphones, Mic, Film, Star,
};

// ─── Project form (create / edit) ─────────────────────────────────────────────

export const ProjectForm = ({ initial, goals, defaultGoalId, onSave, onCancel, mobile }) => {
  const { darkMode, cardBg, borderClass, textPrimary, textSecondary, hoverBg, tasks, unscheduledTasks, use24HourClock, isMobile, isTablet } =
    useDayPlannerCtx();

  const [title, setTitle] = useState(initial?.title || '');
  const [description, setDescription] = useState(initial?.description || '');
  const [goalId, setGoalId] = useState(initial?.goalId || defaultGoalId || '');
  const [status, setStatus] = useState(initial?.status || 'active');

  // ── hyperGLANCE state ────────────────────────────────────────────────────
  const initHG = initial?.hyperglance || {};
  const [hgEnabled, setHgEnabled] = useState(initHG.enabled || false);
  const [hgIcon, setHgIcon] = useState(initHG.icon || 'BookOpen');
  const [hgColor, setHgColor] = useState(initHG.color || '#4f46e5');
  const [hgIsRecurring, setHgIsRecurring] = useState(initHG.isRecurring !== false);
  const [hgScheduledDays, setHgScheduledDays] = useState(initHG.scheduledDays || []);
  const [hgScheduledDate, setHgScheduledDate] = useState(initHG.scheduledDate || dateToString(new Date()));
  const [hgScheduledTime, setHgScheduledTime] = useState(initHG.scheduledTime || nextQuarterHour());
  const [hgDuration, setHgDuration] = useState(initHG.scheduledDuration || 60);
  const [hgTemplateTasks, setHgTemplateTasks] = useState(initHG.templateTasks || []);
  const [hgNewTask, setHgNewTask] = useState('');
  const [editingTemplateTask, setEditingTemplateTask] = useState(null); // { id, name, notes }
  const [showHgDatePicker, setShowHgDatePicker] = useState(false);
  const [showHgTimePicker, setShowHgTimePicker] = useState(false);

  const toggleHGDay = (day) => {
    setHgScheduledDays(prev =>
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]
    );
  };

  const addHGTemplateTask = () => {
    if (!hgNewTask.trim()) return;
    setHgTemplateTasks(prev => [...prev, { id: crypto.randomUUID(), name: hgNewTask.trim(), notes: '' }]);
    setHgNewTask('');
  };

  const removeHGTemplateTask = (id) => setHgTemplateTasks(prev => prev.filter(t => t.id !== id));
  const saveEditingTemplateTask = () => {
    if (!editingTemplateTask) return;
    setHgTemplateTasks(prev => prev.map(t => t.id === editingTemplateTask.id ? { ...t, name: editingTemplateTask.name, notes: editingTemplateTask.notes } : t));
    setEditingTemplateTask(null);
  };

  // "Completed" only available when all project tasks are completed (or none exist)
  const projectTasks = initial
    ? [...tasks, ...unscheduledTasks].filter(t => t.projectId === initial.id && !t.archived)
    : [];
  const canComplete = projectTasks.length === 0 || projectTasks.every(t => t.completed);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!title.trim()) return;
    const hyperglance = hgEnabled ? {
      enabled: true,
      icon: hgIcon,
      color: hgColor,
      isRecurring: hgIsRecurring,
      scheduledDays: hgIsRecurring ? hgScheduledDays : [],
      scheduledDate: hgIsRecurring ? null : (hgScheduledDate || null),
      scheduledTime: hgScheduledTime,
      scheduledDuration: Math.max(15, Math.round(hgDuration / 15) * 15),
      templateTasks: hgTemplateTasks,
      completions: initHG.completions || [],
      createdAt: initHG.createdAt || new Date().toISOString(),
    } : null;
    onSave({ title: title.trim(), description: description.trim(), goalId: goalId || undefined, status, hyperglance });
  };

  const activeGoals = goals.filter(g => g.status !== 'archived');

  return (
    <form
      onSubmit={handleSubmit}
      className={`${mobile ? '' : `${cardBg} rounded-2xl shadow-2xl max-w-md`} p-5 w-full flex flex-col gap-4`}
      onClick={e => e.stopPropagation()}
    >
      <h3 className={`text-base font-semibold ${textPrimary}`}>
        {initial ? 'Edit Project' : 'New Project'}
      </h3>

      {/* Title */}
      <div className="flex flex-col gap-1">
        <label className={`text-xs font-medium ${textSecondary}`}>{t('common.titleRequired')}</label>
        <input
          autoFocus={!initial && !isMobile}
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
        <label className={`text-xs font-medium ${textSecondary}`}>{t('goals.goalOptional')}</label>
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

      {/* ── hyperGLANCE section ────────────────────────────────────────── */}
      <div className={`rounded-xl border ${borderClass} overflow-hidden`}>
        {/* Toggle row */}
        <button
          type="button"
          onClick={() => setHgEnabled(v => !v)}
          className={`w-full flex items-center justify-between px-3 py-2.5 ${hoverBg} transition-colors`}
        >
          <div className="flex items-center gap-2">
            <Zap size={15} className={hgEnabled ? 'text-yellow-400' : textSecondary} />
            <span className={`text-sm font-medium ${hgEnabled ? textPrimary : textSecondary}`}>
              hyperGLANCE
            </span>
            {hgEnabled && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-yellow-400/20 text-yellow-400 font-semibold">ON</span>
            )}
          </div>
          <ChevronDown size={14} className={`${textSecondary} transition-transform ${hgEnabled ? 'rotate-180' : ''}`} />
        </button>

        {hgEnabled && (
          <div className={`px-3 pb-4 pt-1 space-y-4 border-t ${borderClass}`}>
            {/* Icon picker */}
            <div className="flex flex-col gap-1.5">
              <label className={`text-xs font-medium ${textSecondary}`}>Icon</label>
              {HG_ICON_GROUPS.map(({ group, icons }) => (
                <div key={group}>
                  <div className={`text-[10px] font-medium ${textSecondary} opacity-60 mb-1`}>{group}</div>
                  <div className="flex flex-wrap gap-1">
                    {icons.map(iconName => {
                      const Ic = HG_ICON_MAP[iconName];
                      if (!Ic) return null;
                      return (
                        <button
                          key={iconName}
                          type="button"
                          onClick={() => setHgIcon(iconName)}
                          className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
                            hgIcon === iconName
                              ? 'ring-2'
                              : `${hoverBg} opacity-60 hover:opacity-100`
                          }`}
                          style={hgIcon === iconName ? { ringColor: hgColor, backgroundColor: hexToRgba(hgColor, 0.125) } : {}}
                          title={iconName}
                        >
                          <Ic size={15} style={{ color: hgIcon === iconName ? hgColor : undefined }} className={hgIcon === iconName ? '' : textSecondary} />
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            {/* Color picker */}
            <div className="flex flex-col gap-1.5">
              <label className={`text-xs font-medium ${textSecondary}`}>Color</label>
              <div className="flex flex-wrap gap-2">
                {HG_COLORS.map(c => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => setHgColor(c.value)}
                    className={`w-7 h-7 rounded-full transition-all ${hgColor === c.value ? 'ring-2 ring-offset-2' : 'opacity-70 hover:opacity-100'}`}
                    style={{ backgroundColor: c.value, ringColor: c.value }}
                    title={c.label}
                  />
                ))}
              </div>
            </div>

            {/* Schedule type */}
            <div className="flex flex-col gap-1.5">
              <label className={`text-xs font-medium ${textSecondary}`}>Schedule</label>
              <div className={`flex rounded-lg border ${borderClass} overflow-hidden`}>
                {[{ value: true, label: 'Recurring' }, { value: false, label: 'One-off' }].map(opt => (
                  <button
                    key={String(opt.value)}
                    type="button"
                    onClick={() => setHgIsRecurring(opt.value)}
                    className={`flex-1 py-1.5 text-xs font-medium transition-colors ${
                      hgIsRecurring === opt.value ? 'bg-blue-600 text-white' : `${textSecondary} ${hoverBg}`
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Recurring: day picker */}
            {hgIsRecurring && (
              <div className="flex flex-col gap-1.5">
                <label className={`text-xs font-medium ${textSecondary}`}>Days</label>
                <div className="flex gap-1 flex-wrap">
                  {HG_DAYS.slice(1).concat(HG_DAYS[0]).map(day => (
                    <button
                      key={day}
                      type="button"
                      onClick={() => toggleHGDay(day)}
                      className={`px-2 py-1 rounded-md text-[11px] font-medium transition-colors ${
                        hgScheduledDays.includes(day)
                          ? 'text-white'
                          : `${textSecondary} ${hoverBg} opacity-60`
                      }`}
                      style={hgScheduledDays.includes(day) ? { backgroundColor: hgColor } : {}}
                    >
                      {day.charAt(0).toUpperCase() + day.slice(1, 3)}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* One-off: date picker */}
            {!hgIsRecurring && (
              <div className="flex flex-col gap-1.5">
                <label className={`text-xs font-medium ${textSecondary}`}>Date</label>
                <button
                  type="button"
                  onClick={() => setShowHgDatePicker(true)}
                  className={`px-3 py-2 text-sm rounded-lg border ${borderClass} text-left ${darkMode ? 'bg-gray-700 text-gray-100' : 'bg-white text-stone-900'}`}
                >
                  {hgScheduledDate
                    ? new Date(hgScheduledDate + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
                    : 'Select date…'}
                </button>
                {showHgDatePicker && (
                  <DatePicker
                    value={hgScheduledDate}
                    onChange={(d) => { setHgScheduledDate(d); setShowHgDatePicker(false); }}
                    onClose={() => setShowHgDatePicker(false)}
                  />
                )}
              </div>
            )}

            {/* Time + Duration row */}
            <div className="flex gap-3">
              <div className="flex flex-col gap-1.5 flex-1">
                <label className={`text-xs font-medium ${textSecondary}`}>Start time</label>
                <button
                  type="button"
                  onClick={() => setShowHgTimePicker(true)}
                  className={`px-3 py-2 text-sm rounded-lg border ${borderClass} text-left ${darkMode ? 'bg-gray-700 text-gray-100' : 'bg-white text-stone-900'}`}
                >
                  {(() => {
                    const [h, m] = (hgScheduledTime || '09:00').split(':').map(Number);
                    if (use24HourClock) return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
                    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
                    const ampm = h < 12 ? 'AM' : 'PM';
                    return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
                  })()}
                </button>
                {showHgTimePicker && (
                  <ClockTimePicker
                    value={hgScheduledTime}
                    onChange={(t) => { setHgScheduledTime(t); setShowHgTimePicker(false); }}
                    onClose={() => setShowHgTimePicker(false)}
                    darkMode={darkMode} isTablet={isTablet} use24HourClock={use24HourClock}
                  />
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                <label className={`text-xs font-medium ${textSecondary}`}>Duration</label>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setHgDuration(d => Math.max(15, d - 15))}
                    className={`w-8 h-8 rounded-lg border ${borderClass} flex items-center justify-center text-base font-bold ${hoverBg} ${textPrimary} transition-colors`}
                  >−</button>
                  <span className={`text-sm font-medium ${textPrimary} w-14 text-center`}>{hgDuration}m</span>
                  <button
                    type="button"
                    onClick={() => setHgDuration(d => Math.min(480, d + 15))}
                    className={`w-8 h-8 rounded-lg border ${borderClass} flex items-center justify-center text-base font-bold ${hoverBg} ${textPrimary} transition-colors`}
                  >+</button>
                </div>
              </div>
            </div>

            {/* Template tasks */}
            {hgIsRecurring && (
              <div className="flex flex-col gap-1.5">
                <label className={`text-xs font-medium ${textSecondary}`}>
                  Template tasks <span className="opacity-50 font-normal">(instantiated each session)</span>
                </label>
                {hgTemplateTasks.map(t => (
                  <div key={t.id} className={`flex items-center gap-2 px-2 py-1.5 rounded-lg ${darkMode ? 'bg-gray-700/50' : 'bg-stone-50'}`}>
                    <span className={`flex-1 text-sm ${textPrimary}`}>{t.name}</span>
                    {t.notes && <span className={`text-xs ${textSecondary} truncate max-w-[120px]`} title={t.notes}>{t.notes}</span>}
                    <button type="button" onClick={() => setEditingTemplateTask({ id: t.id, name: t.name, notes: t.notes || '' })} className={`p-0.5 rounded ${hoverBg}`}>
                      <Pencil size={13} className={textSecondary} />
                    </button>
                    <button type="button" onClick={() => removeHGTemplateTask(t.id)} className={`p-0.5 rounded ${hoverBg}`}>
                      <Trash2 size={13} className="text-red-400" />
                    </button>
                  </div>
                ))}
                <div className="flex gap-2 mt-1">
                  <input
                    type="text"
                    value={hgNewTask}
                    onChange={e => setHgNewTask(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addHGTemplateTask(); } }}
                    placeholder="Add task…"
                    className={`flex-1 px-2 py-1.5 text-sm rounded-lg border ${borderClass} focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                      darkMode ? 'bg-gray-700 text-gray-100 placeholder-gray-500' : 'bg-white text-stone-900 placeholder-stone-400'
                    }`}
                  />
                  <button
                    type="button"
                    onClick={addHGTemplateTask}
                    disabled={!hgNewTask.trim()}
                    className="px-2 py-1.5 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-40"
                  >
                    <Plus size={14} />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Template task edit modal */}
      {editingTemplateTask && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[80]" onClick={() => setEditingTemplateTask(null)}>
          <div className={`${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-stone-200'} border rounded-xl shadow-2xl p-4 w-80 mx-4`} onClick={e => e.stopPropagation()}>
            <h4 className={`text-sm font-semibold ${textPrimary} mb-3`}>{t('goals.editTemplateTask')}</h4>
            <div className="space-y-3">
              <div>
                <label className={`text-xs font-medium ${textSecondary} mb-1 block`}>Name</label>
                <input
                  type="text"
                  value={editingTemplateTask.name}
                  onChange={e => setEditingTemplateTask(prev => ({ ...prev, name: e.target.value }))}
                  className={`w-full px-2 py-1.5 text-sm rounded-lg border ${darkMode ? 'bg-gray-700 border-gray-600 text-gray-100' : 'bg-white border-stone-300 text-stone-900'} focus:outline-none focus:ring-2 focus:ring-blue-500`}
                  autoFocus
                />
              </div>
              <div>
                <label className={`text-xs font-medium ${textSecondary} mb-1 block`}>Note <span className="font-normal opacity-60">(carried into each session)</span></label>
                <textarea
                  value={editingTemplateTask.notes}
                  onChange={e => setEditingTemplateTask(prev => ({ ...prev, notes: e.target.value }))}
                  rows={3}
                  placeholder="Optional note…"
                  className={`w-full px-2 py-1.5 text-sm rounded-lg border resize-none ${darkMode ? 'bg-gray-700 border-gray-600 text-gray-100 placeholder-gray-500' : 'bg-white border-stone-300 text-stone-900 placeholder-stone-400'} focus:outline-none focus:ring-2 focus:ring-blue-500`}
                />
              </div>
            </div>
            <div className="flex gap-2 justify-end mt-4">
              <button type="button" onClick={() => setEditingTemplateTask(null)} className={`px-3 py-1.5 text-sm rounded-lg ${hoverBg} ${textSecondary} transition-colors`}>Cancel</button>
              <button type="button" onClick={saveEditingTemplateTask} disabled={!editingTemplateTask.name.trim()} className="px-3 py-1.5 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium disabled:opacity-50">Save</button>
            </div>
          </div>
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

export const FormOverlay = ({ children, onClose, mobile, cardBg }) => {
  useEffect(() => {
    const handler = (e) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      e.preventDefault();
      onClose();
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [onClose]);

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
      className="fixed inset-0 z-[60] overflow-y-auto bg-black/50"
      onClick={onClose}
    >
      <div className="min-h-full flex items-center justify-center py-8">
        {children}
      </div>
    </div>
  );
};

// ─── Goal mini card (carousel side slots) ────────────────────────────────────

const GoalMiniCard = ({ goal, onClick }) => {
  const { darkMode, textPrimary, textSecondary, tasks, unscheduledTasks } = useDayPlannerCtx();
  const { projects, updateGoal } = useFeaturesCtx();
  const { t } = useTranslation();
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

  const allTasks = useMemo(() => [...tasks, ...unscheduledTasks], [tasks, unscheduledTasks]);
  const childProjects = useMemo(() => projects.filter(p => p.goalId === goal.id && p.status !== 'archived'), [projects, goal.id]);
  const hasStalledProject = useMemo(() => childProjects.some(p => isProjectStalled(p.id, allTasks, p)), [childProjects, allTasks]);
  const showCaution = isOverdue || hasStalledProject;
  const goalProgress = useMemo(() => calculateGoalProgress(goal.id, childProjects, allTasks), [goal.id, childProjects, allTasks]);
  const allProjectsDone = childProjects.length > 0 && goalProgress >= 1;

  return (
    <div
      onClick={onClick}
      style={{ opacity: isCompleted ? 0.45 : 1, borderLeft: `3px solid ${hex}`, borderRight: `3px solid ${hex}` }}
      className={`w-52 cursor-pointer rounded-xl px-3 py-3 transition-all select-none ${
        darkMode ? 'bg-gray-800 hover:bg-gray-700' : 'bg-stone-50 hover:bg-stone-100'
      }`}
    >
      <div className="flex items-center gap-1.5">
        <p className={`text-sm font-semibold ${textPrimary} leading-tight truncate flex-1 min-w-0`}>
          {goal.title}
        </p>
        {(goal.source_app === 'app.lifeglance' || goal.synced_to_lifeglance) && (
          <span title="Linked with lifeGLANCE" className={`flex-shrink-0 ${textSecondary} opacity-60`}>
            <Link2 size={11} />
          </span>
        )}
      </div>
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
  onNewProject,
  goalCardRefs,
  projectCardRefs,
}) => {
  const { darkMode, textPrimary, textSecondary, borderClass, hoverBg } = useDayPlannerCtx();
  const { t } = useTranslation();
  const { moveProject, goalsDashboardFocusId, setGoalsDashboardFocusId } = useFeaturesCtx();

  const containerRef = useRef(null);
  const [svgLines, setSvgLines] = useState([]);
  const [svgSize, setSvgSize] = useState({ w: 0, h: 0 });

  // ── Drag state ───────────────────────────────────────────────────────────────
  const [dragProjectId, setDragProjectId] = useState(null);
  // Which cross-group pill is hovered: undefined = none, null = standalone, string = goalId
  const [dropZoneTarget, setDropZoneTarget] = useState(undefined);
  // Which card to insert before during within-group reorder (null = append)
  const [dropInsertBeforeId, setDropInsertBeforeId] = useState(null);

  const startDrag = useCallback((e, projId) => {
    e.dataTransfer.effectAllowed = 'move';
    const cardEl = projectCardRefs.current[projId];
    if (cardEl) e.dataTransfer.setDragImage(cardEl, 30, 30);
    // Use setTimeout so React state update doesn't cancel the drag
    setTimeout(() => setDragProjectId(projId), 0);
  }, [projectCardRefs]);

  const endDrag = useCallback(() => {
    setDragProjectId(null);
    setDropZoneTarget(undefined);
    setDropInsertBeforeId(null);
  }, []);

  // Sort goals: completed/overdue → left, active/upcoming → right (default focus)
  const sortedGoals = useMemo(() => sortGoalsForCarousel(activeGoals), [activeGoals]);
  const [activeGoalIdx, setActiveGoalIdx] = useState(
    () => findDefaultActiveIdx(sortedGoals)
  );

  useEffect(() => {
    if (!goalsDashboardFocusId) return;
    const idx = sortedGoals.findIndex(g => g.id === goalsDashboardFocusId);
    if (idx !== -1) setActiveGoalIdx(idx);
    setGoalsDashboardFocusId(null);
  }, [goalsDashboardFocusId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clamp index whenever the goals list changes length
  const safeIdx = sortedGoals.length > 0
    ? Math.min(activeGoalIdx, sortedGoals.length - 1)
    : 0;

  const activeGoal = sortedGoals[safeIdx] || null;
  const prevGoal = safeIdx > 0 ? sortedGoals[safeIdx - 1] : null;
  const nextGoal = safeIdx < sortedGoals.length - 1 ? sortedGoals[safeIdx + 1] : null;

  const goalProjects = useMemo(
    () => sortByOrder(activeGoal ? activeProjects.filter(p => p.goalId === activeGoal.id) : []),
    [activeGoal, activeProjects]
  );

  const standaloneProjects = useMemo(
    () => sortByOrder(activeProjects.filter(p => !p.goalId)),
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

  // ── Arrow-key carousel navigation ────────────────────────────────────────────
  useEffect(() => {
    if (sortedGoals.length <= 1) return;
    const handler = (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || document.activeElement?.isContentEditable) return;
      e.preventDefault();
      if (e.key === 'ArrowLeft')  setActiveGoalIdx(i => Math.max(0, i - 1));
      if (e.key === 'ArrowRight') setActiveGoalIdx(i => Math.min(sortedGoals.length - 1, i + 1));
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [sortedGoals.length]);

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

          {/* Cross-group drop-zone strip — visible while dragging */}
          {dragProjectId && (
            <div className={`relative z-10 mb-4 px-3 py-2.5 rounded-xl border-2 border-dashed ${
              darkMode ? 'border-gray-600 bg-gray-800/60' : 'border-stone-300 bg-stone-50'
            }`}>
              <p className={`text-xs text-center mb-2 ${textSecondary} opacity-50`}>{t('goals.dropToReassign')}</p>
              <div className="flex flex-wrap gap-2 justify-center">
                {sortedGoals.map(g => {
                  const hex = toHex(g.color || 'bg-blue-500');
                  const active = dropZoneTarget === g.id;
                  return (
                    <div
                      key={g.id}
                      onDragOver={e => { e.preventDefault(); setDropZoneTarget(g.id); }}
                      onDragLeave={() => setDropZoneTarget(undefined)}
                      onDrop={e => { e.preventDefault(); moveProject(dragProjectId, g.id); endDrag(); }}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border cursor-pointer select-none transition-all ${
                        active ? 'text-white border-transparent scale-105' :
                        darkMode ? 'bg-gray-700 border-gray-600 text-gray-200 hover:bg-gray-600' :
                                   'bg-white border-stone-200 text-stone-700 hover:bg-stone-100'
                      }`}
                      style={active ? { background: hex, borderColor: hex } : {}}
                    >
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: hex }} />
                      {g.title}
                    </div>
                  );
                })}
                <div
                  onDragOver={e => { e.preventDefault(); setDropZoneTarget(null); }}
                  onDragLeave={() => setDropZoneTarget(undefined)}
                  onDrop={e => { e.preventDefault(); moveProject(dragProjectId, null); endDrag(); }}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border cursor-pointer select-none transition-all ${
                    dropZoneTarget === null
                      ? 'bg-emerald-500 text-white border-transparent scale-105'
                      : darkMode ? 'bg-gray-700 border-gray-600 text-gray-200 hover:bg-gray-600'
                                 : 'bg-white border-stone-200 text-stone-700 hover:bg-stone-100'
                  }`}
                >
                  <Layers size={10} />
                  Standalone
                </div>
              </div>
            </div>
          )}

          {/* Projects for the active goal */}
          {(() => {
            const activeProjs = goalProjects.filter(p => p.status !== 'completed');
            const doneProjs = goalProjects.filter(p => p.status === 'completed');
            const makeDragHandle = (proj) => ({
              draggable: true,
              onDragStart: (e) => startDrag(e, proj.id),
              onDragEnd: endDrag,
            });
            const wrapCard = (proj, cardJsx) => (
              <div
                key={proj.id}
                data-proj-id={proj.id}
                className={`relative w-[260px] transition-opacity ${dragProjectId === proj.id ? 'opacity-40' : ''} ${
                  dropInsertBeforeId === proj.id && dragProjectId && dragProjectId !== proj.id
                    ? 'ring-2 ring-blue-500 rounded-xl' : ''
                }`}
                onDragOver={e => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (dragProjectId && dragProjectId !== proj.id) setDropInsertBeforeId(proj.id);
                }}
                onDrop={e => {
                  e.preventDefault();
                  if (!dragProjectId) return;
                  moveProject(dragProjectId, activeGoal.id, proj.id);
                  endDrag();
                }}
              >
                {dragProjectId && dragProjectId !== proj.id && (
                  <div className="absolute inset-0 z-10 rounded-xl" />
                )}
                {cardJsx}
              </div>
            );
            if (activeProjs.length === 0 && doneProjs.length === 0) return null;
            return (
              <div
                className="relative z-10 mb-8"
                onDragOver={e => { e.preventDefault(); }}
                onDrop={e => {
                  e.preventDefault();
                  if (!dragProjectId || dropInsertBeforeId) return; // card-level handled it
                  moveProject(dragProjectId, activeGoal.id);
                  endDrag();
                }}
              >
                {activeProjs.length > 0 && (
                  <div className="flex flex-wrap gap-4 mb-3 justify-center">
                    {activeProjs.map(proj => wrapCard(proj,
                      <ProjectCard
                        ref={el => { projectCardRefs.current[proj.id] = el; }}
                        project={proj}

                        onEditClick={() => onEditProject?.(proj)}
                        dragHandleProps={makeDragHandle(proj)}
                      />
                    ))}
                  </div>
                )}
                {doneProjs.length > 0 && (
                  <div className="flex flex-wrap gap-4 justify-center">
                    {doneProjs.map(proj => wrapCard(proj,
                      <ProjectCard
                        ref={el => { projectCardRefs.current[proj.id] = el; }}
                        project={proj}

                        onEditClick={() => onEditProject?.(proj)}
                        compact
                        dragHandleProps={makeDragHandle(proj)}
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
      {(standaloneProjects.length > 0 || dragProjectId) && (
        <div
          className={`relative z-10 pt-6 border-t ${borderClass} ${
            dragProjectId && dropZoneTarget === null
              ? darkMode ? 'bg-emerald-900/20 rounded-xl' : 'bg-emerald-50 rounded-xl'
              : ''
          }`}
          onDragOver={e => { e.preventDefault(); setDropZoneTarget(null); }}
          onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setDropZoneTarget(undefined); }}
          onDrop={e => {
            e.preventDefault();
            if (!dragProjectId || dropInsertBeforeId) return;
            moveProject(dragProjectId, null);
            endDrag();
          }}
        >
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
            const makeDragHandle = (proj) => ({
              draggable: true,
              onDragStart: (e) => startDrag(e, proj.id),
              onDragEnd: endDrag,
            });
            const wrapCard = (proj, cardJsx) => (
              <div
                key={proj.id}
                data-proj-id={proj.id}
                className={`relative w-[260px] transition-opacity ${dragProjectId === proj.id ? 'opacity-40' : ''} ${
                  dropInsertBeforeId === proj.id && dragProjectId && dragProjectId !== proj.id
                    ? 'ring-2 ring-blue-500 rounded-xl' : ''
                }`}
                onDragOver={e => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (dragProjectId && dragProjectId !== proj.id) setDropInsertBeforeId(proj.id);
                }}
                onDrop={e => {
                  e.preventDefault();
                  if (!dragProjectId) return;
                  moveProject(dragProjectId, null, proj.id);
                  endDrag();
                }}
              >
                {dragProjectId && dragProjectId !== proj.id && (
                  <div className="absolute inset-0 z-10 rounded-xl" />
                )}
                {cardJsx}
              </div>
            );
            if (activeProjs.length === 0 && doneProjs.length === 0) {
              return dragProjectId
                ? <p className={`text-xs text-center py-4 ${textSecondary} opacity-50`}>{t('goals.dropToStandalone')}</p>
                : null;
            }
            return (
              <>
                {activeProjs.length > 0 && (
                  <div className="flex flex-wrap gap-4 mb-3 justify-center">
                    {activeProjs.map(proj => wrapCard(proj,
                      <ProjectCard
                        ref={el => { projectCardRefs.current[proj.id] = el; }}
                        project={proj}

                        onEditClick={() => onEditProject?.(proj)}
                        dragHandleProps={makeDragHandle(proj)}
                      />
                    ))}
                  </div>
                )}
                {doneProjs.length > 0 && (
                  <div className="flex flex-wrap gap-4 justify-center">
                    {doneProjs.map(proj => wrapCard(proj,
                      <ProjectCard
                        ref={el => { projectCardRefs.current[proj.id] = el; }}
                        project={proj}

                        onEditClick={() => onEditProject?.(proj)}
                        compact
                        dragHandleProps={makeDragHandle(proj)}
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
          <p className={`text-sm font-medium ${textPrimary}`}>{t('goals.noGoalsYet')}</p>
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
  onNewProject,
  isActive = false,
}) => {
  const { darkMode, textPrimary, textSecondary, hoverBg, cardBg, borderClass, tasks: scheduledTasks, unscheduledTasks } = useDayPlannerCtx();
  const { updateGoal, moveProject, goalsDashboardFocusId, setGoalsDashboardFocusId } = useFeaturesCtx();
  const { t } = useTranslation();

  const scrollRef = useRef(null);
  const swipeRef = useRef(null); // { startX, startY, locked }
  const pageRef = useRef(0);    // mirror of `page` for use inside event handlers

  // ── Touch drag state (within-page reorder) ──────────────────────────────────
  const touchDragRef = useRef({ active: false, fromId: null, overId: null });
  const [touchDragId, setTouchDragId] = useState(null);
  const [touchOverId, setTouchOverId] = useState(null);

  // ── "Move to…" sheet state ──────────────────────────────────────────────────
  const [moveToProject, setMoveToProject] = useState(null);

  // Same sort order as desktop: completed/overdue → left, active/upcoming → right
  const sortedGoals = useMemo(() => sortGoalsForCarousel(activeGoals), [activeGoals]);
  const defaultPageIdx = useMemo(() => findDefaultActiveIdx(sortedGoals), [sortedGoals]);
  const [page, setPage] = useState(defaultPageIdx);

  const standaloneProjects = useMemo(() => sortByOrder(activeProjects.filter(p => !p.goalId)), [activeProjects]);
  const pages = [
    ...sortedGoals.map(g => ({ type: 'goal', goal: g })),
    { type: 'standalone' },
  ];
  const totalPages = pages.length;
  const totalPagesRef = useRef(totalPages);
  useEffect(() => { totalPagesRef.current = totalPages; }, [totalPages]);
  useEffect(() => { pageRef.current = page; }, [page]);

  useEffect(() => {
    if (!goalsDashboardFocusId || !isActive) return;
    const idx = sortedGoals.findIndex(g => g.id === goalsDashboardFocusId);
    if (idx !== -1) {
      setPage(idx);
      requestAnimationFrame(() => goToPage(idx));
    }
    setGoalsDashboardFocusId(null);
  }, [goalsDashboardFocusId, isActive]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // ── Touch drag handlers (within-page project reorder) ────────────────────────
  const handleGripTouchStart = useCallback((e, projId, goalId) => {
    e.preventDefault(); // block text selection on long-press
    touchDragRef.current = { active: true, fromId: projId, overId: null, goalId };
    setTouchDragId(projId);
  }, []);

  const handleGripTouchMove = useCallback((e) => {
    if (!touchDragRef.current.active) return;
    e.preventDefault();
    const touch = e.touches[0];
    const el = document.elementFromPoint(touch.clientX, touch.clientY);
    const card = el?.closest('[data-mobile-proj-id]');
    if (card) {
      const overId = card.getAttribute('data-mobile-proj-id');
      if (overId && overId !== touchDragRef.current.fromId) {
        touchDragRef.current.overId = overId;
        setTouchOverId(overId);
      }
    }
  }, []);

  const handleGripTouchEnd = useCallback((e, goalId) => {
    if (!touchDragRef.current.active) return;
    const { fromId, overId } = touchDragRef.current;
    touchDragRef.current = { active: false, fromId: null, overId: null, goalId: null };
    setTouchDragId(null);
    setTouchOverId(null);
    if (fromId && overId && fromId !== overId) {
      moveProject(fromId, goalId ?? null, overId);
    }
  }, [moveProject]);

  // JS swipe handler attached with { passive: false } so we can call
  // preventDefault() on horizontal gestures. This is necessary in Android
  // WebView where CSS touch-action on vertically-scrollable children does
  // not reliably propagate horizontal gestures to the scroll-snap container.
  //
  // Listeners are registered/unregistered based on isActive so they are only
  // attached when the carousel is actually visible. On real Android WebView,
  // registering a passive:false listener on a display:none element (at first
  // mount while another tab is shown) causes the WebView to not route touch
  // events to the element later when it becomes visible.
  useEffect(() => {
    if (!isActive) return;
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
  }, [isActive]); // eslint-disable-line react-hooks/exhaustive-deps

  // Empty state — no goals and no standalone projects
  if (sortedGoals.length === 0 && standaloneProjects.length === 0) {
    return (
      <div className="flex flex-col flex-1 items-center justify-center gap-3 px-6">
        <div className={`w-14 h-14 rounded-full flex items-center justify-center ${darkMode ? 'bg-gray-700' : 'bg-stone-100'}`}>
          <GitBranch size={28} className={textSecondary} />
        </div>
        <p className={`text-sm font-medium ${textPrimary}`}>{t('goals.noGoalsYet')}</p>
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
                      {/* Project count + completion % */}
                      {!isCompleted && nonArchivedProjects.length > 0 && (
                        <div className="flex items-center justify-between mt-1.5">
                          <div className="flex items-center gap-2">
                            <span className={`text-xs ${textSecondary}`}>
                              {nonArchivedProjects.length} project{nonArchivedProjects.length !== 1 ? 's' : ''}
                            </span>
                            <button
                              type="button"
                              onClick={() => onNewProject(goal.id)}
                              className={`flex items-center gap-0.5 text-xs ${textSecondary} opacity-60 hover:opacity-100 transition-opacity`}
                            >
                              <Plus size={10} /> Add
                            </button>
                          </div>
                          <span className={`text-xs font-medium ${goalProgress >= 1 ? 'text-green-500' : textSecondary}`}>
                            {Math.round(goalProgress * 100)}%
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Child project cards */}
                {children.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 py-8">
                    <FolderOpen size={24} className={textSecondary} />
                    <p className={`text-sm ${textSecondary}`}>{t('goals.noProjectsYet')}</p>
                    <button
                      onClick={() => onNewProject(goal.id)}
                      className="flex items-center gap-1.5 text-sm text-emerald-500 hover:text-emerald-600"
                    >
                      <Layers size={14} /> Add project
                    </button>
                  </div>
                ) : (() => {
                  const sorted = sortByOrder(children);
                  const activeProjs = sorted.filter(p => p.status !== 'completed');
                  const doneProjs = sorted.filter(p => p.status === 'completed');
                  return (
                    <div className="flex flex-col gap-3">
                      {activeProjs.map(proj => (
                        <div
                          key={proj.id}
                          data-mobile-proj-id={proj.id}
                          className={`transition-opacity ${touchDragId === proj.id ? 'opacity-40' : ''} ${
                            touchOverId === proj.id && touchDragId && touchDragId !== proj.id
                              ? 'ring-2 ring-blue-500 rounded-xl' : ''
                          }`}
                        >
                          <ProjectCard
                            project={proj}
    
                            onEditClick={() => onEditProject?.(proj)}
                            onMoveToClick={() => setMoveToProject(proj)}
                            dragHandleProps={{
                              onTouchStart: (e) => handleGripTouchStart(e, proj.id, goal.id),
                              onTouchMove: handleGripTouchMove,
                              onTouchEnd: (e) => handleGripTouchEnd(e, goal.id),
                            }}
                          />
                        </div>
                      ))}
                      {doneProjs.map(proj => (
                        <div key={proj.id} data-mobile-proj-id={proj.id}>
                          <ProjectCard
                            project={proj}
    
                            onEditClick={() => onEditProject?.(proj)}
                            onMoveToClick={() => setMoveToProject(proj)}
                            compact
                            dragHandleProps={{
                              onTouchStart: (e) => handleGripTouchStart(e, proj.id, goal.id),
                              onTouchMove: handleGripTouchMove,
                              onTouchEnd: (e) => handleGripTouchEnd(e, goal.id),
                            }}
                          />
                        </div>
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
                  <p className={`text-sm ${textSecondary}`}>{t('goals.noStandaloneProjects')}</p>
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
                    <div
                      key={proj.id}
                      data-mobile-proj-id={proj.id}
                      className={`transition-opacity ${touchDragId === proj.id ? 'opacity-40' : ''} ${
                        touchOverId === proj.id && touchDragId && touchDragId !== proj.id
                          ? 'ring-2 ring-blue-500 rounded-xl' : ''
                      }`}
                    >
                      <ProjectCard
                        project={proj}

                        onEditClick={() => onEditProject?.(proj)}
                        onMoveToClick={() => setMoveToProject(proj)}
                        dragHandleProps={{
                          onTouchStart: (e) => handleGripTouchStart(e, proj.id, null),
                          onTouchMove: handleGripTouchMove,
                          onTouchEnd: (e) => handleGripTouchEnd(e, null),
                        }}
                      />
                    </div>
                  ))}
                  {doneStandalone.map(proj => (
                    <div key={proj.id} data-mobile-proj-id={proj.id}>
                      <ProjectCard
                        project={proj}

                        onEditClick={() => onEditProject?.(proj)}
                        onMoveToClick={() => setMoveToProject(proj)}
                        compact
                        dragHandleProps={{
                          onTouchStart: (e) => handleGripTouchStart(e, proj.id, null),
                          onTouchMove: handleGripTouchMove,
                          onTouchEnd: (e) => handleGripTouchEnd(e, null),
                        }}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* "Move to…" bottom sheet */}
      {moveToProject && (
        <div
          className="fixed inset-0 z-[70] flex flex-col justify-end"
          onClick={() => setMoveToProject(null)}
        >
          <div className="absolute inset-0 bg-black/50" />
          <div
            className={`relative ${cardBg} rounded-t-2xl shadow-xl px-4 pt-4 pb-8 border-t ${borderClass}`}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <span className={`text-sm font-semibold ${textPrimary}`}>
                Move "{moveToProject.title}" to…
              </span>
              <button onClick={() => setMoveToProject(null)} className={`p-1 rounded-lg ${hoverBg}`}>
                <X size={16} className={textSecondary} />
              </button>
            </div>
            <div className="flex flex-col gap-1">
              {sortedGoals.map(g => {
                const hex = toHex(g.color || 'bg-blue-500');
                const isCurrent = moveToProject.goalId === g.id;
                return (
                  <button
                    key={g.id}
                    disabled={isCurrent}
                    onClick={() => { moveProject(moveToProject.id, g.id); setMoveToProject(null); }}
                    className={`flex items-center gap-2.5 w-full text-left px-3 py-2.5 rounded-xl transition-colors ${
                      isCurrent ? 'opacity-40 cursor-default' : hoverBg
                    }`}
                  >
                    <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: hex }} />
                    <span className={`text-sm ${textPrimary}`}>{g.title}</span>
                    {isCurrent && <span className={`ml-auto text-xs ${textSecondary}`}>current</span>}
                  </button>
                );
              })}
              <button
                disabled={!moveToProject.goalId}
                onClick={() => { moveProject(moveToProject.id, null); setMoveToProject(null); }}
                className={`flex items-center gap-2.5 w-full text-left px-3 py-2.5 rounded-xl transition-colors ${
                  !moveToProject.goalId ? 'opacity-40 cursor-default' : hoverBg
                }`}
              >
                <Layers size={12} className={`flex-shrink-0 ${textSecondary}`} />
                <span className={`text-sm ${textPrimary}`}>Standalone</span>
                {!moveToProject.goalId && <span className={`ml-auto text-xs ${textSecondary}`}>current</span>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ─── GoalDashboard modal ──────────────────────────────────────────────────────

const GoalDashboard = ({ embedded = false, isActive = false, addGoalTrigger = 0, addProjectTrigger = 0 }) => {
  const {
    tasks, setTasks,
    unscheduledTasks, setUnscheduledTasks,
    getTodayStr,
    showAddTask, setShowAddTask, setShowNewTaskDeadlinePicker,
    isMobile,
    darkMode,
    cardBg, borderClass, textPrimary, textSecondary, hoverBg,
    expandedNotesTaskId, setExpandedNotesTaskId,
  } = useDayPlannerCtx();
  const {
    showGoalsDashboard, setShowGoalsDashboard,
    goals, projects, setProjects,
    addGoal, updateGoal, deleteGoal,
    addProject, updateProject,
  } = useFeaturesCtx();
  const { t } = useTranslation();

  const [goalForm, setGoalForm] = useState(null);
  const [projectForm, setProjectForm] = useState(null);
  const [confirmDialog, setConfirmDialog] = useState(null); // { title, message, onConfirm }
  const [showArchived, setShowArchived] = useState(false);

  const hasWebDAVIntents = useMemo(() => {
    const raw = localStorage.getItem(INTENT_CONFIG_KEY);
    if (!raw) return false;
    const cfg = JSON.parse(raw);
    return !!(cfg?.webdavUrl && cfg?.username && cfg?.appPassword);
  }, []);

  // Trigger props from header buttons (mobile embedded mode)
  useEffect(() => { if (addGoalTrigger > 0) setGoalForm({ editing: null }); }, [addGoalTrigger]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (addProjectTrigger > 0) setProjectForm({ editing: null, defaultGoalId: null }); }, [addProjectTrigger]); // eslint-disable-line react-hooks/exhaustive-deps

  // Refs for SVG line calculation (desktop only)
  const goalCardRefs = useRef({});
  const projectCardRefs = useRef({});

  const activeGoals = useMemo(() => goals.filter(g => g.status !== 'archived'), [goals]);
  const activeProjects = useMemo(() => projects.filter(p => p.status !== 'archived'), [projects]);
  const archivedGoals = useMemo(() => goals.filter(g => g.status === 'archived'), [goals]);
  const archivedProjects = useMemo(() => projects.filter(p => p.status === 'archived'), [projects]);
  const archivedCount = archivedGoals.length + archivedProjects.length;

  const handleSaveGoal = (fields) => {
    const { trackInLifeGlance, ...goalFields } = fields;
    if (goalForm.editing) {
      const wasArchived = goalForm.editing.status === 'archived';
      const nowArchived = goalFields.status === 'archived';
      if (nowArchived && !wasArchived) {
        // Cascade: archive completed child projects; detach incomplete ones as standalone.
        // Single atomic setProjects call so all changes land in one state update.
        const goalId = goalForm.editing.id;
        const now = new Date().toISOString();
        setProjects(prev => prev.map(p => {
          if (p.goalId !== goalId) return p;
          if (p.status === 'completed') {
            return { ...p, status: 'archived', updatedAt: now };
          }
          // Remove goalId entirely so the project becomes standalone
          const { goalId: _removed, ...rest } = p;
          return { ...rest, updatedAt: now };
        }));
      }
      updateGoal(goalForm.editing.id, goalFields);
    } else {
      const newGoal = addGoal({ ...goalFields, ...(trackInLifeGlance ? { synced_to_lifeglance: true } : {}) });
      if (trackInLifeGlance) emitGoalCreate(newGoal);
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
      const wasArchived = projectForm.editing.status === 'archived';
      const nowArchived = fields.status === 'archived';
      if (nowArchived && !wasArchived) {
        // Cascade: archive completed tasks; detach incomplete tasks from this project.
        const projectId = projectForm.editing.id;
        const cascadeTask = t => {
          if (t.projectId !== projectId) return t;
          if (t.completed) return { ...t, archived: true };
          // Remove projectId entirely so the task becomes a plain inbox/timeline task
          const { projectId: _removed, ...rest } = t;
          return rest;
        };
        setTasks(prev => prev.map(cascadeTask));
        setUnscheduledTasks(prev => prev.map(cascadeTask));
      }
      updateProject(projectForm.editing.id, fields);
    } else {
      addProject(fields);
    }
    setProjectForm(null);
  };

  // Escape key — use capture phase so this fires before useModalClose and other handlers.
  // GoalDashboard owns all Escape behavior while it's visible.
  useEffect(() => {
    if (!showGoalsDashboard && !embedded) return;
    const handler = (e) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation(); // prevent all other keydown listeners
      e.preventDefault();
      if (expandedNotesTaskId) { setExpandedNotesTaskId(null); return; }
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
  }, [showGoalsDashboard, embedded, goalForm, projectForm, showAddTask, expandedNotesTaskId,
      setShowAddTask, setShowNewTaskDeadlinePicker, setShowGoalsDashboard, setExpandedNotesTaskId]);

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
            onNewProject={defaultGoalId => setProjectForm({ editing: null, defaultGoalId })}
            isActive={isActive}
          />
          {archivedCount > 0 && (
            <div className={`border-t ${borderClass} flex-shrink-0`}>
              <button
                onClick={() => setShowArchived(v => !v)}
                className={`flex items-center gap-2 text-xs ${textSecondary} ${hoverBg} px-3 py-2 transition-colors w-full`}
              >
                <Archive size={13} className="flex-shrink-0" />
                <span className="font-medium">Archived ({archivedCount})</span>
                <ChevronDown size={13} className={`ml-auto flex-shrink-0 transition-transform duration-200 ${showArchived ? 'rotate-180' : ''}`} />
              </button>
              {showArchived && (
                <div className="flex gap-4 mt-2">
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs font-medium ${textSecondary} opacity-60 uppercase tracking-wider mb-1.5 px-2`}>Goals</p>
                    {archivedGoals.length === 0 ? (
                      <p className={`text-xs ${textSecondary} opacity-40 px-2 py-1`}>{t('goals.noArchivedGoals')}</p>
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
                      <p className={`text-xs ${textSecondary} opacity-40 px-2 py-1`}>{t('goals.noArchivedProjects')}</p>
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
            <GoalForm initial={goalForm.editing} onSave={handleSaveGoal} onDelete={goalForm.editing ? () => handleDeleteGoal(goalForm.editing.id) : undefined} onCancel={() => setGoalForm(null)} mobile showLifeGlanceCheckbox={hasWebDAVIntents} />
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
                  onNewProject={defaultGoalId => setProjectForm({ editing: null, defaultGoalId })}
                  goalCardRefs={goalCardRefs}
                  projectCardRefs={projectCardRefs}
                />
            </div>

            {/* Archived section */}
            {archivedCount > 0 && (
              <div className={`border-t ${borderClass}`}>
                <button
                  onClick={() => setShowArchived(v => !v)}
                  className={`flex items-center gap-2 text-xs ${textSecondary} ${hoverBg} px-3 py-2 transition-colors w-full`}
                >
                  <Archive size={13} className="flex-shrink-0" />
                  <span className="font-medium">Archived ({archivedCount})</span>
                  <ChevronDown
                    size={13}
                    className={`ml-auto flex-shrink-0 transition-transform duration-200 ${showArchived ? 'rotate-180' : ''}`}
                  />
                </button>

                {showArchived && (
                  <div className="flex gap-4 mt-2">
                    {/* Goals column */}
                    <div className="flex-1 min-w-0">
                      <p className={`text-xs font-medium ${textSecondary} opacity-60 uppercase tracking-wider mb-1.5 px-2`}>Goals</p>
                      {archivedGoals.length === 0 ? (
                        <p className={`text-xs ${textSecondary} opacity-40 px-2 py-1`}>{t('goals.noArchivedGoals')}</p>
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
                        <p className={`text-xs ${textSecondary} opacity-40 px-2 py-1`}>{t('goals.noArchivedProjects')}</p>
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
            showLifeGlanceCheckbox={hasWebDAVIntents}
          />
        </FormOverlay>
      )}

      {/* Project create/edit form overlay */}
      {projectForm && (
        <FormOverlay onClose={() => setProjectForm(null)} mobile={isMobile} cardBg={cardBg}>
          <ProjectForm
            initial={projectForm.editing}
            goals={goals}
            defaultGoalId={projectForm.defaultGoalId}
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
    </>
  );
};

export default GoalDashboard;
