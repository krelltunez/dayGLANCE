import React from 'react';
import { Check, RefreshCw } from 'lucide-react';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { getRecurrencePresets } from '../utils/recurrenceEngine.js';

const EditRecurrenceModal = () => {
  const {
    editingRecurrenceTaskId, setEditingRecurrenceTaskId,
    recurringTasks, setRecurringTasks,
    setTasks,
    cardBg, borderClass, textPrimary, textSecondary, darkMode, hoverBg,
    setShowRecurrenceEndDatePicker,
    recordDeletedTaskTombstone,
    updateRecurrencePattern, updateRecurrenceEndCondition,
    parseRecurringId,
  } = useDayPlannerCtx();

  if (!editingRecurrenceTaskId) return null;

  const parsed = parseRecurringId(editingRecurrenceTaskId);
  if (!parsed) return null;
  const { templateId, dateStr } = parsed;
  const template = recurringTasks.find(t => t.id === templateId);
  if (!template) return null;
  const presets = getRecurrencePresets(dateStr);
  const currentRecurrence = template.recurrence;

  return (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setEditingRecurrenceTaskId(null)}>
            <div
              className={`${cardBg} rounded-lg shadow-xl p-6 ${borderClass} border max-w-sm w-full mx-4`}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 rounded-full bg-blue-100 dark:bg-blue-900/30">
                  <RefreshCw size={20} className="text-blue-600 dark:text-blue-400" />
                </div>
                <h3 className={`text-lg font-semibold ${textPrimary}`}>Edit Recurrence</h3>
              </div>
              <p className={`${textSecondary} mb-3 text-sm`}>
                {template.title}
              </p>
              <div className="flex flex-col gap-1">
                <button
                  onClick={() => {
                    // Convert recurring task to a regular scheduled task for this date
                    const isCompleted = template.completedDates?.includes(dateStr);
                    const regularTask = {
                      id: crypto.randomUUID(),
                      title: template.title,
                      startTime: template.startTime,
                      duration: template.duration,
                      color: template.color,
                      completed: isCompleted,
                      isAllDay: template.isAllDay || false,
                      notes: template.notes || '',
                      subtasks: template.subtasks ? JSON.parse(JSON.stringify(template.subtasks)) : [],
                      date: dateStr
                    };
                    setTasks(prev => [...prev, regularTask]);
                    recordDeletedTaskTombstone(templateId);
                    setRecurringTasks(prev => prev.filter(t => t.id !== templateId));
                    setEditingRecurrenceTaskId(null);
                  }}
                  className={`w-full text-left px-3 py-2 text-sm rounded-lg ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-stone-100'} ${textPrimary}`}
                >
                  None (convert to regular task)
                </button>
                <div className={`border-t ${borderClass} my-1`}></div>
                {presets.filter(p => p.value !== null).map((preset, i) => {
                  const { startDate: _s, endDate: _e, maxOccurrences: _m, ...recCore } = currentRecurrence;
                  const isActive = JSON.stringify(recCore) === JSON.stringify(preset.value);
                  return (
                    <button
                      key={i}
                      onClick={() => {
                        const endFields = {};
                        if (currentRecurrence.endDate) endFields.endDate = currentRecurrence.endDate;
                        if (currentRecurrence.maxOccurrences) endFields.maxOccurrences = currentRecurrence.maxOccurrences;
                        updateRecurrencePattern(templateId, dateStr, { ...preset.value, ...endFields });
                      }}
                      className={`w-full text-left px-3 py-2 text-sm rounded-lg ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-stone-100'} ${
                        isActive ? (darkMode ? 'bg-gray-700 text-blue-400' : 'bg-blue-50 text-blue-700') : textPrimary
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        {isActive && <Check size={14} className="flex-shrink-0" />}
                        {preset.label}
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className={`mt-3 pt-3 border-t ${borderClass}`}>
                <p className={`text-xs font-medium ${textSecondary} mb-2`}>Ends</p>
                <div className="flex flex-col gap-1">
                  <button
                    onClick={() => updateRecurrenceEndCondition(templateId, {})}
                    className={`w-full text-left px-3 py-2 text-sm rounded-lg ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-stone-100'} ${
                      !currentRecurrence.endDate && !currentRecurrence.maxOccurrences ? (darkMode ? 'bg-gray-700 text-blue-400' : 'bg-blue-50 text-blue-700') : textPrimary
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      {!currentRecurrence.endDate && !currentRecurrence.maxOccurrences && <Check size={14} className="flex-shrink-0" />}
                      Never
                    </span>
                  </button>
                  <button
                    onClick={() => setShowRecurrenceEndDatePicker({ source: 'edit', templateId })}
                    className={`w-full text-left px-3 py-2 text-sm rounded-lg ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-stone-100'} ${
                      currentRecurrence.endDate ? (darkMode ? 'bg-gray-700 text-blue-400' : 'bg-blue-50 text-blue-700') : textPrimary
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      {currentRecurrence.endDate && <Check size={14} className="flex-shrink-0" />}
                      On date
                      {currentRecurrence.endDate && <span className="ml-auto text-xs opacity-75">
                        {new Date(currentRecurrence.endDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </span>}
                    </span>
                  </button>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        if (!currentRecurrence.maxOccurrences) {
                          updateRecurrenceEndCondition(templateId, { maxOccurrences: 10 });
                        }
                      }}
                      className={`flex-1 text-left px-3 py-2 text-sm rounded-lg ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-stone-100'} ${
                        currentRecurrence.maxOccurrences ? (darkMode ? 'bg-gray-700 text-blue-400' : 'bg-blue-50 text-blue-700') : textPrimary
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        {currentRecurrence.maxOccurrences && <Check size={14} className="flex-shrink-0" />}
                        After
                      </span>
                    </button>
                    {currentRecurrence.maxOccurrences && (
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          min="1"
                          max="999"
                          value={currentRecurrence.maxOccurrences}
                          onChange={(e) => {
                            const val = parseInt(e.target.value);
                            if (val > 0) updateRecurrenceEndCondition(templateId, { maxOccurrences: val });
                          }}
                          className={`w-16 px-2 py-1 text-sm border ${borderClass} rounded ${darkMode ? 'bg-gray-700 text-white dark-spinner' : 'bg-white'}`}
                          onClick={(e) => e.stopPropagation()}
                        />
                        <span className={`text-sm ${textSecondary}`}>times</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <button
                onClick={() => setEditingRecurrenceTaskId(null)}
                className={`w-full px-4 py-2 rounded-lg ${darkMode ? 'bg-gray-700' : 'bg-stone-200'} ${textPrimary} ${hoverBg} mt-3`}
              >
                Done
              </button>
            </div>
          </div>
  );
};

export default EditRecurrenceModal;
