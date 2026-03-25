import { useState, useRef } from 'react';
import { dateToString } from '../utils/taskUtils.js';
import { nativeUpdateEvent } from '../native.js';

// Pure utilities used by position helpers
const timeToMinutes = (time) => {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
};

const minutesToTime = (minutes) => {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
};

export default function useDragDrop({
  calendarRef, timeGridRef,
  setNewTask, setShowAddTask, selectedDate, setExpandedNotesTaskId,
  tasks, setTasks, setUnscheduledTasks, setRecurringTasks, setRecycleBin, setTodayRoutines,
  pushUndo, parseRecurringId, getAdjustedTimeForImportedConflicts, wouldExceedMaxColumns,
  playUISound, setSyncNotification, onboardingProgress, setOnboardingProgress,
  moveToRecycleBinRef, clearDeadlineRef,
}) {
  const [draggedTask, setDraggedTask] = useState(null);
  const [dragSource, setDragSource] = useState(null);
  const [dragPreviewTime, setDragPreviewTime] = useState(null);
  const [dragPreviewDate, setDragPreviewDate] = useState(null);
  const [dragOverAllDay, setDragOverAllDay] = useState(null);
  const [dragOverInbox, setDragOverInbox] = useState(false);
  const [dragOverRecycleBin, setDragOverRecycleBin] = useState(false);
  const [hoverPreviewTime, setHoverPreviewTime] = useState(null);
  const [hoverPreviewDate, setHoverPreviewDate] = useState(null);
  const [isResizing, setIsResizing] = useState(false);

  const autoScrollInterval = useRef(null); // For drag auto-scroll
  const frameResizingRef = useRef(false); // Suppress click-to-add-task after frame resize drag
  const stickyHeaderRef = useRef(null); // For measuring sticky header height during drag

  // Measure actual hour row height from DOM (handles sub-pixel borders on high-DPI screens)
  const getHourHeight = () => {
    if (timeGridRef.current && timeGridRef.current.children.length > 2) {
      // Use second row (index 1) to avoid first row's border-t variation
      return timeGridRef.current.children[1].offsetHeight;
    }
    return 161; // fallback: 160px content + 1px border
  };

  // Convert minutes from midnight to pixel position using actual DOM row positions
  // This eliminates cumulative drift from sub-pixel border rounding on high-DPI screens
  const minutesToPosition = (minutes) => {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (timeGridRef.current) {
      const children = timeGridRef.current.children;
      // Only use hour row children (first 24), not overlay divs that follow
      const numRows = Math.min(24, children.length);
      if (hours < numRows) {
        const rowTop = children[hours].offsetTop;
        if (mins === 0) return rowTop;
        const rowHeight = hours + 1 < numRows
          ? children[hours + 1].offsetTop - rowTop
          : children[hours].offsetHeight;
        return rowTop + mins * rowHeight / 60;
      }
    }
    // Fallback when DOM not available
    const hourHeight = 161;
    return hours * hourHeight + mins * 160 / 60;
  };

  // Convert pixel position (relative to time grid top) to minutes from midnight
  const positionToMinutes = (y) => {
    if (timeGridRef.current) {
      const children = timeGridRef.current.children;
      // Only use hour row children (first 24), not overlay divs that follow
      const numRows = Math.min(24, children.length);
      for (let i = 0; i < numRows; i++) {
        const rowTop = children[i].offsetTop;
        const nextTop = i + 1 < numRows
          ? children[i + 1].offsetTop
          : rowTop + children[i].offsetHeight;
        if (y < nextTop || i === numRows - 1) {
          const rowHeight = nextTop - rowTop;
          const pixelsIntoRow = Math.max(0, Math.min(y - rowTop, rowHeight));
          return i * 60 + (pixelsIntoRow / rowHeight) * 60;
        }
      }
    }
    // Fallback
    return (y / 161) * 60;
  };

  // Convert duration in minutes to pixel height
  const durationToHeight = (durationMinutes) => {
    const contentHeight = getHourHeight() - 1;
    return durationMinutes * contentHeight / 60;
  };

  const calculateTaskPosition = (task) => {
    const startMinutes = timeToMinutes(task.startTime);
    const endMinutes = startMinutes + task.duration;
    const top = Math.round(minutesToPosition(startMinutes));
    const endPos = Math.round(minutesToPosition(endMinutes));
    const height = endPos - top - 1; // -1 for consistent tiny gap between tasks
    return { top, height };
  };

  // Helper: convert cursor Y position (mouse event) to a rounded time string
  const getTimeFromCursorPosition = (e, options = {}) => {
    const { roundTo = 15, maxMinutes = 23 * 60 + 45, taskDuration = 0 } = options;
    const rect = calendarRef.current.getBoundingClientRect();
    const scrollTop = calendarRef.current.scrollTop;
    const headerHeight = timeGridRef.current ? timeGridRef.current.offsetTop : 0;
    const y = Math.max(0, e.clientY - rect.top + scrollTop - headerHeight);
    const totalMinutesFromTop = positionToMinutes(y);
    const totalMinutesRounded = Math.round(totalMinutesFromTop / roundTo) * roundTo;
    // firstHour is always 0 (calendar always starts at midnight)
    const hours = Math.floor(totalMinutesRounded / 60);
    const minutes = totalMinutesRounded % 60;
    const totalMinutes = Math.max(0, Math.min(maxMinutes - taskDuration, hours * 60 + minutes));
    return minutesToTime(totalMinutes);
  };

  const openNewTaskAtTime = (e, targetDate = null, skipCalendarSlotCheck = false) => {
    if (frameResizingRef.current) return;
    if (skipCalendarSlotCheck || e.target.classList.contains('calendar-slot')) {
      const clickedTime = getTimeFromCursorPosition(e);
      setNewTask({
        title: '',
        startTime: clickedTime,
        duration: 30,
        date: dateToString(targetDate || selectedDate),
        isAllDay: false
      });
      setShowAddTask(true);
    }
  };

  const handleCalendarMouseMove = (e, targetDate, skipCalendarSlotCheck = false) => {
    if (draggedTask) return;
    if (!skipCalendarSlotCheck && !e.target.classList.contains('calendar-slot')) {
      setHoverPreviewTime(null);
      setHoverPreviewDate(null);
      return;
    }
    const time = getTimeFromCursorPosition(e);
    setHoverPreviewTime(time);
    setHoverPreviewDate(targetDate);
  };

  const handleCalendarMouseLeave = () => {
    setHoverPreviewTime(null);
    setHoverPreviewDate(null);
  };

  const handleDragStart = (task, source, e) => {
    setDraggedTask(task);
    setDragSource(source);
    setDragPreviewTime(null);
    setExpandedNotesTaskId(null); // Close notes panel when dragging
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragEnd = () => {
    setDraggedTask(null);
    setDragSource(null);
    setDragPreviewTime(null);
    setDragPreviewDate(null);
    setDragOverAllDay(null);
    setDragOverInbox(false);
    setDragOverRecycleBin(false);
    // Clear auto-scroll
    if (autoScrollInterval.current) {
      clearInterval(autoScrollInterval.current);
      autoScrollInterval.current = null;
    }
  };

  const updateDragAutoScroll = (e) => {
    if (!calendarRef.current) return;
    const calendarRect = calendarRef.current.getBoundingClientRect();
    // Account for sticky headers (date header + all-day section) when computing scroll-up zone
    const stickyHeight = stickyHeaderRef.current ? stickyHeaderRef.current.getBoundingClientRect().bottom - calendarRect.top : 0;
    const scrollZoneSize = 60;
    const scrollSpeed = 8;

    const cursorY = e.clientY;
    const effectiveTop = calendarRect.top + stickyHeight;
    const distanceFromTop = cursorY - effectiveTop;
    const distanceFromBottom = calendarRect.bottom - cursorY;

    if (autoScrollInterval.current) {
      clearInterval(autoScrollInterval.current);
      autoScrollInterval.current = null;
    }

    if (distanceFromTop < scrollZoneSize && distanceFromTop > 0 && calendarRef.current.scrollTop > 0) {
      autoScrollInterval.current = setInterval(() => {
        if (calendarRef.current) {
          calendarRef.current.scrollTop -= scrollSpeed;
        }
      }, 16);
    } else if (distanceFromBottom < scrollZoneSize && distanceFromBottom > 0) {
      autoScrollInterval.current = setInterval(() => {
        if (calendarRef.current) {
          const maxScroll = calendarRef.current.scrollHeight - calendarRef.current.clientHeight;
          if (calendarRef.current.scrollTop < maxScroll) {
            calendarRef.current.scrollTop += scrollSpeed;
          }
        }
      }, 16);
    }
  };

  const handleDragOver = (e, targetDate = null) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    // Clear other drop indicators when back in timeline
    setDragOverAllDay(null);
    setDragOverInbox(false);
    setDragOverRecycleBin(false);

    // Show preview time while dragging
    if (draggedTask && calendarRef.current) {
      const time = getTimeFromCursorPosition(e, {
        maxMinutes: 24 * 60,
        taskDuration: draggedTask.duration
      });
      setDragPreviewTime(time);

      // Track which date column we're dragging over
      if (targetDate) {
        setDragPreviewDate(targetDate);
      }

      updateDragAutoScroll(e);
    }
  };

  const handleDragOverInbox = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    // Clear timeline preview when over inbox
    setDragPreviewTime(null);
    setDragOverAllDay(null);
    setDragOverRecycleBin(false);
    setDragOverInbox(true);
    // Clear auto-scroll when over inbox
    if (autoScrollInterval.current) {
      clearInterval(autoScrollInterval.current);
      autoScrollInterval.current = null;
    }
  };

  const handleDragOverRecycleBin = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    // Clear timeline preview when over recycle bin
    setDragPreviewTime(null);
    setDragOverAllDay(null);
    setDragOverInbox(false);
    setDragOverRecycleBin(true);
    // Clear auto-scroll when over recycle bin
    if (autoScrollInterval.current) {
      clearInterval(autoScrollInterval.current);
      autoScrollInterval.current = null;
    }
  };

  const handleDropOnCalendar = (e, targetDate = null) => {
    e.preventDefault();
    if (!draggedTask) return;

    // Routine chip drop — place on timeline (today only)
    if (dragSource === 'routine') {
      const dropDate = targetDate || dragPreviewDate || selectedDate;
      const dropDateStr = dateToString(dropDate);
      const todayStr = dateToString(new Date());
      if (dropDateStr !== todayStr) {
        setDraggedTask(null); setDragSource(null); setDragPreviewTime(null); setDragPreviewDate(null);
        return;
      }
      const startTime = getTimeFromCursorPosition(e, { maxMinutes: 24 * 60, taskDuration: draggedTask.duration });
      setTodayRoutines(prev => prev.map(r => r.id === draggedTask.id ? { ...r, startTime, isAllDay: false, lastModified: new Date().toISOString() } : r));
      setDraggedTask(null); setDragSource(null); setDragPreviewTime(null); setDragPreviewDate(null);
      return;
    }

    const requestedStartTime = getTimeFromCursorPosition(e, {
      maxMinutes: 24 * 60,
      taskDuration: draggedTask.duration
    });

    // Use the target date from the column, falling back to dragPreviewDate or selectedDate
    const dropDate = targetDate || dragPreviewDate || selectedDate;
    const dropDateStr = dateToString(dropDate);

    // Check for conflicts with imported calendar events and adjust if needed
    const { conflicted, adjustedStartTime, conflictingEvent } = getAdjustedTimeForImportedConflicts(
      draggedTask.id,
      requestedStartTime,
      draggedTask.duration,
      dropDateStr
    );

    const startTime = adjustedStartTime;

    // Prevent drops that would create 4+ side-by-side tasks
    if (wouldExceedMaxColumns(draggedTask, startTime, dropDateStr)) {
      setDraggedTask(null);
      setDragSource(null);
      setDragPreviewTime(null);
      setDragPreviewDate(null);
      return;
    }

    pushUndo();
    if (dragSource === 'inbox') {
      setUnscheduledTasks(prev => prev.filter(t => t.id !== draggedTask.id));
      const { priority, deadline, ...taskWithoutPriorityAndDeadline } = draggedTask;
      setTasks(prev => [...prev, {
        ...taskWithoutPriorityAndDeadline,
        startTime,
        date: dropDateStr,
        isAllDay: false
      }]);
      // Track for onboarding
      if (!onboardingProgress.hasDraggedToTimeline) {
        setOnboardingProgress(prev => ({ ...prev, hasDraggedToTimeline: true }));
      }
    } else if (dragSource === 'calendar') {
      if (draggedTask.isRecurring) {
        const parsed = parseRecurringId(draggedTask.id);
        if (parsed) {
          const { templateId, dateStr: origDateStr } = parsed;
          if (origDateStr === dropDateStr) {
            // Same-date drag: store startTime override in exception
            setRecurringTasks(prev => prev.map(t => {
              if (t.id !== templateId) return t;
              return { ...t, exceptions: { ...t.exceptions, [origDateStr]: { ...t.exceptions?.[origDateStr], startTime } } };
            }));
          } else {
            // Cross-date drag: mark deleted on old date, create regular task on new date
            setRecurringTasks(prev => prev.map(t => {
              if (t.id !== templateId) return t;
              return { ...t, exceptions: { ...t.exceptions, [origDateStr]: { ...t.exceptions?.[origDateStr], deleted: true } } };
            }));
            const { id, isRecurring, recurringTemplateId, ...taskData } = draggedTask;
            setTasks(prev => [...prev, { ...taskData, id: crypto.randomUUID(), startTime, date: dropDateStr, isAllDay: false }]);
          }
        }
      } else {
        const prevDraggedTask = draggedTask;
        setTasks(prev => prev.map(t =>
          t.id === draggedTask.id
            ? { ...t, startTime, date: dropDateStr, isAllDay: false }
            : t
        ));
        // If this is a native Android calendar event, write the change back to the device calendar
        if (draggedTask.nativeEventId) {
          const endMin = timeToMinutes(startTime) + (draggedTask.duration || 60);
          const newStart = `${dropDateStr}T${startTime}:00`;
          const newEnd = `${dropDateStr}T${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}:00`;
          nativeUpdateEvent({
            id: draggedTask.nativeEventId, title: draggedTask.title,
            start: newStart, end: newEnd, allDay: false,
            notes: draggedTask.notes || '', location: draggedTask.location || '',
          }).then(result => {
            if (!result?.success) {
              setTasks(prev => prev.map(t => t.id === prevDraggedTask.id ? { ...prevDraggedTask } : t));
            } else {
              // Keep any localStorage time-override in sync with the new position so
              // a subsequent calendar re-fetch doesn't revert to the stale override value.
              const overrides = JSON.parse(localStorage.getItem('day-planner-native-time-overrides') || '{}');
              const key = String(draggedTask.nativeEventId);
              if (overrides[key]) {
                overrides[key] = { startTime, duration: draggedTask.duration || 60, date: dropDateStr };
                localStorage.setItem('day-planner-native-time-overrides', JSON.stringify(overrides));
              }
            }
          });
        }
      }
    } else if (dragSource === 'recycleBin') {
      // Remove metadata and add to calendar
      const { _deletedFrom, ...cleanTask } = draggedTask;
      setRecycleBin(prev => prev.filter(t => t.id !== draggedTask.id));
      setTasks(prev => [...prev, {
        ...cleanTask,
        startTime,
        date: dropDateStr,
        isAllDay: false
      }]);
    } else if (dragSource === 'overdue') {
      // Handle overdue tasks - they can be scheduled or deadline tasks
      if (draggedTask._overdueType === 'scheduled') {
        // Reschedule an existing scheduled task
        setTasks(prev => prev.map(t =>
          t.id === draggedTask.id
            ? { ...t, startTime, date: dropDateStr, isAllDay: false }
            : t
        ));
      } else if (draggedTask._overdueType === 'deadline') {
        // Schedule an overdue inbox task - remove from inbox, add to calendar
        setUnscheduledTasks(prev => prev.filter(t => t.id !== draggedTask.id));
        const { priority, deadline, _overdueType, ...taskWithoutMeta } = draggedTask;
        setTasks(prev => [...prev, {
          ...taskWithoutMeta,
          startTime,
          date: dropDateStr,
          isAllDay: false
        }]);
      }
    }

    // Show notification if task was rescheduled to avoid calendar conflict
    if (conflicted && conflictingEvent) {
      playUISound('error');
      setSyncNotification({
        type: 'info',
        title: 'Task Rescheduled',
        message: `Task moved to ${startTime} to avoid conflict with "${conflictingEvent.title}"`
      });
    }

    playUISound('drop');
    setDraggedTask(null);
    setDragSource(null);
    setDragPreviewTime(null);
    setDragPreviewDate(null);
  };

  const handleDropOnDateHeader = (e, targetDate) => {
    e.preventDefault();
    if (!draggedTask) return;

    // Routine chip drop — return to all-day (today only)
    if (dragSource === 'routine') {
      const dropDateStr = dateToString(targetDate);
      const todayStr = dateToString(new Date());
      if (dropDateStr !== todayStr) {
        setDraggedTask(null); setDragSource(null); setDragPreviewTime(null); setDragPreviewDate(null); setDragOverAllDay(null);
        return;
      }
      setTodayRoutines(prev => prev.map(r => r.id === draggedTask.id ? { ...r, startTime: null, isAllDay: true, lastModified: new Date().toISOString() } : r));
      setDraggedTask(null); setDragSource(null); setDragPreviewTime(null); setDragPreviewDate(null); setDragOverAllDay(null);
      return;
    }

    const dropDateStr = dateToString(targetDate);

    pushUndo();
    if (dragSource === 'inbox') {
      setUnscheduledTasks(prev => prev.filter(t => t.id !== draggedTask.id));
      const { priority, deadline, ...taskWithoutPriorityAndDeadline } = draggedTask;
      setTasks(prev => [...prev, {
        ...taskWithoutPriorityAndDeadline,
        startTime: '00:00',
        date: dropDateStr,
        isAllDay: true
      }]);
    } else if (dragSource === 'calendar') {
      if (draggedTask.isRecurring) {
        const parsed = parseRecurringId(draggedTask.id);
        if (parsed) {
          const { templateId, dateStr: origDateStr } = parsed;
          // Detach: mark deleted on original date, create regular all-day task
          setRecurringTasks(prev => prev.map(t => {
            if (t.id !== templateId) return t;
            return { ...t, exceptions: { ...t.exceptions, [origDateStr]: { ...t.exceptions?.[origDateStr], deleted: true } } };
          }));
          const { id, isRecurring, recurringTemplateId, ...taskData } = draggedTask;
          setTasks(prev => [...prev, { ...taskData, id: crypto.randomUUID(), startTime: '00:00', date: dropDateStr, isAllDay: true }]);
        }
      } else {
        setTasks(prev => prev.map(t =>
          t.id === draggedTask.id
            ? { ...t, startTime: '00:00', date: dropDateStr, isAllDay: true }
            : t
        ));
      }
    } else if (dragSource === 'recycleBin') {
      const { _deletedFrom, ...cleanTask } = draggedTask;
      setRecycleBin(prev => prev.filter(t => t.id !== draggedTask.id));
      setTasks(prev => [...prev, {
        ...cleanTask,
        startTime: '00:00',
        date: dropDateStr,
        isAllDay: true
      }]);
    } else if (dragSource === 'overdue') {
      // Handle overdue tasks - they can be scheduled or deadline tasks
      if (draggedTask._overdueType === 'scheduled') {
        // Reschedule an existing scheduled task to a new all-day slot
        setTasks(prev => prev.map(t =>
          t.id === draggedTask.id
            ? { ...t, startTime: '00:00', date: dropDateStr, isAllDay: true }
            : t
        ));
      } else if (draggedTask._overdueType === 'deadline') {
        // Schedule an overdue inbox task - remove from inbox, add to calendar
        setUnscheduledTasks(prev => prev.filter(t => t.id !== draggedTask.id));
        const { priority, deadline, _overdueType, ...taskWithoutMeta } = draggedTask;
        setTasks(prev => [...prev, {
          ...taskWithoutMeta,
          startTime: '00:00',
          date: dropDateStr,
          isAllDay: true
        }]);
      }
    }

    setDraggedTask(null);
    setDragSource(null);
    setDragPreviewTime(null);
    setDragPreviewDate(null);
    setDragOverAllDay(null);
  };

  const handleDropOnInbox = (e) => {
    e.preventDefault();
    if (!draggedTask) return;
    if (dragSource === 'routine') { setDraggedTask(null); setDragSource(null); setDragOverInbox(false); return; }

    // Only allow calendar, recycle bin, overdue scheduled tasks, and inbox tasks with deadlines to be moved to inbox
    if (dragSource !== 'calendar' && dragSource !== 'recycleBin' && dragSource !== 'overdue' && !(dragSource === 'inbox' && draggedTask.deadline)) return;

    pushUndo();
    if (dragSource === 'calendar') {
      if (draggedTask.isRecurring) {
        const parsed = parseRecurringId(draggedTask.id);
        if (parsed) {
          const { templateId, dateStr: origDateStr } = parsed;
          // Detach: mark deleted on original date, create regular inbox task
          setRecurringTasks(prev => prev.map(t => {
            if (t.id !== templateId) return t;
            return { ...t, exceptions: { ...t.exceptions, [origDateStr]: { ...t.exceptions?.[origDateStr], deleted: true } } };
          }));
          const { id, isRecurring, recurringTemplateId, startTime, date, ...taskData } = draggedTask;
          setUnscheduledTasks(prev => [...prev, { ...taskData, id: crypto.randomUUID(), priority: taskData.priority || 0 }]);
        }
      } else {
        setTasks(prev => prev.filter(t => t.id !== draggedTask.id));
        const { startTime, date, ...taskWithoutSchedule } = draggedTask;
        setUnscheduledTasks(prev => [...prev, { ...taskWithoutSchedule, priority: taskWithoutSchedule.priority || 0 }]);
      }
    } else if (dragSource === 'recycleBin') {
      setRecycleBin(prev => prev.filter(t => t.id !== draggedTask.id));
      const { _deletedFrom, startTime, date, ...taskWithoutSchedule } = draggedTask;
      setUnscheduledTasks(prev => [...prev, { ...taskWithoutSchedule, priority: taskWithoutSchedule.priority || 0 }]);
    } else if (dragSource === 'overdue' && draggedTask._overdueType === 'scheduled') {
      // Move overdue scheduled task back to inbox
      setTasks(prev => prev.filter(t => t.id !== draggedTask.id));
      const { startTime, date, _overdueType, ...taskWithoutSchedule } = draggedTask;
      setUnscheduledTasks(prev => [...prev, { ...taskWithoutSchedule, priority: taskWithoutSchedule.priority || 0 }]);
    } else if (dragSource === 'overdue' && draggedTask._overdueType === 'deadline') {
      // Clear deadline from overdue inbox task to move it back to regular inbox view
      clearDeadlineRef.current(draggedTask.id);
    } else if (dragSource === 'inbox' && draggedTask.deadline) {
      // Clear deadline from inbox task (moving from all-day section back to inbox)
      clearDeadlineRef.current(draggedTask.id);
    }

    playUISound('slide');
    setDraggedTask(null);
    setDragSource(null);
    setDragPreviewTime(null);
    setDragOverInbox(false);
  };

  const handleDropOnRecycleBin = (e) => {
    e.preventDefault();
    if (!draggedTask) return;
    if (dragSource === 'routine') { setDraggedTask(null); setDragSource(null); setDragOverRecycleBin(false); return; }

    // Recurring tasks: delegate to existing moveToRecycleBin (shows 3-option delete dialog)
    if (draggedTask.isRecurring) {
      moveToRecycleBinRef.current(draggedTask.id);
      setDraggedTask(null);
      setDragSource(null);
      setDragPreviewTime(null);
      setDragOverRecycleBin(false);
      return;
    }

    pushUndo();
    // Determine source and clean up task metadata
    let deletedFrom = 'calendar';
    let cleanTask = { ...draggedTask };

    if (dragSource === 'inbox') {
      deletedFrom = 'inbox';
    } else if (dragSource === 'overdue') {
      if (draggedTask._overdueType === 'scheduled') {
        deletedFrom = 'calendar';
      } else {
        deletedFrom = 'inbox';
      }
      // Remove overdue metadata
      const { _overdueType, ...rest } = cleanTask;
      cleanTask = rest;
    }

    // Add to recycle bin with metadata about where it came from
    const taskWithMeta = {
      ...cleanTask,
      _deletedFrom: deletedFrom,
      deletedAt: new Date().toISOString()
    };
    setRecycleBin(prev => [...prev, taskWithMeta]);

    // Remove from original location
    if (dragSource === 'inbox') {
      setUnscheduledTasks(prev => prev.filter(t => t.id !== draggedTask.id));
    } else if (dragSource === 'calendar') {
      setTasks(prev => prev.filter(t => t.id !== draggedTask.id));
    } else if (dragSource === 'overdue') {
      if (draggedTask._overdueType === 'scheduled') {
        setTasks(prev => prev.filter(t => t.id !== draggedTask.id));
      } else {
        setUnscheduledTasks(prev => prev.filter(t => t.id !== draggedTask.id));
      }
    }

    playUISound('swoosh');
    setDraggedTask(null);
    setDragSource(null);
    setDragPreviewTime(null);
    setDragOverRecycleBin(false);
  };

  return {
    // state
    draggedTask, setDraggedTask,
    dragSource, setDragSource,
    dragPreviewTime, setDragPreviewTime,
    dragPreviewDate, setDragPreviewDate,
    dragOverAllDay, setDragOverAllDay,
    dragOverInbox, setDragOverInbox,
    dragOverRecycleBin, setDragOverRecycleBin,
    hoverPreviewTime, setHoverPreviewTime,
    hoverPreviewDate, setHoverPreviewDate,
    isResizing, setIsResizing,
    // refs
    autoScrollInterval,
    frameResizingRef,
    stickyHeaderRef,
    // position helpers
    getHourHeight,
    minutesToPosition,
    positionToMinutes,
    durationToHeight,
    calculateTaskPosition,
    // cursor + calendar hover/click handlers
    getTimeFromCursorPosition,
    openNewTaskAtTime,
    handleCalendarMouseMove,
    handleCalendarMouseLeave,
    // desktop drag start/end + auto-scroll
    handleDragStart,
    handleDragEnd,
    updateDragAutoScroll,
    // desktop drag-over handlers
    handleDragOver,
    handleDragOverInbox,
    handleDragOverRecycleBin,
    // desktop drop on calendar + date header
    handleDropOnCalendar,
    handleDropOnDateHeader,
    // desktop drop on inbox + recycle bin
    handleDropOnInbox,
    handleDropOnRecycleBin,
  };
}
