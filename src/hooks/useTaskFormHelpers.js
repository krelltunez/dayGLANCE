import { useState, useRef } from 'react';
import { applyTagCompletion, completeShortcutText, cleanTitle } from '../utils/suggestionParser.js';
import { extractTags } from '../utils/taskUtils.js';

export default function useTaskFormHelpers({
  tasks,
  setTasks,
  setUnscheduledTasks,
  setRecurringTasks,
  pushUndo,
  onboardingProgress,
  setOnboardingProgress,
  parseRecurringId,
  getAdjustedTimeForImportedConflicts,
  buildSuggestions,
  suggestions,
  selectedSuggestionIndex,
  showSuggestions,
  setSuggestions,
  setSelectedSuggestionIndex,
  setShowSuggestions,
  setSuggestionContext,
}) {
  const [editingTaskId, setEditingTaskId] = useState(null);
  const [editingTaskText, setEditingTaskText] = useState('');
  const editingInputRef = useRef(null);

  const startEditingTask = (task, isInbox = false) => {
    if (task.imported) return;
    setShowSuggestions(false);
    setSuggestions([]);
    setSelectedSuggestionIndex(0);
    setEditingTaskId(task.id);
    setEditingTaskText(task.title);
  };

  const cancelEditingTask = () => {
    setEditingTaskId(null);
    setEditingTaskText('');
    setShowSuggestions(false);
    setSuggestions([]);
    setSelectedSuggestionIndex(0);
  };

  const saveTaskTitle = (isInbox = false) => {
    pushUndo();
    if (!editingTaskId || !editingTaskText.trim()) {
      cancelEditingTask();
      return;
    }

    const cleanedTitle = cleanTitle(editingTaskText);

    if (typeof editingTaskId === 'string' && editingTaskId.startsWith('recurring-')) {
      const parsed = parseRecurringId(editingTaskId);
      if (parsed) {
        setRecurringTasks(prev => prev.map(t =>
          t.id === parsed.templateId ? { ...t, title: cleanedTitle } : t
        ));
      }
    } else if (isInbox) {
      setUnscheduledTasks(prev => prev.map(t =>
        t.id === editingTaskId ? { ...t, title: cleanedTitle } : t
      ));
    } else {
      setTasks(prev => prev.map(t =>
        t.id === editingTaskId ? { ...t, title: cleanedTitle } : t
      ));
    }

    if (!onboardingProgress.hasUsedTags && extractTags(editingTaskText.trim()).length > 0) {
      setOnboardingProgress(prev => ({ ...prev, hasUsedTags: true }));
    }

    setEditingTaskId(null);
    setEditingTaskText('');
    setShowSuggestions(false);
    setSuggestions([]);
    setSelectedSuggestionIndex(0);
  };

  const applySuggestionForEdit = (suggestion, inputElement, isInbox) => {
    if (suggestion.type === 'tag') {
      const cursorPos = inputElement?.selectionStart || editingTaskText.length;
      const { text: newText, newCursorPos } = applyTagCompletion(editingTaskText, cursorPos, suggestion.value);
      const textWithSpace = newText.slice(0, newCursorPos) + ' ' + newText.slice(newCursorPos);
      setEditingTaskText(textWithSpace);
      setShowSuggestions(false);
      setSuggestions([]);
      setSelectedSuggestionIndex(0);
      setTimeout(() => {
        if (inputElement) {
          inputElement.selectionStart = newCursorPos + 1;
          inputElement.selectionEnd = newCursorPos + 1;
        }
      }, 0);
    } else {
      const { text: completed, cursorPos } = completeShortcutText(editingTaskText, suggestion);
      setEditingTaskText(completed);
      if (suggestion.type === 'date' || suggestion.type === 'time') {
        if (isInbox) {
          setUnscheduledTasks(prev => prev.map(t => {
            if (t.id !== editingTaskId) return t;
            if (suggestion.type === 'date') return { ...t, scheduledDate: suggestion.value };
            return { ...t, scheduledTime: suggestion.value };
          }));
        } else if (suggestion.type === 'time') {
          const editingTask = tasks.find(t => t.id === editingTaskId);
          if (editingTask && !editingTask.isAllDay) {
            const { adjustedStartTime } = getAdjustedTimeForImportedConflicts(
              editingTaskId, suggestion.value, editingTask.duration, editingTask.date
            );
            setTasks(prev => prev.map(t =>
              t.id === editingTaskId ? { ...t, startTime: adjustedStartTime } : t
            ));
          } else {
            setTasks(prev => prev.map(t =>
              t.id === editingTaskId ? { ...t, startTime: suggestion.value } : t
            ));
          }
        } else {
          setTasks(prev => prev.map(t =>
            t.id === editingTaskId ? { ...t, date: suggestion.value } : t
          ));
        }
      } else if (suggestion.type === 'deadline' && isInbox) {
        setUnscheduledTasks(prev => prev.map(t =>
          t.id === editingTaskId ? { ...t, deadline: suggestion.value } : t
        ));
      } else if (suggestion.type === 'priority' && isInbox) {
        setUnscheduledTasks(prev => prev.map(t =>
          t.id === editingTaskId ? { ...t, priority: suggestion.value } : t
        ));
      } else if (suggestion.type === 'duration') {
        if (isInbox) {
          setUnscheduledTasks(prev => prev.map(t =>
            t.id === editingTaskId ? { ...t, duration: suggestion.value } : t
          ));
        } else {
          setTasks(prev => prev.map(t =>
            t.id === editingTaskId ? { ...t, duration: suggestion.value } : t
          ));
        }
      }
      setShowSuggestions(false);
      setSuggestions([]);
      setSelectedSuggestionIndex(0);
      setTimeout(() => {
        if (inputElement) {
          inputElement.focus();
          inputElement.selectionStart = cursorPos;
          inputElement.selectionEnd = cursorPos;
        }
      }, 0);
    }
  };

  const handleEditKeyDown = (e, isInbox = false) => {
    if (showSuggestions && suggestions.length > 0) {
      const selected = suggestions[selectedSuggestionIndex];

      if (e.key === 'Tab' || e.key === ' ') {
        e.preventDefault();
        if (selected.type === 'tag') {
          applySuggestionForEdit(selected, e.target, isInbox);
        } else {
          const inputEl = e.target;
          const { text: completed, cursorPos } = completeShortcutText(editingTaskText, selected);
          const newText = completed + ' ';
          if (selected.type === 'date' || selected.type === 'time') {
            if (isInbox) {
              setUnscheduledTasks(prev => prev.map(t => {
                if (t.id !== editingTaskId) return t;
                if (selected.type === 'date') return { ...t, scheduledDate: selected.value };
                return { ...t, scheduledTime: selected.value };
              }));
            } else if (selected.type === 'time') {
              const editingTask = tasks.find(t => t.id === editingTaskId);
              if (editingTask && !editingTask.isAllDay) {
                const { adjustedStartTime } = getAdjustedTimeForImportedConflicts(
                  editingTaskId, selected.value, editingTask.duration, editingTask.date
                );
                setTasks(prev => prev.map(t =>
                  t.id === editingTaskId ? { ...t, startTime: adjustedStartTime } : t
                ));
              } else {
                setTasks(prev => prev.map(t =>
                  t.id === editingTaskId ? { ...t, startTime: selected.value } : t
                ));
              }
            } else {
              setTasks(prev => prev.map(t =>
                t.id === editingTaskId ? { ...t, date: selected.value } : t
              ));
            }
          } else if (selected.type === 'deadline' && isInbox) {
            setUnscheduledTasks(prev => prev.map(t =>
              t.id === editingTaskId ? { ...t, deadline: selected.value } : t
            ));
          } else if (selected.type === 'priority' && isInbox) {
            setUnscheduledTasks(prev => prev.map(t =>
              t.id === editingTaskId ? { ...t, priority: selected.value } : t
            ));
          } else if (selected.type === 'duration') {
            if (isInbox) {
              setUnscheduledTasks(prev => prev.map(t =>
                t.id === editingTaskId ? { ...t, duration: selected.value } : t
              ));
            } else {
              setTasks(prev => prev.map(t =>
                t.id === editingTaskId ? { ...t, duration: selected.value } : t
              ));
            }
          }
          setEditingTaskText(newText);
          setShowSuggestions(false);
          setSuggestions([]);
          setSelectedSuggestionIndex(0);
          setTimeout(() => {
            if (inputEl) {
              const pos = cursorPos + 1;
              inputEl.selectionStart = pos;
              inputEl.selectionEnd = pos;
            }
          }, 0);
        }
        return;
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedSuggestionIndex(prev => (prev + 1) % suggestions.length);
        return;
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedSuggestionIndex(prev => (prev - 1 + suggestions.length) % suggestions.length);
        return;
      }
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      saveTaskTitle(isInbox);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelEditingTask();
    }
  };

  const handleEditInputChange = (e, isInbox = false) => {
    const value = e.target.value;
    setEditingTaskText(value);
    editingInputRef.current = e.target;

    const cursorPos = e.target.selectionStart;
    const allSuggestions = buildSuggestions(value, cursorPos, isInbox);

    const appliedTypes = new Set();
    for (const s of allSuggestions) {
      if (s.type === 'tag') continue;
      if (appliedTypes.has(s.type)) continue;
      appliedTypes.add(s.type);
      if (s.type === 'date' || s.type === 'time') {
        if (isInbox) {
          setUnscheduledTasks(prev => prev.map(t => {
            if (t.id !== editingTaskId) return t;
            if (s.type === 'date') return { ...t, scheduledDate: s.value };
            return { ...t, scheduledTime: s.value };
          }));
        } else if (s.type === 'time') {
          const editingTask = tasks.find(t => t.id === editingTaskId);
          if (editingTask && !editingTask.isAllDay) {
            const { adjustedStartTime } = getAdjustedTimeForImportedConflicts(
              editingTaskId, s.value, editingTask.duration, editingTask.date
            );
            setTasks(prev => prev.map(t =>
              t.id === editingTaskId ? { ...t, startTime: adjustedStartTime } : t
            ));
          } else {
            setTasks(prev => prev.map(t =>
              t.id === editingTaskId ? { ...t, startTime: s.value } : t
            ));
          }
        } else {
          setTasks(prev => prev.map(t =>
            t.id === editingTaskId ? { ...t, date: s.value } : t
          ));
        }
      } else if (s.type === 'deadline' && isInbox) {
        setUnscheduledTasks(prev => prev.map(t =>
          t.id === editingTaskId ? { ...t, deadline: s.value } : t
        ));
      } else if (s.type === 'priority' && isInbox) {
        setUnscheduledTasks(prev => prev.map(t =>
          t.id === editingTaskId ? { ...t, priority: s.value } : t
        ));
      } else if (s.type === 'duration') {
        if (isInbox) {
          setUnscheduledTasks(prev => prev.map(t =>
            t.id === editingTaskId ? { ...t, duration: s.value } : t
          ));
        } else {
          setTasks(prev => prev.map(t =>
            t.id === editingTaskId ? { ...t, duration: s.value } : t
          ));
        }
      }
    }

    if (allSuggestions.length > 0) {
      setSuggestions(allSuggestions);
      setSelectedSuggestionIndex(0);
      setShowSuggestions(true);
      setSuggestionContext('editing');
    } else {
      setShowSuggestions(false);
      setSuggestions([]);
    }
  };

  return {
    editingTaskId,
    setEditingTaskId,
    editingTaskText,
    setEditingTaskText,
    editingInputRef,
    startEditingTask,
    saveTaskTitle,
    cancelEditingTask,
    applySuggestionForEdit,
    handleEditKeyDown,
    handleEditInputChange,
  };
}
