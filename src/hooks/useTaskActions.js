import { cleanTitle } from '../utils/suggestionParser.js';
import { dateToString, extractTags, formatDeadlineDate } from '../utils/taskUtils.js';
import { TASK_COLORS } from '../utils/colorUtils.js';

// Strip a specific tag (e.g. "#obsidian") from a title string.
const stripTag = (title, tag) =>
  title.replace(new RegExp(`#${tag}\\b`, 'gi'), '').replace(/\s+/g, ' ').trim();

// Pure local helpers (no state dependencies)
const getNextQuarterHour = () => {
  const now = new Date();
  const minutes = now.getMinutes();
  const nextQuarter = Math.ceil(minutes / 15) * 15;
  if (nextQuarter === 60) {
    now.setHours(now.getHours() + 1);
    now.setMinutes(0);
  } else {
    now.setMinutes(nextQuarter);
  }
  return `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
};

const timeToMinutes = (time) => {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
};

const minutesToTime = (minutes) => {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
};

const recordDeletedTaskTombstone = (taskId) => {
  const tombstones = JSON.parse(localStorage.getItem('day-planner-deleted-task-ids') || '{}');
  tombstones[String(taskId)] = new Date().toISOString();
  localStorage.setItem('day-planner-deleted-task-ids', JSON.stringify(tombstones));
};

export default function useTaskActions({
  tasks, setTasks,
  unscheduledTasks, setUnscheduledTasks,
  recurringTasks, setRecurringTasks,
  recycleBin, setRecycleBin,
  completedTaskUids, setCompletedTaskUids,
  selectedDate,
  onboardingProgress, setOnboardingProgress,
  pushUndo,
  playUISound,
  parseRecurringId,
  getAdjustedTimeForImportedConflicts,
  newTask, setNewTask,
  setShowAddTask,
  setShowRecurrencePicker,
  expandedNotesTaskId, setExpandedNotesTaskId,
  setSyncNotification,
  setUndoToast,
  setShowColorPicker,
  setShowDeadlinePicker,
  recurringDeleteConfirm, setRecurringDeleteConfirm,
  hoverPreviewTime, hoverPreviewDate, setHoverPreviewTime, setHoverPreviewDate,
  swipeSchedulingInboxTaskId,
  syncTaskCompletionToCalDAV,
  computeAvailableSlots,
  activeFrameNudgeKey, setFrameNudgeDismissedKey,
  frameScheduleModal, setFrameScheduleModal,
  focusBlockTasks, setFocusBlockTasks,
  focusCompletedTasks, setFocusCompletedTasks,
  exitFocusModeRef,
  playFocusSound,
  // Obsidian integration.
  // getObsidianTaskMeta(rawTitle) → { id, importSource, obsidianRawTitle, obsidianFileDate }
  // Used synchronously at task-creation time so the task gets the obsidian-format
  // ID from the start, letting the next periodic sync de-duplicate instead of cloning.
  getObsidianTaskMeta,
  onWriteObsidianTask,
}) {
  const colors = TASK_COLORS;

  // Helper to update a recurring task template by ID
  const updateRecurringTemplate = (taskId, updater) => {
    const parsed = parseRecurringId(taskId);
    if (parsed) {
      setRecurringTasks(prev => prev.map(t => t.id === parsed.templateId ? updater(t) : t));
    }
  };

  // ── Deadline management ──────────────────────────────────────────────────

  const setDeadline = (taskId, deadline) => {
    pushUndo();
    setUnscheduledTasks(prev => prev.map(t =>
      t.id === taskId ? { ...t, deadline } : t
    ));
    setShowDeadlinePicker(null);
    if (!onboardingProgress.hasAddedDeadline) {
      setOnboardingProgress(prev => ({ ...prev, hasAddedDeadline: true }));
    }
  };

  const postponeDeadlineTask = (taskId) => {
    const task = unscheduledTasks.find(t => t.id === taskId);
    if (!task || !task.deadline) return;
    const nextDay = new Date(task.deadline + 'T12:00:00');
    nextDay.setDate(nextDay.getDate() + 1);
    const nextDateStr = nextDay.toISOString().split('T')[0];
    pushUndo();
    setUnscheduledTasks(prev => prev.map(t =>
      t.id === taskId ? { ...t, deadline: nextDateStr } : t
    ));
    setUndoToast({ message: 'Deadline postponed to ' + formatDeadlineDate(nextDateStr), actionable: true });
    playUISound('slide');
  };

  const clearDeadline = (taskId) => {
    pushUndo();
    setUnscheduledTasks(prev => prev.map(t =>
      t.id === taskId ? { ...t, deadline: null } : t
    ));
    setShowDeadlinePicker(null);
  };

  // ── Task creation ────────────────────────────────────────────────────────

  const addTask = (toInbox = false) => {
    if (newTask.title.trim()) {
      pushUndo();

      // Determine whether this task should be linked to an Obsidian daily note.
      // Recurring and swipe-scheduling paths are excluded: recurring tasks use
      // their own ID scheme; swipe-scheduling preserves an existing task's ID.
      const tags = extractTags(newTask.title);
      const hasObsidianTag = tags.includes('obsidian');
      const isRecurring = !!newTask.recurrence;
      const isSwipeSchedule = !!swipeSchedulingInboxTaskId.current;
      const rawObsidianTitle = hasObsidianTag ? stripTag(cleanTitle(newTask.title), 'obsidian') : null;
      // Skip if stripping the tag leaves an empty title (e.g. task titled only "#obsidian")
      const obsidianMeta = (hasObsidianTag && rawObsidianTitle && !isRecurring && !isSwipeSchedule && getObsidianTaskMeta)
        ? getObsidianTaskMeta(rawObsidianTitle)
        : null;

      const taskId = obsidianMeta?.id ?? crypto.randomUUID();
      // Tracks the conflict-adjusted start time set by the scheduled branch so the
      // vault write uses the same time that ends up in DG state, not the raw input.
      let scheduledAdjustedStartTime = newTask.startTime || null;
      const task = {
        id: taskId,
        title: cleanTitle(newTask.title),
        duration: newTask.duration,
        color: newTask.color || colors[0].class,
        completed: false,
        isAllDay: newTask.isAllDay || false,
        notes: '',
        subtasks: [],
        ...(obsidianMeta ?? {}),
        ...(newTask.projectId ? { projectId: newTask.projectId } : {}),
      };

      if (toInbox) {
        const inboxTask = { ...task, priority: newTask.priority ?? 0 };
        if (newTask.deadline) {
          inboxTask.deadline = newTask.deadline;
        }
        setUnscheduledTasks(prev => [...prev, inboxTask]);
      } else if (newTask.keepUnscheduled && newTask.projectId) {
        // Save as unscheduled project task (no scheduling)
        setUnscheduledTasks(prev => [...prev, task]);
      } else if (newTask.recurrence) {
        // Create recurring task template
        const taskDate = newTask.date || dateToString(selectedDate);
        const template = {
          id: taskId,
          title: cleanTitle(newTask.title),
          startTime: newTask.isAllDay ? '00:00' : newTask.startTime,
          duration: newTask.duration,
          color: newTask.color || colors[0].class,
          isAllDay: newTask.isAllDay || false,
          notes: '',
          subtasks: [],
          recurrence: { ...newTask.recurrence, startDate: taskDate },
          completedDates: [],
          exceptions: {}
        };
        setRecurringTasks(prev => [...prev, template]);
        if (!onboardingProgress.hasCreatedRecurring) {
          setOnboardingProgress(prev => ({ ...prev, hasCreatedRecurring: true }));
        }
      } else if (swipeSchedulingInboxTaskId.current) {
        // Scheduling from inbox swipe: move existing task (preserve ID, notes, subtasks)
        const inboxId = swipeSchedulingInboxTaskId.current;
        const inboxTask = unscheduledTasks.find(t => t.id === inboxId);
        swipeSchedulingInboxTaskId.current = null;
        if (inboxTask) {
          const requestedStartTime = newTask.isAllDay ? '00:00' : newTask.startTime;
          const taskDate = newTask.date || dateToString(selectedDate);
          const { conflicted, adjustedStartTime, conflictingEvent } = newTask.isAllDay
            ? { conflicted: false, adjustedStartTime: requestedStartTime, conflictingEvent: null }
            : getAdjustedTimeForImportedConflicts(inboxTask.id, requestedStartTime, newTask.duration, taskDate);
          const { priority, deadline, ...preserved } = inboxTask;
          setTasks(prev => [...prev, {
            ...preserved,
            title: cleanTitle(newTask.title),
            duration: newTask.duration,
            color: newTask.color || colors[0].class,
            isAllDay: newTask.isAllDay || false,
            startTime: adjustedStartTime,
            date: taskDate
          }]);
          setUnscheduledTasks(prev => prev.filter(t => t.id !== inboxId));
          if (conflicted && conflictingEvent) {
            setSyncNotification({
              type: 'info',
              title: 'Task Rescheduled',
              message: `Task moved to ${adjustedStartTime} to avoid conflict with "${conflictingEvent.title}"`
            });
          }
          if (!onboardingProgress.hasDraggedToTimeline) {
            setOnboardingProgress(prev => ({ ...prev, hasDraggedToTimeline: true }));
          }
        }
      } else {
        const requestedStartTime = newTask.isAllDay ? '00:00' : newTask.startTime;
        const taskDate = newTask.date || dateToString(selectedDate);

        const { conflicted, adjustedStartTime, conflictingEvent } = newTask.isAllDay
          ? { conflicted: false, adjustedStartTime: requestedStartTime, conflictingEvent: null }
          : getAdjustedTimeForImportedConflicts(taskId, requestedStartTime, newTask.duration, taskDate);

        scheduledAdjustedStartTime = adjustedStartTime;
        setTasks(prev => [...prev, {
          ...task,
          startTime: adjustedStartTime,
          date: taskDate
        }]);

        if (conflicted && conflictingEvent) {
          setSyncNotification({
            type: 'info',
            title: 'Task Rescheduled',
            message: `Task moved to ${adjustedStartTime} to avoid conflict with "${conflictingEvent.title}"`
          });
        }
      }

      // If the task is tagged #obsidian, write it to today's daily note
      if (obsidianMeta && onWriteObsidianTask) {
        onWriteObsidianTask({
          title: rawObsidianTitle,
          startTime: toInbox || newTask.isAllDay ? null : scheduledAdjustedStartTime,
          duration: toInbox ? null : (newTask.duration || null),
          isAllDay: !toInbox && (newTask.isAllDay || false),
          date: toInbox ? null : (newTask.date || dateToString(selectedDate)),
        });
      }

      setNewTask({ title: '', startTime: getNextQuarterHour(), duration: 30, date: dateToString(selectedDate), isAllDay: false, recurrence: null });
      setShowAddTask(false);

      if (toInbox && !onboardingProgress.hasAddedInboxTask) {
        setOnboardingProgress(prev => ({ ...prev, hasAddedInboxTask: true }));
      }
      if (!toInbox && !onboardingProgress.hasAddedScheduledTask) {
        setOnboardingProgress(prev => ({ ...prev, hasAddedScheduledTask: true }));
      }
      if (!onboardingProgress.hasUsedTags && extractTags(newTask.title).length > 0) {
        setOnboardingProgress(prev => ({ ...prev, hasUsedTags: true }));
      }
      playUISound('pop');
    }
  };

  const openNewTaskForm = () => {
    setNewTask({
      title: '',
      startTime: hoverPreviewTime || getNextQuarterHour(),
      duration: 30,
      date: hoverPreviewDate ? dateToString(hoverPreviewDate) : dateToString(selectedDate),
      isAllDay: false,
      recurrence: null
    });
    setHoverPreviewTime(null);
    setHoverPreviewDate(null);
    setShowRecurrencePicker(false);
    setShowAddTask(true);
  };

  const openNewInboxTask = () => {
    setNewTask({
      title: '',
      startTime: getNextQuarterHour(),
      duration: 30,
      date: dateToString(selectedDate),
      isAllDay: false,
      openInInbox: true,
      deadline: null,
      priority: 0
    });
    setShowAddTask(true);
  };

  // ── Task update ──────────────────────────────────────────────────────────

  const changeTaskColor = (taskId, newColor, fromInbox = false) => {
    pushUndo();
    if (typeof taskId === 'string' && taskId.startsWith('recurring-')) {
      const parsed = parseRecurringId(taskId);
      if (parsed) {
        setRecurringTasks(prev => prev.map(t =>
          t.id === parsed.templateId ? { ...t, color: newColor } : t
        ));
      }
      setShowColorPicker(null);
      return;
    }

    if (fromInbox) {
      setUnscheduledTasks(prev => prev.map(task =>
        task.id === taskId ? { ...task, color: newColor } : task
      ));
    } else {
      setTasks(prev => prev.map(task =>
        task.id === taskId ? { ...task, color: newColor } : task
      ));
    }
    setShowColorPicker(null);
    if (!onboardingProgress.hasUsedActionButtons) {
      setOnboardingProgress(prev => ({ ...prev, hasUsedActionButtons: true }));
    }
  };

  const updateTaskNotes = (taskId, notes, isInbox) => {
    if (typeof taskId === 'string' && taskId.startsWith('recurring-')) {
      const parsed = parseRecurringId(taskId);
      if (parsed) {
        setRecurringTasks(prev => prev.map(t =>
          t.id === parsed.templateId ? { ...t, notes } : t
        ));
      }
    } else if (isInbox) {
      setUnscheduledTasks(prev => prev.map(t =>
        t.id === taskId ? { ...t, notes } : t
      ));
    } else {
      setTasks(prev => prev.map(t =>
        t.id === taskId ? { ...t, notes } : t
      ));
    }
    if (!onboardingProgress.hasAddedNotes && notes && notes.trim()) {
      setOnboardingProgress(prev => ({ ...prev, hasAddedNotes: true }));
    }
  };

  const updateRecurrencePattern = (templateId, dateStr, newRecurrence) => {
    setRecurringTasks(prev => prev.map(t => {
      if (t.id !== templateId) return t;
      const origStart = t.recurrence.startDate;
      const earlierDate = origStart <= dateStr ? origStart : dateStr;
      const newStart = earlierDate.substring(0, 8) + '01';
      return { ...t, recurrence: { ...newRecurrence, startDate: newStart } };
    }));
  };

  const updateRecurrenceEndCondition = (templateId, { endDate, maxOccurrences }) => {
    setRecurringTasks(prev => prev.map(t => {
      if (t.id !== templateId) return t;
      const updated = { ...t.recurrence };
      delete updated.endDate;
      delete updated.maxOccurrences;
      if (endDate) updated.endDate = endDate;
      if (maxOccurrences) updated.maxOccurrences = maxOccurrences;
      return { ...t, recurrence: updated };
    }));
  };

  // ── Task completion ──────────────────────────────────────────────────────

  const toggleComplete = (id, fromInbox = false) => {
    pushUndo();
    playUISound('tick');
    if (navigator.vibrate) navigator.vibrate(30);
    if (typeof id === 'string' && id.startsWith('recurring-')) {
      const { templateId, dateStr } = parseRecurringId(id);
      setRecurringTasks(prev => prev.map(t => {
        if (t.id !== templateId) return t;
        const completed = (t.completedDates || []).includes(dateStr);
        return {
          ...t,
          completedDates: completed
            ? (t.completedDates || []).filter(d => d !== dateStr)
            : [...(t.completedDates || []), dateStr]
        };
      }));
      if (!onboardingProgress.hasCompletedTask) {
        setOnboardingProgress(prev => ({ ...prev, hasCompletedTask: true }));
      }
      const wasCompleted = recurringTasks.find(t => t.id === templateId)?.completedDates?.includes(dateStr);
      if (!wasCompleted) {
        setUndoToast({ message: 'Task completed', actionable: true });
      }
      return;
    }

    const taskToToggle = fromInbox
      ? unscheduledTasks.find(t => t.id === id)
      : tasks.find(t => t.id === id);
    if (!onboardingProgress.hasCompletedTask && taskToToggle && !taskToToggle.completed) {
      setOnboardingProgress(prev => ({ ...prev, hasCompletedTask: true }));
    }

    if (fromInbox) {
      setUnscheduledTasks(prev => prev.map(task =>
        task.id === id ? { ...task, completed: !task.completed, completedAt: !task.completed ? dateToString(new Date()) : null } : task
      ));
    } else {
      const task = tasks.find(t => t.id === id);
      if (task?.isTaskCalendar && task?.icalUid) {
        const completionKey = task.icalUid + '::' + task.date;
        const newCompleted = !task.completed;
        setCompletedTaskUids(prev => {
          const newSet = new Set(prev);
          if (task.completed) {
            newSet.delete(completionKey);
          } else {
            newSet.add(completionKey);
          }
          return newSet;
        });
        syncTaskCompletionToCalDAV(task.icalUid, newCompleted, {
          isRecurring: task.isRecurringSeries,
          date: task.date,
          startTime: task.startTime,
          isAllDay: task.isAllDay
        });
      }
      setTasks(prev => prev.map(task =>
        task.id === id ? { ...task, completed: !task.completed } : task
      ));
    }
    if (taskToToggle && !taskToToggle.completed) {
      setUndoToast({ message: 'Task completed', actionable: true });
    }
  };

  // ── Task move ────────────────────────────────────────────────────────────

  const postponeTask = (id) => {
    if (typeof id === 'string' && id.startsWith('recurring-')) {
      const parsed = parseRecurringId(id);
      if (!parsed) return;
      const template = recurringTasks.find(t => t.id === parsed.templateId);
      if (!template) return;
      if (template.recurrence?.type === 'daily') return; // daily tasks recur tomorrow anyway
      const exc = template.exceptions?.[parsed.dateStr] || {};
      const title = exc.title || template.title;
      const startTime = exc.startTime !== undefined ? exc.startTime : (template.startTime || '');
      const duration = exc.duration !== undefined ? exc.duration : (template.duration ?? 30);
      const color = exc.color || template.color;
      const isAllDay = exc.isAllDay !== undefined ? exc.isAllDay : (template.isAllDay ?? false);
      if (!startTime && !isAllDay) return;
      const nextDay = new Date(parsed.dateStr + 'T12:00:00');
      nextDay.setDate(nextDay.getDate() + 1);
      const nextDateStr = dateToString(nextDay);
      pushUndo();
      setRecurringTasks(prev => prev.map(t => t.id !== parsed.templateId ? t : {
        ...t,
        exceptions: { ...t.exceptions, [parsed.dateStr]: { ...(t.exceptions?.[parsed.dateStr] || {}), skipped: true } },
      }));
      setTasks(prev => [...prev, {
        id: crypto.randomUUID(), title,
        startTime: isAllDay ? '00:00' : startTime, duration, color,
        isAllDay, date: nextDateStr, completed: false, notes: '', subtasks: [],
      }]);
      setUndoToast({ message: 'Task postponed to tomorrow', actionable: true });
      playUISound('slide');
      return;
    }
    const task = tasks.find(t => t.id === id);
    if (!task || !task.startTime || !task.date) return;

    const nextDay = new Date(task.date + 'T12:00:00');
    nextDay.setDate(nextDay.getDate() + 1);
    const nextDateStr = nextDay.toISOString().split('T')[0];

    const { conflicted, conflictingEvent } = getAdjustedTimeForImportedConflicts(
      id, task.startTime, task.duration, nextDateStr
    );

    if (conflicted) {
      playUISound('error');
      setSyncNotification({
        type: 'error',
        title: "Can't Postpone",
        message: `Time slot conflicts with "${conflictingEvent?.title || 'a calendar event'}" on ${nextDateStr}`
      });
      return;
    }

    pushUndo();
    setTasks(prev => prev.map(t =>
      t.id === id ? { ...t, date: nextDateStr } : t
    ));
    setUndoToast({ message: 'Task postponed to tomorrow', actionable: true });
    playUISound('slide');
    if (!onboardingProgress.hasUsedActionButtons) {
      setOnboardingProgress(prev => ({ ...prev, hasUsedActionButtons: true }));
    }
  };

  const moveToInbox = (id) => {
    pushUndo();
    if (typeof id === 'string' && id.startsWith('recurring-')) return;
    const task = tasks.find(t => t.id === id);
    if (!task || task.imported) return;

    const unscheduledTask = {
      ...task,
      startTime: null,
      date: null,
      isAllDay: false,
      priority: task.priority || 0,
      lastModified: new Date().toISOString(),
    };

    setTasks(prev => prev.filter(t => t.id !== id));
    setUnscheduledTasks(prev => [...prev, unscheduledTask]);
    playUISound('slide');
    setUndoToast({ message: 'Moved to inbox', actionable: true });
    if (!onboardingProgress.hasUsedActionButtons) {
      setOnboardingProgress(prev => ({ ...prev, hasUsedActionButtons: true }));
    }
  };

  // ── Subtask management ───────────────────────────────────────────────────

  const addSubtask = (taskId, title, isInbox, extraFields = {}) => {
    if (!title.trim()) return;
    pushUndo();
    const newSubtask = {
      id: crypto.randomUUID(),
      title: title.trim(),
      completed: false,
      ...extraFields,
    };
    if (typeof taskId === 'string' && taskId.startsWith('recurring-')) {
      updateRecurringTemplate(taskId, t => ({ ...t, subtasks: [...(t.subtasks || []), newSubtask] }));
    } else if (isInbox) {
      setUnscheduledTasks(prev => prev.map(t =>
        t.id === taskId ? { ...t, subtasks: [...(t.subtasks || []), newSubtask] } : t
      ));
    } else {
      setTasks(prev => prev.map(t =>
        t.id === taskId ? { ...t, subtasks: [...(t.subtasks || []), newSubtask] } : t
      ));
    }
    if (!onboardingProgress.hasAddedNotes) {
      setOnboardingProgress(prev => ({ ...prev, hasAddedNotes: true }));
    }
    return newSubtask;
  };

  const toggleSubtask = (taskId, subtaskId, isInbox) => {
    pushUndo();
    const subtaskUpdater = t => ({
      ...t,
      subtasks: (t.subtasks || []).map(st =>
        st.id === subtaskId ? { ...st, completed: !st.completed } : st
      )
    });
    if (typeof taskId === 'string' && taskId.startsWith('recurring-')) {
      updateRecurringTemplate(taskId, subtaskUpdater);
    } else if (isInbox) {
      setUnscheduledTasks(prev => prev.map(t => t.id === taskId ? subtaskUpdater(t) : t));
    } else {
      setTasks(prev => prev.map(t => t.id === taskId ? subtaskUpdater(t) : t));
    }
  };

  const deleteSubtask = (taskId, subtaskId, isInbox) => {
    pushUndo();
    const subtaskUpdater = t => ({
      ...t,
      subtasks: (t.subtasks || []).filter(st => st.id !== subtaskId)
    });
    if (typeof taskId === 'string' && taskId.startsWith('recurring-')) {
      updateRecurringTemplate(taskId, subtaskUpdater);
    } else if (isInbox) {
      setUnscheduledTasks(prev => prev.map(t => t.id === taskId ? subtaskUpdater(t) : t));
    } else {
      setTasks(prev => prev.map(t => t.id === taskId ? subtaskUpdater(t) : t));
    }
  };

  const updateSubtaskTitle = (taskId, subtaskId, newTitle, isInbox) => {
    pushUndo();
    const subtaskUpdater = t => ({
      ...t,
      subtasks: (t.subtasks || []).map(st =>
        st.id === subtaskId ? { ...st, title: newTitle } : st
      )
    });
    if (typeof taskId === 'string' && taskId.startsWith('recurring-')) {
      updateRecurringTemplate(taskId, subtaskUpdater);
    } else if (isInbox) {
      setUnscheduledTasks(prev => prev.map(t => t.id === taskId ? subtaskUpdater(t) : t));
    } else {
      setTasks(prev => prev.map(t => t.id === taskId ? subtaskUpdater(t) : t));
    }
  };

  // ── Task deletion ────────────────────────────────────────────────────────

  const moveToRecycleBin = (id, fromInbox = false) => {
    if (typeof id === 'string' && id.startsWith('recurring-')) {
      const parsed = parseRecurringId(id);
      if (parsed) {
        setRecurringDeleteConfirm({ taskId: parsed.templateId, dateStr: parsed.dateStr });
      }
      return;
    }

    pushUndo();
    const taskInScheduled = tasks.find(t => t.id === id);
    const taskInInbox = unscheduledTasks.find(t => t.id === id);
    const task = fromInbox ? taskInInbox : (taskInScheduled || taskInInbox);
    const actuallyInInbox = !!taskInInbox && !taskInScheduled;

    if (task) {
      if (expandedNotesTaskId === id) {
        setExpandedNotesTaskId(null);
      }
      const taskWithMeta = {
        ...task,
        _deletedFrom: actuallyInInbox ? 'inbox' : 'calendar',
        deletedAt: new Date().toISOString()
      };
      setRecycleBin(prev => [...prev, taskWithMeta]);
      if (actuallyInInbox) {
        setUnscheduledTasks(prev => prev.filter(t => t.id !== id));
      } else {
        setTasks(prev => prev.filter(t => t.id !== id));
      }
      playUISound('swoosh');
      if (navigator.vibrate) navigator.vibrate([30, 50, 30]);
      setUndoToast({ message: 'Task deleted', actionable: true });
      if (!onboardingProgress.hasUsedActionButtons) {
        setOnboardingProgress(prev => ({ ...prev, hasUsedActionButtons: true }));
      }
    }
  };

  const deleteRecurringInstance = (mode) => {
    if (!recurringDeleteConfirm) return;
    pushUndo();
    const { taskId, dateStr } = recurringDeleteConfirm;

    if (mode === 'this') {
      setRecurringTasks(prev => prev.map(t => {
        if (t.id !== taskId) return t;
        return { ...t, exceptions: { ...t.exceptions, [dateStr]: { deleted: true } } };
      }));
    } else if (mode === 'future') {
      const dayBefore = new Date(dateStr + 'T12:00:00');
      dayBefore.setDate(dayBefore.getDate() - 1);
      const endDate = dateToString(dayBefore);
      setRecurringTasks(prev => prev.map(t => {
        if (t.id !== taskId) return t;
        return { ...t, recurrence: { ...t.recurrence, endDate } };
      }));
    } else if (mode === 'series') {
      recordDeletedTaskTombstone(taskId);
      setRecurringTasks(prev => prev.filter(t => t.id !== taskId));
    }

    setRecurringDeleteConfirm(null);
  };

  // ── Scheduling ───────────────────────────────────────────────────────────

  const scheduleTaskAtNextSlot = (taskId, isInbox) => {
    const now = new Date();
    const totalMinutes = now.getHours() * 60 + now.getMinutes();
    const nextSlotMinutes = Math.ceil((totalMinutes + 1) / 15) * 15;
    const nextSlotTime = minutesToTime(nextSlotMinutes);
    const todayStr = dateToString(now);
    if (isInbox) {
      const task = unscheduledTasks.find(t => t.id === taskId);
      if (!task) return;
      setUnscheduledTasks(prev => prev.filter(t => t.id !== taskId));
      setTasks(prev => [...prev, { ...task, startTime: nextSlotTime, date: todayStr, isAllDay: false }]);
    } else {
      setTasks(prev => prev.map(t => t.id === taskId ? { ...t, startTime: nextSlotTime, date: todayStr } : t));
    }
    setFrameNudgeDismissedKey(activeFrameNudgeKey);
    playUISound('tick');
  };

  const manuallyScheduleTask = (taskId) => {
    if (!frameScheduleModal) return;
    const { frameId, dateStr, frame } = frameScheduleModal;
    const task = unscheduledTasks.find(t => t.id === taskId);
    if (!task) return;

    const frameInstance = {
      frameId,
      date: dateStr,
      start: frame.start,
      end: frame.end,
      bufferMinutes: frame.bufferMinutes ?? 5,
    };
    const slots = computeAvailableSlots(frameInstance, new Date(dateStr + 'T12:00:00'));
    const taskDuration = task.duration || 30;

    const slot = slots.find(s => s.minutes >= taskDuration);
    const startTime = slot ? slot.start : frame.start;

    pushUndo();
    const { priority, deadline, ...preserved } = task;
    setTasks(prev => [...prev, {
      ...preserved,
      date: dateStr,
      startTime,
      duration: taskDuration,
      color: task.color || 'bg-blue-500',
      isAllDay: false,
    }]);
    setUnscheduledTasks(prev => prev.filter(t => t.id !== taskId));
    setFrameScheduleModal(null);
    playUISound('pop');
    setSyncNotification({
      type: 'success',
      title: 'Task Scheduled',
      message: `"${task.title}" placed at ${startTime} in ${frame.label}`,
    });
  };

  // ── Focus mode wrappers ──────────────────────────────────────────────────

  const focusCompleteTask = (taskId) => {
    toggleComplete(taskId);
    setFocusCompletedTasks(prev => {
      const next = new Set(prev);
      next.add(taskId);
      return next;
    });
    playFocusSound('complete');
    const allDone = focusBlockTasks.every(t => t.completed || t.id === taskId || focusCompletedTasks.has(t.id));
    if (allDone) {
      setTimeout(() => exitFocusModeRef.current?.(true), 500);
    }
  };

  const focusUpdateTaskNotes = (taskId, notes, isInbox) => {
    updateTaskNotes(taskId, notes, isInbox);
    setFocusBlockTasks(prev => prev.map(t => t.id === taskId ? { ...t, notes } : t));
  };

  const focusAddSubtask = (taskId, title, isInbox) => {
    const newSt = addSubtask(taskId, title, isInbox);
    if (!newSt) return;
    setFocusBlockTasks(prev => prev.map(t => t.id === taskId ? { ...t, subtasks: [...(t.subtasks || []), newSt] } : t));
  };

  const focusToggleSubtask = (taskId, subtaskId, isInbox) => {
    toggleSubtask(taskId, subtaskId, isInbox);
    setFocusBlockTasks(prev => prev.map(t => {
      if (t.id !== taskId) return t;
      return { ...t, subtasks: (t.subtasks || []).map(st => st.id === subtaskId ? { ...st, completed: !st.completed } : st) };
    }));
  };

  const focusDeleteSubtask = (taskId, subtaskId, isInbox) => {
    deleteSubtask(taskId, subtaskId, isInbox);
    setFocusBlockTasks(prev => prev.map(t => {
      if (t.id !== taskId) return t;
      return { ...t, subtasks: (t.subtasks || []).filter(st => st.id !== subtaskId) };
    }));
  };

  const focusUpdateSubtaskTitle = (taskId, subtaskId, newTitle, isInbox) => {
    updateSubtaskTitle(taskId, subtaskId, newTitle, isInbox);
    setFocusBlockTasks(prev => prev.map(t => {
      if (t.id !== taskId) return t;
      return { ...t, subtasks: (t.subtasks || []).map(st => st.id === subtaskId ? { ...st, title: newTitle } : st) };
    }));
  };

  return {
    // Deadline
    setDeadline,
    postponeDeadlineTask,
    clearDeadline,
    // Create
    addTask,
    openNewTaskForm,
    openNewInboxTask,
    // Update
    changeTaskColor,
    updateTaskNotes,
    updateRecurringTemplate,
    updateRecurrencePattern,
    updateRecurrenceEndCondition,
    // Complete
    toggleComplete,
    // Move
    postponeTask,
    moveToInbox,
    // Subtasks
    addSubtask,
    toggleSubtask,
    deleteSubtask,
    updateSubtaskTitle,
    // Delete
    moveToRecycleBin,
    deleteRecurringInstance,
    recordDeletedTaskTombstone,
    // Schedule
    scheduleTaskAtNextSlot,
    manuallyScheduleTask,
    // Focus wrappers
    focusCompleteTask,
    focusUpdateTaskNotes,
    focusAddSubtask,
    focusToggleSubtask,
    focusDeleteSubtask,
    focusUpdateSubtaskTitle,
  };
}
