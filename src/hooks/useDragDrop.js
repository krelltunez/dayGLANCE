import { useState, useRef } from 'react';
import { dateToString } from '../utils/taskUtils.js';

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

export default function useDragDrop({ calendarRef, timeGridRef, setNewTask, setShowAddTask, selectedDate, setExpandedNotesTaskId }) {
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
  };
}
