import React from 'react';
import {
  AlertCircle, BookOpen, Calendar, Check, CheckSquare,
  ExternalLink, FileText, GripVertical, Inbox, MoreHorizontal,
  NotebookPen, Pencil, RefreshCw, Settings, SkipForward,
  Target, Trash2,
} from 'lucide-react';
import ViewCycler from './ViewCycler.jsx';
import DayViewAllDaySection from './DayViewAllDaySection.jsx';
import { isNativeAndroid, nativeUpdateEvent } from '../native.js';
import { renderTitle, getLinkUrl, hasNotesOrSubtasks, isLinkOnlyTask, hasOnlySubtasks, isObsidianNoteOnlyTask } from '../utils/textFormatting.jsx';
import { dateToString, extractWikilinks, formatDeadlineDate, formatShortDate } from '../utils/taskUtils.js';
import { HABIT_COLORS, HABIT_ICONS } from '../constants/habits.js';
import { MiniHabitRing } from './HabitRing.jsx';
import NotesSubtasksPanel from './NotesSubtasksPanel.jsx';
import DeadlinePickerPopover from './DeadlinePickerPopover.jsx';
import SuggestionAutocomplete from './SuggestionAutocomplete.jsx';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useSyncCtx } from '../context/SyncContext.jsx';
import { useFeaturesCtx } from '../context/FeaturesContext.jsx';

const CalendarHeader = () => {
  const {
    isTablet,
    visibleDates,
    selectedDate,
    canShowViewCycler, effectiveViewMode,
    use24HourClock, dayViewColumns,
    mobileDateHeaderRef, mobileAllDaySectionRef,
    autoScrollInterval,
    longPressTimerRef, longPressTriggeredRef,
    darkMode,
    tasks, setTasks,
    expandedRecurringTasks,
    editingTaskId, editingTaskText, setEditingTaskText,
    expandedNotesTaskId, setExpandedNotesTaskId,
    expandedTaskMenu, setExpandedTaskMenu,
    showDeadlinePicker, setShowDeadlinePicker,
    showSuggestions, suggestions, selectedSuggestionIndex, suggestionContext,
    taskContextMenu, setTaskContextMenu,
    draggedTask,
    dragOverAllDay, setDragOverAllDay,
    mobileDragPreviewTime,
    mobileDragTaskIdState,
    mobileDragPreviewDate,
    hoverTaskId, setHoverTaskId,
    showAddTask, setShowAddTask,
    newTask, setNewTask,
    dailyNotes,
    dailyNotesModalDate, setDailyNotesModalDate,
    taskWidths,
    scheduledNotifications,
    cardBg, borderClass, textPrimary, textSecondary, hoverBg,
    toggleComplete,
    startEditingTask, saveTaskTitle,
    handleEditInputChange, handleEditKeyDown,
    applySuggestionForEdit,
    handleDragStart, handleDragEnd,
    handleDropOnDateHeader,
    handleMobileTaskTouchStart, handleMobileTaskTouchMove, handleMobileTaskTouchEnd,
    openMobileEditTask,
    postponeTask, postponeDeadlineTask,
    moveToRecycleBin, moveToInbox,
    setInboxProjectFilter, setInboxPriorityFilter, setHideCompletedInbox,
    setHideProjectTasksInbox, setHideStandaloneTasksInbox,
    getTasksForDate, getDeadlineTasksForDate,
    getTaskCalendarStyle,
    setTaskRef,
    formatTime, timeToMinutes, minutesToTime,
    setEditingRecurrenceTaskId,
    updateDragAutoScroll,
    updateTaskNotes, addSubtask, toggleSubtask, deleteSubtask, updateSubtaskTitle,
    editingInputRef,
    playUISound,
    pushUndo,
    setDragPreviewTime,
    getNextQuarterHour,
    addTasksFromSelection,
  } = useDayPlannerCtx();
  const { loadWikiNote, saveWikiNote, openInObsidian } = useSyncCtx();
  const {
    focusLog, setFocusLogModalDate,
    habitLogs, activeHabits, habitsEnabled,
    habitDayPopup, setHabitDayPopup,
    todayRoutines, routinesEnabled, routineCompletions,
    aiConfig, aiSubtasksLoadingForTask, generateAISubtasks,
    goalsProjectsEnabled, projects,
    projectFilter, setProjectFilter,
    openRoutinesDashboard,
  } = useFeaturesCtx();

  // Helpers for day-mode date-group header labels
  const formatBoundHour = (h, use24h) => {
    const norm = h % 24;
    if (use24h) return `${norm.toString().padStart(2, '0')}:00`;
    if (norm === 0) return '12a';
    if (norm === 12) return '12p';
    return norm < 12 ? `${norm}a` : `${norm - 12}p`;
  };

  return (
    <>
{/* Date headers row */}
<div ref={(el) => { if (isTablet) mobileDateHeaderRef.current = el; }} className={`flex border-b ${borderClass} ${cardBg}`}>
  {effectiveViewMode === 'multi' ? (
    <>
    {/* Top-left cell: hosts ViewCycler on large screens */}
    <div className={`w-16 flex-shrink-0 border-r ${borderClass} flex items-center justify-center min-h-[44px]`}>
      {canShowViewCycler && <ViewCycler />}
    </div>
    {visibleDates.map((date, idx) => {
    const isDateToday = dateToString(date) === dateToString(new Date());
    const dateStr = dateToString(date);
    const isDragOverThis = dragOverAllDay === dateStr;
    return (
      <div
        key={dateStr}
        className={`flex-1 py-2 px-3 text-center cursor-pointer hover:bg-opacity-80 transition-colors ${idx > 0 ? `border-l ${borderClass}` : ''} ${isDateToday ? (darkMode ? 'bg-blue-900/30 hover:bg-blue-900/50' : 'bg-blue-50 hover:bg-blue-100') : `${cardBg} ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-stone-100'}`} ${isDragOverThis ? (darkMode ? 'bg-green-700 ring-2 ring-inset ring-green-400' : 'bg-green-200 ring-2 ring-inset ring-green-500') : ''}`}
        onClick={() => {
          setNewTask({
            title: '',
            startTime: getNextQuarterHour(),
            duration: 30,
            date: dateStr,
            isAllDay: true
          });
          setShowAddTask(true);
        }}
        onDragOver={(e) => { e.preventDefault(); if (autoScrollInterval.current) { clearInterval(autoScrollInterval.current); autoScrollInterval.current = null; } }}
        onDragEnter={(e) => {
          e.preventDefault();
          setDragOverAllDay(dateStr);
          setDragPreviewTime(null);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget)) {
            setDragOverAllDay(null);
          }
        }}
        onDrop={(e) => handleDropOnDateHeader(e, date)}
        title={draggedTask ? "Drop to make all-day task" : "Click to add all-day task"}
      >
        <div className={`font-bold flex items-center justify-center gap-1.5 ${isDateToday ? 'text-blue-600' : textPrimary}`}>
          {formatShortDate(date)}
          <button
            onClick={(e) => { e.stopPropagation(); setDailyNotesModalDate(dateStr); }}
            className={`p-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10 transition-colors ${dailyNotes[dateStr]?.text ? '' : 'opacity-50'}`}
            title="Daily notes"
          >
            <NotebookPen size={14} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); setFocusLogModalDate(dateStr); }}
            className={`p-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10 transition-colors ${focusLog[dateStr]?.totalMinutes > 0 ? '' : 'opacity-50'}`}
            title="Focus sessions"
          >
            <Target size={14} />
          </button>
        </div>
        {habitsEnabled && !isDateToday && dateStr < dateToString(new Date()) && habitLogs[dateStr] && activeHabits.length > 0 && (
          <div className="flex items-center justify-center gap-0.5 mt-0.5 cursor-pointer" onClick={(e) => { e.stopPropagation(); setHabitDayPopup(dateStr); }}>
            {activeHabits.slice(0, 6).map(habit => (
              <MiniHabitRing key={habit.id} habit={habit} count={habitLogs[dateStr]?.[habit.id] || 0} darkMode={darkMode} />
            ))}
          </div>
        )}
      </div>
    );
  })}
    </>
  ) : (() => {
    // Day mode: build date groups from dayViewColumns — start at x=0 so column
    // boundaries align exactly with DayView's flex-1 columns below.
    const dateGroups = [];
    for (const col of dayViewColumns) {
      const last = dateGroups[dateGroups.length - 1];
      if (last && last.dateStr === col.dateStr) {
        last.count++;
        last.endHour = col.endHour;
      } else {
        dateGroups.push({ dateStr: col.dateStr, date: col.date, startHour: col.startHour, endHour: col.endHour, count: 1 });
      }
    }
    return dateGroups.map((group, idx) => {
      const isDateToday = group.dateStr === dateToString(new Date());
      const fullDay = group.startHour === 0 && group.endHour === 24;
      const timeRange = fullDay ? null : `${formatBoundHour(group.startHour, use24HourClock)} \u2013 ${formatBoundHour(group.endHour, use24HourClock)}`;
      return (
        <div
          key={group.dateStr}
          className={`relative min-h-[44px] flex items-center justify-center ${isDateToday ? (darkMode ? 'bg-blue-900/30' : 'bg-blue-50') : cardBg}`}
          style={{ flex: group.count }}
        >
          {/* ViewCycler floats in the absolute-left of the first date group so
              column boundaries align: both header and DayView start at x=0. */}
          {idx === 0 && canShowViewCycler && (
            <div className={`absolute left-0 top-0 w-16 h-full border-r ${borderClass}`}>
              <ViewCycler />
            </div>
          )}
          <div className={`text-center font-bold text-sm ${isDateToday ? 'text-blue-600' : textPrimary} ${idx === 0 && canShowViewCycler ? 'pl-16' : ''}`}>
            {formatShortDate(group.date)}
            {timeRange && (
              <span className={`font-normal text-xs ${textSecondary} ml-1.5`}>· {timeRange}</span>
            )}
          </div>
        </div>
      );
    });
  })()}
</div>

{/* Now bar - current running task */}
{(() => {
  const todayStr = dateToString(new Date());
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
  const runningTask = [...tasks, ...expandedRecurringTasks].find(t =>
    t.date === todayStr && !t.isAllDay && !t.completed &&
    !(t.imported && !t.isTaskCalendar) &&
    nowMin >= timeToMinutes(t.startTime || '0:00') &&
    nowMin < timeToMinutes(t.startTime || '0:00') + (t.duration || 0)
  );
  if (!runningTask) return null;
  return (
    <div className={`flex items-center gap-2 px-4 py-1.5 text-xs font-semibold ${darkMode ? 'bg-amber-900/40 text-amber-300 border-b border-amber-700/40' : 'bg-amber-50 text-amber-800 border-b border-amber-200'}`}>
      <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse flex-shrink-0" />
      <span className="truncate">Now: {renderTitle(runningTask.title)}</span>
    </div>
  );
})()}

{/* Day mode all-day chips strip */}
{effectiveViewMode === 'day' && <DayViewAllDaySection />}

{/* Multi-mode all-day tasks section */}
{effectiveViewMode === 'multi' && (visibleDates.some(date => getTasksForDate(date).some(t => t.isAllDay) || getDeadlineTasksForDate(dateToString(date)).length > 0) || (routinesEnabled && todayRoutines.some(r => r.isAllDay))) && (
  <div ref={(el) => { if (isTablet) mobileAllDaySectionRef.current = el; }} className={`flex border-b ${borderClass} ${cardBg}`}>
    <div className={`w-16 flex-shrink-0 px-3 py-2 text-xs font-semibold ${textSecondary} border-r ${borderClass}`}>
      ALL DAY
    </div>
    {visibleDates.map((date, idx) => {
      const dayTasks = getTasksForDate(date).filter(t => t.isAllDay && (!projectFilter || t.projectId === projectFilter)).sort((a, b) => {
        const order = (t) => {
          if (t.importSource === 'file') return 0;             // ICS downloads
          if (t.imported && !t.isTaskCalendar) return 1;       // Imported calendar events
          if (t.isTaskCalendar) return 2;                      // Imported task calendar items
          if (typeof t.id === 'string' && t.id.startsWith('recurring-')) return 4; // Recurring
          return 3;                                            // Regular all-day tasks
        };
        return order(a) - order(b);
      });
      const dateStr = dateToString(date);
      const deadlineTasks = getDeadlineTasksForDate(dateStr).filter(t => !projectFilter || t.projectId === projectFilter);
      const isDragOverThis = dragOverAllDay === dateStr;
      return (
        <div
          key={dateStr}
          className={`flex-1 min-w-0 p-2 space-y-1 ${idx > 0 ? `border-l ${borderClass}` : ''} ${isDragOverThis || (isTablet && mobileDragPreviewTime === 'all-day') ? (darkMode ? 'bg-green-700/50' : 'bg-green-100') : ''}`}
          onDragOver={(e) => { e.preventDefault(); if (autoScrollInterval.current) { clearInterval(autoScrollInterval.current); autoScrollInterval.current = null; } }}
          onDragEnter={(e) => {
            e.preventDefault();
            setDragOverAllDay(dateStr);
            setDragPreviewTime(null);
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget)) {
              setDragOverAllDay(null);
            }
          }}
          onDrop={(e) => handleDropOnDateHeader(e, date)}
        >
          {dayTasks.map((task) => {
            const isImported = task.imported;
            const taskCalendarStyle = getTaskCalendarStyle(task, darkMode);

            // Action buttons for all-day tasks
            const isRecurringAllDay = typeof task.id === 'string' && task.id.startsWith('recurring-');

            // Notes button for all-day tasks (render function, not component, to avoid remount)
            const renderAllDayNotesButton = (inMenu = false) => (
                <button
                  onMouseDown={() => {
                    if (isLinkOnlyTask(task)) {
                      if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
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

            const renderAllDayActionButtons = (inMenu = false) => {
              if (isRecurringAllDay) {
                // Recurring all-day: Notes, Postpone (non-daily only), Edit + Delete (desktop only)
                return (
                  <>
                    {renderAllDayNotesButton(inMenu)}
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
              // Non-recurring all-day: Notes, Postpone (all), Edit + Inbox (desktop only)
              return (
                <>
                  {renderAllDayNotesButton(inMenu)}
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

            // Width-based layout for all-day tasks (no height concern)
            const allDayTaskWidth = taskWidths[task.id];
            const useFullLayout = allDayTaskWidth >= 200;

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
                    isRecurring: !!isRecurringAllDay,
                    isImported: !!isImported,
                    isAllDay: true,
                    dateStr,
                  });
                }}
                draggable={(!isImported || !!task.nativeEventId) && !isTablet}
                onDragStart={(e) => (!isImported || !!task.nativeEventId) && handleDragStart(task, 'calendar', e)}
                onDragEnd={handleDragEnd}
                onDragOver={(e) => { e.preventDefault(); updateDragAutoScroll(e); }}
                onDragEnter={(e) => {
                  e.preventDefault();
                  setDragOverAllDay(dateStr);
                  setDragPreviewTime(null);
                }}
                onDrop={(e) => handleDropOnDateHeader(e, date)}
                className={`notes-panel-container relative ${task.completed && (!isImported || task.isTaskCalendar) ? 'opacity-50' : ''}`}
                style={isTablet && !isImported ? { marginLeft: '12px' } : {}}
              >
                {/* Tablet swipe strips — outside data-swipe-container so they stay behind as content slides */}
                {isTablet && !isImported && (
                  <>
                    <div data-swipe-strip="right" style={{ display: 'none', left: '8px' }} className={`absolute inset-0 ${isRecurringAllDay ? (darkMode ? 'bg-red-900/80 text-red-300' : 'bg-red-100 text-red-600') : (darkMode ? 'bg-blue-900/80 text-blue-300' : 'bg-blue-100 text-blue-600')} rounded-lg flex items-center pl-3 text-xs font-medium`}>
                      {isRecurringAllDay ? (
                        <><Trash2 size={14} className="mr-1" />Delete</>
                      ) : (
                        <><Inbox size={14} className="mr-1" />Inbox</>
                      )}
                    </div>
                    <div data-swipe-strip="left" style={{ display: 'none', left: '8px' }} className={`absolute inset-0 ${darkMode ? 'bg-amber-900/80 text-amber-300' : 'bg-amber-100 text-amber-600'} rounded-lg flex items-center justify-end pr-3 text-xs font-medium`}>
                      Edit<Settings size={14} className="ml-1" />
                    </div>
                  </>
                )}
                {/* On tablet: data-swipe-container wraps drag tab + card so they slide together.
                    On desktop: plain wrapper with no special attributes. */}
                <div {...(isTablet && !isImported ? { 'data-swipe-container': '', className: 'flex items-start' } : {})}>
                {/* Protruding drag tab (tablet only, in-flow with negative margin) */}
                {isTablet && !isImported && (
                  <div
                    data-drag-handle
                    className={`relative flex-shrink-0 ${task.nativeCalendarColor ? '' : task.color} rounded-l-lg flex items-center pl-px cursor-grab active:opacity-70 text-white/70`}
                    style={{ marginLeft: '-12px', marginRight: '-8px', marginTop: '3px', width: '20px', height: '24px', touchAction: 'none', zIndex: 10, ...(task.nativeCalendarColor ? { backgroundColor: task.nativeCalendarColor } : {}) }}
                    onTouchStart={(e) => handleMobileTaskTouchStart(e, task, 'allday')}
                    onTouchMove={(e) => handleMobileTaskTouchMove(e)}
                    onTouchEnd={(e) => handleMobileTaskTouchEnd(e, task.id, 'allday')}
                    onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
                  >
                    <div className="absolute top-0 left-0 h-full rounded-l-lg border-l border-t border-b border-white/20 pointer-events-none" style={{ width: '12px' }} />
                    <div className="absolute top-0 border-t border-white/20 pointer-events-none" style={{ left: '12px', width: '2px' }} />
                    <GripVertical size={14} />
                  </div>
                )}
                <div className={isTablet && !isImported ? 'relative flex-1 min-w-0 rounded-lg overflow-hidden' : 'relative overflow-hidden'}>
                <div
                {...(isTablet && !isImported ? {
                  onTouchStart: (e) => handleMobileTaskTouchStart(e, task, 'allday'),
                  onTouchMove: (e) => handleMobileTaskTouchMove(e),
                  onTouchEnd: (e) => handleMobileTaskTouchEnd(e, task.id, 'allday'),
                } : {})}
                className={`${!isTablet ? 'notes-panel-container' : 'select-none'} ${task.isTaskCalendar ? '' : task.color} rounded-lg shadow-sm ${isImported && !task.isTaskCalendar || isTablet ? 'cursor-default' : 'cursor-move'} relative ${task.isExample ? 'border-2 border-dashed border-white/50' : ''}`}
                style={{ ...(taskCalendarStyle || {}), ...(isTablet ? { touchAction: 'pan-y' } : {}) }}
              >
                {task.isExample && (
                  <span className="absolute -top-2 -right-2 bg-yellow-400 text-yellow-900 text-[10px] font-bold px-1.5 py-0.5 rounded-full shadow-sm z-10">
                    Example
                  </span>
                )}
                <div className="p-2 text-white">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      {(!isImported || task.isTaskCalendar) && (
                        <button
                          onClick={() => toggleComplete(task.id)}
                          className={`rounded flex-shrink-0 ${task.completed ? 'bg-white/40' : 'bg-white/20'} border-2 border-white w-4 h-4 flex items-center justify-center hover:bg-white/30 transition-colors`}
                        >
                          {task.completed && <Check size={10} strokeWidth={3} />}
                        </button>
                      )}
                      <Calendar size={14} className="flex-shrink-0" />
                      {task.isRecurring && <RefreshCw size={12} className="flex-shrink-0 opacity-75 hover:opacity-100 cursor-pointer" onClick={(e) => { e.stopPropagation(); setEditingRecurrenceTaskId(task.id); }} />}
                      <div
                        className={`${task.isTaskCalendar ? 'font-bold' : 'font-semibold'} text-sm truncate ${task.completed ? 'line-through' : ''} ${!isImported && !isTablet ? 'cursor-text' : ''} flex-1 min-w-0`}
                        onDoubleClick={!isTablet ? (e) => {
                          if (!isImported) {
                            e.stopPropagation();
                            startEditingTask(task, false);
                          }
                        } : undefined}
                        title={task.title}
                      >
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
                          renderTitle(task.title)
                        )}
                      </div>
                    </div>
                    {!isImported ? (
                      useFullLayout ? (
                        // Full layout: show action buttons inline
                        <div className="flex items-center gap-0.5 flex-shrink-0">
                          {renderAllDayActionButtons()}
                        </div>
                      ) : (
                        // Compact layout: show overflow menu
                        <button
                          onClick={() => setExpandedTaskMenu(expandedTaskMenu === task.id ? null : task.id)}
                          className="task-menu-container hover:bg-white/20 rounded p-1 transition-colors flex-shrink-0"
                        >
                          <MoreHorizontal size={14} />
                          {expandedTaskMenu === task.id && (
                            <div className="task-menu-container absolute top-full right-2 mt-1 bg-white dark:bg-gray-800 rounded-lg p-1 z-30 shadow-xl border border-stone-300 dark:border-gray-700 min-w-[100px] text-gray-800 dark:text-white">
                              {renderAllDayActionButtons(true)}
                            </div>
                          )}
                        </button>
                      )
                    ) : task.notes ? (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setExpandedNotesTaskId(prev => prev === task.id ? null : task.id);
                        }}
                        className="notes-toggle-button hover:bg-white/20 rounded p-1 transition-colors flex-shrink-0"
                        title="View description"
                      >
                        <FileText size={14} />
                      </button>
                    ) : null}
                  </div>
                  {goalsProjectsEnabled && task.projectId && (() => {
                    const proj = projects.find(p => p.id === task.projectId);
                    if (!proj) return null;
                    return (
                      <button
                        onClick={(e) => { e.stopPropagation(); const next = projectFilter === task.projectId ? null : task.projectId; setProjectFilter(next); setInboxProjectFilter(next ? [next] : []); if (next) { setInboxPriorityFilter(0); setHideCompletedInbox(false); setHideProjectTasksInbox(false); setHideStandaloneTasksInbox(true); } else { setHideProjectTasksInbox(true); setHideStandaloneTasksInbox(false); } }}
                        className={`mt-1 inline-flex items-center text-[10px] px-1.5 py-0.5 rounded-full bg-white/25 hover:bg-white/40 text-white font-medium transition-colors ${projectFilter === task.projectId ? 'ring-1 ring-white/60' : ''}`}
                        title={projectFilter === task.projectId ? 'Clear project filter' : `Filter: ${proj.title}`}
                      >
                        {proj.title}
                      </button>
                    );
                  })()}
                </div>
                {/* Notes panel for all-day tasks */}
                {expandedNotesTaskId === task.id && !isImported && (
                  <div className="notes-panel-container">
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
                      wikilinks={extractWikilinks(task.title).length > 0 ? extractWikilinks(task.title) : undefined}
                      onLoadWikiNote={extractWikilinks(task.title).length > 0 ? loadWikiNote : undefined}
                      onSaveWikiNote={extractWikilinks(task.title).length > 0 ? saveWikiNote : undefined}
                      onOpenInObsidian={extractWikilinks(task.title).length > 0 ? openInObsidian : undefined}
                    />
                  </div>
                )}
                {/* Editable notes panel for imported calendar events */}
                {expandedNotesTaskId === task.id && isImported && (
                  <div className="notes-panel-container p-2">
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
                )}
              </div>
              </div>{/* inner flex-1 wrapper */}
              </div>{/* data-swipe-container / desktop wrapper */}
              </div>
            );
          })}

          {/* Deadline tasks from inbox */}
          {deadlineTasks.map((task) => (
            <div
              key={`deadline-${task.id}`}
              className="notes-panel-container relative"
              style={isTablet ? { marginLeft: '12px' } : {}}
            >
              {/* Swipe action strips — outside data-swipe-container so they stay behind as content slides */}
              {isTablet && (
                <>
                  <div data-swipe-strip="right" style={{ display: 'none', left: '8px' }} className={`absolute inset-0 ${darkMode ? 'bg-blue-900/80 text-blue-300' : 'bg-blue-100 text-blue-600'} rounded-lg flex items-center pl-3 text-xs font-medium`}>
                    <Inbox size={14} className="mr-1" />Inbox
                  </div>
                  <div data-swipe-strip="left" style={{ display: 'none', left: '8px' }} className={`absolute inset-0 ${darkMode ? 'bg-amber-900/80 text-amber-300' : 'bg-amber-100 text-amber-600'} rounded-lg flex items-center justify-end pr-3 text-xs font-medium`}>
                    Edit<Settings size={14} className="ml-1" />
                  </div>
                </>
              )}
              {/* data-swipe-container wraps drag tab + card so they slide together on tablet */}
              <div {...(isTablet ? { 'data-swipe-container': '', className: `flex items-start ${task.completed ? 'opacity-50' : 'opacity-90'}` } : { className: task.completed ? 'opacity-50' : 'opacity-90' })}>              {/* Protruding drag tab (tablet only, in-flow with negative margin) */}
              {isTablet && (
                <div
                  data-drag-handle
                  className={`relative flex-shrink-0 ${task.color} rounded-l-lg flex items-center pl-px cursor-grab active:opacity-70 text-white/70`}
                  style={{ marginLeft: '-12px', marginRight: '-8px', marginTop: '3px', width: '20px', height: '24px', touchAction: 'none', zIndex: 10 }}
                  onTouchStart={(e) => handleMobileTaskTouchStart(e, { ...task, isDeadlineDrag: true }, 'deadline')}
                  onTouchMove={(e) => handleMobileTaskTouchMove(e)}
                  onTouchEnd={(e) => handleMobileTaskTouchEnd(e, task.id, 'deadline')}
                  onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
                >
                  <div className="absolute top-0 left-0 h-full rounded-l-lg border-l-2 border-t-2 border-b-2 border-dashed border-white/60 pointer-events-none" style={{ width: '12px' }} />
                  <div className="absolute top-0 border-t-2 border-dashed border-white/60 pointer-events-none" style={{ left: '12px', width: '2px' }} />
                  <GripVertical size={14} />
                </div>
              )}
              <div className={`relative rounded-lg ${showDeadlinePicker === task.id ? '' : 'overflow-hidden'} ${isTablet ? 'flex-1 min-w-0' : ''}`}>
            <div
              data-task-id={task.id}
              data-ctx-menu
              draggable
              onDragStart={(e) => handleDragStart(task, 'inbox', e)}
              onDragEnd={handleDragEnd}
              onDragOver={(e) => { e.preventDefault(); updateDragAutoScroll(e); }}
              onDragEnter={(e) => {
                e.preventDefault();
                setDragOverAllDay(dateStr);
                setDragPreviewTime(null);
              }}
              onDrop={(e) => handleDropOnDateHeader(e, date)}
              onContextMenu={(e) => {
                e.preventDefault();
                setTaskContextMenu({
                  x: e.clientX, y: e.clientY,
                  taskId: task.id,
                  isRecurring: false,
                  isImported: false,
                  isAllDay: true,
                  dateStr,
                });
              }}
              onTouchStart={(e) => handleMobileTaskTouchStart(e, { ...task, isDeadlineDrag: true }, 'deadline')}
              onTouchMove={(e) => handleMobileTaskTouchMove(e)}
              onTouchEnd={(e) => handleMobileTaskTouchEnd(e, task.id, 'deadline')}
              className={`${task.color} rounded-lg shadow-sm cursor-move relative border-2 border-dashed border-white/60`}
              style={{ touchAction: 'pan-y' }}
            >
              {task.isExample && (
                <span className="absolute -top-2 -right-2 bg-yellow-400 text-yellow-900 text-[10px] font-bold px-1.5 py-0.5 rounded-full shadow-sm z-10">
                  Example
                </span>
              )}
              <div className="p-2 text-white">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <button
                      onClick={() => toggleComplete(task.id, true)}
                      className={`rounded flex-shrink-0 ${task.completed ? 'bg-white/40' : 'bg-white/20'} border-2 border-white w-4 h-4 flex items-center justify-center hover:bg-white/30 transition-colors`}
                    >
                      {task.completed && <Check size={10} strokeWidth={3} />}
                    </button>
                    <AlertCircle size={14} className="flex-shrink-0" />
                    <div
                      className={`font-semibold text-sm truncate ${task.completed ? 'line-through' : ''}`}
                      title={task.title}
                    >
                      {renderTitle(task.title)}
                    </div>
                  </div>
                  <div className="flex items-center gap-0.5 flex-shrink-0">
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
                      className={`notes-toggle-button hover:bg-white/20 rounded p-1 transition-colors ${hasNotesOrSubtasks(task) || extractWikilinks(task.title).length > 0 ? '' : 'opacity-40'}`}
                      title={isLinkOnlyTask(task) ? `${getLinkUrl(task)} (hold to edit)` : "Notes & subtasks"}
                    >
                      {isLinkOnlyTask(task) ? <ExternalLink size={14} /> : hasOnlySubtasks(task) ? <CheckSquare size={14} /> : isObsidianNoteOnlyTask(task) ? <BookOpen size={14} /> : <FileText size={14} />}
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); postponeDeadlineTask(task.id); }}
                      className="hover:bg-white/20 rounded p-1 transition-colors"
                      title="Postpone to tomorrow"
                    >
                      <SkipForward size={14} />
                    </button>
                    <div className="deadline-picker-container relative">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowDeadlinePicker(showDeadlinePicker === task.id ? null : task.id);
                        }}
                        className="hover:bg-white/20 rounded p-1 transition-colors bg-white/20"
                        title={`Deadline: ${formatDeadlineDate(task.deadline)}`}
                      >
                        <Calendar size={14} />
                      </button>
                      {showDeadlinePicker === task.id && (
                        <DeadlinePickerPopover
                          taskId={task.id}
                          currentDeadline={task.deadline}
                          onClose={() => setShowDeadlinePicker(null)}
                        />
                      )}
                    </div>
                    {!isTablet && (
                      <button
                        onClick={() => openMobileEditTask(task, true)}
                        className="hover:bg-white/20 rounded p-1 transition-colors"
                        title="Edit"
                      >
                        <Pencil size={14} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
              {/* Notes panel for deadline tasks */}
              {expandedNotesTaskId === task.id && (
                <div className="notes-panel-container">
                  <NotesSubtasksPanel
                    task={task}
                    isInbox={true}
                    darkMode={darkMode}
                    updateTaskNotes={updateTaskNotes}
                    addSubtask={addSubtask}
                    toggleSubtask={toggleSubtask}
                    deleteSubtask={deleteSubtask}
                    updateSubtaskTitle={updateSubtaskTitle}
                    aiConfig={aiConfig}
                    aiSubtasksLoadingForTask={aiSubtasksLoadingForTask}
                    onGenerateSubtasks={generateAISubtasks}
                    wikilinks={extractWikilinks(task.title).length > 0 ? extractWikilinks(task.title) : undefined}
                    onLoadWikiNote={extractWikilinks(task.title).length > 0 ? loadWikiNote : undefined}
                    onSaveWikiNote={extractWikilinks(task.title).length > 0 ? saveWikiNote : undefined}
                    onOpenInObsidian={extractWikilinks(task.title).length > 0 ? openInObsidian : undefined}
                  />
                </div>
              )}
            </div>
            </div>
            </div>{/* data-swipe-container / desktop wrapper */}
            </div>
          ))}

          {/* Routine pills in all-day (today only) */}
          {routinesEnabled && dateToString(date) === dateToString(new Date()) && todayRoutines.filter(r => r.isAllDay).map((routine) => (
            <div
              key={`routine-${routine.id}`}
              draggable={!isTablet}
              onDragStart={!isTablet ? (e) => {
                handleDragStart({ ...routine, duration: routine.duration || 15 }, 'routine', e);
              } : undefined}
              onDragEnd={!isTablet ? handleDragEnd : undefined}
              {...(isTablet ? {
                onTouchStart: (e) => handleMobileTaskTouchStart(e, { ...routine, isRoutineDrag: true, duration: routine.duration || 15 }, 'allday'),
                onTouchMove: (e) => handleMobileTaskTouchMove(e),
                onTouchEnd: (e) => handleMobileTaskTouchEnd(e, routine.id, 'allday'),
              } : {})}
              className={`rounded-full px-3 py-1 text-xs font-medium ${isTablet ? 'cursor-default select-none' : 'cursor-move'} inline-block mr-1 mb-1 ${darkMode ? 'bg-teal-700/80 text-teal-100' : 'bg-teal-600/80 text-white'} ${routineCompletions[routine.id] ? 'line-through opacity-75' : ''}`}
              style={isTablet ? { touchAction: 'none', WebkitTouchCallout: 'none', WebkitUserSelect: 'none' } : {}}
            >
              {routine.name}
            </div>
          ))}
        </div>
      );
    })}
  </div>
)}
    </>
  );
};

export default CalendarHeader;
