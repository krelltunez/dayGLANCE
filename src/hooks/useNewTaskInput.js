import { useState, useRef, useEffect } from 'react';
import {
  getPartialTag, getFilteredTags, applyTagCompletion,
  getPartialDate, getPartialTime, getPartialDeadline,
  getPartialPriority, getPartialDuration,
  getDateCandidates, getTimeCandidates,
  completeShortcutText,
} from '../utils/suggestionParser.js';

export default function useNewTaskInput({ allTags, showAddTask }) {
  const [newTask, setNewTask] = useState({ title: '', startTime: '09:00', duration: 30 });
  const [showNewTaskDeadlinePicker, setShowNewTaskDeadlinePicker] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestionContext, setSuggestionContext] = useState(null); // 'newTask' | 'editing'
  const newTaskInputRef = useRef(null);

  // Build suggestions from text (tags, dates, times)
  // isInbox: when true, skip date (@) and time (~) suggestions since inbox tasks don't get scheduled
  const buildSuggestions = (text, cursorPos, isInbox = false) => {
    const allSuggestions = [];

    // Check for partial tag at cursor (triggered by #)
    const tagInfo = getPartialTag(text, cursorPos);
    if (tagInfo) {
      const filtered = getFilteredTags(tagInfo.tag, allTags);
      filtered.forEach(tag => {
        allSuggestions.push({
          type: 'tag',
          value: tag,
          display: tag,
          startIndex: tagInfo.startIndex,
          endIndex: cursorPos
        });
      });
    }

    // Check for partial date at cursor (triggered by @) - skip for inbox tasks
    if (!isInbox) {
      const dateInfo = getPartialDate(text, cursorPos);
      if (dateInfo) {
        const candidates = getDateCandidates(dateInfo.partial);
        for (const parsed of candidates) {
          const dateStr = `${parsed.date.getFullYear()}-${(parsed.date.getMonth() + 1).toString().padStart(2, '0')}-${parsed.date.getDate().toString().padStart(2, '0')}`;
          allSuggestions.push({
            type: 'date',
            value: dateStr,
            display: parsed.display,
            keyword: parsed.keyword,
            startIndex: dateInfo.startIndex,
            endIndex: cursorPos
          });
        }
      }
    }

    // Check for partial time at cursor (triggered by ~) - skip for inbox tasks
    if (!isInbox) {
      const timeInfo = getPartialTime(text, cursorPos);
      if (timeInfo) {
        const candidates = getTimeCandidates(timeInfo.partial);
        for (const parsed of candidates) {
          allSuggestions.push({
            type: 'time',
            value: parsed.time,
            display: parsed.display,
            keyword: parsed.keyword,
            startIndex: timeInfo.startIndex,
            endIndex: cursorPos
          });
        }
      }
    }

    // Check for partial deadline at cursor (triggered by $) - only for inbox tasks
    if (isInbox) {
      const deadlineInfo = getPartialDeadline(text, cursorPos);
      if (deadlineInfo) {
        const candidates = getDateCandidates(deadlineInfo.partial);
        for (const parsed of candidates) {
          const dateStr = `${parsed.date.getFullYear()}-${(parsed.date.getMonth() + 1).toString().padStart(2, '0')}-${parsed.date.getDate().toString().padStart(2, '0')}`;
          allSuggestions.push({
            type: 'deadline',
            value: dateStr,
            display: `Deadline: ${parsed.display}`,
            keyword: parsed.keyword,
            startIndex: deadlineInfo.startIndex,
            endIndex: cursorPos
          });
        }
      }
    }

    // Check for priority at cursor (triggered by !, !!, !!!) - only for inbox tasks
    if (isInbox) {
      const priorityInfo = getPartialPriority(text, cursorPos);
      if (priorityInfo) {
        const priorityLabels = ['Low priority (!)', 'Medium priority (!!)', 'High priority (!!!)'];
        allSuggestions.push({
          type: 'priority',
          value: priorityInfo.count,
          display: priorityLabels[priorityInfo.count - 1],
          startIndex: priorityInfo.startIndex,
          endIndex: priorityInfo.endIndex
        });
      }
    }

    // Check for duration at cursor (triggered by %) - works for both inbox and scheduled
    // Shows 15-minute increment suggestions filtered by typed digits
    const durationInfo = getPartialDuration(text, cursorPos);
    if (durationInfo) {
      const increments = [15, 30, 45, 60, 75, 90, 105, 120, 150, 180, 240];
      const typed = durationInfo.partial;
      const matching = increments.filter(m => String(m).startsWith(typed));
      for (const mins of matching.slice(0, 4)) {
        const hrs = Math.floor(mins / 60);
        const rem = mins % 60;
        const display = hrs > 0
          ? `Duration: ${hrs}h${rem > 0 ? ` ${rem}m` : ''}`
          : `Duration: ${mins}m`;
        allSuggestions.push({
          type: 'duration',
          value: mins,
          display,
          keyword: String(mins),
          startIndex: durationInfo.startIndex,
          endIndex: durationInfo.endIndex
        });
      }
    }

    return allSuggestions;
  };

  // Handle suggestions for new task input
  const handleNewTaskInputChange = (e) => {
    const value = e.target.value;
    const cursorPos = e.target.selectionStart;
    const allSuggestions = buildSuggestions(value, cursorPos, newTask.openInInbox);

    // Auto-apply attribute suggestions in real-time as the user types
    const updates = { title: value };
    for (const s of allSuggestions) {
      // Use first (best) match per type, not last
      if (s.type === 'date' && !('date' in updates)) updates.date = s.value;
      else if (s.type === 'time' && !('startTime' in updates)) updates.startTime = s.value;
      else if (s.type === 'deadline' && !('deadline' in updates)) updates.deadline = s.value;
      else if (s.type === 'priority' && !('priority' in updates)) updates.priority = s.value;
      else if (s.type === 'duration' && !('duration' in updates)) updates.duration = s.value;
    }
    setNewTask(prev => ({ ...prev, ...updates }));

    if (allSuggestions.length > 0) {
      setSuggestions(allSuggestions);
      setSelectedSuggestionIndex(0);
      setShowSuggestions(true);
      setSuggestionContext('newTask');
    } else {
      setShowSuggestions(false);
      setSuggestions([]);
    }
  };

  // Handle keyboard for new task input with suggestions
  // Tags: TAB or SPACE accepts tag completion
  // Non-tags: SPACE accepts the suggestion and inserts a space
  // ENTER always submits; ESC bubbles up to close the modal
  const handleNewTaskInputKeyDown = (e) => {
    if (showSuggestions && suggestions.length > 0) {
      const selected = suggestions[selectedSuggestionIndex];

      if (e.key === 'Tab' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        if (selected.type === 'tag') {
          applySuggestionForNewTask(selected);
        } else {
          // Autocomplete the shortcut text and append a space
          const { text: completed, cursorPos } = completeShortcutText(newTask.title, selected);
          const newTitle = completed + ' ';
          const updates = { title: newTitle };
          if (selected.type === 'date') updates.date = selected.value;
          else if (selected.type === 'time') updates.startTime = selected.value;
          else if (selected.type === 'deadline') updates.deadline = selected.value;
          else if (selected.type === 'priority') updates.priority = selected.value;
          else if (selected.type === 'duration') updates.duration = selected.value;
          setNewTask(prev => ({ ...prev, ...updates }));
          setShowSuggestions(false);
          setSuggestions([]);
          setSelectedSuggestionIndex(0);
          setTimeout(() => {
            if (newTaskInputRef.current) {
              const pos = cursorPos + 1; // after the space
              newTaskInputRef.current.selectionStart = pos;
              newTaskInputRef.current.selectionEnd = pos;
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
  };

  // Apply a suggestion for new task
  const applySuggestionForNewTask = (suggestion) => {
    if (suggestion.type === 'tag') {
      // Complete the tag
      const cursorPos = newTaskInputRef.current?.selectionStart || newTask.title.length;
      const { text: newText, newCursorPos } = applyTagCompletion(newTask.title, cursorPos, suggestion.value);
      const textWithSpace = newText.slice(0, newCursorPos) + ' ' + newText.slice(newCursorPos);
      setNewTask(prev => ({ ...prev, title: textWithSpace }));
      setShowSuggestions(false);
      setSuggestions([]);
      setSelectedSuggestionIndex(0);
      setTimeout(() => {
        if (newTaskInputRef.current) {
          newTaskInputRef.current.selectionStart = newCursorPos + 1;
          newTaskInputRef.current.selectionEnd = newCursorPos + 1;
        }
      }, 0);
    } else {
      // Autocomplete the shortcut text and apply the selected suggestion
      const { text: completed, cursorPos } = completeShortcutText(newTask.title, suggestion);
      const updates = { title: completed };
      if (suggestion.type === 'date') updates.date = suggestion.value;
      else if (suggestion.type === 'time') updates.startTime = suggestion.value;
      else if (suggestion.type === 'deadline') updates.deadline = suggestion.value;
      else if (suggestion.type === 'priority') updates.priority = suggestion.value;
      else if (suggestion.type === 'duration') updates.duration = suggestion.value;
      setNewTask(prev => ({ ...prev, ...updates }));
      setShowSuggestions(false);
      setSuggestions([]);
      setSelectedSuggestionIndex(0);
      setTimeout(() => {
        if (newTaskInputRef.current) {
          newTaskInputRef.current.focus();
          newTaskInputRef.current.selectionStart = cursorPos;
          newTaskInputRef.current.selectionEnd = cursorPos;
        }
      }, 0);
    }
  };

  // Close tag suggestions when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (showSuggestions && !e.target.closest('.tag-autocomplete-container')) {
        setShowSuggestions(false);
        setSuggestions([]);
        setSelectedSuggestionIndex(0);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showSuggestions]);

  // Reset tag suggestions when add task modal closes
  useEffect(() => {
    if (!showAddTask) {
      setShowSuggestions(false);
      setSuggestions([]);
      setSelectedSuggestionIndex(0);
    }
  }, [showAddTask]);

  return {
    newTask,
    setNewTask,
    showNewTaskDeadlinePicker,
    setShowNewTaskDeadlinePicker,
    suggestions,
    setSuggestions,
    selectedSuggestionIndex,
    setSelectedSuggestionIndex,
    showSuggestions,
    setShowSuggestions,
    suggestionContext,
    setSuggestionContext,
    newTaskInputRef,
    buildSuggestions,
    handleNewTaskInputChange,
    handleNewTaskInputKeyDown,
    applySuggestionForNewTask,
  };
}
