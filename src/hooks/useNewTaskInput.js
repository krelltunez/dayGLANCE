import { useState, useRef, useEffect } from 'react';
import {
  getPartialTag, getFilteredTags, applyTagCompletion,
  getPartialDate, getPartialTime, getPartialDeadline,
  getPartialPriority, getPartialDuration,
  getDateCandidates, getTimeCandidates,
  completeShortcutText,
} from '../utils/suggestionParser.js';
import { parseQuickAdd, spanSignature } from '../utils/quickAddParser.js';

// Deep-enough equality for NL-applied values (strings, numbers, small
// recurrence objects). Used to detect whether the user manually changed a
// field after the NL layer set it.
const sameVal = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export default function useNewTaskInput({ allTags, showAddTask, isEditing = false }) {
  const [newTask, setNewTask] = useState({ title: '', startTime: '09:00', duration: 30 });
  // Natural-language layer bookkeeping:
  // - dismissedNlRef: span signatures the user rejected via chip tap — those
  //   phrases stay plain text until the input is next reset.
  // - nlAppliedRef / nlBaselineRef: per-field record of what the NL layer set
  //   and what the field held before, so removing a chip (dismiss OR editing
  //   the phrase away) reverts the field — unless the user changed it manually
  //   in the meantime (then the user's value wins).
  const dismissedNlRef = useRef(new Set());
  const nlAppliedRef = useRef({});
  const nlBaselineRef = useRef({});
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

  // ── Natural-language layer ────────────────────────────────────────────────
  // Parses bare phrases ("tomorrow 3pm every 2 weeks") into chips + task
  // fields. Runs alongside the sigil system: sigil regions are masked inside
  // parseQuickAdd, and sigil auto-apply runs AFTER (explicit syntax wins).

  // Parse `title`, drop dismissed/mode-inapplicable spans, and return the
  // task patched with applied fields + chip/strip metadata.
  const applyNlLayer = (prev, title) => {
    // NL parsing is for CREATING tasks only. When editing an existing task,
    // typing "tomorrow" into a title must never silently reschedule it.
    if (isEditing) {
      return { ...prev, title, nlChips: [], nlSpans: [] };
    }
    const isInbox = !!prev.openInInbox;
    let spans = parseQuickAdd(title).spans
      .filter(s => !dismissedNlRef.current.has(spanSignature(s)));
    // Inbox tasks aren't scheduled or recurring: only tags, a deadline-style
    // date, and duration make sense there.
    if (isInbox) spans = spans.filter(s => ['tag', 'date', 'duration'].includes(s.type));

    const bySpanType = (t) => spans.find(s => s.type === t);
    const dateSpan = bySpanType('date');
    const timeSpan = bySpanType('time');
    const rangeSpan = bySpanType('timerange');
    const durSpan = bySpanType('duration');
    const recSpan = bySpanType('recurrence');

    // Desired field values from the current spans.
    const desired = {};
    if (isInbox) {
      if (dateSpan) desired.deadline = dateSpan.value;
      if (durSpan) desired.duration = durSpan.value;
    } else {
      if (dateSpan) desired.date = dateSpan.value;
      if (rangeSpan) {
        desired.startTime = rangeSpan.value.startTime;
        desired.duration = rangeSpan.value.duration;
      }
      if (timeSpan) desired.startTime = timeSpan.value;
      else if (!rangeSpan) {
        const implied = dateSpan?.impliedTime || recSpan?.impliedTime;
        if (implied) desired.startTime = implied;
      }
      if (durSpan) desired.duration = durSpan.value;
      if (recSpan) desired.recurrence = recSpan.value;
    }

    // Apply new values / revert vanished ones. A field is only touched while
    // it still holds what the NL layer last wrote — manual edits win.
    const next = { ...prev, title };
    const applied = nlAppliedRef.current;
    const baselines = nlBaselineRef.current;
    for (const f of ['date', 'startTime', 'duration', 'recurrence', 'deadline']) {
      if (f in desired) {
        if (!(f in applied)) baselines[f] = prev[f]; // first claim → remember what to restore
        if (!(f in applied) || sameVal(prev[f], applied[f])) {
          next[f] = desired[f];
          applied[f] = desired[f];
        }
      } else if (f in applied) {
        if (sameVal(prev[f], applied[f])) next[f] = baselines[f];
        delete applied[f];
        delete baselines[f];
      }
    }
    if ('startTime' in desired && prev.isAllDay) next.isAllDay = false;

    // Chips for the UI (tags included); spans to strip from the title at save
    // (tags excluded — tag text stays in the title by app convention).
    next.nlChips = spans.map(s => ({ ...s, sig: spanSignature(s), inboxDate: isInbox && s.type === 'date' }));
    next.nlSpans = spans.filter(s => s.type !== 'tag');
    return next;
  };

  // Chip tap = undo that parse. Non-tag chips: remember the dismissal (the
  // phrase stays plain text) and revert the field. Tag chips: delete the #tag
  // token from the title itself.
  const dismissNlChip = (chip) => {
    if (chip.type === 'tag') {
      setNewTask(prev => {
        const title = (prev.title.slice(0, chip.start) + prev.title.slice(chip.end))
          .replace(/\s{2,}/g, ' ').trimStart();
        return applyNlLayer(prev, title);
      });
      newTaskInputRef.current?.focus();
      return;
    }
    dismissedNlRef.current.add(chip.sig);
    setNewTask(prev => applyNlLayer(prev, prev.title));
    newTaskInputRef.current?.focus();
  };

  // Handle suggestions for new task input
  const handleNewTaskInputChange = (e) => {
    const value = e.target.value;
    const cursorPos = e.target.selectionStart;
    const allSuggestions = buildSuggestions(value, cursorPos, newTask.openInInbox);

    // Auto-apply sigil suggestions in real-time as the user types
    const updates = {};
    for (const s of allSuggestions) {
      // Use first (best) match per type, not last
      if (s.type === 'date' && !('date' in updates)) updates.date = s.value;
      else if (s.type === 'time' && !('startTime' in updates)) updates.startTime = s.value;
      else if (s.type === 'deadline' && !('deadline' in updates)) updates.deadline = s.value;
      else if (s.type === 'priority' && !('priority' in updates)) updates.priority = s.value;
      else if (s.type === 'duration' && !('duration' in updates)) updates.duration = s.value;
    }
    // NL layer first, sigil updates second — explicit sigil syntax wins.
    setNewTask(prev => ({ ...applyNlLayer(prev, value), ...updates }));

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

  // Reset tag suggestions and NL-layer bookkeeping when add task modal closes
  useEffect(() => {
    if (!showAddTask) {
      setShowSuggestions(false);
      setSuggestions([]);
      setSelectedSuggestionIndex(0);
      dismissedNlRef.current = new Set();
      nlAppliedRef.current = {};
      nlBaselineRef.current = {};
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
    dismissNlChip,
  };
}
