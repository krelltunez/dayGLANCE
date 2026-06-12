import React from 'react';
import {
  X, Activity, Target, GripVertical, RefreshCw,
  Pencil, Trash2, ChevronUp, ChevronDown, Plus, Footprints, Moon, WifiOff,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { HABIT_ICONS, HABIT_ICON_NAMES, HABIT_COLORS } from '../constants/habits.js';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../context/FeaturesContext.jsx';
import UserOwnerSwitcher from './UserOwnerSwitcher.jsx';
import { getDeviceId } from '../native.js';

const HabitModal = () => {
  const { t } = useTranslation();
  const { cardBg, borderClass, textPrimary, textSecondary, darkMode, hoverBg } = useDayPlannerCtx();
  const {
    setShowHabitModal,
    editingHabit, setEditingHabit,
    draggedHabitIdx, setDraggedHabitIdx,
    managedHabits: activeHabits, habits,
    addHabit, updateHabit, archiveHabit, deleteHabit, reorderHabits,
    addStepsHabit, addSleepHabit, healthPerms,
    multiUserEnabled, users, hrViewUserSyncId, setHrViewUserSyncId,
  } = useFeaturesCtx();

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => { setShowHabitModal(false); setEditingHabit(null); }}>
      <div className={`${cardBg} rounded-xl shadow-2xl max-w-lg w-full mx-4 max-h-[85vh] overflow-hidden flex flex-col`} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className={`px-5 py-4 border-b ${borderClass} flex items-center justify-between`}>
          <h2 className={`text-lg font-bold ${textPrimary}`}>
            {editingHabit ? t('habit.editHabit') : t('habit.manageHabits')}
          </h2>
          <button onClick={() => { setShowHabitModal(false); setEditingHabit(null); }} className={`p-1.5 rounded-lg ${hoverBg} transition-colors`}>
            <X size={20} className={textSecondary} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {editingHabit ? (
            /* Edit/Add form */
            (() => {
              const isNew = !editingHabit.id;
              return (
                <div className="space-y-4">
                  {/* Name */}
                  <div>
                    <label className={`block text-sm font-medium ${textSecondary} mb-1`}>{t('habit.habitName')}</label>
                    <input
                      type="text"
                      placeholder={t('habit.habitNamePlaceholder')}
                      value={editingHabit.name || ''}
                      onChange={(e) => setEditingHabit(prev => ({ ...prev, name: e.target.value }))}
                      className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'} text-sm`}
                      autoFocus
                    />
                  </div>

                  {/* Type toggle */}
                  <div>
                    <label className={`block text-sm font-medium ${textSecondary} mb-1`}>{t('habit.habitType')}</label>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setEditingHabit(prev => ({ ...prev, type: 'doMore' }))}
                        className={`flex-1 px-3 py-2 text-sm rounded-lg transition-colors ${
                          editingHabit.type === 'doMore'
                            ? 'bg-blue-600 text-white'
                            : `${darkMode ? 'bg-gray-700 text-gray-300' : 'bg-stone-100 text-stone-700'}`
                        }`}
                      >
                        {t('habit.habitDoMore')}
                      </button>
                      <button
                        onClick={() => setEditingHabit(prev => ({ ...prev, type: 'limit' }))}
                        className={`flex-1 px-3 py-2 text-sm rounded-lg transition-colors ${
                          editingHabit.type === 'limit'
                            ? 'bg-red-600 text-white'
                            : `${darkMode ? 'bg-gray-700 text-gray-300' : 'bg-stone-100 text-stone-700'}`
                        }`}
                      >
                        {t('habit.habitLimit')}
                      </button>
                    </div>
                    <p className={`text-xs ${textSecondary} mt-1`}>
                      {editingHabit.type === 'doMore' ? t('habit.habitDoMoreHint') : t('habit.habitLimitHint')}
                    </p>
                  </div>

                  {/* Target + Unit */}
                  <div className="flex gap-3">
                    <div className="flex-1">
                      <label className={`block text-sm font-medium ${textSecondary} mb-1`}>{editingHabit.type === 'doMore' ? t('habit.habitDailyGoal') : t('habit.habitDailyLimit')}</label>
                      <input
                        type="number"
                        min="1"
                        value={editingHabit.target || ''}
                        onChange={(e) => setEditingHabit(prev => ({ ...prev, target: parseInt(e.target.value) || 0 }))}
                        className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'} text-sm`}
                      />
                    </div>
                    <div className="flex-1">
                      <label className={`block text-sm font-medium ${textSecondary} mb-1`}>{t('habit.habitUnit')}</label>
                      <input
                        type="text"
                        placeholder={t('habit.habitUnitPlaceholder')}
                        value={editingHabit.unit || ''}
                        onChange={(e) => setEditingHabit(prev => ({ ...prev, unit: e.target.value }))}
                        className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'} text-sm`}
                      />
                    </div>
                  </div>

                  {/* Scheduled days -- hidden for auto-synced habits */}
                  {editingHabit.source !== 'healthConnect' && (() => {
                    const DOW_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
                    const days = editingHabit.scheduledDays ?? [0, 1, 2, 3, 4, 5, 6];
                    return (
                      <div>
                        <label className={`block text-sm font-medium ${textSecondary} mb-1`}>{t('habit.habitActiveDays')}</label>
                        <div className="flex gap-1.5">
                          {DOW_LABELS.map((label, idx) => {
                            const active = days.includes(idx);
                            return (
                              <button
                                key={idx}
                                type="button"
                                onClick={() => {
                                  if (active && days.length === 1) return; // keep at least one
                                  setEditingHabit(prev => ({
                                    ...prev,
                                    scheduledDays: active
                                      ? days.filter(d => d !== idx)
                                      : [...days, idx].sort((a, b) => a - b),
                                  }));
                                }}
                                className="w-9 h-9 rounded-lg text-sm font-semibold transition-colors flex-shrink-0"
                                style={active
                                  ? { backgroundColor: '#fe8b00', color: '#fff' }
                                  : { backgroundColor: darkMode ? '#374151' : '#f1f0ef', color: darkMode ? '#9ca3af' : '#78716c' }
                                }
                              >
                                {label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}

                  {/* Icon picker */}
                  <div>
                    <label className={`block text-sm font-medium ${textSecondary} mb-1`}>{t('habit.habitIcon')}</label>
                    <div className="flex flex-wrap gap-2">
                      {HABIT_ICON_NAMES.map(name => {
                        const Icon = HABIT_ICONS[name];
                        return (
                          <button
                            key={name}
                            onClick={() => setEditingHabit(prev => ({ ...prev, icon: name }))}
                            className={`w-9 h-9 rounded-lg flex items-center justify-center transition-colors ${
                              editingHabit.icon === name
                                ? 'bg-blue-600 text-white'
                                : `${darkMode ? 'bg-gray-700 text-gray-400 hover:bg-gray-600' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'}`
                            }`}
                          >
                            <Icon size={18} />
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Color picker */}
                  <div>
                    <label className={`block text-sm font-medium ${textSecondary} mb-1`}>{t('habit.habitColor')}</label>
                    <div className="flex flex-wrap gap-2">
                      {HABIT_COLORS.map(c => (
                        <button
                          key={c.name}
                          onClick={() => setEditingHabit(prev => ({ ...prev, color: c.name }))}
                          className={`w-9 h-9 rounded-full ${c.bg} transition-all ${
                            editingHabit.color === c.name ? 'ring-2 ring-offset-2 ring-blue-500' : 'opacity-70 hover:opacity-100'
                          }`}
                          style={editingHabit.color === c.name && darkMode ? { ringOffsetColor: '#1f2937' } : undefined}
                        />
                      ))}
                    </div>
                  </div>

                  {/* Save / Cancel */}
                  <div className="flex gap-2 pt-2">
                    <button
                      onClick={() => setEditingHabit(null)}
                      className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-medium ${darkMode ? 'bg-gray-700 text-gray-300 hover:bg-gray-600' : 'bg-stone-100 text-stone-700 hover:bg-stone-200'} transition-colors`}
                    >
                      {t('common.cancel')}
                    </button>
                    <button
                      onClick={() => {
                        if (!editingHabit.name?.trim()) return;
                        if (isNew) {
                          addHabit(editingHabit);
                        } else {
                          updateHabit(editingHabit.id, editingHabit);
                        }
                        setEditingHabit(null);
                      }}
                      disabled={!editingHabit.name?.trim() || !editingHabit.target}
                      className="flex-1 px-4 py-2.5 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {isNew ? t('habit.addHabit') : t('common.save')}
                    </button>
                  </div>
                </div>
              );
            })()
          ) : (
            /* Habit list view */
            <>
              <UserOwnerSwitcher
                enabled={multiUserEnabled}
                users={users}
                value={hrViewUserSyncId}
                onChange={setHrViewUserSyncId}
                darkMode={darkMode}
                borderClass={borderClass}
                textSecondary={textSecondary}
                label="Habits for"
              />
              {activeHabits.length === 0 ? (
                <div className={`text-center py-8 ${textSecondary}`}>
                  <Activity size={40} className="mx-auto mb-3 opacity-30" />
                  <p className="text-sm">{t('habit.noHabitsTitle')}</p>
                  <p className="text-xs mt-1">{t('habit.noHabitsHint')}</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {activeHabits.map((habit, idx) => {
                    const IconComp = HABIT_ICONS[habit.icon] || Target;
                    const colorObj = HABIT_COLORS.find(c => c.name === habit.color) || HABIT_COLORS[0];
                    return (
                      <div
                        key={habit.id}
                        draggable
                        onDragStart={(e) => { setDraggedHabitIdx(idx); e.dataTransfer.effectAllowed = 'move'; }}
                        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
                        onDrop={(e) => { e.preventDefault(); if (draggedHabitIdx !== null && draggedHabitIdx !== idx) reorderHabits(draggedHabitIdx, idx); setDraggedHabitIdx(null); }}
                        onDragEnd={() => setDraggedHabitIdx(null)}
                        className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border ${borderClass} ${darkMode ? 'bg-gray-800' : 'bg-white'} ${draggedHabitIdx === idx ? 'opacity-40' : ''} transition-opacity`}
                      >
                        <div className={`cursor-grab active:cursor-grabbing ${textSecondary}`}>
                          <GripVertical size={16} />
                        </div>
                        <IconComp size={20} style={{ color: colorObj.ring }} className="flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className={`text-sm font-medium ${textPrimary} truncate flex items-center gap-1.5`}>
                            {habit.name}
                            {(() => {
                              const { lastAutoSync } = habit;
                              const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
                              const isRecent = lastAutoSync?.timestamp &&
                                Date.now() - new Date(lastAutoSync.timestamp).getTime() < SEVEN_DAYS_MS;
                              if (!isRecent) return null;
                              const isThisDevice = lastAutoSync.deviceId === getDeviceId();
                              if (isThisDevice) {
                                const paused = habit.unit === 'steps' ? healthPerms?.steps === false : healthPerms?.sleep === false;
                                if (paused) return <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-orange-400/10 text-orange-500 flex-shrink-0"><WifiOff size={9} />Not syncing</span>;
                                return <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-600 dark:text-green-400 flex-shrink-0"><RefreshCw size={9} />Auto-synced on this device</span>;
                              }
                              const platform = lastAutoSync.platform ?? 'another device';
                              return <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-600 dark:text-green-400 flex-shrink-0"><RefreshCw size={9} />Auto-synced on {platform}</span>;
                            })()}
                          </div>
                          <div className={`text-xs ${textSecondary}`}>
                            {habit.type === 'doMore' ? t('habit.habitGoalPrefix') : t('habit.habitLimitPrefix')}: {habit.target} {habit.unit}
                          </div>
                          {(() => {
                            const days = habit.scheduledDays ?? [0, 1, 2, 3, 4, 5, 6];
                            if (days.length === 7) return null;
                            const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
                            return (
                              <div className={`text-xs ${textSecondary} opacity-70`}>
                                {days.map(d => names[d]).join(', ')}
                              </div>
                            );
                          })()}
                        </div>
                        <div className="flex items-center gap-1">
                          {idx > 0 && (
                            <button onClick={() => reorderHabits(idx, idx - 1)} className={`p-1 rounded ${hoverBg}`}>
                              <ChevronUp size={14} className={textSecondary} />
                            </button>
                          )}
                          {idx < activeHabits.length - 1 && (
                            <button onClick={() => reorderHabits(idx, idx + 1)} className={`p-1 rounded ${hoverBg}`}>
                              <ChevronDown size={14} className={textSecondary} />
                            </button>
                          )}
                          <button onClick={() => setEditingHabit({ ...habit })} className={`p-1 rounded ${hoverBg}`}>
                            <Pencil size={14} className={textSecondary} />
                          </button>
                          <button onClick={() => archiveHabit(habit.id)} className={`p-1 rounded ${hoverBg}`}>
                            <Trash2 size={14} className="text-red-500" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Add button */}
              {activeHabits.length < 8 && (
                <button
                  onClick={() => setEditingHabit({ name: '', icon: 'Droplets', color: 'blue', type: 'doMore', target: 8, unit: '', scheduledDays: [0, 1, 2, 3, 4, 5, 6] })}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border-2 border-dashed border-blue-500/30 text-blue-500 text-sm font-medium hover:bg-blue-500/5 transition-colors"
                >
                  <Plus size={16} />
                  {t('habit.addHabit')}
                </button>
              )}

              {/* Health Connect steps suggestion — only shown on Android with native bridge */}
              {window.DayGlanceNative && !activeHabits.some(h => h.source === 'healthConnect' && h.unit === 'steps') && activeHabits.length < 8 && (
                <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${darkMode ? 'border-green-800 bg-green-950/40' : 'border-green-200 bg-green-50'}`}>
                  <Footprints size={22} className="text-green-500 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className={`text-sm font-semibold ${darkMode ? 'text-green-300' : 'text-green-800'}`}>{t('habit.trackStepsTitle')}</div>
                    <div className={`text-xs ${darkMode ? 'text-green-500' : 'text-green-600'} mt-0.5`}>{t('habit.trackStepsHint')}</div>
                  </div>
                  <div className="flex gap-1.5 flex-shrink-0">
                    {!healthPerms?.steps && (
                      <button
                        onClick={() => { try { window.DayGlanceNative.requestHealthPermission(); } catch (e) {} }}
                        className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-green-500 text-white hover:bg-green-600 active:bg-green-700 transition-colors"
                      >
                        {t('common.authorize')}
                      </button>
                    )}
                    <button
                      onClick={healthPerms?.steps ? addStepsHabit : undefined}
                      disabled={!healthPerms?.steps}
                      className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors ${healthPerms?.steps ? 'bg-green-500 text-white hover:bg-green-600 active:bg-green-700' : 'bg-green-500/30 text-white/50 cursor-not-allowed'}`}
                    >
                      {t('common.add')}
                    </button>
                  </div>
                </div>
              )}

              {/* Health Connect sleep suggestion — only shown on Android with native bridge */}
              {window.DayGlanceNative && !activeHabits.some(h => h.source === 'healthConnect' && h.unit === 'min') && activeHabits.length < 8 && (
                <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${darkMode ? 'border-indigo-800 bg-indigo-950/40' : 'border-indigo-200 bg-indigo-50'}`}>
                  <Moon size={22} className="text-indigo-500 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className={`text-sm font-semibold ${darkMode ? 'text-indigo-300' : 'text-indigo-800'}`}>{t('habit.trackSleepTitle')}</div>
                    <div className={`text-xs ${darkMode ? 'text-indigo-500' : 'text-indigo-600'} mt-0.5`}>{t('habit.trackSleepHint')}</div>
                  </div>
                  <div className="flex gap-1.5 flex-shrink-0">
                    {!healthPerms?.sleep && (
                      <button
                        onClick={() => { try { window.DayGlanceNative.requestHealthPermission(); } catch (e) {} }}
                        className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-indigo-500 text-white hover:bg-indigo-600 active:bg-indigo-700 transition-colors"
                      >
                        {t('common.authorize')}
                      </button>
                    )}
                    <button
                      onClick={healthPerms?.sleep ? addSleepHabit : undefined}
                      disabled={!healthPerms?.sleep}
                      className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors ${healthPerms?.sleep ? 'bg-indigo-500 text-white hover:bg-indigo-600 active:bg-indigo-700' : 'bg-indigo-500/30 text-white/50 cursor-not-allowed'}`}
                    >
                      {t('common.add')}
                    </button>
                  </div>
                </div>
              )}

              {/* Archived habits */}
              {habits.filter(h => h.archived).length > 0 && (
                <div className="pt-2">
                  <h4 className={`text-xs font-semibold uppercase tracking-wide ${textSecondary} mb-2`}>{t('habit.archived')}</h4>
                  <div className="space-y-1">
                    {habits.filter(h => h.archived).map(habit => {
                      const IconComp = HABIT_ICONS[habit.icon] || Target;
                      const colorObj = HABIT_COLORS.find(c => c.name === habit.color) || HABIT_COLORS[0];
                      return (
                        <div key={habit.id} className={`flex items-center gap-3 px-3 py-2 rounded-lg ${darkMode ? 'bg-gray-800/50' : 'bg-stone-50'} opacity-60`}>
                          <IconComp size={16} style={{ color: colorObj.ring }} />
                          <span className={`text-sm flex-1 ${textPrimary}`}>{habit.name}</span>
                          <button onClick={() => updateHabit(habit.id, { archived: false })} className={`text-xs text-blue-500 font-medium px-2 py-1 rounded hover:bg-blue-500/10`}>{t('common.restore')}</button>
                          <button onClick={() => deleteHabit(habit.id)} className={`text-xs text-red-500 font-medium px-2 py-1 rounded hover:bg-red-500/10`}>{t('common.delete')}</button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default HabitModal;
