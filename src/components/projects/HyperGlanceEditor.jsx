import React, { useEffect, useRef, useState } from 'react';
import {
  Activity, Apple, Bike, BookMarked, BookOpen, Brain, Briefcase, Calculator,
  Camera, ChevronDown, Clipboard, Code2, Dumbbell, Film, FlaskConical, Flame,
  Globe, GraduationCap, Headphones, Heart, LayoutDashboard, Leaf, Lightbulb,
  LineChart, Mail, Mic, Microscope, Moon, Music, Palette, Pencil, Plus, Rocket,
  Star, Target, Trash2, Trophy, Users, Wand2, Zap,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../../context/DayPlannerContext.jsx';
import { HG_ICON_GROUPS, HG_COLORS, HG_DAYS } from '../../hooks/useHyperGlance.js';
import { hexToRgba } from '../../utils/colorUtils.js';
import { dateToString } from '../../utils/taskUtils.js';
import DatePicker from '../DatePicker.jsx';
import ClockTimePicker from '../ClockTimePicker.jsx';

const HG_ICON_MAP = {
  BookOpen, GraduationCap, Brain, Calculator, FlaskConical, Pencil, Globe, Microscope, BookMarked,
  Briefcase, Code2, LineChart, Target, LayoutDashboard, Clipboard, Users, Mail, Rocket,
  Dumbbell, Heart, Activity, Apple, Moon, Bike, Leaf, Trophy, Flame,
  Music, Camera, Palette, Lightbulb, Wand2, Headphones, Mic, Film, Star,
};

const nextQuarterHour = () => {
  const now = new Date();
  const minutes = now.getMinutes();
  const next = Math.ceil(minutes / 15) * 15;
  if (next === 60) { now.setHours(now.getHours() + 1); now.setMinutes(0); }
  else now.setMinutes(next);
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
};

/**
 * Self-contained hyperGLANCE settings editor — extracted from ProjectForm and
 * now hosted by the Project Planner. Owns its form state and emits the
 * assembled hyperglance object (or null when disabled) through onChange on
 * every user change; the initial value never triggers an emit, so mounting
 * the editor can't dirty the project.
 */
const HyperGlanceEditor = ({ value, onChange }) => {
  const { darkMode, borderClass, textPrimary, textSecondary, hoverBg, use24HourClock, isTablet } =
    useDayPlannerCtx();
  const { t } = useTranslation();

  const initHG = value || {};
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

  // Emit the assembled hyperglance object on user changes (skip mount).
  const mountedRef = useRef(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => {
    if (!mountedRef.current) { mountedRef.current = true; return; }
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
    onChangeRef.current?.(hyperglance);
    // initHG fields are carried through, not inputs to re-emit on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hgEnabled, hgIcon, hgColor, hgIsRecurring, hgScheduledDays, hgScheduledDate, hgScheduledTime, hgDuration, hgTemplateTasks]);

  return (
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
              {hgTemplateTasks.map(tt => (
                <div key={tt.id} className={`flex items-center gap-2 px-2 py-1.5 rounded-lg ${darkMode ? 'bg-gray-700/50' : 'bg-stone-50'}`}>
                  <span className={`flex-1 text-sm ${textPrimary}`}>{tt.name}</span>
                  {tt.notes && <span className={`text-xs ${textSecondary} truncate max-w-[120px]`} title={tt.notes}>{tt.notes}</span>}
                  <button type="button" onClick={() => setEditingTemplateTask({ id: tt.id, name: tt.name, notes: tt.notes || '' })} className={`p-0.5 rounded ${hoverBg}`}>
                    <Pencil size={13} className={textSecondary} />
                  </button>
                  <button type="button" onClick={() => removeHGTemplateTask(tt.id)} className={`p-0.5 rounded ${hoverBg}`}>
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
    </div>
  );
};

export default HyperGlanceEditor;
