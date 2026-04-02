import React from 'react';
import {
  BookOpen, Check, CheckSquare, Clock, ExternalLink,
  FileText, GripVertical, Inbox, MoreHorizontal, NotebookPen,
  RefreshCw, Settings, SkipForward, Trash2,
} from 'lucide-react';
import { isNativeAndroid, nativeUpdateEvent } from '../native.js';
import { renderTitle, getLinkUrl, hasNotesOrSubtasks, isLinkOnlyTask, hasOnlySubtasks, isObsidianNoteOnlyTask } from '../utils/textFormatting.jsx';
import { dateToString, extractWikilinks } from '../utils/taskUtils.js';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';

const MobileTimeGrid = () => {
  const {
    visibleDates, hours,
    calendarRef, timeGridRef, currentTimeRef,
    longPressTimerRef, longPressTriggeredRef,
    darkMode, use24HourClock,
    borderClass, textSecondary,
    tasks, setTasks,
    projects,
    projectFilter, setProjectFilter,
    taskWidths,
    expandedNotesTaskId, setExpandedNotesTaskId,
    expandedTaskMenu, setExpandedTaskMenu,
    taskContextMenu, setTaskContextMenu,
    setTimelineContextMenu,
    setFrameContextMenu,
    hoverPreviewTime, hoverPreviewDate,
    setHoverPreviewTime, setHoverPreviewDate,
    draggedTask,
    mobileDragPreviewTime, mobileDragPreviewDate, mobileDragTaskIdState,
    currentTimeTop,
    routinesEnabled, todayRoutines,
    setTaskRef,
    handleDragOver, handleDropOnCalendar,
    handleCalendarMouseMove, handleCalendarMouseLeave,
    handleMobileTaskTouchStart, handleMobileTaskTouchMove, handleMobileTaskTouchEnd,
    handleTouchResizeStart, handleTouchRoutineResizeStart,
    openNewTaskAtTime,
    toggleComplete,
    postponeTask,
    formatTime, timeToMinutes, minutesToTime,
    getTasksForDate, getFrameInstancesForDate,
    getTaskCalendarStyle,
    computeAvailableSlots,
    minutesToPosition, positionToMinutes,
    calculateTaskPosition, calculateConflictPosition,
    goalsProjectsEnabled,
    getTimeFromCursorPosition,
  } = useDayPlannerCtx();

  return (
<div ref={timeGridRef} className="relative">
  {hours.map((hour, index) => (
    <div key={hour} className="relative">
      <div className={`flex border-b ${index === 0 ? `border-t` : ''} ${borderClass} ${index % 2 === 1 ? (darkMode ? 'bg-white/[0.04]' : 'bg-stone-100/50') : ''}`}>
        <div className={`w-12 flex-shrink-0 px-1 py-1 text-xs ${textSecondary} border-r ${borderClass} text-center ${!darkMode ? 'bg-stone-100/80' : ''}`}>
          {use24HourClock
            ? `${hour.toString().padStart(2, '0')}:00`
            : <>{hour === 0 ? 12 : hour > 12 ? hour - 12 : hour}<span className="text-[9px] ml-0.5">{hour >= 12 ? 'PM' : 'AM'}</span></>
          }
        </div>
        {visibleDates.map((date, idx) => (
          <div
            key={dateToString(date)}
            data-ctx-menu
            className={`flex-1 relative h-40 calendar-slot ${idx > 0 ? `border-l ${borderClass}` : ''}`}
            data-date={dateToString(date)}
            onClick={(e) => {
              if (e.target.classList.contains('calendar-slot')) {
                const time = getTimeFromCursorPosition(e);
                setHoverPreviewTime(time);
                setHoverPreviewDate(date);
              }
            }}
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
      {/* Half-hour dashed line */}
      <div className="absolute left-0 right-0 pointer-events-none" style={{ top: '80px' }}>
        <div className={`flex border-b border-dashed ${borderClass} opacity-50`}>
          <div className="w-12 flex-shrink-0"></div>
          {visibleDates.map((date, idx) => (
            <div key={dateToString(date)} className={`flex-1 ${idx > 0 ? `border-l ${borderClass}` : ''}`}></div>
          ))}
        </div>
      </div>
    </div>
  ))}

  {/* Task overlays */}
  <div className="absolute top-0 left-12 right-0 bottom-0 pointer-events-none flex">
    {visibleDates.map((date, dayIndex) => {
      const dateStr = dateToString(date);
      const isDateToday = dateStr === dateToString(new Date());
      const dayTasks = getTasksForDate(date).filter(t => !t.isAllDay && !t.isExample && (!projectFilter || t.projectId === projectFilter));
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
                    borderLeft: `2px solid ${borderColorMap[frame.color] || (darkMode ? 'rgba(165,180,252,0.4)' : 'rgba(79,70,229,0.75)')}`,
                  }}
                  onContextMenu={(e) => { e.preventDefault(); setFrameContextMenu({ x: e.clientX, y: e.clientY, frameId: frame.frameId, dateStr }); }}
                  onDragOver={(e) => handleDragOver(e, date)}
                  onDrop={(e) => handleDropOnCalendar(e, date)}
                  onMouseMove={(e) => handleCalendarMouseMove(e, date, true)}
                  onMouseLeave={handleCalendarMouseLeave}
                  onClick={(e) => openNewTaskAtTime(e, date, true)}
                >
                  <span className="absolute top-0.5 left-1 text-[9px] font-medium pointer-events-none select-none" style={{ color: borderColorMap[frame.color] || (darkMode ? 'rgba(165,180,252,0.4)' : 'rgba(79,70,229,0.75)') }}>
                    {frame.label}
                  </span>
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
                      className="absolute left-0.5 right-0.5 rounded pointer-events-none"
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

          {/* Current time line */}
          {isDateToday && (
            <div
              className="absolute left-0 right-0 pointer-events-none z-10"
              style={{ top: `${currentTimeTop}px` }}
            >
              <div className="flex items-center">
                <div className="w-2 h-2 bg-red-500 rounded-full -ml-1"></div>
                <div className="flex-1 h-0.5 bg-red-500"></div>
              </div>
            </div>
          )}

          {/* Mobile drag time preview */}
          {mobileDragPreviewTime && mobileDragPreviewTime !== 'all-day' && (!mobileDragPreviewDate || mobileDragPreviewDate === dateStr) && (() => {
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

          {/* Hover preview line - shows selected time for new task via FAB */}
          {hoverPreviewTime && !draggedTask && hoverPreviewDate && dateToString(hoverPreviewDate) === dateStr && (
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

          {/* Task blocks */}
          {dayTasks.map(task => {
            const { top, height } = calculateTaskPosition(task);
            const taskCalendarStyle = getTaskCalendarStyle(task, darkMode);
            const mobileCalendarStyle = taskCalendarStyle;
            const isRecurring = typeof task.id === 'string' && task.id.startsWith('recurring-');
            const isImported = task.imported;
            const isCalendarEvent = task.imported && !task.isTaskCalendar;
            const isPastEvent = isCalendarEvent && isDateToday && (timeToMinutes(task.startTime) + task.duration) <= (new Date().getHours() * 60 + new Date().getMinutes());
            const _nowMin = new Date().getHours() * 60 + new Date().getMinutes();
            const _taskStart = timeToMinutes(task.startTime || '0:00');
            const isCurrentTask = isDateToday && !task.isAllDay && !task.completed && !isCalendarEvent && _nowMin >= _taskStart && _nowMin < _taskStart + (task.duration || 0);
            const isConflicted = !task.isAllDay && dayTasks.some(other => {
              if (other.id === task.id || other.isAllDay || other.completed) return false;
              const s1 = timeToMinutes(task.startTime), e1 = s1 + task.duration;
              const s2 = timeToMinutes(other.startTime), e2 = s2 + other.duration;
              return s1 < e2 && e1 > s2;
            });
            const conflictPos = calculateConflictPosition(task, dayTasks);

            // Layout tiers (matching desktop logic)
            const isMicroHeight = height <= 40;
            const taskWidth = taskWidths[task.id];
            const isMeasured = taskWidth !== undefined;
            const isNarrowWidth = taskWidth < 180;

            // Mobile action buttons component
            const MobileActionButtons = ({ inMenu = false }) => (
              <>
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
                  onTouchStart={(e) => {
                    e.stopPropagation();
                    if (isLinkOnlyTask(task)) {
                      longPressTriggeredRef.current = false;
                      longPressTimerRef.current = setTimeout(() => {
                        longPressTriggeredRef.current = true;
                        setExpandedNotesTaskId(prev => prev === task.id ? null : task.id);
                      }, 500);
                    }
                  }}
                  onTouchEnd={() => { if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current); }}
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
                  className={`notes-toggle-button hover:bg-white/20 rounded p-1 transition-colors ${inMenu ? 'flex items-center gap-2 w-full' : ''} ${hasNotesOrSubtasks(task) ? '' : 'opacity-40'}`}
                >
                  {isLinkOnlyTask(task) ? <ExternalLink size={14} /> : hasOnlySubtasks(task) ? <CheckSquare size={14} /> : isObsidianNoteOnlyTask(task) ? <BookOpen size={14} /> : <FileText size={14} />}
                  {inMenu && <span className="text-xs">{isLinkOnlyTask(task) ? 'Open Link' : 'Notes'}</span>}
                </button>
                {!(typeof task.id === 'string' && task.id.startsWith('recurring-')) && (
                  <button
                    onClick={(e) => { e.stopPropagation(); postponeTask(task.id); }}
                    className={`hover:bg-white/20 rounded p-1 transition-colors ${inMenu ? 'flex items-center gap-2 w-full' : ''}`}
                  >
                    <SkipForward size={14} />
                    {inMenu && <span className="text-xs">Postpone</span>}
                  </button>
                )}
              </>
            );

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
                    isRecurring: !!isRecurring,
                    isImported: !!isImported,
                    isAllDay: !!task.isAllDay,
                    dateStr,
                  });
                }}
                className={`absolute pointer-events-auto ${(task.completed && (!isImported || task.isTaskCalendar)) || isPastEvent ? 'opacity-50' : ''} ${mobileDragTaskIdState === task.id ? 'scale-105 shadow-2xl z-40' : ''} ${isCurrentTask ? 'current-task-pulse' : ''}`}
                style={{
                  top: `${top}px`,
                  height: `${height}px`,
                  minHeight: isMicroHeight ? '27px' : '39px',
                  left: conflictPos.left,
                  right: conflictPos.right,
                  width: conflictPos.width,
                  visibility: isMeasured ? 'visible' : 'hidden',
                  transition: mobileDragTaskIdState === task.id ? 'transform 0.15s, box-shadow 0.15s' : undefined,
                }}
              >
                {/* Swipe action strips - outside flex wrapper so they stay stationary */}
                {(!task.imported || !!task.nativeEventId) && (
                  <>
                    {!task.imported && (
                      <div data-swipe-strip="right" style={{ display: 'none' }} className={`absolute inset-0 ${typeof task.id === 'string' && task.id.startsWith('recurring-') ? (darkMode ? 'bg-red-900/80 text-red-300' : 'bg-red-100 text-red-600') : (darkMode ? 'bg-blue-900/80 text-blue-300' : 'bg-blue-100 text-blue-600')} rounded-lg flex items-center pl-3 text-xs font-medium`}>
                        {typeof task.id === 'string' && task.id.startsWith('recurring-') ? (
                          <><Trash2 size={14} className="mr-1" />Delete</>
                        ) : (
                          <><Inbox size={14} className="mr-1" />Inbox</>
                        )}
                      </div>
                    )}
                    <div data-swipe-strip="left" style={{ display: 'none' }} className={`absolute inset-0 ${darkMode ? 'bg-amber-900/80 text-amber-300' : 'bg-amber-100 text-amber-600'} rounded-lg flex items-center justify-end pr-3 text-xs font-medium`}>
                      Edit<Settings size={14} className="ml-1" />
                    </div>
                  </>
                )}
                <div data-swipe-container className="flex h-full items-start">
                {/* Protruding drag tab — shown for own tasks, task-calendar items, and native calendar events */}
                {(!isImported || task.isTaskCalendar || !!task.nativeEventId) && (
                  <div
                    data-drag-handle
                    className={`${task.isTaskCalendar ? '' : task.color || ''} rounded-l-lg flex items-center pl-px cursor-grab active:opacity-70 text-white/70 flex-shrink-0 relative`}
                    style={{ width: '20px', height: '24px', marginTop: '3px', marginRight: '-8px', touchAction: 'none', zIndex: 10, ...(task.isTaskCalendar ? { backgroundColor: darkMode ? '#4b5563' : '#6b7280' } : !task.color && task.nativeCalendarColor ? { backgroundColor: task.nativeCalendarColor } : {}) }}
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
                <div className={`flex-1 min-w-0 h-full rounded-lg ${expandedTaskMenu === task.id ? 'overflow-visible z-30' : 'overflow-hidden'}`}>
                {/* Task content with swipe + drag touch handlers */}
                <div
                  className={`relative h-full select-none ${task.isTaskCalendar ? '' : task.color} rounded-lg shadow-sm ${task.isTaskCalendar ? '' : 'border border-white/20'}`}
                  style={{ touchAction: 'pan-y', ...mobileCalendarStyle }}
                  onTouchStart={(e) => handleMobileTaskTouchStart(e, task, 'timeline')}
                  onTouchMove={(e) => handleMobileTaskTouchMove(e)}
                  onTouchEnd={(e) => handleMobileTaskTouchEnd(e, task.id, 'timeline')}
                >
                {/* Flex wrapper: content fills full width */}
                <div className="flex h-full">
                <div className="flex-1 min-w-0 h-full">
                {isCalendarEvent ? (
                  <div className="h-full px-2 py-1 flex flex-col justify-start text-white overflow-hidden">
                    <div className="flex items-start gap-1 min-w-0">
                      <span className="text-sm font-semibold truncate flex-1 min-w-0 leading-tight">
                        {renderTitle(task.title)}
                      </span>
                      <div className="flex items-center gap-0.5 flex-shrink-0 mt-0.5">
                        {isNativeAndroid() && extractWikilinks(task.title).map((note, i) => (
                          <button key={i} className="text-purple-200 active:text-purple-100" onClick={(e) => { e.stopPropagation(); window.DayGlanceObsidian?.openNote(note); }} title={`Open "${note}" in Obsidian`}><NotebookPen size={14} /></button>
                        ))}
                        {(task.notes) && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setExpandedNotesTaskId(prev => prev === task.id ? null : task.id);
                            }}
                            className="notes-toggle-button hover:bg-white/20 rounded p-0.5 transition-colors"
                            title="View/edit description"
                          >
                            <FileText size={11} />
                          </button>
                        )}
                        {!isNarrowWidth && (
                          <div className="text-xs opacity-90 whitespace-nowrap flex items-center gap-1 ml-1">
                            <Clock size={10} />
                            {formatTime(task.startTime)} • {task.duration}m
                          </div>
                        )}
                      </div>
                    </div>
                    {height > 42 && (task.calendarName || task.location) && (
                      <div className="flex flex-col mt-0.5 text-white/75 text-[10px]">
                        {task.calendarName && <span className="truncate">{task.calendarName}</span>}
                        {task.location && <span className="truncate">{task.location}</span>}
                      </div>
                    )}
                  </div>
                ) : isImported ? (
                  <div className="h-full px-2 py-1.5 flex items-start gap-1.5 text-white">
                    <button
                      onClick={() => toggleComplete(task.id)}
                      className={`rounded flex-shrink-0 ${task.completed ? 'bg-white/40' : 'bg-white/20'} border-2 border-white w-3.5 h-3.5 flex items-center justify-center`}
                    >
                      {task.completed && <Check size={8} strokeWidth={3} />}
                    </button>
                    <span className={`text-sm font-bold truncate flex-1 min-w-0 ${task.completed ? 'line-through' : ''}`}>
                      {renderTitle(task.title)}
                    </span>
                    {isNativeAndroid() && extractWikilinks(task.title).map((note, i) => (
                      <button key={i} className="flex-shrink-0 text-purple-200 active:text-purple-100" onClick={(e) => { e.stopPropagation(); window.DayGlanceObsidian?.openNote(note); }} title={`Open "${note}" in Obsidian`}><NotebookPen size={14} /></button>
                    ))}
                    {!isNarrowWidth && (
                      <div className="text-xs opacity-90 whitespace-nowrap flex-shrink-0 flex items-center gap-1">
                        <Clock size={10} />
                        {formatTime(task.startTime)} • {task.duration}m
                      </div>
                    )}
                  </div>
                ) : isNarrowWidth ? (
                  /* NARROW: overflow menu + checkbox + title */
                  <div className="h-full px-2 py-1 flex flex-col text-white">
                    <button
                      onClick={() => setExpandedTaskMenu(expandedTaskMenu === task.id ? null : task.id)}
                      className="task-menu-container absolute top-0.5 right-0.5 hover:bg-white/20 rounded p-0.5 transition-colors z-10"
                    >
                      <MoreHorizontal size={14} />
                      {expandedTaskMenu === task.id && (
                        <div className="task-menu-container absolute top-full right-0 mt-1 bg-white dark:bg-gray-800 rounded-lg p-1 z-30 shadow-xl border border-stone-300 dark:border-gray-700 min-w-[100px] text-gray-800 dark:text-white">
                          <MobileActionButtons inMenu={true} />
                        </div>
                      )}
                    </button>
                    <div className="flex items-center gap-1 pr-6">
                      <button
                        onClick={() => toggleComplete(task.id)}
                        className={`rounded flex-shrink-0 ${task.completed ? 'bg-white/40' : 'bg-white/20'} border-2 border-white w-4 h-4 flex items-center justify-center`}
                      >
                        {task.completed && <Check size={10} strokeWidth={3} />}
                      </button>
                      {isRecurring && <RefreshCw size={10} className="flex-shrink-0 opacity-60" />}
                      <span className={`text-sm font-medium truncate ${task.completed ? 'line-through' : ''}`}>
                        {renderTitle(task.title)}
                      </span>
                      {isNativeAndroid() && extractWikilinks(task.title).map((note, i) => (
                        <button key={i} className="flex-shrink-0 text-purple-200 active:text-purple-100" onClick={(e) => { e.stopPropagation(); window.DayGlanceObsidian?.openNote(note); }} title={`Open "${note}" in Obsidian`}><NotebookPen size={14} /></button>
                      ))}
                    </div>
                    {goalsProjectsEnabled && task.projectId ? (() => {
                      const proj = projects.find(p => p.id === task.projectId);
                      if (!proj) return height >= 55 ? <div className="text-xs text-white/70 mt-0.5">{formatTime(task.startTime)} · {task.duration}m</div> : null;
                      return (
                        <div className="flex items-center gap-1 flex-wrap mt-0.5">
                          <button
                            onClick={(e) => { e.stopPropagation(); setProjectFilter(prev => prev === task.projectId ? null : task.projectId); }}
                            className={`inline-flex items-center text-[10px] px-1.5 py-0.5 rounded-full bg-white/25 active:bg-white/40 text-white font-medium transition-colors flex-shrink-0 ${projectFilter === task.projectId ? 'ring-1 ring-white/60' : ''}`}
                            title={projectFilter === task.projectId ? 'Clear project filter' : `Filter: ${proj.title}`}
                          >
                            {proj.title}
                          </button>
                          {height >= 55 && <span className="text-xs text-white/70">{formatTime(task.startTime)} · {task.duration}m</span>}
                        </div>
                      );
                    })() : height >= 55 ? (
                      <div className="text-xs text-white/70 mt-0.5">{formatTime(task.startTime)} · {task.duration}m</div>
                    ) : null}
                  </div>
                ) : (
                  /* WIDE: checkbox + title + action buttons + time row */
                  <div className="h-full px-2 py-1 flex flex-col text-white">
                    <div className="flex items-center justify-between gap-1">
                      <div className="flex items-center gap-1.5 min-w-0 flex-1">
                        <button
                          onClick={() => toggleComplete(task.id)}
                          className={`rounded flex-shrink-0 ${task.completed ? 'bg-white/40' : 'bg-white/20'} border-2 border-white w-4 h-4 flex items-center justify-center`}
                        >
                          {task.completed && <Check size={10} strokeWidth={3} />}
                        </button>
                        {isRecurring && <RefreshCw size={10} className="flex-shrink-0 opacity-60" />}
                        <span className={`text-sm font-medium truncate ${task.completed ? 'line-through' : ''}`}>
                          {renderTitle(task.title)}
                        </span>
                        {isNativeAndroid() && extractWikilinks(task.title).map((note, i) => (
                          <button key={i} className="flex-shrink-0 text-purple-200 active:text-purple-100" onClick={(e) => { e.stopPropagation(); window.DayGlanceObsidian?.openNote(note); }} title={`Open "${note}" in Obsidian`}><NotebookPen size={14} /></button>
                        ))}
                      </div>
                      <div className="flex items-center gap-0.5 flex-shrink-0">
                        <MobileActionButtons />
                      </div>
                    </div>
                    {goalsProjectsEnabled && task.projectId ? (() => {
                      const proj = projects.find(p => p.id === task.projectId);
                      if (!proj) return height >= 55 ? <div className="text-xs text-white/70 mt-0.5">{formatTime(task.startTime)} · {task.duration}m</div> : null;
                      return (
                        <div className="flex items-center gap-1 flex-wrap mt-0.5">
                          <button
                            onClick={(e) => { e.stopPropagation(); setProjectFilter(prev => prev === task.projectId ? null : task.projectId); }}
                            className={`inline-flex items-center text-[10px] px-1.5 py-0.5 rounded-full bg-white/25 active:bg-white/40 text-white font-medium transition-colors flex-shrink-0 ${projectFilter === task.projectId ? 'ring-1 ring-white/60' : ''}`}
                            title={projectFilter === task.projectId ? 'Clear project filter' : `Filter: ${proj.title}`}
                          >
                            {proj.title}
                          </button>
                          {height >= 55 && <span className="text-xs text-white/70">{formatTime(task.startTime)} · {task.duration}m</span>}
                        </div>
                      );
                    })() : height >= 55 ? (
                      <div className="text-xs text-white/70 mt-0.5">{formatTime(task.startTime)} · {task.duration}m</div>
                    ) : null}
                  </div>
                )}
                </div>{/* end content */}
                </div>{/* end flex wrapper */}
                </div>{/* end swipe content */}
                </div>{/* end inner overflow container */}
                </div>{/* end data-swipe-container flex */}
                {/* Touch resize handle at bottom */}
                {(!isImported || (isCalendarEvent && task.nativeEventId)) && (
                  <div
                    onTouchStart={(e) => handleTouchResizeStart(task, e)}
                    onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
                    className="absolute bottom-0 left-1/3 right-1/3 h-3 hover:bg-white/20 active:bg-white/20 flex items-center justify-center select-none"
                    style={{ marginBottom: '-4px', touchAction: 'none', zIndex: 10, WebkitTouchCallout: 'none' }}
                  >
                    <div className="w-12 h-1 bg-white rounded-full"></div>
                  </div>
                )}
                {/* Editable notes panel for mobile timeline imported events (not calendar events — they use the bottom sheet) */}
                {expandedNotesTaskId === task.id && isImported && !isCalendarEvent && (() => {
                  const startMin = timeToMinutes(task.startTime || '0:00');
                  const endMin = startMin + (task.duration || 0);
                  const showAbove = endMin >= 22 * 60;
                  return (
                    <div
                      className="notes-panel-container absolute left-0 right-0 z-40"
                      style={showAbove ? { bottom: `${height}px` } : { top: `${height}px` }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className={`${task.color} rounded-lg shadow-lg ${showAbove ? 'mb-1' : 'mt-1'}`}>
                        <div className={`p-3 rounded-lg ${darkMode ? 'bg-black/30' : 'bg-white/30'} text-white`}>
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
              );
            })}

          {/* Timeline routine pills (today only) */}
          {routinesEnabled && dateStr === dateToString(new Date()) && (() => {
            const timelineRoutines = todayRoutines.filter(r => !r.isAllDay && r.startTime && !String(r.id).startsWith('example-'));
            if (timelineRoutines.length === 0) return null;

            // Compute side-by-side columns for overlapping routine chips
            const routineColumns = [];
            const sorted = [...timelineRoutines].sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));
            sorted.forEach(r => {
              const rStart = timeToMinutes(r.startTime);
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
            const colMap = {};
            routineColumns.forEach((col, ci) => col.forEach(r => { colMap[r.id] = ci; }));
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
              const { top: rTop, height: rHeight } = calculateTaskPosition(routine);
              const colIdx = colMap[routine.id];
              const cols = overlapCount[routine.id];
              const widthPercent = cols > 1 ? `${100 / cols}%` : '100%';
              const leftPercent = cols > 1 ? `${(colIdx * 100) / cols}%` : '0%';
              const endMinutes = timeToMinutes(routine.startTime) + routine.duration;
              const isPast = endMinutes <= nowMinutes;

              return (
                <div
                  key={`routine-tl-${routine.id}`}
                  className={`absolute pointer-events-auto select-none flex items-center justify-center ${isPast ? 'opacity-50' : ''} ${mobileDragTaskIdState === routine.id ? 'scale-105 shadow-2xl z-40' : ''}`}
                  style={{
                    touchAction: 'none',
                    WebkitTouchCallout: 'none',
                    WebkitUserSelect: 'none',
                    top: `${rTop}px`,
                    height: `${Math.max(rHeight, 27)}px`,
                    left: `calc(${leftPercent} + 4px)`,
                    width: `calc(${widthPercent} - 8px)`,
                  }}
                  onTouchStart={(e) => handleMobileTaskTouchStart(e, { ...routine, isRoutineDrag: true }, 'timeline')}
                  onTouchMove={(e) => handleMobileTaskTouchMove(e)}
                  onTouchEnd={(e) => handleMobileTaskTouchEnd(e, routine.id, 'timeline')}
                >
                  <div className={`absolute left-0 right-0 top-1/2 -translate-y-1/2 h-1.5 rounded-full ${darkMode ? 'bg-teal-700/80' : 'bg-teal-600/80'}`}></div>
                  <div className={`absolute top-0 bottom-0 left-1/2 -translate-x-1/2 w-1.5 rounded-full ${darkMode ? 'bg-teal-700/80' : 'bg-teal-600/80'}`}></div>
                  <span className={`relative rounded-full px-3 py-1 text-xs font-medium ${darkMode ? 'bg-teal-700 text-teal-100' : 'bg-teal-600 text-white'}`}>{routine.name}</span>
                  {/* Touch resize handle at bottom */}
                  <div
                    onTouchStart={(e) => handleTouchRoutineResizeStart(routine, e)}
                    className="absolute bottom-0 left-1/3 right-1/3 h-3 hover:bg-white/20 active:bg-white/20 flex items-center justify-center select-none"
                    style={{ marginBottom: '-4px', touchAction: 'none', zIndex: 10, WebkitTouchCallout: 'none' }}
                  >
                    <div className="w-12 h-1 bg-white rounded-full"></div>
                  </div>
                </div>
              );
            });
          })()}
        </div>
      );
    })}
  </div>
</div>
  );
};

export default MobileTimeGrid;
