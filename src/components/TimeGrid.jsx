import React from 'react';
import {
  BookOpen, Check, CheckSquare, Clock, ExternalLink,
  FileText, GripVertical, Inbox, MapPin, MoreHorizontal,
  Pencil, RefreshCw, Settings, SkipForward, Trash2,
} from 'lucide-react';
import { isNativeAndroid, nativeUpdateEvent } from '../native.js';
import { renderTitleWithoutTags, getLinkUrl, hasNotesOrSubtasks, isLinkOnlyTask, hasOnlySubtasks, isObsidianNoteOnlyTask } from '../utils/textFormatting.jsx';
import { formatHourLabel } from '../utils/timeFormatting.jsx';
import { dateToString, extractTags, extractWikilinks, stripWikilinks } from '../utils/taskUtils.js';
import SuggestionAutocomplete from './SuggestionAutocomplete.jsx';
import NotesSubtasksPanel from './NotesSubtasksPanel.jsx';
import TimelineTaskCardContent from './TimelineTaskCardContent.jsx';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useSyncCtx } from '../context/SyncContext.jsx';
import { useFeaturesCtx } from '../context/FeaturesContext.jsx';
import { getHGBarsForDate } from '../hooks/useHyperGlance.js';
import HyperGlanceBar from './HyperGlanceBar.jsx';

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
    taskWidths,
    expandedNotesTaskId, setExpandedNotesTaskId,
    expandedTaskMenu, setExpandedTaskMenu,
    editingTaskId, editingTaskText,
    showSuggestions, suggestions, selectedSuggestionIndex, suggestionContext,
    taskContextMenu, setTaskContextMenu,
    setTimelineContextMenu,
    currentTimeTop,
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
    getTasksForDate,
    getTaskCalendarStyle,
    minutesToPosition, positionToMinutes,
    calculateTaskPosition, calculateConflictPosition,
    updateTaskNotes, addSubtask, toggleSubtask, deleteSubtask, updateSubtaskTitle,
    setInboxProjectFilter, setInboxPriorityFilter, setHideCompletedInbox,
    setHideProjectTasksInbox, setHideStandaloneTasksInbox,
  } = useDayPlannerCtx();
  const { loadWikiNote, saveWikiNote, openInObsidian } = useSyncCtx();
  const {
    goalsProjectsEnabled,
    projects,
    projectFilter, setProjectFilter,
    routinesEnabled, todayRoutines, routineCompletions, toggleRoutineCompletion,
    getFrameInstancesForDate,
    computeAvailableSlots,
    setFrameContextMenu,
    aiConfig, aiSubtasksLoadingForTask, generateAISubtasks,
  } = useFeaturesCtx();

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
          {formatHourLabel(hour, use24HourClock)}
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
      const hgBars = getHGBarsForDate(projects, dateStr, isDateToday ? new Date().getHours() * 60 + new Date().getMinutes() : undefined);
      const hasBars = hgBars.length > 0;
      // Returns true if a task's time range overlaps with any HG bar's scheduled time range
      const taskOverlapsHG = (task) => {
        if (!task.startTime || !hasBars) return false;
        const [th, tm] = (task.startTime || '0:0').split(':').map(Number);
        const tStart = th * 60 + tm;
        const tEnd = tStart + (task.duration || 30);
        return hgBars.some(bar => {
          const effectiveBarTime = bar.project.hyperglance.scheduledTimeOverrides?.[bar.date] || bar.project.hyperglance.scheduledTime || '0:0';
          const [bh, bm] = effectiveBarTime.split(':').map(Number);
          const bStart = bh * 60 + bm;
          const effectiveDuration = bar.isCompleted ? 15 : (bar.project.hyperglance.scheduledDurationOverrides?.[bar.date] || bar.project.hyperglance.scheduledDuration || 60);
          const bEnd = bStart + effectiveDuration;
          return tStart < bEnd && tEnd > bStart;
        });
      };

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

          {/* HyperGLANCE project bars (left half, only within their scheduled time range) */}
          {hasBars && (
            <div className="absolute top-0 bottom-0 pointer-events-none" style={{ left: 0, width: '50%' }}>
              {hgBars.map(bar => (
                <HyperGlanceBar key={bar.project.id} {...bar} />
              ))}
            </div>
          )}

          {/* Task + routine layer — full width; individual tasks shift right if they overlap an HG bar */}
          <div className="absolute top-0 bottom-0 pointer-events-none" style={{ left: 0, right: 0 }}>
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
                  className={`hover:bg-white/20 rounded p-1 transition-colors ${inMenu ? 'flex items-center gap-2 w-full' : ''} ${hasNotesOrSubtasks(task) || extractWikilinks(task.title).length > 0 ? '' : 'opacity-40'}`}
                  title={isLinkOnlyTask(task) ? `${getLinkUrl(task)} (hold to edit)` : "Notes & subtasks"}
                >
                  {isLinkOnlyTask(task) ? <ExternalLink size={14} /> : hasOnlySubtasks(task) ? <CheckSquare size={14} /> : isObsidianNoteOnlyTask(task) ? <BookOpen size={14} /> : <FileText size={14} />}
                  {inMenu && <span className="text-xs">{isLinkOnlyTask(task) ? 'Open Link' : 'Notes'}</span>}
                </button>
            );

            const ActionButtons = ({ inMenu = false }) => {
              if (isRecurringTask) {
                // Recurring: Notes, Postpone (non-daily only), Edit + Delete (desktop only)
                return (
                  <>
                    <NotesButton inMenu={inMenu} />
                    {task.recurrenceType !== 'daily' && (
                    <button
                      onClick={() => postponeTask(task.id)}
                      className={`hover:bg-white/20 rounded p-1 transition-colors ${inMenu ? 'flex items-center gap-2 w-full' : ''}`}
                      title="Postpone to tomorrow"
                    >
                      <SkipForward size={14} />
                      {inMenu && <span className="text-xs">Postpone</span>}
                    </button>
                    )}
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
                  ...(taskOverlapsHG(task)
                    ? { left: '50%', right: 0, width: undefined }
                    : { left: conflictPos.left, right: conflictPos.right, width: conflictPos.width }),
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
                <div className={`${isTablet ? 'flex-1 min-w-0 rounded-lg shadow-md' : ''} h-full ${isTablet && expandedNotesTaskId === task.id ? 'overflow-visible z-30' : ''}`}>
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
                  <TimelineTaskCardContent task={task} height={height} isNarrowWidth={isNarrowWidth} />
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
                  className={`absolute pointer-events-auto ${isTablet ? 'cursor-default select-none' : 'cursor-move'} flex items-center justify-center ${isPast ? 'opacity-50' : ''}`}
                  style={{
                    top: `${top}px`,
                    height: `${Math.max(height, 27)}px`,
                    left: `calc(${leftPercent} + 4px)`,
                    width: `calc(${widthPercent} - 8px)`,
                    ...(isTablet ? { touchAction: 'pan-y', WebkitTouchCallout: 'none', WebkitUserSelect: 'none' } : {}),
                  }}
                >
                  {/* Teal cross lines — horizontal + vertical */}
                  <div className={`absolute left-0 right-0 top-1/2 -translate-y-1/2 h-1.5 rounded-full ${darkMode ? 'bg-teal-700/80' : 'bg-teal-600/80'}`}></div>
                  <div className={`absolute top-0 bottom-0 left-1/2 -translate-x-1/2 w-1.5 rounded-full ${darkMode ? 'bg-teal-700/80' : 'bg-teal-600/80'}`}></div>
                  {/* Compact pill label centered */}
                  <span
                    className={`relative rounded-full px-3 py-1 text-xs font-medium cursor-pointer ${darkMode ? 'bg-teal-700 text-teal-100' : 'bg-teal-600 text-white'} ${routineCompletions[routine.id] ? 'line-through opacity-75' : ''}`}
                    onClick={() => toggleRoutineCompletion(routine.id)}
                    {...(isTablet ? {
                      style: { touchAction: 'none', WebkitTouchCallout: 'none', WebkitUserSelect: 'none' },
                      onTouchStart: (e) => handleMobileTaskTouchStart(e, { ...routine, isRoutineDrag: true }, 'timeline'),
                      onTouchMove: (e) => handleMobileTaskTouchMove(e),
                      onTouchEnd: (e) => handleMobileTaskTouchEnd(e, routine.id, 'timeline'),
                    } : {})}
                  >{routine.name}</span>
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
          </div>{/* end task+routine layer */}

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
