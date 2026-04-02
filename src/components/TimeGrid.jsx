import React from 'react';
import {
  BookOpen, Check, CheckSquare, Clock, ExternalLink,
  FileText, GripVertical, Inbox, MapPin, MoreHorizontal,
  NotebookPen, Pencil, RefreshCw, Settings, SkipForward, Trash2,
} from 'lucide-react';
import { isNativeAndroid, nativeUpdateEvent } from '../native.js';
import { renderTitleWithoutTags, getLinkUrl, hasNotesOrSubtasks, isLinkOnlyTask, hasOnlySubtasks, isObsidianNoteOnlyTask } from '../utils/textFormatting.jsx';
import { dateToString, extractTags, extractWikilinks, stripWikilinks } from '../utils/taskUtils.js';
import SuggestionAutocomplete from './SuggestionAutocomplete.jsx';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';

const TimeGrid = () => {
  const {
    isTablet,
    hours, visibleDates,
    currentTimeRef, timeGridRef, calendarRef,
    editingInputRef, longPressTimerRef, longPressTriggeredRef,
    darkMode, use24HourClock,
    borderClass, cardBg, textPrimary, textSecondary, hoverBg,
    tasks, setTasks,
    conflicts,
    projectFilter, setProjectFilter,
    taskWidths,
    expandedNotesTaskId, setExpandedNotesTaskId,
    expandedTaskMenu, setExpandedTaskMenu,
    editingTaskId, editingTaskText,
    showSuggestions, suggestions, selectedSuggestionIndex, suggestionContext,
    taskContextMenu, setTaskContextMenu,
    setTimelineContextMenu,
    setFrameContextMenu,
    currentTimeTop,
    routinesEnabled, todayRoutines,
    hoverPreviewTime, hoverPreviewDate,
    draggedTask,
    dragPreviewTime, setDragPreviewTime,
    dragPreviewDate, setDragPreviewDate,
    isResizing,
    mobileDragPreviewTime, mobileDragPreviewDate, mobileDragTaskIdState,
    setTaskRef,
    setEditingRecurrenceTaskId,
    handleDragStart, handleDragEnd,
    handleDragOver, handleDropOnCalendar,
    handleCalendarMouseMove, handleCalendarMouseLeave,
    handleMobileTaskTouchStart, handleMobileTaskTouchMove, handleMobileTaskTouchEnd,
    handleFrameResizeStart,
    handleResizeStart, handleTouchResizeStart,
    handleRoutineResizeStart, handleTouchRoutineResizeStart,
    handleEditInputChange, handleEditKeyDown,
    openNewTaskAtTime, openMobileEditTask,
    toggleComplete,
    startEditingTask, saveTaskTitle,
    applySuggestionForEdit,
    moveToInbox, moveToRecycleBin, postponeTask,
    formatTime, timeToMinutes, minutesToTime,
    getTasksForDate, getFrameInstancesForDate,
    getTaskCalendarStyle,
    computeAvailableSlots,
  } = useDayPlannerCtx();

  return (
<div
  ref={timeGridRef}
  className="relative"
  onDragLeave={(e) => {
    // Clear preview when leaving the calendar grid entirely
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setDragPreviewTime(null);
      setDragPreviewDate(null);
    }
  }}
>
  {hours.map((hour, index) => (
    <div key={hour} className="relative">
      {/* Main hour row with solid border */}
      <div className={`flex border-b ${index === 0 ? `border-t` : ''} ${borderClass} ${index % 2 === 1 ? (darkMode ? 'bg-white/[0.04]' : 'bg-stone-100/50') : ''}`}>
        <div className={`w-16 flex-shrink-0 px-3 py-1 text-sm ${textSecondary} border-r ${borderClass}`}>
          {use24HourClock
            ? `${hour.toString().padStart(2, '0')}:00`
            : <>{hour === 0 ? 12 : hour > 12 ? hour - 12 : hour}<span className="text-[10px] ml-0.5">{hour >= 12 ? 'PM' : 'AM'}</span></>
          }
        </div>
        {visibleDates.map((date, idx) => (
          <div
            key={dateToString(date)}
            data-ctx-menu
            className={`flex-1 relative h-40 calendar-slot ${idx > 0 ? `border-l ${borderClass}` : ''}`}
            data-date={dateToString(date)}
            onDragOver={(e) => handleDragOver(e, date)}
            onDrop={(e) => handleDropOnCalendar(e, date)}
            onClick={(e) => openNewTaskAtTime(e, date)}
            onMouseMove={(e) => handleCalendarMouseMove(e, date)}
            onMouseLeave={handleCalendarMouseLeave}
            onContextMenu={(e) => {
              if (!e.target.classList.contains('calendar-slot')) return;
              e.preventDefault();
              if (!calendarRef.current || !timeGridRef.current) return;
              const rect = calendarRef.current.getBoundingClientRect();
              const scrollTop = calendarRef.current.scrollTop;
              const headerHeight = timeGridRef.current.offsetTop;
              const y = Math.max(0, e.clientY - rect.top + scrollTop - headerHeight);
              const minutes = Math.round(positionToMinutes(y) / 15) * 15;
              setTimelineContextMenu({ x: e.clientX, y: e.clientY, dateStr: dateToString(date), timeMinutes: minutes });
            }}
          ></div>
        ))}
      </div>
      {/* Half-hour dashed line (no label) */}
      <div className="absolute left-0 right-0 pointer-events-none" style={{ top: '80px' }}>
        <div className={`flex border-b border-dashed ${borderClass} opacity-50`}>
          <div className="w-16 flex-shrink-0"></div>
          {visibleDates.map((date, idx) => (
            <div key={dateToString(date)} className={`flex-1 ${idx > 0 ? `border-l ${borderClass}` : ''}`}></div>
          ))}
        </div>
      </div>
    </div>
  ))}

  {/* Task overlay for each day column */}
  <div className="absolute top-0 left-16 right-0 bottom-0 pointer-events-none flex">
    {visibleDates.map((date, dayIndex) => {
      const dateStr = dateToString(date);
      const isDateToday = dateStr === dateToString(new Date());
      const dayTasks = getTasksForDate(date).filter(t => !t.isAllDay && (!projectFilter || t.projectId === projectFilter));
      const frameInstances = getFrameInstancesForDate(date);

      return (
        <div
          key={dateStr}
          data-date-column={dateStr}
          className={`flex-1 relative ${dayIndex > 0 ? `border-l ${borderClass}` : ''}`}
        >
          {/* GTD Frame background zones */}
          {frameInstances.map(frame => {
            const frameStartMin = timeToMinutes(frame.start);
            const frameEndMin = timeToMinutes(frame.end);
            const top = Math.round(minutesToPosition(frameStartMin));
            const bottom = Math.round(minutesToPosition(frameEndMin));
            const height = bottom - top;
            const colorMap = darkMode ? {
              'bg-indigo-200': 'rgba(165,180,252,0.08)',
              'bg-amber-200': 'rgba(253,230,138,0.08)',
              'bg-green-200': 'rgba(167,243,208,0.08)',
              'bg-blue-200': 'rgba(191,219,254,0.08)',
              'bg-rose-200': 'rgba(254,205,211,0.08)',
              'bg-purple-200': 'rgba(221,214,254,0.08)',
              'bg-teal-200': 'rgba(153,246,228,0.08)',
              'bg-orange-200': 'rgba(254,215,170,0.08)',
            } : {
              'bg-indigo-200': 'rgba(165,180,252,0.18)',
              'bg-amber-200': 'rgba(253,230,138,0.18)',
              'bg-green-200': 'rgba(167,243,208,0.18)',
              'bg-blue-200': 'rgba(191,219,254,0.18)',
              'bg-rose-200': 'rgba(254,205,211,0.18)',
              'bg-purple-200': 'rgba(221,214,254,0.18)',
              'bg-teal-200': 'rgba(153,246,228,0.18)',
              'bg-orange-200': 'rgba(254,215,170,0.18)',
            };
            const borderColorMap = darkMode ? {
              'bg-indigo-200': 'rgba(165,180,252,0.4)',
              'bg-amber-200': 'rgba(253,230,138,0.4)',
              'bg-green-200': 'rgba(167,243,208,0.4)',
              'bg-blue-200': 'rgba(191,219,254,0.4)',
              'bg-rose-200': 'rgba(254,205,211,0.4)',
              'bg-purple-200': 'rgba(221,214,254,0.4)',
              'bg-teal-200': 'rgba(153,246,228,0.4)',
              'bg-orange-200': 'rgba(254,215,170,0.4)',
            } : {
              'bg-indigo-200': 'rgba(79,70,229,0.75)',
              'bg-amber-200': 'rgba(217,119,6,0.75)',
              'bg-green-200': 'rgba(22,163,74,0.75)',
              'bg-blue-200': 'rgba(37,99,235,0.75)',
              'bg-rose-200': 'rgba(225,29,72,0.75)',
              'bg-purple-200': 'rgba(147,51,234,0.75)',
              'bg-teal-200': 'rgba(13,148,136,0.75)',
              'bg-orange-200': 'rgba(234,88,12,0.75)',
            };
            const availableSlots = computeAvailableSlots(frame, date);
            return (
              <div key={frame.frameId}>
                <div
                  data-ctx-menu
                  className="absolute left-0 right-0 rounded-sm pointer-events-auto select-none"
                  style={{
                    top: `${top}px`,
                    height: `${height}px`,
                    background: colorMap[frame.color] || (darkMode ? 'rgba(165,180,252,0.08)' : 'rgba(165,180,252,0.18)'),
                    borderLeft: `3px solid ${borderColorMap[frame.color] || (darkMode ? 'rgba(165,180,252,0.4)' : 'rgba(79,70,229,0.75)')}`,
                  }}
                  onContextMenu={(e) => { e.preventDefault(); setFrameContextMenu({ x: e.clientX, y: e.clientY, frameId: frame.frameId, dateStr }); }}
                  onDragOver={(e) => handleDragOver(e, date)}
                  onDrop={(e) => handleDropOnCalendar(e, date)}
                  onMouseMove={(e) => handleCalendarMouseMove(e, date, true)}
                  onMouseLeave={handleCalendarMouseLeave}
                  onClick={(e) => openNewTaskAtTime(e, date, true)}
                >
                  <span className="absolute top-1 left-1.5 text-[10px] font-medium pointer-events-none select-none" style={{ color: borderColorMap[frame.color] || (darkMode ? 'rgba(165,180,252,0.4)' : 'rgba(79,70,229,0.75)') }}>
                    {frame.label}
                  </span>
                  {/* Resize handles */}
                  <div
                    className="absolute top-0 left-0 right-0 h-2 cursor-n-resize"
                    onMouseDown={(e) => handleFrameResizeStart(frame.frameId, dateStr, 'top', e)}
                  />
                  <div
                    className="absolute bottom-0 left-0 right-0 h-2 cursor-s-resize"
                    onMouseDown={(e) => handleFrameResizeStart(frame.frameId, dateStr, 'bottom', e)}
                  />
                </div>
                {/* Dashed outlines for available slots */}
                {availableSlots.map((slot, si) => {
                  const slotTop = Math.round(minutesToPosition(timeToMinutes(slot.start)));
                  const slotBottom = Math.round(minutesToPosition(timeToMinutes(slot.end)));
                  const slotHeight = slotBottom - slotTop;
                  if (slotHeight < 4) return null;
                  return (
                    <div
                      key={`avail-${frame.frameId}-${si}`}
                      className="absolute left-1 right-1 rounded pointer-events-none"
                      style={{
                        top: `${slotTop}px`,
                        height: `${slotHeight}px`,
                        border: `1.5px dashed ${borderColorMap[frame.color] || (darkMode ? 'rgba(165,180,252,0.4)' : 'rgba(79,70,229,0.75)')}`,
                        opacity: 0.5,
                      }}
                    />
                  );
                })}
              </div>
            );
          })}

          {/* Current time line - only on today */}
          {isDateToday && (
            <div
              ref={currentTimeRef}
              className="absolute left-0 right-0 pointer-events-none z-10"
              style={{ top: `${currentTimeTop}px` }}
            >
              <div className="flex items-center">
                <div className="w-2 h-2 bg-red-500 rounded-full -ml-1"></div>
                <div className="flex-1 h-0.5 bg-red-500"></div>
              </div>
            </div>
          )}

          {/* Tasks for this day */}
          {dayTasks.map((task) => {
            const { top, height } = calculateTaskPosition(task);
            const isConflicted = conflicts.some(c => c.includes(task.id));
            const conflictPos = calculateConflictPosition(task, dayTasks);
            const isImported = task.imported;
            const isCalendarEvent = isImported && !task.isTaskCalendar;
            const taskCalendarStyle = getTaskCalendarStyle(task, darkMode);
            const isPastEvent = isCalendarEvent && isDateToday && (timeToMinutes(task.startTime) + task.duration) <= (new Date().getHours() * 60 + new Date().getMinutes());
            const _nowMinT = new Date().getHours() * 60 + new Date().getMinutes();
            const _taskStartT = timeToMinutes(task.startTime || '0:00');
            const isCurrentTask = isDateToday && !task.isAllDay && !task.completed && !isCalendarEvent && _nowMinT >= _taskStartT && _nowMinT < _taskStartT + (task.duration || 0);

            // Layout tiers for timeline tasks
            const isMicroHeight = height <= 40;  // 15min tasks
            const taskWidth = taskWidths[task.id];
            const isMeasured = taskWidth !== undefined;
            const isNarrowWidth = taskWidth < 300;

            // Layout: narrow (< 300px) or wide (>= 300px), same for all heights
            // Default: wide layout (30+ min, >= 200px)

            // Action buttons component (reused in different layouts)
            const isRecurringTask = typeof task.id === 'string' && task.id.startsWith('recurring-');

            // Notes button (shared across all variants)
            const NotesButton = ({ inMenu = false }) => (
                <button
                  onMouseDown={() => {
                    if (isLinkOnlyTask(task)) {
                      longPressTriggeredRef.current = false;
                      longPressTimerRef.current = setTimeout(() => {
                        longPressTriggeredRef.current = true;
                        setExpandedNotesTaskId(prev => prev === task.id ? null : task.id);
                      }, 500);
                    }
                  }}
                  onMouseUp={() => { if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current); }}
                  onMouseLeave={() => { if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current); }}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (isLinkOnlyTask(task)) {
                      if (!longPressTriggeredRef.current) {
                        window.open(getLinkUrl(task), '_blank', 'noopener,noreferrer');
                      }
                      longPressTriggeredRef.current = false;
                    } else {
                      setExpandedNotesTaskId(prev => prev === task.id ? null : task.id);
                    }
                  }}
                  className={`hover:bg-white/20 rounded p-1 transition-colors ${inMenu ? 'flex items-center gap-2 w-full' : ''} ${hasNotesOrSubtasks(task) || (task.importSource === 'obsidian' && extractWikilinks(task.title).length > 0) ? '' : 'opacity-40'}`}
                  title={isLinkOnlyTask(task) ? `${getLinkUrl(task)} (hold to edit)` : "Notes & subtasks"}
                >
                  {isLinkOnlyTask(task) ? <ExternalLink size={14} /> : hasOnlySubtasks(task) ? <CheckSquare size={14} /> : isObsidianNoteOnlyTask(task) ? <BookOpen size={14} /> : <FileText size={14} />}
                  {inMenu && <span className="text-xs">{isLinkOnlyTask(task) ? 'Open Link' : 'Notes'}</span>}
                </button>
            );

            const ActionButtons = ({ inMenu = false }) => {
              if (isRecurringTask) {
                // Recurring: Notes (tablet+desktop), Edit + Delete (desktop only)
                return (
                  <>
                    <NotesButton inMenu={inMenu} />
                    {!isTablet && (
                    <button
                      onClick={() => openMobileEditTask(task, false)}
                      className={`hover:bg-white/20 rounded p-1 transition-colors ${inMenu ? 'flex items-center gap-2 w-full' : ''}`}
                      title="Edit"
                    >
                      <Pencil size={14} />
                      {inMenu && <span className="text-xs">Edit</span>}
                    </button>
                    )}
                    {!isTablet && (
                    <button
                      onClick={() => moveToRecycleBin(task.id)}
                      className={`hover:bg-white/20 rounded p-1 transition-colors ${inMenu ? 'flex items-center gap-2 w-full' : ''}`}
                      title="Delete"
                    >
                      <Trash2 size={14} />
                      {inMenu && <span className="text-xs">Delete</span>}
                    </button>
                    )}
                  </>
                );
              }
              // Non-recurring: Notes, Postpone (all), Edit + Inbox (desktop only)
              return (
                <>
                  <NotesButton inMenu={inMenu} />
                  <button
                    onClick={() => postponeTask(task.id)}
                    className={`hover:bg-white/20 rounded p-1 transition-colors ${inMenu ? 'flex items-center gap-2 w-full' : ''}`}
                    title="Postpone to tomorrow"
                  >
                    <SkipForward size={14} />
                    {inMenu && <span className="text-xs">Postpone</span>}
                  </button>
                  {!isTablet && (
                  <button
                    onClick={() => openMobileEditTask(task, false)}
                    className={`hover:bg-white/20 rounded p-1 transition-colors ${inMenu ? 'flex items-center gap-2 w-full' : ''}`}
                    title="Edit"
                  >
                    <Pencil size={14} />
                    {inMenu && <span className="text-xs">Edit</span>}
                  </button>
                  )}
                  {!isTablet && (
                  <button
                    onClick={() => moveToInbox(task.id)}
                    className={`hover:bg-white/20 rounded p-1 transition-colors ${inMenu ? 'flex items-center gap-2 w-full' : ''}`}
                    title="Move to Inbox"
                  >
                    <Inbox size={14} />
                    {inMenu && <span className="text-xs">To Inbox</span>}
                  </button>
                  )}
                </>
              );
            };

            return (
              <div
                key={task.id}
                ref={setTaskRef(task.id)}
                data-task-id={task.id}
                data-ctx-menu
                onContextMenu={(e) => {
                  e.preventDefault();
                  setTaskContextMenu({
                    x: e.clientX, y: e.clientY,
                    taskId: task.id,
                    isRecurring: !!isRecurringTask,
                    isImported: !!isImported,
                    isAllDay: !!task.isAllDay,
                    dateStr,
                  });
                }}
                draggable={(!isImported || task.isTaskCalendar || !!task.nativeEventId) && !isTablet}
                onDragStart={(e) => (!isImported || task.isTaskCalendar || !!task.nativeEventId) && handleDragStart(task, 'calendar', e)}
                onDragEnd={handleDragEnd}
                onDragOver={(e) => handleDragOver(e, date)}
                onDrop={(e) => handleDropOnCalendar(e, date)}
                className={`absolute notes-panel-container ${task.isTaskCalendar || isTablet ? '' : task.color} ${isTablet ? '' : 'rounded-lg shadow-md'} pointer-events-auto ${isImported && !task.isTaskCalendar || isTablet ? 'cursor-default' : 'cursor-move'} ${(task.completed && (!isImported || task.isTaskCalendar)) || isPastEvent ? 'opacity-50' : ''} ${isTablet ? '' : expandedNotesTaskId === task.id ? 'overflow-visible z-30' : ''} ${task.isExample ? 'border-2 border-dashed border-white/50' : ''} ${isCurrentTask ? 'current-task-pulse' : ''}`}
                style={{
                  top: `${top}px`,
                  height: `${height}px`,
                  minHeight: isMicroHeight ? '27px' : '39px',
                  left: conflictPos.left,
                  right: conflictPos.right,
                  width: conflictPos.width,
                  visibility: isMeasured ? 'visible' : 'hidden',
                  ...(isTablet ? { touchAction: 'pan-y' } : {}),
                  ...(isTablet ? {} : taskCalendarStyle)
                }}
              >
                {task.isExample && !isTablet && (
                  <span className="absolute -top-2 -right-2 bg-yellow-400 text-yellow-900 text-[10px] font-bold px-1.5 py-0.5 rounded-full shadow-sm z-10">
                    Example
                  </span>
                )}
                {/* Tablet swipe strips - outside flex wrapper so they stay stationary */}
                {isTablet && !isImported && (
                  <>
                    <div data-swipe-strip="right" style={{ display: 'none' }} className={`absolute inset-0 ${isRecurringTask ? (darkMode ? 'bg-red-900/80 text-red-300' : 'bg-red-100 text-red-600') : (darkMode ? 'bg-blue-900/80 text-blue-300' : 'bg-blue-100 text-blue-600')} rounded-lg flex items-center pl-3 text-xs font-medium`}>
                      {isRecurringTask ? (
                        <><Trash2 size={14} className="mr-1" />Delete</>
                      ) : (
                        <><Inbox size={14} className="mr-1" />Inbox</>
                      )}
                    </div>
                    <div data-swipe-strip="left" style={{ display: 'none' }} className={`absolute inset-0 ${darkMode ? 'bg-amber-900/80 text-amber-300' : 'bg-amber-100 text-amber-600'} rounded-lg flex items-center justify-end pr-3 text-xs font-medium`}>
                      Edit<Settings size={14} className="ml-1" />
                    </div>
                  </>
                )}
                <div className={`${isTablet ? 'flex h-full items-start' : 'h-full'}`} {...(isTablet ? { 'data-swipe-container': true } : {})}>
                {/* Protruding drag tab (tablet only) */}
                {isTablet && (!isImported || task.isTaskCalendar || !!task.nativeEventId) && (
                  <div
                    data-drag-handle
                    className={`${task.isTaskCalendar || task.nativeCalendarColor ? '' : task.color} rounded-l-lg flex items-center pl-px cursor-grab active:opacity-70 text-white/70 flex-shrink-0 relative`}
                    style={{ width: '20px', height: '24px', marginTop: '3px', marginRight: '-8px', touchAction: 'none', zIndex: 10, ...(task.isTaskCalendar ? { backgroundColor: darkMode ? '#4b5563' : '#6b7280' } : task.nativeCalendarColor ? { backgroundColor: task.nativeCalendarColor } : {}) }}
                    onTouchStart={(e) => handleMobileTaskTouchStart(e, task, 'timeline')}
                    onTouchMove={(e) => handleMobileTaskTouchMove(e)}
                    onTouchEnd={(e) => handleMobileTaskTouchEnd(e, task.id, 'timeline')}
                    onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
                  >
                    <div className="absolute top-0 left-0 h-full rounded-l-lg border-l border-t border-b border-white/20 pointer-events-none" style={{ width: '12px' }} />
                    <div className="absolute top-0 border-t border-white/20 pointer-events-none" style={{ left: '12px', width: '2px' }} />
                    <GripVertical size={14} />
                  </div>
                )}
                <div className={`${isTablet ? 'flex-1 min-w-0 rounded-lg shadow-md' : ''} h-full ${isTablet ? (expandedNotesTaskId === task.id ? 'overflow-visible z-30' : 'overflow-hidden') : ''}`}>
                {task.isExample && isTablet && (
                  <span className="absolute -top-2 -right-2 bg-yellow-400 text-yellow-900 text-[10px] font-bold px-1.5 py-0.5 rounded-full shadow-sm z-10">
                    Example
                  </span>
                )}
                <div
                {...(isTablet && (!isImported || task.isTaskCalendar || !!task.nativeEventId) ? {
                  onTouchStart: (e) => handleMobileTaskTouchStart(e, task, 'timeline'),
                  onTouchMove: (e) => handleMobileTaskTouchMove(e),
                  onTouchEnd: (e) => handleMobileTaskTouchEnd(e, task.id, 'timeline'),
                } : {})}
                className={`h-full flex text-white rounded-lg relative ${isTablet && !task.isTaskCalendar && !task.nativeCalendarColor ? task.color : ''} ${isTablet ? 'select-none' : ''}`}
                style={{ ...(isTablet ? { touchAction: 'pan-y', ...taskCalendarStyle } : {}) }}
                >
                  <div className="px-2 py-1 flex-1 min-w-0 h-full flex flex-col">
                  {/* IMPORTED EVENT LAYOUT: Always show time on right with truncated title */}
                  {isImported && !task.isTaskCalendar ? (
                    <div className="flex flex-col h-full justify-between gap-0.5">
                      <div className="flex items-center justify-between gap-2">
                        <div
                          className="font-semibold text-sm leading-tight truncate flex-1 min-w-0"
                          title={task.title}
                        >
                          {stripWikilinks(task.title)}
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          {task.notes && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setExpandedNotesTaskId(prev => prev === task.id ? null : task.id);
                              }}
                              className="notes-toggle-button hover:bg-white/20 rounded p-1 transition-colors"
                              title="View description"
                            >
                              <FileText size={12} />
                            </button>
                          )}
                          <div className="text-xs opacity-90 whitespace-nowrap flex items-center gap-1">
                            <Clock size={10} />
                            {formatTime(task.startTime)} • {task.duration}m
                          </div>
                        </div>
                      </div>
                      {!isMicroHeight && (task.calendarName || task.location) && (
                        <div className="text-xs opacity-75 truncate flex items-center gap-1">
                          {task.calendarName && <span className="truncate max-w-[50%]">{task.calendarName}</span>}
                          {task.calendarName && task.location && <span className="opacity-50">·</span>}
                          {task.location && <><MapPin size={9} /><span className="truncate">{task.location}</span></>}
                        </div>
                      )}
                    </div>
                  ) : isNarrowWidth ? (
                    /* NARROW LAYOUT: overflow menu + checkbox + title + tags */
                    <>
                      {!isImported && (
                        <button
                          onClick={() => setExpandedTaskMenu(expandedTaskMenu === task.id ? null : task.id)}
                          className="task-menu-container absolute top-0.5 right-0.5 hover:bg-white/20 rounded p-0.5 transition-colors z-10"
                        >
                          <MoreHorizontal size={14} />
                          {expandedTaskMenu === task.id && (
                            <div className="task-menu-container absolute top-full right-0 mt-1 bg-white dark:bg-gray-800 rounded-lg p-1 z-30 shadow-xl border border-stone-300 dark:border-gray-700 min-w-[100px] text-gray-800 dark:text-white">
                              <ActionButtons inMenu={true} />
                            </div>
                          )}
                        </button>
                      )}
                      <div className="pr-6">
                        <div className="flex items-center gap-1">
                          {(!isImported || task.isTaskCalendar) && (
                            <button
                              onClick={() => toggleComplete(task.id)}
                              className={`rounded flex-shrink-0 ${task.completed ? 'bg-white/40' : 'bg-white/20'} border-2 border-white w-4 h-4 flex items-center justify-center hover:bg-white/30 transition-colors`}
                            >
                              {task.completed && <Check size={10} strokeWidth={3} />}
                            </button>
                          )}
                          {task.isRecurring && <RefreshCw size={12} className="flex-shrink-0 opacity-75 hover:opacity-100 cursor-pointer" onClick={(e) => { e.stopPropagation(); setEditingRecurrenceTaskId(task.id); }} />}
                          {task.importSource === 'obsidian' && <BookOpen size={12} className="flex-shrink-0 opacity-75" title="From Obsidian" />}
                          <div className="flex-1 min-w-0">
                            {!isTablet && editingTaskId === task.id ? (
                              <div className="relative tag-autocomplete-container">
                                <input
                                  type="text"
                                  value={editingTaskText}
                                  onChange={(e) => handleEditInputChange(e, false)}
                                  onKeyDown={(e) => handleEditKeyDown(e, false)}
                                  onBlur={() => {
                                    setTimeout(() => {
                                      if (!showSuggestions) {
                                        saveTaskTitle(false);
                                      }
                                    }, 100);
                                  }}
                                  autoFocus
                                  className="w-full bg-white/20 text-white font-semibold text-sm px-1 py-0.5 rounded border border-white/30 outline-none focus:bg-white/30"
                                  onClick={(e) => e.stopPropagation()}
                                />
                                {showSuggestions && suggestionContext === 'editing' && (
                                  <SuggestionAutocomplete
                                    suggestions={suggestions}
                                    selectedIndex={selectedSuggestionIndex}
                                    onSelect={(suggestion) => applySuggestionForEdit(suggestion, editingInputRef.current, false)}
                                    cardBg={cardBg}
                                    borderClass={borderClass}
                                    textPrimary={textPrimary}
                                    hoverBg={hoverBg}
                                  />
                                )}
                              </div>
                            ) : (
                              <div className="flex items-center gap-0.5">
                                <div
                                  className={`${task.isTaskCalendar ? 'font-bold' : 'font-semibold'} text-sm leading-tight truncate flex-1 min-w-0 ${task.completed ? 'line-through' : ''} ${!isImported && !isTablet ? 'cursor-text' : ''}`}
                                  onDoubleClick={!isTablet ? (e) => {
                                    if (!isImported) {
                                      e.stopPropagation();
                                      startEditingTask(task, false);
                                    }
                                  } : undefined}
                                  title={task.title}
                                >
                                  {renderTitleWithoutTags(task.title)}
                                </div>
                                {isNativeAndroid() && extractWikilinks(task.title).map((note, i) => (
                                  <button key={i} className="flex-shrink-0 text-purple-200 active:text-purple-100" onClick={(e) => { e.stopPropagation(); window.DayGlanceObsidian?.openNote(note); }} title={`Open "${note}" in Obsidian`}><NotebookPen size={14} /></button>
                                ))}
                              </div>
                            )}
                            {(extractTags(task.title).length > 0 || (goalsProjectsEnabled && task.projectId)) && (
                              <div className="flex items-center gap-1 flex-wrap text-xs italic opacity-75">
                                {extractTags(task.title).length > 0 && (
                                  <span className="truncate">{extractTags(task.title).map(tag => `#${tag}`).join(' ')}</span>
                                )}
                                {goalsProjectsEnabled && task.projectId && (() => {
                                  const proj = projects.find(p => p.id === task.projectId);
                                  if (!proj) return null;
                                  return (
                                    <button
                                      onClick={(e) => { e.stopPropagation(); setProjectFilter(prev => prev === task.projectId ? null : task.projectId); }}
                                      className={`not-italic inline-flex items-center text-[10px] px-1.5 py-0.5 rounded-full bg-white/25 hover:bg-white/40 text-white font-medium transition-colors flex-shrink-0`}
                                      title={projectFilter === task.projectId ? 'Clear project filter' : `Filter: ${proj.title}`}
                                    >
                                      {proj.title}
                                    </button>
                                  );
                                })()}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </>
                  ) : (
                    /* WIDE LAYOUT: Title+tags row 1 with action buttons, time row 2 */
                    <>
                      <div className="flex items-center justify-between gap-1">
                        <div className="flex items-center gap-1 flex-1 min-w-0">
                          {(!isImported || task.isTaskCalendar) && (
                            <button
                              onClick={() => toggleComplete(task.id)}
                              className={`rounded flex-shrink-0 ${task.completed ? 'bg-white/40' : 'bg-white/20'} border-2 border-white w-4 h-4 flex items-center justify-center hover:bg-white/30 transition-colors`}
                            >
                              {task.completed && <Check size={10} strokeWidth={3} />}
                            </button>
                          )}
                          {task.isRecurring && <RefreshCw size={12} className="flex-shrink-0 opacity-75 hover:opacity-100 cursor-pointer" onClick={(e) => { e.stopPropagation(); setEditingRecurrenceTaskId(task.id); }} />}
                          {task.importSource === 'obsidian' && <BookOpen size={12} className="flex-shrink-0 opacity-75" title="From Obsidian" />}
                          <div className="flex-1 min-w-0">
                            {!isTablet && editingTaskId === task.id ? (
                              <div className="relative tag-autocomplete-container">
                                <input
                                  type="text"
                                  value={editingTaskText}
                                  onChange={(e) => handleEditInputChange(e, false)}
                                  onKeyDown={(e) => handleEditKeyDown(e, false)}
                                  onBlur={() => {
                                    setTimeout(() => {
                                      if (!showSuggestions) {
                                        saveTaskTitle(false);
                                      }
                                    }, 100);
                                  }}
                                  autoFocus
                                  className="w-full bg-white/20 text-white font-semibold text-sm px-1 py-0.5 rounded border border-white/30 outline-none focus:bg-white/30"
                                  onClick={(e) => e.stopPropagation()}
                                />
                                {showSuggestions && suggestionContext === 'editing' && (
                                  <SuggestionAutocomplete
                                    suggestions={suggestions}
                                    selectedIndex={selectedSuggestionIndex}
                                    onSelect={(suggestion) => applySuggestionForEdit(suggestion, editingInputRef.current, false)}
                                    cardBg={cardBg}
                                    borderClass={borderClass}
                                    textPrimary={textPrimary}
                                    hoverBg={hoverBg}
                                  />
                                )}
                              </div>
                            ) : (
                              <div className="flex items-center gap-0.5">
                                <div
                                  className={`${task.isTaskCalendar ? 'font-bold' : 'font-semibold'} text-sm leading-tight truncate flex-1 min-w-0 ${task.completed ? 'line-through' : ''} ${!isImported && !isTablet ? 'cursor-text' : ''}`}
                                  onDoubleClick={!isTablet ? (e) => {
                                    if (!isImported) {
                                      e.stopPropagation();
                                      startEditingTask(task, false);
                                    }
                                  } : undefined}
                                  title={!isImported && !isTablet ? "Double-click to edit" : undefined}
                                >
                                  {renderTitleWithoutTags(task.title)}
                                </div>
                                {isNativeAndroid() && extractWikilinks(task.title).map((note, i) => (
                                  <button key={i} className="flex-shrink-0 text-purple-200 active:text-purple-100" onClick={(e) => { e.stopPropagation(); window.DayGlanceObsidian?.openNote(note); }} title={`Open "${note}" in Obsidian`}><NotebookPen size={14} /></button>
                                ))}
                              </div>
                            )}
                            {(extractTags(task.title).length > 0 || (goalsProjectsEnabled && task.projectId)) && (
                              <div className="flex items-center gap-1 flex-wrap text-xs italic opacity-75">
                                {extractTags(task.title).length > 0 && (
                                  <span className="truncate">{extractTags(task.title).map(tag => `#${tag}`).join(' ')}</span>
                                )}
                                {goalsProjectsEnabled && task.projectId && (() => {
                                  const proj = projects.find(p => p.id === task.projectId);
                                  if (!proj) return null;
                                  return (
                                    <button
                                      onClick={(e) => { e.stopPropagation(); setProjectFilter(prev => prev === task.projectId ? null : task.projectId); }}
                                      className={`not-italic inline-flex items-center text-[10px] px-1.5 py-0.5 rounded-full bg-white/25 hover:bg-white/40 text-white font-medium transition-colors flex-shrink-0`}
                                      title={projectFilter === task.projectId ? 'Clear project filter' : `Filter: ${proj.title}`}
                                    >
                                      {proj.title}
                                    </button>
                                  );
                                })()}
                              </div>
                            )}
                          </div>
                        </div>
                        {!isImported && (
                          <div className="flex items-center gap-0.5 flex-shrink-0">
                            <ActionButtons />
                          </div>
                        )}
                      </div>
                      {!isImported && height >= 55 && (
                        <div className="text-xs opacity-90 whitespace-nowrap flex items-center gap-1 mt-0.5">
                          <Clock size={10} />
                          {formatTime(task.startTime)} • {task.duration}min
                        </div>
                      )}
                    </>
                  )}
                  </div>{/* end content wrapper */}
                  {/* Resize handle at bottom - solid white for visibility */}
                  {(!isImported || !!task.nativeEventId) && (
                    <div
                      onMouseDown={(e) => handleResizeStart(task, e)}
                      onTouchStart={(e) => handleTouchResizeStart(task, e)}
                      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
                      className="absolute bottom-0 left-1/3 right-1/3 h-3 cursor-ns-resize hover:bg-white/20 flex items-center justify-center select-none"
                      style={{ marginBottom: '-4px', touchAction: 'none', WebkitTouchCallout: 'none' }}
                    >
                      <div className="w-12 h-1 bg-white rounded-full"></div>
                    </div>
                  )}
                  {/* Notes panel - floating below task (or above if task ends after 22:00) */}
                  {expandedNotesTaskId === task.id && !isImported && (() => {
                    const startMin = timeToMinutes(task.startTime || '0:00');
                    const endMin = startMin + (task.duration || 0);
                    const showAbove = endMin >= 22 * 60;
                    return (
                      <div
                        className="notes-panel-container absolute left-0 right-0 z-40"
                        style={showAbove ? { bottom: `${height}px` } : { top: `${height}px` }}
                      >
                        <div className={`${task.color} rounded-lg shadow-lg ${showAbove ? 'mb-1' : 'mt-1'}`}>
                          <NotesSubtasksPanel
                            task={task}
                            isInbox={false}
                            darkMode={darkMode}
                            updateTaskNotes={updateTaskNotes}
                            addSubtask={addSubtask}
                            toggleSubtask={toggleSubtask}
                            deleteSubtask={deleteSubtask}
                            updateSubtaskTitle={updateSubtaskTitle}
                            compact={false}
                            aiConfig={aiConfig}
                            aiSubtasksLoadingForTask={aiSubtasksLoadingForTask}
                            onGenerateSubtasks={generateAISubtasks}
                            wikilinks={task.importSource === 'obsidian' ? extractWikilinks(task.title) : undefined}
                            onLoadWikiNote={task.importSource === 'obsidian' ? loadWikiNote : undefined}
                            onSaveWikiNote={task.importSource === 'obsidian' ? saveWikiNote : undefined}
                          />
                        </div>
                      </div>
                    );
                  })()}
                  {/* Editable notes panel for imported calendar events */}
                  {expandedNotesTaskId === task.id && isImported && (() => {
                    const startMin = timeToMinutes(task.startTime || '0:00');
                    const endMin = startMin + (task.duration || 0);
                    const showAbove = endMin >= 22 * 60;
                    return (
                      <div
                        className="notes-panel-container absolute left-0 right-0 z-40"
                        style={showAbove ? { bottom: `${height}px` } : { top: `${height}px` }}
                      >
                        <div className={`${task.color} rounded-lg shadow-lg ${showAbove ? 'mb-1' : 'mt-1'}`}>
                          <div className={`p-3 rounded-lg ${darkMode ? 'bg-black/30' : 'bg-white/30'} text-white`} onClick={(e) => e.stopPropagation()}>
                            <div className="text-xs font-semibold opacity-75 mb-1">Description</div>
                            <textarea
                              defaultValue={task.notes || ''}
                              placeholder="Add description…"
                              rows={3}
                              className="w-full text-sm p-2 rounded bg-white/10 text-white placeholder:text-white/40 resize-y focus:outline-none focus:bg-white/20"
                              onBlur={async (e) => {
                                const newNotes = e.target.value;
                                if (newNotes === (task.notes || '')) return;
                                setTasks(prev => prev.map(t => t.id === task.id ? { ...t, notes: newNotes } : t));
                                if (isNativeAndroid() && task.nativeEventId) {
                                  await nativeUpdateEvent({
                                    id: task.nativeEventId,
                                    title: task.title,
                                    start: `${task.date}T${task.startTime}:00`,
                                    end: `${task.date}T${minutesToTime(timeToMinutes(task.startTime || '0:00') + (task.duration || 0))}:00`,
                                    allDay: false,
                                    notes: newNotes,
                                    location: task.location || '',
                                  });
                                }
                              }}
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </div>
                </div>{/* end inner overflow (tablet) */}
                </div>{/* end flex items-start (tablet) */}
              </div>
            );
          })}

          {/* Timeline routine pills (today only) */}
          {routinesEnabled && dateStr === dateToString(new Date()) && (() => {
            const timelineRoutines = todayRoutines.filter(r => !r.isAllDay && r.startTime);
            if (timelineRoutines.length === 0) return null;

            // Compute side-by-side columns for overlapping routine chips
            const routineColumns = [];
            const sorted = [...timelineRoutines].sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));
            sorted.forEach(r => {
              const rStart = timeToMinutes(r.startTime);
              const rEnd = rStart + r.duration;
              let placed = false;
              for (let c = 0; c < routineColumns.length; c++) {
                const lastInCol = routineColumns[c][routineColumns[c].length - 1];
                if (timeToMinutes(lastInCol.startTime) + lastInCol.duration <= rStart) {
                  routineColumns[c].push(r);
                  placed = true;
                  break;
                }
              }
              if (!placed) routineColumns.push([r]);
            });

            // Build a map from routine id to its column index
            const colMap = {};
            routineColumns.forEach((col, ci) => col.forEach(r => { colMap[r.id] = ci; }));

            // For each routine, compute max simultaneously active routines at any point in its span
            const overlapCount = {};
            timelineRoutines.forEach(r => {
              const rStart = timeToMinutes(r.startTime);
              const rEnd = rStart + r.duration;
              // Collect event points: r's own start + starts of any routine beginning within r's span
              const eventPoints = new Set([rStart]);
              timelineRoutines.forEach(other => {
                const oStart = timeToMinutes(other.startTime);
                if (oStart > rStart && oStart < rEnd) eventPoints.add(oStart);
              });
              // Max simultaneous active routines at any event point
              let maxCols = 0;
              eventPoints.forEach(t => {
                let count = 0;
                timelineRoutines.forEach(other => {
                  const oStart = timeToMinutes(other.startTime);
                  const oEnd = oStart + other.duration;
                  if (oStart <= t && oEnd > t) count++;
                });
                maxCols = Math.max(maxCols, count);
              });
              overlapCount[r.id] = maxCols;
            });

            const now = new Date();
            const nowMinutes = now.getHours() * 60 + now.getMinutes();

            return timelineRoutines.map(routine => {
              const { top, height } = calculateTaskPosition(routine);
              const colIdx = colMap[routine.id];
              const cols = overlapCount[routine.id];
              const widthPercent = cols > 1 ? `${100 / cols}%` : '100%';
              const leftPercent = cols > 1 ? `${(colIdx * 100) / cols}%` : '0%';
              const endMinutes = timeToMinutes(routine.startTime) + routine.duration;
              const isPast = endMinutes <= nowMinutes;

              return (
                <div
                  key={`routine-tl-${routine.id}`}
                  draggable={!isTablet}
                  onDragStart={!isTablet ? (e) => handleDragStart({ ...routine }, 'routine', e) : undefined}
                  onDragEnd={!isTablet ? handleDragEnd : undefined}
                  onDragOver={(e) => handleDragOver(e, date)}
                  onDrop={(e) => handleDropOnCalendar(e, date)}
                  {...(isTablet ? {
                    onTouchStart: (e) => handleMobileTaskTouchStart(e, { ...routine, isRoutineDrag: true }, 'timeline'),
                    onTouchMove: (e) => handleMobileTaskTouchMove(e),
                    onTouchEnd: (e) => handleMobileTaskTouchEnd(e, routine.id, 'timeline'),
                  } : {})}
                  className={`absolute pointer-events-auto ${isTablet ? 'cursor-default select-none' : 'cursor-move'} flex items-center justify-center ${isPast ? 'opacity-50' : ''}`}
                  style={{
                    top: `${top}px`,
                    height: `${Math.max(height, 27)}px`,
                    left: `calc(${leftPercent} + 4px)`,
                    width: `calc(${widthPercent} - 8px)`,
                    ...(isTablet ? { touchAction: 'none', WebkitTouchCallout: 'none', WebkitUserSelect: 'none' } : {}),
                  }}
                >
                  {/* Teal cross lines — horizontal + vertical */}
                  <div className={`absolute left-0 right-0 top-1/2 -translate-y-1/2 h-1.5 rounded-full ${darkMode ? 'bg-teal-700/80' : 'bg-teal-600/80'}`}></div>
                  <div className={`absolute top-0 bottom-0 left-1/2 -translate-x-1/2 w-1.5 rounded-full ${darkMode ? 'bg-teal-700/80' : 'bg-teal-600/80'}`}></div>
                  {/* Compact pill label centered */}
                  <span className={`relative rounded-full px-3 py-1 text-xs font-medium ${darkMode ? 'bg-teal-700 text-teal-100' : 'bg-teal-600 text-white'}`}>{routine.name}</span>
                  {/* Desktop: Resize handle (drag) */}
                  {!isTablet && (
                    <div
                      className="absolute bottom-0 left-0 right-0 h-3 cursor-ns-resize flex justify-center items-center"
                      onMouseDown={(e) => handleRoutineResizeStart(routine, e)}
                      style={{ marginBottom: '-4px' }}
                    >
                      <div className="w-8 h-1 rounded-full bg-white"></div>
                    </div>
                  )}
                  {/* Tablet: Touch resize handle */}
                  {isTablet && (
                    <div
                      onTouchStart={(e) => handleTouchRoutineResizeStart(routine, e)}
                      className="absolute bottom-0 left-1/3 right-1/3 h-3 hover:bg-white/20 active:bg-white/20 flex items-center justify-center select-none"
                      style={{ marginBottom: '-4px', touchAction: 'none', WebkitTouchCallout: 'none' }}
                    >
                      <div className="w-12 h-1 bg-white rounded-full"></div>
                    </div>
                  )}
                </div>
              );
            });
          })()}

          {/* Hover preview line - shows where a new task would start */}
          {hoverPreviewTime && !draggedTask && !isResizing && hoverPreviewDate && dateToString(hoverPreviewDate) === dateStr && (
            <div
              className="absolute left-0 right-0 pointer-events-none z-30"
              style={{
                top: `${minutesToPosition(timeToMinutes(hoverPreviewTime))}px`
              }}
            >
              <div className="absolute left-0 right-12 h-0.5 bg-blue-400/60"></div>
              <div className="absolute right-1 bg-blue-500/80 text-white text-xs px-1.5 py-0.5 rounded -translate-y-1/2">
                {formatTime(hoverPreviewTime)}
              </div>
            </div>
          )}

          {/* Drag preview - hover bar style */}
          {dragPreviewTime && draggedTask && dragPreviewDate && dateToString(dragPreviewDate) === dateStr && (() => {
            const dragMinutes = timeToMinutes(dragPreviewTime);
            const dragTop = Math.round(minutesToPosition(dragMinutes));
            return (
              <div
                className="absolute left-0 right-0 pointer-events-none z-20"
                style={{ top: `${dragTop}px` }}
              >
                <div className="relative">
                  <div className={`absolute bottom-0.5 right-0 px-1.5 py-0.5 rounded text-[10px] font-bold ${darkMode ? 'bg-blue-500 text-white' : 'bg-blue-600 text-white'}`}>
                    {formatTime(dragPreviewTime)}
                  </div>
                  <div className="h-0.5 bg-blue-500"></div>
                </div>
              </div>
            );
          })()}

          {/* Tablet touch drag preview - hover bar style */}
          {isTablet && mobileDragPreviewTime && mobileDragPreviewTime !== 'all-day' && mobileDragTaskIdState && mobileDragPreviewDate === dateStr && (() => {
            const dragMinutes = timeToMinutes(mobileDragPreviewTime);
            const dragTop = Math.round(minutesToPosition(dragMinutes));
            return (
              <div
                className="absolute left-0 right-0 pointer-events-none z-20"
                style={{ top: `${dragTop}px` }}
              >
                <div className="relative">
                  <div className={`absolute bottom-0.5 right-0 px-1.5 py-0.5 rounded text-[10px] font-bold ${darkMode ? 'bg-blue-500 text-white' : 'bg-blue-600 text-white'}`}>
                    {formatTime(mobileDragPreviewTime)}
                  </div>
                  <div className="h-0.5 bg-blue-500"></div>
                </div>
              </div>
            );
          })()}
        </div>
      );
    })}
  </div>
</div>
  );
};

export default TimeGrid;
