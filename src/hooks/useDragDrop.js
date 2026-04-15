import { useState, useRef } from 'react';
import { dateToString } from '../utils/taskUtils.js';
import { TASK_COLORS } from '../utils/colorUtils.js';
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

// Compute whether a touch point is over the Trash FAB using CSS-derived coordinates.
// Avoids a ref timing race (the FAB ref is null until React commits the render that mounts it).
// Tablet FAB (DesktopLayout): left: calc(340px + 1rem), bottom: calc(1.5rem), w-16 h-16
// Mobile FAB (MobileLayout):  left-4 (1rem),            bottom: 4.5rem,       w-16 h-16
const isOverTrashFAB = (touchX, touchY, padding = 24) => {
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const vh = window.visualViewport?.height ?? window.innerHeight;
  if (window.innerWidth >= 721) {
    return touchX >= 340 + 1 * rem - padding &&
           touchX <= 340 + 5 * rem + padding &&
           touchY >= vh - 5.5 * rem - padding &&
           touchY <= vh - 1.5 * rem + padding;
  }
  return touchX >= 1 * rem - padding &&
         touchX <= 5 * rem + padding &&
         touchY >= vh - 8.5 * rem - padding &&
         touchY <= vh - 4.5 * rem + padding;
};

export default function useDragDrop({
  calendarRef, timeGridRef,
  setNewTask, setShowAddTask, selectedDate, setExpandedNotesTaskId,
  tasks, setTasks, setUnscheduledTasks, setRecurringTasks, setRecycleBin, setTodayRoutines,
  pushUndo, parseRecurringId, getAdjustedTimeForImportedConflicts, wouldExceedMaxColumns,
  playUISound, setSyncNotification, onboardingProgress, setOnboardingProgress,
  moveToRecycleBinRef, clearDeadlineRef,
  gtdFrames, setGtdFrames,
  unscheduledTasks, setMobileEditingTask,
  expandedRecurringTasksRef, moveToInboxRef, openMobileEditTaskRef, openMobileEditNativeEventRef,
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

  // Mobile drag state
  const [mobileDragPreviewTime, setMobileDragPreviewTime] = useState(null);
  const [mobileDragPreviewDate, setMobileDragPreviewDate] = useState(null);
  const [mobileDragTaskIdState, setMobileDragTaskIdState] = useState(null);
  const [mobileDragIsRoutine, setMobileDragIsRoutine] = useState(false);
  const [mobileDragOverTrash, setMobileDragOverTrash] = useState(false);

  const autoScrollInterval = useRef(null); // For drag auto-scroll
  const frameResizingRef = useRef(false); // Suppress click-to-add-task after frame resize drag
  const stickyHeaderRef = useRef(null); // For measuring sticky header height during drag

  // Mobile swipe gesture refs
  const swipeTouchStartX = useRef(0);
  const swipeTouchStartY = useRef(0);
  const swipeCurrentOffset = useRef(0);
  const swipedTaskId = useRef(null);
  const swipeDirection = useRef(null); // 'left' | 'right' | null
  const swipeLocked = useRef(false);
  const swipeIsVertical = useRef(false);
  const swipeTaskElement = useRef(null);
  const swipeSchedulingInboxTaskId = useRef(null); // inbox task being scheduled via swipe

  // Mobile long-press drag refs
  const mobileDragActive = useRef(false);
  const mobileDragTaskId = useRef(null);
  const mobileDragTimer = useRef(null);
  const mobileDragOriginalTask = useRef(null);
  const mobileDragTouchStartPos = useRef({ x: 0, y: 0 });
  const mobileDragAutoScrollInterval = useRef(null);
  const mobileDragLastTouch = useRef({ clientX: 0, clientY: 0 });
  const mobileDragScrollDir = useRef(null);
  const mobileDragPreventScrollRef = useRef(null);
  const mobileDragStartScrollTop = useRef(0);
  const mobileDateHeaderRef = useRef(null);
  const mobileAllDaySectionRef = useRef(null);
  const mobileDragSourceType = useRef(null); // 'timeline' or 'allday'
  // Refs that mirror mobileDragPreviewTime/Date state — read in handleMobileLongPressEnd
  // to avoid stale-closure bugs when touchend fires before React commits the latest render.
  const mobileDragPreviewTimeRef = useRef(null);
  const mobileDragPreviewDateRef = useRef(null);
  const mobileDragOverTrashRef = useRef(false);
  const trashFabRef = useRef(null);

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
    if (frameResizingRef.current) { setHoverPreviewTime(null); setHoverPreviewDate(null); return; }
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

  const handleResizeStart = (task, e) => {
    e.stopPropagation();
    e.preventDefault();
    pushUndo();
    setIsResizing(true);

    const startY = e.clientY;
    const startDuration = task.duration;
    let finalDuration = startDuration;

    const isRecurringTask = task.isRecurring;
    const recurringInfo = isRecurringTask ? parseRecurringId(task.id) : null;

    // Prevent the browser from initiating a native drag on the parent draggable element
    const preventDrag = (de) => de.preventDefault();
    document.addEventListener('dragstart', preventDrag);

    const handleMouseMove = (moveEvent) => {
      const deltaY = moveEvent.clientY - startY;
      const deltaMinutes = Math.round((deltaY / 80) * 60 / 15) * 15;
      const newDuration = Math.max(15, startDuration + deltaMinutes);
      finalDuration = newDuration;

      if (isRecurringTask && recurringInfo) {
        const { templateId, dateStr } = recurringInfo;
        setRecurringTasks(prev => prev.map(t => {
          if (t.id !== templateId) return t;
          return { ...t, exceptions: { ...t.exceptions, [dateStr]: { ...t.exceptions?.[dateStr], duration: newDuration } } };
        }));
      } else {
        setTasks(prevTasks => prevTasks.map(t =>
          t.id === task.id ? { ...t, duration: newDuration } : t
        ));
      }
    };

    const handleMouseUp = () => {
      playUISound('tick');
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('dragstart', preventDrag);
      setIsResizing(false);
      // Sync resize back to the device calendar for native events
      if (task.nativeEventId && !isRecurringTask && task.startTime) {
        const endMin = timeToMinutes(task.startTime) + finalDuration;
        const newStart = `${task.date}T${task.startTime}:00`;
        const newEnd = `${task.date}T${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}:00`;
        nativeUpdateEvent({
          id: task.nativeEventId, title: task.title,
          start: newStart, end: newEnd, allDay: false,
          notes: task.notes || '', location: task.location || '',
        }).then(result => {
          if (!result?.success) {
            setTasks(prev => prev.map(t => t.id === task.id ? { ...t, duration: startDuration } : t));
          } else {
            // Keep the localStorage time-override in sync so a subsequent calendar
            // re-fetch doesn't restore the stale pre-resize duration from the override.
            const overrides = JSON.parse(localStorage.getItem('day-planner-native-time-overrides') || '{}');
            const key = String(task.nativeEventId);
            if (overrides[key]) {
              overrides[key] = { ...overrides[key], duration: finalDuration };
              localStorage.setItem('day-planner-native-time-overrides', JSON.stringify(overrides));
            }
          }
        });
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const handleTouchResizeStart = (task, e) => {
    e.stopPropagation();
    pushUndo();
    setIsResizing(true);

    const startY = e.touches[0].clientY;
    const startDuration = task.duration;
    let finalDuration = startDuration;

    const isRecurringTask = task.isRecurring;
    const recurringInfo = isRecurringTask ? parseRecurringId(task.id) : null;

    const handleTouchMove = (moveEvent) => {
      moveEvent.preventDefault();
      const deltaY = moveEvent.touches[0].clientY - startY;
      const deltaMinutes = Math.round((deltaY / 80) * 60 / 15) * 15;
      const newDuration = Math.max(15, startDuration + deltaMinutes);
      finalDuration = newDuration;

      if (isRecurringTask && recurringInfo) {
        const { templateId, dateStr } = recurringInfo;
        setRecurringTasks(prev => prev.map(t => {
          if (t.id !== templateId) return t;
          return { ...t, exceptions: { ...t.exceptions, [dateStr]: { ...t.exceptions?.[dateStr], duration: newDuration } } };
        }));
      } else {
        setTasks(prevTasks => prevTasks.map(t =>
          t.id === task.id ? { ...t, duration: newDuration } : t
        ));
      }
    };

    const handleTouchEnd = () => {
      playUISound('tick');
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
      setIsResizing(false);
      // Sync resize back to the device calendar for native events
      if (task.nativeEventId && !isRecurringTask && task.startTime) {
        const endMin = timeToMinutes(task.startTime) + finalDuration;
        const newStart = `${task.date}T${task.startTime}:00`;
        const newEnd = `${task.date}T${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}:00`;
        nativeUpdateEvent({
          id: task.nativeEventId, title: task.title,
          start: newStart, end: newEnd, allDay: false,
          notes: task.notes || '', location: task.location || '',
        }).then(result => {
          if (!result?.success) {
            setTasks(prev => prev.map(t => t.id === task.id ? { ...t, duration: startDuration } : t));
          } else {
            // Keep the localStorage time-override in sync so a subsequent calendar
            // re-fetch doesn't restore the stale pre-resize duration from the override.
            const overrides = JSON.parse(localStorage.getItem('day-planner-native-time-overrides') || '{}');
            const key = String(task.nativeEventId);
            if (overrides[key]) {
              overrides[key] = { ...overrides[key], duration: finalDuration };
              localStorage.setItem('day-planner-native-time-overrides', JSON.stringify(overrides));
            }
          }
        });
      }
    };

    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('touchend', handleTouchEnd);
  };

  const handleRoutineResizeStart = (routine, e) => {
    e.stopPropagation();
    e.preventDefault();
    setIsResizing(true);

    const startY = e.clientY;
    const startDuration = routine.duration;

    // Prevent the browser from initiating a native drag on the parent draggable element
    const preventDrag = (de) => de.preventDefault();
    document.addEventListener('dragstart', preventDrag);

    const handleMouseMove = (moveEvent) => {
      const deltaY = moveEvent.clientY - startY;
      const deltaMinutes = Math.round((deltaY / 80) * 60 / 15) * 15;
      const newDuration = Math.max(15, startDuration + deltaMinutes);
      setTodayRoutines(prev => prev.map(r => r.id === routine.id ? { ...r, duration: newDuration, lastModified: new Date().toISOString() } : r));
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('dragstart', preventDrag);
      setIsResizing(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const handleTouchRoutineResizeStart = (routine, e) => {
    e.stopPropagation();
    setIsResizing(true);

    const startY = e.touches[0].clientY;
    const startDuration = routine.duration;

    const handleTouchMove = (moveEvent) => {
      moveEvent.preventDefault();
      const deltaY = moveEvent.touches[0].clientY - startY;
      const deltaMinutes = Math.round((deltaY / 80) * 60 / 15) * 15;
      const newDuration = Math.max(15, startDuration + deltaMinutes);
      setTodayRoutines(prev => prev.map(r => r.id === routine.id ? { ...r, duration: newDuration, lastModified: new Date().toISOString() } : r));
    };

    const handleTouchEnd = () => {
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
      setIsResizing(false);
    };

    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('touchend', handleTouchEnd);
  };

  const handleFrameResizeStart = (frameId, dateStr, edge, e) => {
    e.preventDefault();
    e.stopPropagation();
    pushUndo();
    const frame = gtdFrames.find(f => f.id === frameId);
    if (!frame) return;
    const exception = frame.exceptions?.[dateStr];
    const origStart = timeToMinutes(exception?.start || frame.start);
    const origEnd = timeToMinutes(exception?.end || frame.end);
    const startY = e.clientY;

    const handleMouseMove = (moveEvent) => {
      frameResizingRef.current = true;
      const deltaY = moveEvent.clientY - startY;
      // Use approximate 80px per hour for desktop
      const deltaMinutes = Math.round((deltaY / 80) * 60 / 15) * 15;
      let newStart = origStart;
      let newEnd = origEnd;
      if (edge === 'top') {
        newStart = Math.max(0, Math.min(origEnd - 15, origStart + deltaMinutes));
      } else {
        newEnd = Math.max(newStart + 15, Math.min(1440, origEnd + deltaMinutes));
      }
      setGtdFrames(prev => prev.map(f => {
        if (f.id !== frameId) return f;
        return {
          ...f,
          lastModified: new Date().toISOString(),
          exceptions: {
            ...(f.exceptions || {}),
            [dateStr]: {
              ...(f.exceptions?.[dateStr] || {}),
              start: minutesToTime(newStart),
              end: minutesToTime(newEnd),
              deleted: false,
            },
          },
        };
      }));
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      if (frameResizingRef.current) {
        playUISound('tick');
        // Clear after click event has fired so openNewTaskAtTime can check it
        setTimeout(() => { frameResizingRef.current = false; }, 0);
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  // --- Mobile long-press drag helpers ---
  const updateMobileDragPreview = () => {
    if (!calendarRef.current || !mobileDragOriginalTask.current) return;
    const touch = mobileDragLastTouch.current;

    // If finger is over the trash FAB zone, freeze the time preview and mark for deletion.
    {
      const overTrash = isOverTrashFAB(touch.clientX, touch.clientY);
      if (overTrash !== mobileDragOverTrashRef.current) {
        mobileDragOverTrashRef.current = overTrash;
        setMobileDragOverTrash(overTrash);
        if (overTrash && navigator.vibrate) navigator.vibrate(30);
      }
      if (overTrash) return; // freeze preview time — don't update while over trash
    }

    const calendarRect = calendarRef.current.getBoundingClientRect();
    const scrollTop = calendarRef.current.scrollTop;
    // Detect which date column the finger is over
    const columns = calendarRef.current.querySelectorAll('[data-date-column]');
    for (const col of columns) {
      const rect = col.getBoundingClientRect();
      if (touch.clientX >= rect.left && touch.clientX < rect.right) {
        mobileDragPreviewDateRef.current = col.getAttribute('data-date-column');
        setMobileDragPreviewDate(mobileDragPreviewDateRef.current);
        break;
      }
    }
    // Detect if finger is in the date header or all-day section (all-day zone)
    const headerBottom = mobileDateHeaderRef.current?.getBoundingClientRect().bottom ?? 0;
    const allDayBottom = mobileAllDaySectionRef.current?.getBoundingClientRect().bottom;
    const allDayZoneBottom = allDayBottom || headerBottom;
    if (touch.clientY < allDayZoneBottom) {
      mobileDragPreviewTimeRef.current = 'all-day';
      setMobileDragPreviewTime('all-day');
      return;
    }
    // For all-day and deadline source tasks, use absolute position (finger = time)
    if (mobileDragSourceType.current === 'allday' || mobileDragSourceType.current === 'deadline') {
      if (!timeGridRef.current) return;
      const headerHeight = timeGridRef.current.offsetTop;
      const y = Math.max(0, touch.clientY - calendarRect.top + scrollTop - headerHeight);
      const totalMinutes = positionToMinutes(y);
      const roundedMinutes = Math.round(totalMinutes / 15) * 15;
      const clampedMinutes = Math.max(0, Math.min(23 * 60 + 45, roundedMinutes));
      const hrs = Math.floor(clampedMinutes / 60);
      const mins = clampedMinutes % 60;
      mobileDragPreviewTimeRef.current = `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
      setMobileDragPreviewTime(mobileDragPreviewTimeRef.current);
      return;
    }
    // For timeline source tasks, use delta-based computation (no jump)
    const currentY = touch.clientY - calendarRect.top + scrollTop;
    const startY = mobileDragTouchStartPos.current.y - calendarRect.top + mobileDragStartScrollTop.current;
    const deltaPixels = currentY - startY;
    const deltaMinutes = (deltaPixels / getHourHeight()) * 60;
    const originalMinutes = timeToMinutes(mobileDragOriginalTask.current.startTime);
    const newMinutes = originalMinutes + deltaMinutes;
    const roundedMinutes = Math.round(newMinutes / 15) * 15;
    const clampedMinutes = Math.max(0, Math.min(23 * 60 + 45, roundedMinutes));
    const hrs = Math.floor(clampedMinutes / 60);
    const mins = clampedMinutes % 60;
    const timeStr = `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
    mobileDragPreviewTimeRef.current = timeStr;
    setMobileDragPreviewTime(timeStr);
  };

  const handleMobileLongPressMove = (touch) => {
    if (!calendarRef.current) return;
    mobileDragLastTouch.current = { clientX: touch.clientX, clientY: touch.clientY };
    updateMobileDragPreview();

    if (mobileDragOverTrashRef.current) return; // suppress auto-scroll while over trash

    // Auto-scroll near edges
    const allDayZoneBottom = mobileAllDaySectionRef.current?.getBoundingClientRect().bottom || mobileDateHeaderRef.current?.getBoundingClientRect().bottom || 0;
    const inAllDayZone = touch.clientY < allDayZoneBottom;
    const calendarRect = calendarRef.current.getBoundingClientRect();
    const scrollZoneSize = 60;
    // Measure scroll-up zone from below the sticky headers, not from calendar top
    const distFromTimeGridTop = touch.clientY - allDayZoneBottom;
    const distFromBottom = calendarRect.bottom - touch.clientY;

    let newDir = null;
    if (inAllDayZone) {
      // Don't auto-scroll while hovering over the all-day drop zone
    } else if (distFromTimeGridTop < scrollZoneSize && distFromTimeGridTop > 0) {
      newDir = 'up';
    } else if (distFromBottom < scrollZoneSize && distFromBottom > 0) {
      newDir = 'down';
    }

    if (newDir !== mobileDragScrollDir.current) {
      mobileDragScrollDir.current = newDir;
      if (mobileDragAutoScrollInterval.current) {
        clearInterval(mobileDragAutoScrollInterval.current);
        mobileDragAutoScrollInterval.current = null;
      }
      if (newDir) {
        const scrollSpeed = 8;
        mobileDragAutoScrollInterval.current = setInterval(() => {
          if (!calendarRef.current) return;
          const el = calendarRef.current;
          const maxScroll = el.scrollHeight - el.clientHeight;
          if (newDir === 'down' && el.scrollTop >= maxScroll) return;
          if (newDir === 'up' && el.scrollTop <= 0) return;
          el.scrollTop += (newDir === 'up' ? -scrollSpeed : scrollSpeed);
          updateMobileDragPreview();
        }, 16);
      }
    }
  };

  // --- Mobile swipe + long-press drag handlers ---
  const handleMobileTaskTouchStart = (e, task, taskType) => {
    // Skip swipe for imported items that can't be moved; allow drag for native calendar events
    if (task.imported && !task.nativeEventId && !task.isTaskCalendar) return;
    const touch = e.touches[0];
    swipeTouchStartX.current = touch.clientX;
    swipeTouchStartY.current = touch.clientY;
    swipeCurrentOffset.current = 0;
    swipedTaskId.current = task.id;
    swipeDirection.current = null;
    swipeLocked.current = false;
    swipeIsVertical.current = false;
    // Use the swipe container (flex wrapper with tab + content) as transform target
    // so the drag tab slides with the content. Fall back to e.currentTarget for
    // tasks without a container (all-day, deadline, inbox).
    swipeTaskElement.current = e.currentTarget.closest('[data-swipe-container]') || e.currentTarget;

    // Start long-press timer for timeline, all-day, and deadline tasks
    // Only allow drag initiation from dedicated drag handles (data-drag-handle attribute)
    // or from routine pills (which are entirely draggable, no handle needed)
    const isFromDragHandle = e.target.closest('[data-drag-handle]');
    // Drag handle initiates a long-press drag, not a swipe — disable swipe tracking
    if (isFromDragHandle) {
      swipedTaskId.current = null;
    }
    const isRoutine = task.isRoutineDrag;
    if ((taskType === 'timeline' || taskType === 'allday' || taskType === 'deadline') && (!task.imported || task.nativeEventId || task.isTaskCalendar) && (isFromDragHandle || isRoutine)) {
      mobileDragTouchStartPos.current = { x: touch.clientX, y: touch.clientY };
      mobileDragTaskId.current = task.id;
      mobileDragOriginalTask.current = task;
      mobileDragSourceType.current = taskType;
      mobileDragTimer.current = setTimeout(() => {
        mobileDragActive.current = true;
        setMobileDragTaskIdState(task.id);
        setMobileDragIsRoutine(!!task.isRoutineDrag);
        // Capture initial scroll position and finger position for delta-based drag
        if (calendarRef.current) {
          mobileDragStartScrollTop.current = calendarRef.current.scrollTop;
          calendarRef.current.style.overflowY = 'hidden';
        }
        // Set initial preview based on source
        const _initTime = (taskType === 'allday' || taskType === 'deadline') ? 'all-day' : task.startTime;
        const _initDate = task.date || dateToString(selectedDate);
        mobileDragPreviewTimeRef.current = _initTime;
        mobileDragPreviewDateRef.current = _initDate;
        setMobileDragPreviewTime(_initTime);
        setMobileDragPreviewDate(_initDate);
        // Add native non-passive touchmove listener to prevent browser scroll
        // (React 18 registers touchmove as passive, so e.preventDefault() in onTouchMove is a no-op).
        // Also update the drag preview here so the trash FAB hit-test stays current even when
        // the element-level onTouchMove is suppressed (e.g. tablet with touchAction ancestor).
        const preventScroll = (e) => {
          e.preventDefault();
          if (mobileDragActive.current && e.touches[0]) {
            mobileDragLastTouch.current = { clientX: e.touches[0].clientX, clientY: e.touches[0].clientY };
            updateMobileDragPreview();
          }
        };
        document.addEventListener('touchmove', preventScroll, { passive: false });
        mobileDragPreventScrollRef.current = preventScroll;
        // Suppress iOS text selection / magnifier during drag
        window.getSelection()?.removeAllRanges();
        document.body.style.webkitUserSelect = 'none';
        document.body.style.userSelect = 'none';
        // Haptic feedback
        if (navigator.vibrate) navigator.vibrate(50);
      }, 500);
    }
  };

  const handleMobileTaskTouchMove = (e) => {
    const touch = e.touches[0];
    const dx = touch.clientX - swipeTouchStartX.current;
    const dy = touch.clientY - swipeTouchStartY.current;

    // If drag is active, handle drag movement
    if (mobileDragActive.current) {
      e.preventDefault();
      handleMobileLongPressMove(touch);
      return;
    }

    // Cancel long-press if finger moved too far before timer fired
    if (mobileDragTimer.current) {
      const dragDist = Math.sqrt(
        Math.pow(touch.clientX - mobileDragTouchStartPos.current.x, 2) +
        Math.pow(touch.clientY - mobileDragTouchStartPos.current.y, 2)
      );
      if (dragDist > 10) {
        clearTimeout(mobileDragTimer.current);
        mobileDragTimer.current = null;
      }
    }

    // If touchstart was blocked (e.g. imported events), ignore swipe gestures
    if (swipedTaskId.current == null) return;

    // Swipe direction lock
    if (!swipeLocked.current) {
      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);
      if (absDx < 10 && absDy < 10) return;
      if (absDy > absDx) {
        swipeIsVertical.current = true;
        swipeLocked.current = true;
        return;
      }
      swipeLocked.current = true;
      swipeDirection.current = dx > 0 ? 'right' : 'left';
      // Show only the relevant swipe strip
      const parent = swipeTaskElement.current?.parentElement;
      if (parent) {
        const strip = parent.querySelector(`[data-swipe-strip="${swipeDirection.current}"]`);
        if (strip) strip.style.display = 'flex';
      }
    }

    if (swipeIsVertical.current) return;

    e.preventDefault();
    swipeCurrentOffset.current = dx;
    if (swipeTaskElement.current) {
      swipeTaskElement.current.style.transform = `translateX(${dx}px)`;
      swipeTaskElement.current.style.transition = 'none';
    }
  };

  // --- Mobile long-press drag end ---
  const handleMobileLongPressEnd = (e) => {
    if (mobileDragAutoScrollInterval.current) {
      clearInterval(mobileDragAutoScrollInterval.current);
      mobileDragAutoScrollInterval.current = null;
    }
    mobileDragScrollDir.current = null;
    // Re-enable scroll on timeline after drag
    if (calendarRef.current) calendarRef.current.style.overflowY = 'scroll';
    // Remove native touchmove prevention listener
    if (mobileDragPreventScrollRef.current) {
      document.removeEventListener('touchmove', mobileDragPreventScrollRef.current);
      mobileDragPreventScrollRef.current = null;
    }
    // Restore text selection after drag
    document.body.style.webkitUserSelect = '';
    document.body.style.userSelect = '';

    // Use refs instead of state to avoid stale-closure bugs when touchend fires
    // before React has committed the latest setMobileDragPreviewTime render.
    const _previewTime = mobileDragPreviewTimeRef.current;
    const _previewDate = mobileDragPreviewDateRef.current;

    // Fallback: check release position in case the touchmove handler missed it.
    const releasedTouch = e?.changedTouches?.[0];
    if (mobileDragActive.current && releasedTouch && !mobileDragOverTrashRef.current) {
      if (isOverTrashFAB(releasedTouch.clientX, releasedTouch.clientY)) {
        mobileDragOverTrashRef.current = true;
      }
    }

    // Drop on trash FAB: delete the task
    if (mobileDragActive.current && mobileDragOverTrashRef.current && mobileDragOriginalTask.current) {
      moveToRecycleBinRef.current(mobileDragOriginalTask.current.id);
      playUISound('delete');
      mobileDragActive.current = false;
      mobileDragTaskId.current = null;
      mobileDragOriginalTask.current = null;
      mobileDragSourceType.current = null;
      mobileDragPreviewTimeRef.current = null;
      mobileDragPreviewDateRef.current = null;
      mobileDragOverTrashRef.current = false;
      setMobileDragPreviewTime(null);
      setMobileDragPreviewDate(null);
      setMobileDragTaskIdState(null);
      setMobileDragIsRoutine(false);
      setMobileDragOverTrash(false);
      return;
    }

    if (mobileDragActive.current && _previewTime && mobileDragOriginalTask.current) {
      const task = mobileDragOriginalTask.current;
      const droppingToAllDay = _previewTime === 'all-day';
      const newTime = droppingToAllDay ? '00:00' : _previewTime;
      const fromAllDay = mobileDragSourceType.current === 'allday';
      const dropDateStr = _previewDate || dateToString(selectedDate);

      // Check for conflicts with imported calendar events and routines (same as desktop)
      let finalTime = newTime;
      let conflicted = false;
      let conflictingEvent = null;
      if (!droppingToAllDay && !task.isRoutineDrag) {
        const result = getAdjustedTimeForImportedConflicts(
          task.id,
          newTime,
          task.duration || 30,
          dropDateStr
        );
        finalTime = result.adjustedStartTime;
        conflicted = result.conflicted;
        conflictingEvent = result.conflictingEvent;
      }

      // If dragging from all-day back to all-day, no change needed
      if (fromAllDay && droppingToAllDay) {
        // no-op
      } else if (task.isDeadlineDrag) {
        // Deadline task: move from unscheduled to scheduled
        pushUndo();
        setUnscheduledTasks(prev => prev.filter(t => t.id !== task.id));
        setTasks(prev => [...prev, {
          id: task.id,
          title: task.title,
          startTime: droppingToAllDay ? '00:00' : finalTime,
          duration: task.duration || 30,
          date: dropDateStr,
          isAllDay: droppingToAllDay,
          color: task.color || TASK_COLORS[0].class,
          notes: task.notes || '',
          subtasks: task.subtasks || [],
          completed: task.completed || false,
        }]);
      } else if (typeof task.id === 'string' && task.id.startsWith('recurring-')) {
        // Recurring task instances via exceptions
        const parsed = parseRecurringId(task.id);
        if (parsed) {
          pushUndo();
          setRecurringTasks(prev => prev.map(t => {
            if (t.id === parsed.templateId) {
              return {
                ...t,
                exceptions: {
                  ...t.exceptions,
                  [parsed.dateStr]: {
                    ...(t.exceptions?.[parsed.dateStr] || {}),
                    startTime: finalTime,
                    isAllDay: droppingToAllDay,
                    duration: task.duration,
                  }
                }
              };
            }
            return t;
          }));
        }
      } else if (task.isRoutineDrag) {
        // Routine chip: update time/all-day on todayRoutines
        if (droppingToAllDay) {
          setTodayRoutines(prev => prev.map(r => r.id === task.id ? { ...r, startTime: null, isAllDay: true, lastModified: new Date().toISOString() } : r));
        } else {
          setTodayRoutines(prev => prev.map(r => r.id === task.id ? { ...r, startTime: newTime, isAllDay: false, lastModified: new Date().toISOString() } : r));
        }
      } else {
        // Regular task: update time, isAllDay status, and date (for cross-column drag)
        pushUndo();
        const prevTask = task;
        const fromAllDayToTimed = fromAllDay && !droppingToAllDay && !!task.nativeEventId;

        // Native all-day calendar event time overrides.
        if (task.nativeEventId) {
          const overrides = JSON.parse(localStorage.getItem('day-planner-native-time-overrides') || '{}');
          const key = String(task.nativeEventId);
          if (droppingToAllDay && overrides[key]) {
            delete overrides[key];
            localStorage.setItem('day-planner-native-time-overrides', JSON.stringify(overrides));
          } else if (fromAllDayToTimed) {
            overrides[key] = { startTime: finalTime, duration: task.duration || 60, date: dropDateStr };
            localStorage.setItem('day-planner-native-time-overrides', JSON.stringify(overrides));
          }
        }

        setTasks(prev => prev.map(t => t.id === task.id ? {
          ...t,
          startTime: finalTime,
          isAllDay: droppingToAllDay,
          date: dropDateStr,
        } : t));
        // Sync native Android calendar events back to the device calendar
        if (task.nativeEventId && !droppingToAllDay && finalTime) {
          const endMin = timeToMinutes(finalTime) + (task.duration || 60);
          const newStart = `${dropDateStr}T${finalTime}:00`;
          const newEnd = `${dropDateStr}T${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}:00`;
          nativeUpdateEvent({
            id: task.nativeEventId, title: task.title,
            start: newStart, end: newEnd, allDay: false,
            notes: task.notes || '', location: task.location || '',
          }).then(result => {
            if (!result?.success) {
              if (!fromAllDayToTimed) {
                setTasks(prev => prev.map(t => t.id === prevTask.id ? prevTask : t));
              }
            } else if (task.nativeEventId) {
              const overrides = JSON.parse(localStorage.getItem('day-planner-native-time-overrides') || '{}');
              const key = String(task.nativeEventId);
              if (overrides[key]) {
                overrides[key] = { startTime: finalTime, duration: task.duration || 60, date: dropDateStr };
                localStorage.setItem('day-planner-native-time-overrides', JSON.stringify(overrides));
              }
            }
          });
        }
      }
      // Show notification if task was rescheduled to avoid calendar conflict
      if (conflicted && conflictingEvent) {
        playUISound('error');
        setSyncNotification({
          type: 'info',
          title: 'Task Rescheduled',
          message: `Task moved to ${finalTime} to avoid conflict with "${conflictingEvent.title}"`
        });
      }
      if (!(fromAllDay && droppingToAllDay)) {
        playUISound(droppingToAllDay ? 'drop' : 'slide');
      }
    }

    mobileDragActive.current = false;
    mobileDragTaskId.current = null;
    mobileDragOriginalTask.current = null;
    mobileDragSourceType.current = null;
    mobileDragPreviewTimeRef.current = null;
    mobileDragPreviewDateRef.current = null;
    mobileDragOverTrashRef.current = false;
    setMobileDragPreviewTime(null);
    setMobileDragPreviewDate(null);
    setMobileDragTaskIdState(null);
    setMobileDragIsRoutine(false);
    setMobileDragOverTrash(false);
  };

  // --- Mobile touch end (swipe actions) ---
  const handleMobileTaskTouchEnd = (e, taskId, taskType) => {
    // Clear long-press timer
    if (mobileDragTimer.current) {
      clearTimeout(mobileDragTimer.current);
      mobileDragTimer.current = null;
    }

    // If drag was active, handle drag end
    if (mobileDragActive.current) {
      handleMobileLongPressEnd(e);
      return;
    }

    const offset = swipeCurrentOffset.current;
    const el = swipeTaskElement.current;

    // Helper to hide swipe strips
    const hideSwipeStrips = (element) => {
      const parent = element?.parentElement;
      if (parent) {
        parent.querySelectorAll('[data-swipe-strip]').forEach(strip => {
          strip.style.display = 'none';
        });
      }
    };

    // If touchstart was blocked (e.g. imported events), stale refs can cause false swipe actions — bail out
    if (swipedTaskId.current == null || swipedTaskId.current !== taskId) {
      if (el) { el.style.transform = ''; el.style.transition = ''; hideSwipeStrips(el); }
      swipeCurrentOffset.current = 0;
      swipedTaskId.current = null;
      return;
    }

    if (!el || swipeIsVertical.current || !swipeLocked.current) {
      // Reset
      if (el) {
        el.style.transform = '';
        el.style.transition = '';
        hideSwipeStrips(el);
      }
      swipeCurrentOffset.current = 0;
      swipedTaskId.current = null;
      return;
    }

    const elWidth = el.offsetWidth;
    const threshold = elWidth * 0.4;
    const isRecurring = typeof taskId === 'string' && taskId.startsWith('recurring-');
    const isRightSwipeBlocked = false;

    if (Math.abs(offset) > threshold && !isRightSwipeBlocked) {
      // Trigger action
      if (navigator.vibrate) navigator.vibrate(40);
      const direction = offset > 0 ? 'right' : 'left';
      // Animate off-screen
      el.style.transform = `translateX(${direction === 'right' ? elWidth : -elWidth}px)`;
      el.style.transition = 'transform 200ms ease-out';
      setTimeout(() => {
        if (direction === 'right') {
          if (taskType === 'timeline') {
            const swipedTask = tasks.find(t => t.id === taskId);
            if (swipedTask?._native) {
              // Native calendar events can't be moved to inbox; no-op
            } else if (isRecurring) {
              // Recurring: trigger delete popup
              moveToRecycleBinRef.current(taskId);
            } else {
              moveToInboxRef.current(taskId);
            }
          } else if (taskType === 'allday') {
            if (isRecurring) {
              // Recurring: trigger delete popup
              moveToRecycleBinRef.current(taskId);
            } else {
              moveToInboxRef.current(taskId);
            }
          } else if (taskType === 'deadline') {
            // Clear deadline — moves back to regular inbox
            clearDeadlineRef.current(taskId);
          } else if (taskType === 'inbox') {
            // Schedule: open edit modal as scheduled task
            const task = unscheduledTasks.find(t => t.id === taskId);
            if (task) {
              // Track which inbox task we're scheduling (removed on submit, restored on cancel)
              swipeSchedulingInboxTaskId.current = taskId;
              setMobileEditingTask(null);
              setNewTask({
                title: task.title,
                startTime: getNextQuarterHour(),
                duration: task.duration || 30,
                date: dateToString(selectedDate),
                isAllDay: false,
                color: task.color || TASK_COLORS[0].class,
                recurrence: null,
              });
              setShowAddTask(true);
            }
          }
        } else {
          // Left swipe = edit
          const isInbox = taskType === 'inbox' || taskType === 'deadline';
          const task = isInbox
            ? unscheduledTasks.find(t => t.id === taskId)
            : tasks.find(t => t.id === taskId) || (
                typeof taskId === 'string' && taskId.startsWith('recurring-')
                  ? expandedRecurringTasksRef.current?.find(t => t.id === taskId)
                  : null
              );
          if (task && task._native && task.nativeEventId) {
            openMobileEditNativeEventRef.current(task);
          } else if (task && !task.imported) {
            openMobileEditTaskRef.current(task, isInbox);
          }
        }
        // Reset element
        if (el) {
          el.style.transform = '';
          el.style.transition = '';
          hideSwipeStrips(el);
        }
      }, 200);
    } else {
      // Snap back
      el.style.transform = 'translateX(0)';
      el.style.transition = 'transform 200ms ease-out';
      setTimeout(() => {
        if (el) {
          el.style.transform = '';
          el.style.transition = '';
          hideSwipeStrips(el);
        }
      }, 200);
    }

    swipeCurrentOffset.current = 0;
    swipedTaskId.current = null;
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
    // task resize handlers
    handleResizeStart,
    handleTouchResizeStart,
    // routine + frame resize handlers
    handleRoutineResizeStart,
    handleTouchRoutineResizeStart,
    handleFrameResizeStart,
    // mobile drag state
    mobileDragPreviewTime, setMobileDragPreviewTime,
    mobileDragPreviewDate, setMobileDragPreviewDate,
    mobileDragTaskIdState, setMobileDragTaskIdState,
    mobileDragIsRoutine,
    mobileDragOverTrash,
    trashFabRef,
    // mobile swipe refs
    swipeTouchStartX,
    swipeTouchStartY,
    swipeCurrentOffset,
    swipedTaskId,
    swipeDirection,
    swipeLocked,
    swipeIsVertical,
    swipeTaskElement,
    swipeSchedulingInboxTaskId,
    // mobile long-press drag refs
    mobileDragActive,
    mobileDragTaskId,
    mobileDragTimer,
    mobileDragOriginalTask,
    mobileDragTouchStartPos,
    mobileDragAutoScrollInterval,
    mobileDragLastTouch,
    mobileDragScrollDir,
    mobileDragPreventScrollRef,
    mobileDragStartScrollTop,
    mobileDateHeaderRef,
    mobileAllDaySectionRef,
    mobileDragSourceType,
    mobileDragPreviewTimeRef,
    mobileDragPreviewDateRef,
    // mobile touch start + move
    handleMobileTaskTouchStart,
    handleMobileTaskTouchMove,
    // mobile touch end (swipe actions)
    handleMobileTaskTouchEnd,
  };
}
