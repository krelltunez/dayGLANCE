import React from 'react';
import { BookOpen, Calendar, Check, Loader, Sparkles, X } from 'lucide-react';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../context/FeaturesContext.jsx';
import { useSyncCtx } from '../context/SyncContext.jsx';
import { SOURCE_APPS } from '../native.js';
import SuggestionAutocomplete from './SuggestionAutocomplete.jsx';
import LastGlanceBadge from './LastGlanceBadge.jsx';
import { dateToString, extractTags, getRecurrenceLabel } from '../utils/taskUtils.js';
import { getRecurrencePresets } from '../utils/recurrenceEngine.js';

const DesktopNewTaskModal = () => {
  const {
    showAddTask, setShowAddTask,
    isMobile, isTablet,
    newTask, setNewTask,
    newTaskInputRef,
    mobileEditingTask, setMobileEditingTask,
    mobileEditIsInbox, setMobileEditIsInbox,
    selectedDate,
    cardBg, borderClass, textPrimary, textSecondary, darkMode, hoverBg, colors,
    durationOptions, formatTime,
    showNewTaskDeadlinePicker, setShowNewTaskDeadlinePicker,
    showRecurrencePicker, setShowRecurrencePicker,
    showDatePicker, setShowDatePicker,
    showColorPicker, setShowColorPicker,
    showRecurrenceEndDatePicker, setShowRecurrenceEndDatePicker,
    setShowTimePicker,
    deadlinePickerTaskId, setDeadlinePickerTaskId,
    tasks,
    suggestions, showSuggestions, selectedSuggestionIndex, suggestionContext,
    addTask, saveMobileEditTask, moveToRecycleBin,
    applySuggestionForNewTask,
    handleNewTaskInputChange, handleNewTaskInputKeyDown,
  } = useDayPlannerCtx();
  const { aiConfig, taskAISuggestion, setTaskAISuggestion, taskAISuggestionLoading, triggerTaskAISuggestion, goals, projects, goalsProjectsEnabled } = useFeaturesCtx();
  const { wikilinkCandidates = [] } = useSyncCtx() || {};

  // Wikilink autocomplete: detect [[partial at end of title
  const wikilinkMatch = newTask.title.match(/\[\[([^\]]*)?$/);
  const wikilinkQuery = wikilinkMatch ? (wikilinkMatch[1] ?? '') : null;
  const wikilinkSuggestions = wikilinkQuery !== null && wikilinkCandidates.length > 0
    ? wikilinkCandidates.filter(c => c.toLowerCase().includes(wikilinkQuery.toLowerCase())).slice(0, 8)
    : [];
  const applyWikilinkSuggestion = (noteName) => {
    const newTitle = newTask.title.replace(/\[\[([^\]]*)?$/, `[[${noteName}]]`);
    setNewTask(prev => ({ ...prev, title: newTitle }));
    newTaskInputRef.current?.focus();
  };

  if (!showAddTask || isMobile) return null;

  return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[80]" onClick={() => { setShowAddTask(false); setShowNewTaskDeadlinePicker(false); setMobileEditingTask(null); }}>
          <form
            className={`${cardBg} rounded-lg shadow-xl p-6 ${borderClass} border max-w-lg w-full mx-4`}
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              if (mobileEditingTask) {
                saveMobileEditTask();
              } else {
                const addToInbox = e.nativeEvent.submitter?.dataset.inbox === 'true' || newTask.openInInbox;
                addTask(addToInbox);
              }
              setShowNewTaskDeadlinePicker(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                if (showRecurrencePicker) {
                  setShowRecurrencePicker(false);
                } else if (showNewTaskDeadlinePicker) {
                  setShowNewTaskDeadlinePicker(false);
                } else if (deadlinePickerTaskId) {
                  setDeadlinePickerTaskId(null);
                } else if (showDatePicker) {
                  setShowDatePicker(false);
                } else if (showRecurrenceEndDatePicker) {
                  setShowRecurrenceEndDatePicker(null);
                } else {
                  setShowAddTask(false);
                  setMobileEditingTask(null);
                }
              } else if (e.key === '^' && !newTask.openInInbox) {
                // '^' toggles Full Day for scheduled tasks
                e.preventDefault();
                setNewTask({ ...newTask, isAllDay: !newTask.isAllDay });
              } else if (e.key === ' ' && e.target.tagName !== 'INPUT') {
                // Prevent SPACE from activating buttons
                e.preventDefault();
              }
            }}
          >
            <h3 className={`font-semibold ${textPrimary} mb-4 text-lg`}>
              {mobileEditingTask ? 'Edit Task' : newTask.openInInbox ? 'New Inbox Task' : 'New Scheduled Task'}
            </h3>
            <div className="space-y-4">
              {/* Source attribution — shown when editing a task created via lastGLANCE */}
              {mobileEditingTask?.source_app === SOURCE_APPS.LASTGLANCE && (
                <div className={`flex items-center gap-1.5 text-xs ${textSecondary}`}>
                  <LastGlanceBadge size={14} className="flex-shrink-0" />
                  <span>Added by lastGLANCE</span>
                </div>
              )}
              <div className="relative tag-autocomplete-container">
                <input
                  ref={newTaskInputRef}
                  type="text"
                  placeholder={newTask.openInInbox ? "Task title (#tag, $deadline, !priority, %mins)" : "Task title (#tag, @date, ~time, %mins, ^all-day)"}
                  value={newTask.title}
                  onChange={handleNewTaskInputChange}
                  onKeyDown={handleNewTaskInputKeyDown}
                  autoFocus={!(isTablet && mobileEditingTask)}
                  className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'}`}
                />
                {showSuggestions && suggestionContext === 'newTask' && (
                  <SuggestionAutocomplete
                    suggestions={suggestions}
                    selectedIndex={selectedSuggestionIndex}
                    onSelect={applySuggestionForNewTask}
                    cardBg={cardBg}
                    borderClass={borderClass}
                    textPrimary={textPrimary}
                    hoverBg={hoverBg}
                  />
                )}
                {/* Wikilink autocomplete dropdown */}
                {wikilinkSuggestions.length > 0 && (
                  <div className={`absolute top-full left-0 mt-1 ${cardBg} rounded-lg p-1 z-50 shadow-xl border ${borderClass} min-w-[200px] max-h-48 overflow-y-auto`}>
                    {wikilinkSuggestions.map(name => (
                      <button
                        key={name}
                        type="button"
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); applyWikilinkSuggestion(name); }}
                        onMouseDown={(e) => e.preventDefault()}
                        className={`w-full text-left px-2 py-1.5 rounded text-sm flex items-center gap-2 ${textPrimary} ${hoverBg}`}
                      >
                        <BookOpen size={12} className="flex-shrink-0 opacity-50" />
                        <span className="truncate">{name}</span>
                      </button>
                    ))}
                  </div>
                )}
                {/* AI duration + tag suggestion */}
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
                  ) : (
                    <div className="mt-1.5">
                      <button
                        type="button"
                        onClick={triggerTaskAISuggestion}
                        className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors ${darkMode ? 'bg-purple-500/20 hover:bg-purple-500/30 text-purple-400' : 'bg-purple-100 hover:bg-purple-200 text-purple-600'}`}
                      >
                        <Sparkles size={9} />
                        AI
                      </button>
                    </div>
                  )
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
                      setNewTask({ ...newTask, projectId: pid, ...(parentGoal?.color ? { color: parentGoal.color } : {}) });
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
              <div className="grid grid-cols-3 gap-3">
                {newTask.openInInbox ? (
                  <>
                    <div>
                      <label className={`block text-sm ${textSecondary} mb-1`}>Color</label>
                      <div className="relative color-picker-container">
                        <button
                          type="button"
                          onClick={() => setShowColorPicker(showColorPicker === 'newTask' ? null : 'newTask')}
                          className={`w-full h-10 ${newTask.color || colors[0].class} rounded-lg border ${borderClass}`}
                        />
                        {showColorPicker === 'newTask' && (
                          <div className={`absolute top-12 left-0 ${cardBg} rounded-lg p-2 shadow-xl z-20 border ${borderClass} min-w-[120px]`}>
                            <div className="grid grid-cols-3 gap-1">
                              {colors.map((color) => (
                                <button
                                  type="button"
                                  key={color.class}
                                  onClick={() => {
                                    setNewTask({ ...newTask, color: color.class });
                                    setShowColorPicker(null);
                                  }}
                                  className={`${color.class} w-8 h-8 rounded-full hover:scale-110 transition-transform`}
                                  title={color.name}
                                />
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                    <div>
                      <label className={`block text-sm ${textSecondary} mb-1`}>Priority</label>
                      <button
                        type="button"
                        onClick={() => !newTask.projectId && setNewTask({ ...newTask, priority: ((newTask.priority || 0) + 1) % 4 })}
                        disabled={!!newTask.projectId}
                        className={`w-full h-10 px-3 border ${borderClass} rounded-lg ${darkMode ? 'bg-gray-700' : 'bg-white'} flex items-center justify-center gap-1 ${newTask.projectId ? 'opacity-50 cursor-not-allowed' : ''}`}
                        title={newTask.projectId ? 'Not available for project tasks' : ['No priority', 'Low priority', 'Medium priority', 'High priority'][newTask.priority || 0]}
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
                          <div className={`absolute top-12 left-0 ${cardBg} rounded-lg shadow-xl border ${borderClass} p-2 min-w-[160px] z-20`}>
                            <div className="space-y-1">
                              <button
                                type="button"
                                onClick={() => {
                                  setNewTask({ ...newTask, deadline: dateToString(new Date()) });
                                  setShowNewTaskDeadlinePicker(false);
                                }}
                                className={`w-full text-left px-3 py-2 rounded text-sm ${textPrimary} ${hoverBg} flex items-center gap-2`}
                              >
                                <Calendar size={14} />
                                Today
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  const tomorrow = new Date();
                                  tomorrow.setDate(tomorrow.getDate() + 1);
                                  setNewTask({ ...newTask, deadline: dateToString(tomorrow) });
                                  setShowNewTaskDeadlinePicker(false);
                                }}
                                className={`w-full text-left px-3 py-2 rounded text-sm ${textPrimary} ${hoverBg} flex items-center gap-2`}
                              >
                                <Calendar size={14} />
                                Tomorrow
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  const nextWeek = new Date();
                                  nextWeek.setDate(nextWeek.getDate() + 7);
                                  setNewTask({ ...newTask, deadline: dateToString(nextWeek) });
                                  setShowNewTaskDeadlinePicker(false);
                                }}
                                className={`w-full text-left px-3 py-2 rounded text-sm ${textPrimary} ${hoverBg} flex items-center gap-2`}
                              >
                                <Calendar size={14} />
                                Next week
                              </button>
                              <div className={`border-t ${borderClass} my-1`}></div>
                              <button
                                type="button"
                                onClick={() => {
                                  setShowNewTaskDeadlinePicker(false);
                                  setDeadlinePickerTaskId('newTask');
                                }}
                                className={`w-full text-left px-3 py-2 rounded text-sm ${textPrimary} ${hoverBg} flex items-center gap-2`}
                              >
                                <Calendar size={14} />
                                Pick date...
                              </button>
                              {newTask.deadline && (
                                <>
                                  <div className={`border-t ${borderClass} my-1`}></div>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setNewTask({ ...newTask, deadline: null });
                                      setShowNewTaskDeadlinePicker(false);
                                    }}
                                    className={`w-full text-left px-3 py-2 rounded text-sm text-red-500 ${hoverBg} flex items-center gap-2`}
                                  >
                                    <X size={14} />
                                    Clear deadline
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    {/* Row 1: Color, Date, Recurrence */}
                    <div>
                      <label className={`block text-sm ${textSecondary} mb-1`}>Color</label>
                      <div className="relative color-picker-container">
                        <button
                          type="button"
                          onClick={() => setShowColorPicker(showColorPicker === 'newTask' ? null : 'newTask')}
                          className={`w-full h-10 ${newTask.color || colors[0].class} rounded-lg border ${borderClass}`}
                        />
                        {showColorPicker === 'newTask' && (
                          <div className={`absolute top-12 left-0 ${cardBg} rounded-lg p-2 shadow-xl z-20 border ${borderClass} min-w-[120px]`}>
                            <div className="grid grid-cols-3 gap-1">
                              {colors.map((color) => (
                                <button
                                  type="button"
                                  key={color.class}
                                  onClick={() => {
                                    setNewTask({ ...newTask, color: color.class });
                                    setShowColorPicker(null);
                                  }}
                                  className={`${color.class} w-8 h-8 rounded-full hover:scale-110 transition-transform`}
                                  title={color.name}
                                />
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                    <div>
                      <label className={`block text-sm ${textSecondary} mb-1`}>Date</label>
                      {(() => {
                        const isRecurringEdit = mobileEditingTask && typeof mobileEditingTask.id === 'string' && mobileEditingTask.id.startsWith('recurring-');
                        const dateDisabled = newTask.keepUnscheduled || (isRecurringEdit && (mobileEditingTask.recurrenceType === 'daily' || newTask.recurrence?.type === 'daily'));
                        return (
                          <button
                            type="button"
                            onClick={() => !dateDisabled && setShowDatePicker(true)}
                            disabled={dateDisabled}
                            className={`w-full px-3 py-2 border ${borderClass} rounded-lg text-left text-sm ${darkMode ? 'bg-gray-700 text-white' : 'bg-white'} ${dateDisabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                          >
                            {newTask.date ? new Date(newTask.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'Select'}
                          </button>
                        );
                      })()}
                    </div>
                    <div className="relative">
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
                          <div className={`absolute top-full left-0 mt-1 ${cardBg} rounded-lg shadow-xl z-30 border ${borderClass} min-w-[250px] max-h-[300px] overflow-y-auto`}>
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
                                className={`w-full text-left px-3 py-2 text-sm ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-stone-100'} ${
                                  JSON.stringify(newTask.recurrence) === JSON.stringify(preset.value) ? (darkMode ? 'bg-gray-700' : 'bg-blue-50 text-blue-700') : textPrimary
                                } ${i === 0 ? 'rounded-t-lg' : ''} ${i === presets.length - 1 ? 'rounded-b-lg' : ''}`}
                              >
                                {preset.label}
                              </button>
                            ))}
                          </div>
                        );
                      })()}
                    </div>
                    {newTask.recurrence && (
                      <div className="col-span-full">
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
                    {/* Row 2: Time, Duration, All Day */}
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
                          <option key={minutes} value={minutes}>
                            {minutes} min
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className={`block text-sm ${textSecondary} mb-1`}>All Day</label>
                      <div className={`flex items-center h-10 ${newTask.keepUnscheduled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`} onClick={() => !newTask.keepUnscheduled && setNewTask(prev => ({ ...prev, isAllDay: !prev.isAllDay }))}>
                        <div className={`w-5 h-5 rounded flex items-center justify-center border-2 transition-colors ${newTask.isAllDay ? 'bg-blue-600 border-blue-600' : darkMode ? 'border-gray-500' : 'border-stone-300'}`}>
                          {newTask.isAllDay && <Check size={14} className="text-white" strokeWidth={3} />}
                        </div>
                        <span className={`ml-2 text-sm ${textPrimary}`}>Full day</span>
                      </div>
                    </div>
                    {/* Unscheduled — only shown when a project is selected */}
                    {newTask.projectId && (
                      <div className="col-span-full">
                        <div
                          className="flex items-center gap-2 cursor-pointer"
                          onClick={() => setNewTask(prev => ({ ...prev, keepUnscheduled: !prev.keepUnscheduled }))}
                        >
                          <div className={`w-5 h-5 rounded flex items-center justify-center border-2 transition-colors flex-shrink-0 ${newTask.keepUnscheduled ? 'bg-blue-600 border-blue-600' : darkMode ? 'border-gray-500' : 'border-stone-300'}`}>
                            {newTask.keepUnscheduled && <Check size={14} className="text-white" strokeWidth={3} />}
                          </div>
                          <span className={`text-sm ${textPrimary}`}>Unscheduled</span>
                          <span className={`text-xs ${textSecondary}`}>(add to project card, no date/time)</span>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  {mobileEditingTask ? 'Save Changes' : newTask.openInInbox ? (newTask.projectId ? 'Add to Project' : 'Add to Inbox') : newTask.projectId && newTask.keepUnscheduled ? 'Add to Project' : newTask.projectId ? 'Add to Project and Schedule' : 'Add to Schedule'}
                </button>
                {mobileEditingTask && (
                  <button
                    type="button"
                    onClick={() => {
                      moveToRecycleBin(mobileEditingTask.id, mobileEditIsInbox);
                      setShowAddTask(false);
                      setMobileEditingTask(null);
                      setMobileEditIsInbox(false);
                    }}
                    className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
                  >
                    Delete
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => { setShowAddTask(false); setShowNewTaskDeadlinePicker(false); setMobileEditingTask(null); }}
                  className={`px-4 py-2 ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-stone-200 hover:bg-stone-300'} ${textPrimary} rounded-lg transition-colors`}
                >
                  Cancel
                </button>
              </div>
              {!mobileEditingTask && (
              <div className={`text-xs ${textSecondary} text-center`}>
                <kbd className={`px-1.5 py-0.5 ${darkMode ? 'bg-gray-700' : 'bg-stone-200'} rounded`}>Enter</kbd> add to {newTask.openInInbox ? 'inbox' : 'schedule'}
                {' '} • <kbd className={`px-1.5 py-0.5 ${darkMode ? 'bg-gray-700' : 'bg-stone-200'} rounded`}>Esc</kbd> cancel
              </div>
              )}
            </div>
          </form>
        </div>
  );
};

export default DesktopNewTaskModal;
