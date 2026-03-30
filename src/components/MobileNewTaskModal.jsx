import React from 'react';
import { Calendar, Check, Loader, Sparkles, X } from 'lucide-react';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { dateToString, extractTags, getRecurrenceLabel } from '../utils/taskUtils.js';
import { getRecurrencePresets } from '../utils/recurrenceEngine.js';

const MobileNewTaskModal = () => {
  const {
    showAddTask, setShowAddTask,
    isMobile,
    newTask, setNewTask,
    newTaskInputRef,
    mobileEditingTask, setMobileEditingTask,
    mobileEditIsInbox, setMobileEditIsInbox,
    mobileEditingNativeEvent, setMobileEditingNativeEvent,
    selectedDate,
    cardBg, borderClass, textPrimary, textSecondary, darkMode, hoverBg, colors,
    durationOptions, formatTime,
    aiConfig, taskAISuggestion, setTaskAISuggestion, taskAISuggestionLoading,
    showNewTaskDeadlinePicker, setShowNewTaskDeadlinePicker,
    showRecurrencePicker, setShowRecurrencePicker,
    setShowDatePicker, setShowTimePicker, setShowRecurrenceEndDatePicker,
    addTask, saveMobileEditTask, saveMobileEditNativeEvent,
    moveToRecycleBin, clearNativeEventOverride,
    handleNewTaskInputChange,
    goals, projects, goalsProjectsEnabled,
  } = useDayPlannerCtx();

  return (
    <>
      {showAddTask && isMobile && (
        <div className="fixed inset-0 z-[80] flex flex-col justify-end" onClick={() => { setShowAddTask(false); setShowNewTaskDeadlinePicker(false); setMobileEditingTask(null); setMobileEditIsInbox(false); }}>
          <div className="bg-black/30 absolute inset-0" />
          <div
            className={`relative ${cardBg} rounded-t-2xl shadow-xl max-h-[85vh] overflow-y-auto`}
            style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={`flex items-center justify-between p-4 border-b ${borderClass}`}>
              <h3 className={`font-semibold ${textPrimary} text-lg`}>
                {mobileEditingTask ? 'Edit Task' : newTask.openInInbox ? 'New Inbox Task' : 'New Scheduled Task'}
              </h3>
              <button onClick={() => { setShowAddTask(false); setShowNewTaskDeadlinePicker(false); setMobileEditingTask(null); setMobileEditIsInbox(false); }} className={`p-1 rounded-lg ${hoverBg}`}>
                <X size={18} className={textSecondary} />
              </button>
            </div>
            <form
              className="p-4 space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (mobileEditingTask) {
                  saveMobileEditTask();
                } else {
                  addTask(!!newTask.openInInbox);
                  setShowNewTaskDeadlinePicker(false);
                }
              }}
            >
              {/* Title */}
              <div>
                <input
                  ref={newTaskInputRef}
                  type="text"
                  placeholder="Task title"
                  value={newTask.title}
                  onChange={handleNewTaskInputChange}
                  autoFocus={!mobileEditingTask && !newTask.title}
                  className={`w-full px-3 py-3 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white'} text-base`}
                />
                {/* AI duration + tag suggestion pill */}
                {aiConfig.enabled && aiConfig.features?.durationEstimate && !mobileEditingTask && (
                  taskAISuggestionLoading ? (
                    <div className={`mt-1.5 flex items-center gap-1.5 text-xs ${darkMode ? 'text-purple-400' : 'text-purple-600'}`}>
                      <Loader size={11} className="animate-spin" />
                      <span>Estimating...</span>
                    </div>
                  ) : taskAISuggestion ? (
                    <div className={`mt-1.5 flex items-center gap-1.5 text-xs ${darkMode ? 'text-purple-300' : 'text-purple-700'}`}>
                      <Sparkles size={11} className="text-purple-400 flex-shrink-0" />
                      <span className="font-medium">{taskAISuggestion.duration} min</span>
                      {taskAISuggestion.tags?.length > 0 && (
                        <>
                          <span className={textSecondary}>·</span>
                          <span className="opacity-75">{taskAISuggestion.tags.map(t => '#' + t).join(' ')}</span>
                        </>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setNewTask(prev => {
                            const existing = extractTags(prev.title);
                            const newTags = (taskAISuggestion.tags || []).filter(t => !existing.includes(t));
                            const title = newTags.length > 0 ? prev.title.trimEnd() + ' ' + newTags.map(t => '#' + t).join(' ') : prev.title;
                            return { ...prev, duration: taskAISuggestion.duration, title };
                          });
                          setTaskAISuggestion(null);
                        }}
                        className={`ml-auto px-2 py-0.5 rounded text-xs font-medium transition-colors ${darkMode ? 'bg-purple-900/60 hover:bg-purple-800/60 text-purple-200' : 'bg-purple-100 hover:bg-purple-200 text-purple-700'}`}
                      >
                        Apply
                      </button>
                      <button type="button" onClick={() => setTaskAISuggestion(null)} className={`p-0.5 rounded transition-colors ${darkMode ? 'hover:bg-white/10' : 'hover:bg-black/5'}`}>
                        <X size={11} className={textSecondary} />
                      </button>
                    </div>
                  ) : null
                )}
              </div>

              {/* Project assignment (only when Goals & Projects is enabled) */}
              {goalsProjectsEnabled && (
                <div>
                  <label className={`block text-sm ${textSecondary} mb-1`}>Project</label>
                  <select
                    value={newTask.projectId || ''}
                    onChange={(e) => {
                      const pid = e.target.value || null;
                      const proj = pid ? projects.find(p => p.id === pid) : null;
                      const parentGoal = proj?.goalId ? goals.find(g => g.id === proj.goalId) : null;
                      setNewTask({ ...newTask, projectId: pid, keepUnscheduled: false, ...(parentGoal?.color ? { color: parentGoal.color } : {}) });
                    }}
                    className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'}`}
                  >
                    <option value="">No project</option>
                    {(() => {
                      const activeProjects = projects.filter(p => p.status !== 'archived' && p.status !== 'completed');
                      const withGoal = activeProjects.filter(p => p.goalId);
                      const standalone = activeProjects.filter(p => !p.goalId);
                      const goalGroups = goals
                        .filter(g => g.status !== 'archived' && withGoal.some(p => p.goalId === g.id))
                        .map(g => ({ goal: g, projs: withGoal.filter(p => p.goalId === g.id) }));
                      return (
                        <>
                          {goalGroups.map(({ goal, projs }) => (
                            <optgroup key={goal.id} label={goal.title}>
                              {projs.map(p => (
                                <option key={p.id} value={p.id}>{p.title}</option>
                              ))}
                            </optgroup>
                          ))}
                          {standalone.length > 0 && (
                            <optgroup label="Standalone">
                              {standalone.map(p => (
                                <option key={p.id} value={p.id}>{p.title}</option>
                              ))}
                            </optgroup>
                          )}
                        </>
                      );
                    })()}
                  </select>
                </div>
              )}

              {/* Color row */}
              <div>
                <label className={`block text-sm ${textSecondary} mb-2`}>Color</label>
                <div className="flex gap-2 flex-wrap">
                  {colors.map((color) => (
                    <button
                      type="button"
                      key={color.class}
                      onClick={() => setNewTask({ ...newTask, color: color.class })}
                      className={`${color.class} w-8 h-8 rounded-full transition-transform ${(newTask.color || colors[0].class) === color.class ? 'ring-2 ring-offset-2 ring-blue-500 scale-110' : ''}`}
                      title={color.name}
                    />
                  ))}
                </div>
              </div>

              {/* Fields grid */}
              {newTask.openInInbox ? (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={`block text-sm ${textSecondary} mb-1`}>Priority</label>
                    <button
                      type="button"
                      onClick={() => !newTask.projectId && setNewTask({ ...newTask, priority: ((newTask.priority || 0) + 1) % 4 })}
                      disabled={!!newTask.projectId}
                      className={`w-full h-10 px-3 border ${borderClass} rounded-lg ${darkMode ? 'bg-gray-700' : 'bg-white'} flex items-center justify-center gap-1 ${newTask.projectId ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      {[1, 2, 3].map((level) => (
                        <div
                          key={level}
                          className={`w-4 h-1 rounded-full ${(newTask.priority || 0) >= level ? 'bg-orange-500' : darkMode ? 'bg-gray-600' : 'bg-stone-300'}`}
                        />
                      ))}
                    </button>
                  </div>
                  <div>
                    <label className={`block text-sm ${textSecondary} mb-1`}>Deadline</label>
                    <div className="relative deadline-picker-container">
                      <button
                        type="button"
                        onClick={() => !newTask.projectId && setShowNewTaskDeadlinePicker(!showNewTaskDeadlinePicker)}
                        disabled={!!newTask.projectId}
                        className={`w-full px-3 py-2 border ${borderClass} rounded-lg text-left text-sm ${darkMode ? 'bg-gray-700 text-white' : 'bg-white'} flex items-center gap-2 ${newTask.projectId ? 'opacity-50 cursor-not-allowed' : ''}`}
                      >
                        <Calendar size={14} className={textSecondary} />
                        {newTask.deadline
                          ? new Date(newTask.deadline + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                          : 'None'}
                      </button>
                      {showNewTaskDeadlinePicker && (
                        <div className={`absolute bottom-12 left-0 ${cardBg} rounded-lg shadow-xl border ${borderClass} p-2 min-w-[160px] z-20`}>
                          <div className="space-y-1">
                            <button type="button" onClick={() => { setNewTask({ ...newTask, deadline: dateToString(new Date()) }); setShowNewTaskDeadlinePicker(false); }} className={`w-full text-left px-3 py-2 rounded text-sm ${textPrimary} ${hoverBg} flex items-center gap-2`}><Calendar size={14} />Today</button>
                            <button type="button" onClick={() => { const d = new Date(); d.setDate(d.getDate() + 1); setNewTask({ ...newTask, deadline: dateToString(d) }); setShowNewTaskDeadlinePicker(false); }} className={`w-full text-left px-3 py-2 rounded text-sm ${textPrimary} ${hoverBg} flex items-center gap-2`}><Calendar size={14} />Tomorrow</button>
                            <button type="button" onClick={() => { const d = new Date(); d.setDate(d.getDate() + 7); setNewTask({ ...newTask, deadline: dateToString(d) }); setShowNewTaskDeadlinePicker(false); }} className={`w-full text-left px-3 py-2 rounded text-sm ${textPrimary} ${hoverBg} flex items-center gap-2`}><Calendar size={14} />Next week</button>
                            {newTask.deadline && (
                              <>
                                <div className={`border-t ${borderClass} my-1`}></div>
                                <button type="button" onClick={() => { setNewTask({ ...newTask, deadline: null }); setShowNewTaskDeadlinePicker(false); }} className={`w-full text-left px-3 py-2 rounded text-sm text-red-500 ${hoverBg} flex items-center gap-2`}><X size={14} />Clear</button>
                              </>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="col-span-2">
                    <label className={`block text-sm ${textSecondary} mb-1`}>Duration</label>
                    <select
                      value={newTask.duration}
                      onChange={(e) => setNewTask({ ...newTask, duration: parseInt(e.target.value) })}
                      className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'}`}
                    >
                      {durationOptions.map(minutes => (
                        <option key={minutes} value={minutes}>{minutes} min</option>
                      ))}
                    </select>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={`block text-sm ${textSecondary} mb-1`}>Date</label>
                    <button
                      type="button"
                      onClick={() => !newTask.keepUnscheduled && setShowDatePicker(true)}
                      disabled={newTask.keepUnscheduled}
                      className={`w-full px-3 py-2 border ${borderClass} rounded-lg text-left text-sm ${darkMode ? 'bg-gray-700 text-white' : 'bg-white'} ${newTask.keepUnscheduled ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      {newTask.date ? new Date(newTask.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'Select'}
                    </button>
                  </div>
                  <div>
                    <label className={`block text-sm ${textSecondary} mb-1`}>Time</label>
                    <button
                      type="button"
                      onClick={() => !newTask.isAllDay && !newTask.keepUnscheduled && setShowTimePicker(true)}
                      disabled={newTask.isAllDay || newTask.keepUnscheduled}
                      className={`w-full px-3 py-2 border ${borderClass} rounded-lg text-left ${darkMode ? 'bg-gray-700 text-white' : 'bg-white'} ${newTask.isAllDay || newTask.keepUnscheduled ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      {newTask.isAllDay ? 'All Day' : formatTime(newTask.startTime)}
                    </button>
                  </div>
                  <div>
                    <label className={`block text-sm ${textSecondary} mb-1`}>Duration</label>
                    <select
                      value={newTask.duration}
                      onChange={(e) => setNewTask({ ...newTask, duration: parseInt(e.target.value) })}
                      disabled={newTask.isAllDay || newTask.keepUnscheduled}
                      className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white'} ${newTask.isAllDay || newTask.keepUnscheduled ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      {durationOptions.map(minutes => (
                        <option key={minutes} value={minutes}>{minutes} min</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={`block text-sm ${textSecondary} mb-1`}>All Day</label>
                    <label className={`flex items-center h-10 ${newTask.keepUnscheduled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`} onClick={(e) => { e.preventDefault(); !newTask.keepUnscheduled && setNewTask(prev => ({ ...prev, isAllDay: !prev.isAllDay })); }}>
                      <div className={`w-5 h-5 rounded flex items-center justify-center border-2 transition-colors ${newTask.isAllDay ? 'bg-blue-600 border-blue-600' : darkMode ? 'border-gray-500' : 'border-stone-300'}`}>
                        {newTask.isAllDay && <Check size={14} className="text-white" strokeWidth={3} />}
                      </div>
                      <span className={`ml-2 text-sm ${textPrimary}`}>Full day</span>
                    </label>
                  </div>
                  {/* Unscheduled — only shown when a project is selected */}
                  {newTask.projectId && (
                    <div className="col-span-2">
                      <label
                        className="flex items-center gap-2 cursor-pointer py-1"
                        onClick={(e) => { e.preventDefault(); setNewTask(prev => ({ ...prev, keepUnscheduled: !prev.keepUnscheduled })); }}
                      >
                        <div className={`w-5 h-5 rounded flex items-center justify-center border-2 transition-colors flex-shrink-0 ${newTask.keepUnscheduled ? 'bg-blue-600 border-blue-600' : darkMode ? 'border-gray-500' : 'border-stone-300'}`}>
                          {newTask.keepUnscheduled && <Check size={14} className="text-white" strokeWidth={3} />}
                        </div>
                        <div>
                          <span className={`text-sm ${textPrimary}`}>Unscheduled</span>
                          <span className={`ml-1 text-xs ${textSecondary}`}>(add to project card, no date/time)</span>
                        </div>
                      </label>
                    </div>
                  )}
                  {(<>
                    <div className="col-span-2 relative">
                      <label className={`block text-sm ${textSecondary} mb-1`}>Recurrence</label>
                      <button
                        type="button"
                        onClick={() => !newTask.keepUnscheduled && setShowRecurrencePicker(!showRecurrencePicker)}
                        disabled={newTask.keepUnscheduled}
                        className={`w-full px-3 py-2 border ${borderClass} rounded-lg text-left text-sm ${darkMode ? 'bg-gray-700 text-white' : 'bg-white'} ${newTask.recurrence ? 'ring-2 ring-blue-500' : ''} ${newTask.keepUnscheduled ? 'opacity-50 cursor-not-allowed' : ''}`}
                      >
                        {newTask.recurrence ? getRecurrenceLabel(newTask.recurrence) : 'None'}
                      </button>
                      {showRecurrencePicker && (() => {
                        const presets = getRecurrencePresets(newTask.date || dateToString(selectedDate));
                        return (
                          <div className={`absolute bottom-full left-0 mb-1 ${cardBg} rounded-lg shadow-xl z-30 border ${borderClass} min-w-[250px] max-h-[200px] overflow-y-auto`}>
                            {presets.map((preset, i) => (
                              <button
                                key={i}
                                type="button"
                                onClick={() => {
                                  const endFields = {};
                                  if (newTask.recurrence?.endDate) endFields.endDate = newTask.recurrence.endDate;
                                  if (newTask.recurrence?.maxOccurrences) endFields.maxOccurrences = newTask.recurrence.maxOccurrences;
                                  setNewTask({ ...newTask, recurrence: preset.value ? { ...preset.value, ...endFields } : null });
                                  setShowRecurrencePicker(false);
                                }}
                                className={`w-full text-left px-3 py-2 text-sm ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-stone-100'} ${textPrimary}`}
                              >
                                {preset.label}
                              </button>
                            ))}
                          </div>
                        );
                      })()}
                    </div>
                    {newTask.recurrence && (
                      <div className="col-span-2">
                        <label className={`block text-xs font-medium ${textSecondary} mb-1`}>Ends</label>
                        <div className="flex items-center gap-2 flex-wrap">
                          <button
                            type="button"
                            onClick={() => {
                              const { endDate: _e, maxOccurrences: _m, ...rest } = newTask.recurrence;
                              setNewTask({ ...newTask, recurrence: rest });
                            }}
                            className={`px-3 py-1.5 text-sm rounded-lg border ${borderClass} ${
                              !newTask.recurrence.endDate && !newTask.recurrence.maxOccurrences
                                ? 'bg-blue-600 text-white border-blue-600'
                                : `${darkMode ? 'bg-gray-700 text-white' : 'bg-white'}`
                            }`}
                          >
                            Never
                          </button>
                          <button
                            type="button"
                            onClick={() => setShowRecurrenceEndDatePicker({ source: 'new' })}
                            className={`px-3 py-1.5 text-sm rounded-lg border ${borderClass} ${
                              newTask.recurrence.endDate
                                ? 'bg-blue-600 text-white border-blue-600'
                                : `${darkMode ? 'bg-gray-700 text-white' : 'bg-white'}`
                            }`}
                          >
                            {newTask.recurrence.endDate
                              ? `Until ${new Date(newTask.recurrence.endDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
                              : 'On date'}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (!newTask.recurrence.maxOccurrences) {
                                const { endDate: _e, ...rest } = newTask.recurrence;
                                setNewTask({ ...newTask, recurrence: { ...rest, maxOccurrences: 10 } });
                              }
                            }}
                            className={`px-3 py-1.5 text-sm rounded-lg border ${borderClass} ${
                              newTask.recurrence.maxOccurrences
                                ? 'bg-blue-600 text-white border-blue-600'
                                : `${darkMode ? 'bg-gray-700 text-white' : 'bg-white'}`
                            }`}
                          >
                            After
                          </button>
                          {newTask.recurrence.maxOccurrences && (
                            <div className="flex items-center gap-1">
                              <input
                                type="number"
                                min="1"
                                max="999"
                                value={newTask.recurrence.maxOccurrences}
                                onChange={(e) => {
                                  const val = parseInt(e.target.value);
                                  if (val > 0) {
                                    const { endDate: _e, ...rest } = newTask.recurrence;
                                    setNewTask({ ...newTask, recurrence: { ...rest, maxOccurrences: val } });
                                  }
                                }}
                                className={`w-16 px-2 py-1 text-sm border ${borderClass} rounded ${darkMode ? 'bg-gray-700 text-white dark-spinner' : 'bg-white'}`}
                              />
                              <span className={`text-sm ${textSecondary}`}>times</span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </>)}
                </div>
              )}

              {/* Action buttons */}
              <div className="flex gap-2 pt-2">
                <button
                  type="submit"
                  className="flex-1 px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
                >
                  {mobileEditingTask ? 'Save Changes' : newTask.openInInbox ? (newTask.projectId ? 'Add to Project' : 'Add to Inbox') : newTask.projectId && newTask.keepUnscheduled ? 'Add to Project' : newTask.projectId ? 'Add to Project and Schedule' : 'Add to Schedule'}
                </button>
              </div>

              {/* Delete button for edit mode */}
              {mobileEditingTask && (
                <button
                  type="button"
                  onClick={() => {
                    moveToRecycleBin(mobileEditingTask.id, mobileEditIsInbox);
                    setShowAddTask(false);
                    setMobileEditingTask(null);
                    setMobileEditIsInbox(false);
                  }}
                  className="w-full px-4 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 font-medium"
                >
                  Delete Task
                </button>
              )}
            </form>
          </div>
        </div>
      )}

      {/* Native Calendar Event Edit Modal (mobile) */}
      {mobileEditingNativeEvent && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end" onClick={() => setMobileEditingNativeEvent(null)}>
          <div className="bg-black/30 absolute inset-0" />
          <div
            className={`relative ${cardBg} rounded-t-2xl shadow-xl max-h-[85vh] overflow-y-auto`}
            style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={`flex items-center justify-between p-4 border-b ${borderClass}`}>
              <div className="flex items-center gap-2">
                {mobileEditingNativeEvent.nativeCalendarColor && !newTask.color && (
                  <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: mobileEditingNativeEvent.nativeCalendarColor }} />
                )}
                {newTask.color && (
                  <div className={`w-3 h-3 rounded-full flex-shrink-0 ${newTask.color}`} />
                )}
                <h3 className={`font-semibold ${textPrimary} text-lg`}>Edit Event</h3>
              </div>
              <button onClick={() => setMobileEditingNativeEvent(null)} className={`p-1 rounded-lg ${hoverBg}`}>
                <X size={18} className={textSecondary} />
              </button>
            </div>
            <form
              className="p-4 space-y-4"
              onSubmit={(e) => { e.preventDefault(); saveMobileEditNativeEvent(); }}
            >
              {/* Calendar source info */}
              {mobileEditingNativeEvent.calendarName && (
                <p className={`text-xs ${textSecondary}`}>
                  From <span className="font-medium">{mobileEditingNativeEvent.calendarName}</span>
                </p>
              )}

              {/* Title */}
              <div>
                <label className={`block text-sm ${textSecondary} mb-1`}>Title</label>
                <input
                  type="text"
                  value={newTask.title}
                  onChange={(e) => setNewTask({ ...newTask, title: e.target.value })}
                  className={`w-full px-3 py-3 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white'} text-base`}
                />
              </div>

              {/* Color row */}
              <div>
                <label className={`block text-sm ${textSecondary} mb-2`}>Color override</label>
                <div className="flex gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => setNewTask({ ...newTask, color: '' })}
                    title="Use calendar color"
                    className={`w-8 h-8 rounded-full border-2 flex items-center justify-center transition-transform ${!newTask.color ? 'ring-2 ring-offset-2 ring-blue-500 scale-110' : darkMode ? 'border-gray-600' : 'border-stone-300'}`}
                    style={mobileEditingNativeEvent.nativeCalendarColor ? { backgroundColor: mobileEditingNativeEvent.nativeCalendarColor } : {}}
                  >
                    {!mobileEditingNativeEvent.nativeCalendarColor && <span className={`text-xs ${textSecondary}`}>—</span>}
                  </button>
                  {colors.map((color) => (
                    <button
                      type="button"
                      key={color.class}
                      onClick={() => setNewTask({ ...newTask, color: color.class })}
                      className={`${color.class} w-8 h-8 rounded-full transition-transform ${newTask.color === color.class ? 'ring-2 ring-offset-2 ring-blue-500 scale-110' : ''}`}
                      title={color.name}
                    />
                  ))}
                </div>
              </div>

              {/* Date / Time / Duration / All Day */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={`block text-sm ${textSecondary} mb-1`}>Date</label>
                  <button
                    type="button"
                    onClick={() => setShowDatePicker(true)}
                    className={`w-full px-3 py-2 border ${borderClass} rounded-lg text-left text-sm ${darkMode ? 'bg-gray-700 text-white' : 'bg-white'}`}
                  >
                    {newTask.date ? new Date(newTask.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'Select'}
                  </button>
                </div>
                <div>
                  <label className={`block text-sm ${textSecondary} mb-1`}>Time</label>
                  <button
                    type="button"
                    onClick={() => !newTask.isAllDay && setShowTimePicker(true)}
                    disabled={newTask.isAllDay}
                    className={`w-full px-3 py-2 border ${borderClass} rounded-lg text-left text-sm ${darkMode ? 'bg-gray-700 text-white' : 'bg-white'} ${newTask.isAllDay ? 'opacity-50' : ''}`}
                  >
                    {newTask.isAllDay ? 'All Day' : formatTime(newTask.startTime)}
                  </button>
                </div>
                <div>
                  <label className={`block text-sm ${textSecondary} mb-1`}>Duration</label>
                  <select
                    value={newTask.duration}
                    onChange={(e) => setNewTask({ ...newTask, duration: parseInt(e.target.value) })}
                    disabled={newTask.isAllDay}
                    className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white'} ${newTask.isAllDay ? 'opacity-50' : ''}`}
                  >
                    {durationOptions.map(minutes => (
                      <option key={minutes} value={minutes}>{minutes} min</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={`block text-sm ${textSecondary} mb-1`}>All Day</label>
                  <label className="flex items-center h-10 cursor-pointer" onClick={(e) => { e.preventDefault(); setNewTask(prev => ({ ...prev, isAllDay: !prev.isAllDay })); }}>
                    <div className={`w-5 h-5 rounded flex items-center justify-center border-2 transition-colors ${newTask.isAllDay ? 'bg-blue-600 border-blue-600' : darkMode ? 'border-gray-500' : 'border-stone-300'}`}>
                      {newTask.isAllDay && <Check size={14} className="text-white" strokeWidth={3} />}
                    </div>
                    <span className={`ml-2 text-sm ${textPrimary}`}>Full day</span>
                  </label>
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className={`block text-sm ${textSecondary} mb-1`}>Notes</label>
                <textarea
                  value={newTask.notes || ''}
                  onChange={(e) => setNewTask({ ...newTask, notes: e.target.value })}
                  rows={2}
                  className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white'} text-sm resize-none`}
                  placeholder="Add notes…"
                />
              </div>

              {/* Save */}
              <div className="flex gap-2 pt-2">
                <button
                  type="submit"
                  className="flex-1 px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
                >
                  Save Changes
                </button>
              </div>

              {/* Clear local overrides */}
              <button
                type="button"
                onClick={() => clearNativeEventOverride(mobileEditingNativeEvent)}
                className={`w-full px-4 py-2 rounded-lg text-sm font-medium ${darkMode ? 'text-gray-400 hover:bg-gray-700' : 'text-stone-500 hover:bg-stone-100'}`}
              >
                Reload from calendar
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
};

export default MobileNewTaskModal;
