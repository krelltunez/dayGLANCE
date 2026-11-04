import { cleanTitle } from '../utils/suggestionParser.js';
import { toInboxCopy } from '../utils/inboxMove.js';
import { stripBucketId } from '../utils/bucketList.js';
import { stripSpans } from '../utils/quickAddParser.js';
import { dateToString, extractTags, formatDeadlineDate, completionTimestamp, stripWikilinks } from '../utils/taskUtils.js';
import { carryCreatedAt, createdTimestamp } from '../utils/createdAt.js';
import { TASK_COLORS } from '../utils/colorUtils.js';
import { triggerHaptic } from '../native.js';
import { isCalendarEventRow } from '../utils/eventNotes.js';
import { describeObstacle } from '../utils/dayOccupancy.js';
import { createPendingProject } from '../utils/pendingProject.js';
import { rememberLastUsedProject } from '../utils/lastUsedProject.js';
import { canFollowUp, resolveTaskRef } from '../utils/followUp.js';
import { editedSeriesStart } from '../utils/recurrenceEngine.js';
import { moveSubtaskTo } from '../utils/subtaskOrder.js';
import { recordDeletedTaskTombstone } from '../utils/deletedTaskTombstones.js';

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

// THIS module's deletes are user-pressed: they know INTENT, so they write the
// deletedTaskIds tombstone (utils/deletedTaskTombstones.js explains the
// provenance rule; the MCP undo of a created series writes the same record).

export default function useTaskActions({
  tasks, setTasks, setEventNote,
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
  isFocusSettlementPending = () => false,
  // "Make a task" from an unlinked Do: links the Do once the task is saved.
  onTaskMadeFromDo,
  exitFocusModeRef,
  playFocusSound,
  // Obsidian integration.
  // getObsidianTaskMeta(rawTitle) → { id, importSource, obsidianRawTitle, obsidianFileDate, obsidianBlockId }
  // Used synchronously at task-creation time so the task gets the obsidian-format
  // ID from the start, letting the next periodic sync de-duplicate instead of cloning.
  getObsidianTaskMeta,
  onWriteObsidianTask,
  // A project named in the task modal is created as the task is saved.
  addProject,
  goals,
}) {
  const colors = TASK_COLORS;

  // Helper to update a recurring task template by ID
  const updateRecurringTemplate = (taskId, updater) => {
    const parsed = parseRecurringId(taskId);
    if (parsed) {
      setRecurringTasks(prev => prev.map(t => t.id === parsed.templateId ? { ...updater(t), lastModified: new Date().toISOString() } : t));
    }
  };

  // ── Deadline management ──────────────────────────────────────────────────

  const setDeadline = (taskId, deadline) => {
    pushUndo({ key: 'deadlineSet', taskId });
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
    const said = pushUndo({ key: 'deadlinePostponed', taskId, date: formatDeadlineDate(nextDateStr) });
    setUnscheduledTasks(prev => prev.map(t =>
      t.id === taskId ? { ...t, deadline: nextDateStr } : t
    ));
    setUndoToast({ message: said, actionable: true });
    playUISound('slide');
  };

  // Returns what it did, in words, for a caller's toast.
  const clearDeadline = (taskId) => {
    const said = pushUndo({ key: 'deadlineCleared', taskId });
    setUnscheduledTasks(prev => prev.map(t =>
      t.id === taskId ? { ...t, deadline: null } : t
    ));
    setShowDeadlinePicker(null);
    return said;
  };

  // ── Task creation ────────────────────────────────────────────────────────

  // A project named in the modal ("New project…") is created as the task is
  // saved, and the rest reads newTask with its real id (utils/pendingProject.js).
  // Its project becomes the picker's "last used" on this device (#2274).
  const addTask = (toInbox = false) => {
    if (!newTask.title.trim()) return;
    const ready = createPendingProject(newTask, { addProject, goals });
    addTaskFrom(ready.newTask, toInbox, ready.project);
    rememberLastUsedProject(ready.newTask.projectId);
  };

  const addTaskFrom = (newTask, toInbox, createdProject) => {
    if (newTask.title.trim()) {
      // Remove natural-language phrases the quick-add layer parsed into task
      // fields ("tomorrow 3pm every 2 weeks"); their values already live on
      // newTask. Dismissed chips are not in nlSpans, so their text survives.
      // cleanTitle then strips sigil shorthand as before.
      const savedTitle = cleanTitle(stripSpans(newTask.title, newTask.nlSpans));
      // Scheduling an Inbox task by swipe goes through here too, and that path
      // strips the deadline: the undo step has to say so, or a toast that
      // offers Undo would look like it only moved the task.
      const swipeInboxTask = swipeSchedulingInboxTaskId.current
        ? unscheduledTasks.find(t => t.id === swipeSchedulingInboxTaskId.current)
        : null;
      pushUndo({
        key: swipeInboxTask ? (swipeInboxTask.deadline ? 'scheduledDroppedDeadline' : 'scheduled') : 'added',
        title: savedTitle,
      });

      // Determine whether this task should be linked to an Obsidian daily note.
      // Recurring and swipe-scheduling paths are excluded: recurring tasks use
      // their own ID scheme; swipe-scheduling preserves an existing task's ID.
      const tags = extractTags(newTask.title);
      const hasObsidianTag = tags.includes('obsidian');
      const isRecurring = !!newTask.recurrence;
      const isSwipeSchedule = !!swipeSchedulingInboxTaskId.current;
      const rawObsidianTitle = hasObsidianTag ? stripTag(savedTitle, 'obsidian') : null;
      // Skip if stripping the tag leaves an empty title (e.g. task titled only "#obsidian")
      const obsidianMeta = (hasObsidianTag && rawObsidianTitle && !isRecurring && !isSwipeSchedule && getObsidianTaskMeta)
        ? getObsidianTaskMeta(rawObsidianTitle, newTask.projectId, createdProject)
        : null;

      const taskId = obsidianMeta?.id ?? crypto.randomUUID();
      // Tracks the conflict-adjusted start time set by the scheduled branch so the
      // vault write uses the same time that ends up in DG state, not the raw input.
      let scheduledAdjustedStartTime = newTask.startTime || null;
      // Notes and subtasks written in the modal before the task existed
      // (components/TaskModalNotes.jsx).
      const draftNotes = newTask.notes || '';
      const draftSubtasks = newTask.subtasks || [];
      const task = {
        id: taskId,
        title: savedTitle,
        duration: newTask.duration,
        color: newTask.color || colors[0].class,
        completed: false,
        isAllDay: newTask.isAllDay || false,
        notes: draftNotes,
        subtasks: draftSubtasks,
        ...(obsidianMeta ?? {}),
        // The persist pass never stamps an Obsidian task (utils/createdAt.js:
        // it cannot tell one made here from a line read from the vault), so
        // the one made here is stamped at its creation.
        ...(obsidianMeta ? { createdAt: createdTimestamp() } : {}),
        ...(newTask.projectId ? { projectId: newTask.projectId } : {}),
        ...(newTask.assignedUserSyncIds?.length ? { assignedUserSyncIds: newTask.assignedUserSyncIds } : {}),
      };

      // The id a new one-off task was saved under, for a Do this task was
      // made from (null when the save moved an existing Inbox task instead,
      // or made a series: see the link below).
      let createdId = null;
      if (toInbox) {
        createdId = taskId;
        const inboxTask = { ...task, priority: newTask.priority ?? 0 };
        if (newTask.deadline) {
          inboxTask.deadline = newTask.deadline;
        }
        setUnscheduledTasks(prev => [...prev, inboxTask]);
      } else if (newTask.keepUnscheduled && newTask.projectId) {
        // Save as unscheduled project task (no scheduling). It is an inbox task
        // by the same rule, and the editor's deadline field is live for it, so
        // the value has to come through here too (#2116 review).
        createdId = taskId;
        setUnscheduledTasks(prev => [...prev, newTask.deadline ? { ...task, deadline: newTask.deadline } : task]);
      } else if (newTask.recurrence) {
        // Create recurring task template
        const taskDate = newTask.date || dateToString(selectedDate);
        const template = {
          id: taskId,
          title: savedTitle,
          startTime: newTask.isAllDay ? '00:00' : newTask.startTime,
          duration: newTask.duration,
          color: newTask.color || colors[0].class,
          isAllDay: newTask.isAllDay || false,
          notes: draftNotes,
          subtasks: draftSubtasks,
          recurrence: { ...newTask.recurrence, startDate: taskDate },
          completedDates: [],
          exceptions: {},
          // Project membership is series-level too: it lives on the template so
          // every materialised instance inherits it (same rule as assignment).
          ...(newTask.projectId ? { projectId: newTask.projectId } : {}),
          // User assignment on recurring tasks is series-level: it lives on the
          // template so every materialised instance inherits it.
          ...(newTask.assignedUserSyncIds?.length ? { assignedUserSyncIds: newTask.assignedUserSyncIds } : {}),
          lastModified: new Date().toISOString()
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
            title: savedTitle,
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
              message: `Task moved to ${adjustedStartTime} to avoid conflict with ${describeObstacle(conflictingEvent)}`
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
        createdId = taskId;
        setTasks(prev => [...prev, {
          ...task,
          startTime: adjustedStartTime,
          date: taskDate
        }]);

        if (conflicted && conflictingEvent) {
          setSyncNotification({
            type: 'info',
            title: 'Task Rescheduled',
            message: `Task moved to ${adjustedStartTime} to avoid conflict with ${describeObstacle(conflictingEvent)}`
          });
        }
      }

      // If the task is tagged #obsidian, write it to today's daily note.
      // blockId rides along so the appended line carries the same ^dg- id the
      // app task was just created with (Phase 2 round-trip identity).
      if (obsidianMeta && onWriteObsidianTask) {
        onWriteObsidianTask({
          // The raw title as the identity was derived from it: with the
          // project field when the task was created under a project.
          title: obsidianMeta.obsidianRawTitle ?? rawObsidianTitle,
          startTime: toInbox || newTask.isAllDay ? null : scheduledAdjustedStartTime,
          duration: toInbox ? null : (newTask.duration || null),
          isAllDay: !toInbox && (newTask.isAllDay || false),
          date: toInbox ? null : (newTask.date || dateToString(selectedDate)),
          blockId: obsidianMeta.obsidianBlockId,
        });
      }

      // "Make a task" from an unlinked Do (jobo/carryForward.js makeTaskDraft):
      // link that Do to the task just saved. One more undo step, after the add.
      // Only a one-off task is linked. Make a task opens the Inbox form, which
      // cannot make a series; if one is ever made from a Do, the Do stays
      // unlinked, since a series has no occurrence the work belongs to and
      // the views resolve a template id only through one.
      if (newTask.linkDo && createdId != null) onTaskMadeFromDo?.(newTask.linkDo, createdId);

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

  // Date-header tap in every timeline view (MULTI/DAY/WEEK/SCHED and the
  // mobile header): a new scheduled task on that day, "All Day" pre-selected.
  const openNewAllDayTask = (dateStr) => {
    setNewTask({
      title: '',
      startTime: getNextQuarterHour(),
      duration: 30,
      date: dateStr,
      isAllDay: true,
      recurrence: null
    });
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

  // Energy-axis override (summary strip): 'restore' | 'effort' | null (null =
  // back to auto-derivation, see utils/energyAxis.js). Same routing as
  // changeTaskColor: a recurring instance stores the override on its SERIES —
  // energy is a property of the block's nature, which recurs with it.
  const setTaskEnergy = (taskId, energy, fromInbox = false) => {
    pushUndo({ key: 'energy', taskId });
    if (typeof taskId === 'string' && taskId.startsWith('recurring-')) {
      const parsed = parseRecurringId(taskId);
      if (parsed) {
        setRecurringTasks(prev => prev.map(t =>
          t.id === parsed.templateId ? { ...t, energy: energy ?? undefined, lastModified: new Date().toISOString() } : t
        ));
      }
      return;
    }
    const apply = (task) => (task.id === taskId ? { ...task, energy: energy ?? undefined } : task);
    if (fromInbox) setUnscheduledTasks(prev => prev.map(apply));
    else setTasks(prev => prev.map(apply));
  };

  const changeTaskColor = (taskId, newColor, fromInbox = false) => {
    pushUndo({ key: 'color', taskId });
    if (typeof taskId === 'string' && taskId.startsWith('recurring-')) {
      const parsed = parseRecurringId(taskId);
      if (parsed) {
        setRecurringTasks(prev => prev.map(t =>
          t.id === parsed.templateId ? { ...t, color: newColor, lastModified: new Date().toISOString() } : t
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
          t.id === parsed.templateId ? { ...t, notes, lastModified: new Date().toISOString() } : t
        ));
      }
    } else if (isInbox) {
      setUnscheduledTasks(prev => prev.map(t =>
        t.id === taskId ? { ...t, notes } : t
      ));
    } else if (setEventNote && isCalendarEventRow(tasks.find(t => t.id === taskId))) {
      // A calendar event's own notes are its description, rebuilt from the
      // feed on every refresh: your note is kept apart (utils/eventNotes.js).
      setEventNote(taskId, notes);
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
      // Never earlier than the series' own start: it used to snap to the 1st
      // of the month, which invented occurrences from before the series
      // existed. Yearly and biweekly may move it forward to stay anchored on
      // this occurrence; see editedSeriesStart.
      const newStart = editedSeriesStart(newRecurrence, t.recurrence.startDate, dateStr);
      return { ...t, recurrence: { ...newRecurrence, startDate: newStart }, lastModified: new Date().toISOString() };
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
      return { ...t, recurrence: updated, lastModified: new Date().toISOString() };
    }));
  };

  // ── Task completion ──────────────────────────────────────────────────────

  const toggleComplete = (id, fromInbox = false) => {
    // Which way it goes decides the words: "Completed" or "Marked … not done".
    const recurringRef = typeof id === 'string' && id.startsWith('recurring-') ? parseRecurringId(id) : null;
    const wasDone = recurringRef
      ? !!recurringTasks.find(t => t.id === recurringRef.templateId)?.completedDates?.includes(recurringRef.dateStr)
      : !!(fromInbox ? unscheduledTasks : tasks).find(t => t.id === id)?.completed;
    const said = pushUndo({ key: wasDone ? 'uncompleted' : 'completed', taskId: id });
    playUISound('tick');
    triggerHaptic('medium');
    if (typeof id === 'string' && id.startsWith('recurring-')) {
      const { templateId, dateStr } = parseRecurringId(id);
      setRecurringTasks(prev => prev.map(t => {
        if (t.id !== templateId) return t;
        const completed = (t.completedDates || []).includes(dateStr);
        return {
          ...t,
          completedDates: completed
            ? (t.completedDates || []).filter(d => d !== dateStr)
            : [...(t.completedDates || []), dateStr],
          // Stamp the toggled occurrence so sync resolves this complete/un-complete
          // by last-writer-wins per date instead of letting a concurrent series
          // edit clobber it (completedDates is unioned across devices on merge).
          // The same own-offset form as an ordinary completedAt, so the stamp
          // names the local date the occurrence was done on (JOBO's Do date)
          // and can close a Focus session; the merge compares instants.
          completedDatesTimestamps: { ...(t.completedDatesTimestamps || {}), [dateStr]: completionTimestamp() },
          lastModified: new Date().toISOString()
        };
      }));
      if (!onboardingProgress.hasCompletedTask) {
        setOnboardingProgress(prev => ({ ...prev, hasCompletedTask: true }));
      }
      const wasCompleted = recurringTasks.find(t => t.id === templateId)?.completedDates?.includes(dateStr);
      if (!wasCompleted) {
        // The occurrence as that day showed it, for "Schedule follow-up task".
        const occurrence = resolveTaskRef(id, { recurringTasks })?.task;
        setUndoToast({ message: said, actionable: true, ...(occurrence ? { followUp: occurrence } : {}) });
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
        task.id === id ? { ...task, completed: !task.completed, completedAt: !task.completed ? completionTimestamp() : null, transitionId: crypto.randomUUID() } : task
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
      // completedAt on the scheduled branch is NEW (it deliberately didn't
      // set one for years — the flip is pinned in taskMutations.pinning
      // .test.js): the Obsidian completion marker regenerates from this
      // stored value, so the app must record what it intends to write.
      setTasks(prev => prev.map(task =>
        task.id === id ? { ...task, completed: !task.completed, completedAt: !task.completed ? completionTimestamp() : null, transitionId: crypto.randomUUID() } : task
      ));
    }
    if (taskToToggle && !taskToToggle.completed) {
      setUndoToast({ message: said, actionable: true, ...(canFollowUp(taskToToggle) ? { followUp: taskToToggle } : {}) });
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
      const said = pushUndo({ key: 'postponed', title });
      setRecurringTasks(prev => prev.map(t => t.id !== parsed.templateId ? t : {
        ...t,
        exceptions: { ...t.exceptions, [parsed.dateStr]: { ...(t.exceptions?.[parsed.dateStr] || {}), skipped: true } },
        lastModified: new Date().toISOString()
      }));
      setTasks(prev => [...prev, {
        id: crypto.randomUUID(), title,
        startTime: isAllDay ? '00:00' : startTime, duration, color,
        isAllDay, date: nextDateStr, completed: false, notes: '', subtasks: [],
        ...carryCreatedAt(template),
      }]);
      setUndoToast({ message: said, actionable: true });
      playUISound('slide');
      return;
    }
    const task = tasks.find(t => t.id === id);
    // All-day tasks carry no meaningful start time: some sources (lastGLANCE
    // intents among them) store it as null rather than '00:00', and they
    // occupy no slot, so they skip the conflict check below.
    if (!task || !task.date || (!task.startTime && !task.isAllDay)) return;

    const nextDay = new Date(task.date + 'T12:00:00');
    nextDay.setDate(nextDay.getDate() + 1);
    const nextDateStr = nextDay.toISOString().split('T')[0];

    const { conflicted, conflictingEvent } = task.isAllDay
      ? { conflicted: false }
      : getAdjustedTimeForImportedConflicts(id, task.startTime, task.duration, nextDateStr);

    if (conflicted) {
      playUISound('error');
      setSyncNotification({
        type: 'error',
        title: "Can't Postpone",
        message: `Time slot conflicts with ${describeObstacle(conflictingEvent)} on ${nextDateStr}`
      });
      return;
    }

    const said = pushUndo({ key: 'postponed', taskId: id });
    setTasks(prev => prev.map(t =>
      t.id === id ? { ...t, date: nextDateStr } : t
    ));
    setUndoToast({ message: said, actionable: true });
    playUISound('slide');
    if (!onboardingProgress.hasUsedActionButtons) {
      setOnboardingProgress(prev => ({ ...prev, hasUsedActionButtons: true }));
    }
  };

  const moveToInbox = (id) => {
    if (typeof id === 'string' && id.startsWith('recurring-')) return;
    const task = tasks.find(t => t.id === id);
    if (!task || task.imported) return;
    const said = pushUndo({ key: 'toInbox', taskId: id });

    // Shared with the harness's unschedule (utils/inboxMove.js): an
    // Obsidian task records the time this move removes, so a stale read of
    // its still-timed line is told apart from a time typed in the vault.
    const unscheduledTask = toInboxCopy(task);

    setTasks(prev => prev.filter(t => t.id !== id));
    setUnscheduledTasks(prev => [...prev, unscheduledTask]);
    playUISound('slide');
    setUndoToast({ message: said, actionable: true });
    if (!onboardingProgress.hasUsedActionButtons) {
      setOnboardingProgress(prev => ({ ...prev, hasUsedActionButtons: true }));
    }
  };

  // ── Subtask management ───────────────────────────────────────────────────

  const addSubtask = (taskId, title, isInbox, extraFields = {}) => {
    if (!title.trim()) return;
    pushUndo({ key: 'subtaskAdded', taskId });
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
    pushUndo({ key: 'subtaskChanged', taskId });
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
    pushUndo({ key: 'subtaskDeleted', taskId });
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
    pushUndo({ key: 'subtaskChanged', taskId });
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

  // Move one subtask to position `toIndex` (#2176): the array's order is the
  // checklist's, so this writes the task's subtasks in the new order through
  // the same paths as the other subtask edits. One undo step; a no-op move
  // (dropped where it was) pushes none and changes nothing.
  const moveSubtask = (taskId, subtaskId, toIndex, isInbox) => {
    const isRecurring = typeof taskId === 'string' && taskId.startsWith('recurring-');
    const parsed = isRecurring ? parseRecurringId(taskId) : null;
    const current = isRecurring
      ? recurringTasks.find(t => t.id === parsed?.templateId)
      : (isInbox ? unscheduledTasks : tasks).find(t => t.id === taskId);
    const subtasks = current?.subtasks || [];
    if (moveSubtaskTo(subtasks, subtaskId, toIndex) === subtasks) return;
    pushUndo({ key: 'subtasksReordered', taskId });
    const subtaskUpdater = t => ({ ...t, subtasks: moveSubtaskTo(t.subtasks || [], subtaskId, toIndex) });
    if (isRecurring) {
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

    const said = pushUndo({ key: 'deleted', taskId: id });
    const taskInScheduled = tasks.find(t => t.id === id);
    const taskInInbox = unscheduledTasks.find(t => t.id === id);
    const task = fromInbox ? taskInInbox : (taskInScheduled || taskInInbox);
    const actuallyInInbox = !!taskInInbox && !taskInScheduled;

    if (task) {
      if (expandedNotesTaskId === id) {
        setExpandedNotesTaskId(null);
      }
      // Stamp the bin entry with a FRESH timestamp that is strictly newer than
      // the task's own lastModified, used for BOTH deletedAt and lastModified.
      // This prevents "zombie" resurrection: an old task (lastModified beyond the
      // sync horizon) would otherwise have its recycle-bin entry pruned as a
      // presumed zombie during merge, after which the remote active copy — which
      // carries no tombstone — reconciles straight back into the inbox. A fresh
      // stamp keeps the bin entry alive past the horizon and lets it win the
      // active-vs-recycled reconciliation in both the file and vault sync tiers.
      const deletedStamp = new Date(
        Math.max(Date.now(), (task.lastModified ? Date.parse(task.lastModified) : 0) + 1000)
      ).toISOString();
      const taskWithMeta = {
        ...task,
        _deletedFrom: actuallyInInbox ? 'inbox' : 'calendar',
        deletedAt: deletedStamp,
        lastModified: deletedStamp,
      };
      setRecycleBin(prev => [...prev, taskWithMeta]);
      if (actuallyInInbox) {
        setUnscheduledTasks(prev => prev.filter(t => t.id !== id));
      } else {
        setTasks(prev => prev.filter(t => t.id !== id));
      }
      playUISound('swoosh');
      triggerHaptic('success');
      setUndoToast({ message: said, actionable: true });
      if (!onboardingProgress.hasUsedActionButtons) {
        setOnboardingProgress(prev => ({ ...prev, hasUsedActionButtons: true }));
      }
    }
  };

  const deleteRecurringInstance = (mode) => {
    if (!recurringDeleteConfirm) return;
    const { taskId, dateStr } = recurringDeleteConfirm;
    pushUndo({ key: 'deleted', title: recurringTasks.find(t => t.id === taskId)?.title });

    if (mode === 'this') {
      setRecurringTasks(prev => prev.map(t => {
        if (t.id !== taskId) return t;
        return { ...t, exceptions: { ...t.exceptions, [dateStr]: { deleted: true } }, lastModified: new Date().toISOString() };
      }));
    } else if (mode === 'future') {
      const dayBefore = new Date(dateStr + 'T12:00:00');
      dayBefore.setDate(dayBefore.getDate() - 1);
      const endDate = dateToString(dayBefore);
      setRecurringTasks(prev => prev.map(t => {
        if (t.id !== taskId) return t;
        return { ...t, recurrence: { ...t.recurrence, endDate }, lastModified: new Date().toISOString() };
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
      // Both fields are inbox-only, so putting the task on the clock drops
      // them — the same strip the drag paths do. A dropped deadline is named in
      // the undo step, and the toast below shows it (the action is reachable
      // from an overdue Inbox deadline card, where the deadline is the reason
      // the card is on screen at all).
      const said = task.deadline ? pushUndo({ key: 'scheduledDroppedDeadline', taskId }) : null;
      const { priority, deadline, ...preserved } = stripBucketId(task);
      setUnscheduledTasks(prev => prev.filter(t => t.id !== taskId));
      setTasks(prev => [...prev, { ...preserved, startTime: nextSlotTime, date: todayStr, isAllDay: false }]);
      if (said) setUndoToast({ message: said, actionable: true });
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

    // Placing it in a Frame schedules it, so the inbox-only fields go and a
    // dropped deadline is named in the undo step (the sync notification below
    // reports the placement itself).
    pushUndo(task.deadline ? { key: 'scheduledDroppedDeadline', taskId } : { key: 'scheduled', taskId });
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
      message: `"${stripWikilinks(task.title)}" placed at ${startTime} in ${frame.label}`,
    });
  };

  // SCHED: give a deadline task a concrete slot on a given day (deadline card
  // → scheduled task). Deadline and priority are stripped, matching what
  // dragging a deadline chip onto the time grid does — and because this button
  // is the one-tap path for exactly the task the deadline is about, the toast
  // says the deadline went, with an Undo that brings it back.
  const scheduleDeadlineTaskAt = (taskId, dateStr, startTime) => {
    const task = unscheduledTasks.find(t => t.id === taskId);
    if (!task) return;
    const said = pushUndo(task.deadline ? { key: 'scheduledDroppedDeadline', taskId } : { key: 'scheduled', taskId });
    const { priority, deadline, ...preserved } = task;
    setUnscheduledTasks(prev => prev.filter(t => t.id !== taskId));
    setTasks(prev => [...prev, {
      ...preserved,
      date: dateStr,
      startTime,
      duration: task.duration || 30,
      isAllDay: false,
      lastModified: new Date().toISOString(),
    }]);
    setUndoToast({ message: said, actionable: true });
    playUISound('pop');
  };

  // ── Focus mode wrappers ──────────────────────────────────────────────────

  const focusCompleteTask = (taskId, { exitWhenDone = true, fromSettlement = false } = {}) => {
    if (isFocusSettlementPending()) return false;
    if (fromSettlement) {
      const found = resolveTaskRef(taskId, { tasks, unscheduledTasks, recurringTasks, recycleBin });
      if (!found || found.where === 'deleted' || found.task.completed || focusCompletedTasks.has(taskId)) return false;
      taskId = found.task.id;
      toggleComplete(taskId, found.where === 'inbox');
    } else toggleComplete(taskId);
    setFocusCompletedTasks(prev => {
      const next = new Set(prev);
      next.add(taskId);
      return next;
    });
    // Play completion chord only when all tasks are done — consistent with hyperGLANCE.
    // (toggleComplete above plays the 'tick' sound on every toggle.)
    const allDone = focusBlockTasks.every(t => t.completed || t.id === taskId || focusCompletedTasks.has(t.id));
    if (allDone) {
      playFocusSound('complete');
      if (exitWhenDone) setTimeout(() => exitFocusModeRef.current?.(true), 500);
    }
    return allDone;
  };

  const hgCompleteTask = (taskId) => {
    const fromInbox = !tasks.find(t => t.id === taskId);
    toggleComplete(taskId, fromInbox);
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

  const focusMoveSubtask = (taskId, subtaskId, toIndex, isInbox) => {
    moveSubtask(taskId, subtaskId, toIndex, isInbox);
    setFocusBlockTasks(prev => prev.map(t => (t.id === taskId
      ? { ...t, subtasks: moveSubtaskTo(t.subtasks || [], subtaskId, toIndex) }
      : t)));
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
    openNewAllDayTask,
    openNewInboxTask,
    // Update
    changeTaskColor,
    setTaskEnergy,
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
    moveSubtask,
    // Delete
    moveToRecycleBin,
    deleteRecurringInstance,
    recordDeletedTaskTombstone,
    // Schedule
    scheduleTaskAtNextSlot,
    manuallyScheduleTask,
    scheduleDeadlineTaskAt,
    // HG wrapper
    hgCompleteTask,
    // Focus wrappers
    focusCompleteTask,
    focusUpdateTaskNotes,
    focusAddSubtask,
    focusToggleSubtask,
    focusDeleteSubtask,
    focusUpdateSubtaskTitle,
    focusMoveSubtask,
  };
}
