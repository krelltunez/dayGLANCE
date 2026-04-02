import React from 'react';
import {
  AlertCircle, BookOpen, Calendar, Check, CheckSquare,
  ExternalLink, FileText, GripVertical, Inbox, NotebookPen,
  RefreshCw, Settings, SkipForward, Trash2,
} from 'lucide-react';
import { isNativeAndroid } from '../native.js';
import { renderTitle, getLinkUrl, hasNotesOrSubtasks, isLinkOnlyTask, hasOnlySubtasks, isObsidianNoteOnlyTask } from '../utils/textFormatting.jsx';
import { dateToString, extractWikilinks, formatDeadlineDate } from '../utils/taskUtils.js';
import DeadlinePickerPopover from './DeadlinePickerPopover.jsx';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';

const MobileAllDaySection = () => {
  const {
    visibleDates,
    mobileAllDaySectionRef,
    longPressTimerRef, longPressTriggeredRef,
    darkMode,
    borderClass, cardBg, textPrimary, textSecondary, hoverBg,
    tasks,
    expandedNotesTaskId, setExpandedNotesTaskId,
    showDeadlinePicker, setShowDeadlinePicker,
    taskContextMenu, setTaskContextMenu,
    mobileDragPreviewTime, mobileDragTaskIdState,
    routinesEnabled, todayRoutines,
    goalsProjectsEnabled, projects, projectFilter,
    toggleComplete,
    postponeTask, postponeDeadlineTask,
    handleMobileTaskTouchStart, handleMobileTaskTouchMove, handleMobileTaskTouchEnd,
    formatTime, timeToMinutes,
    getTasksForDate, getDeadlineTasksForDate,
    getTaskCalendarStyle,
    openRoutinesDashboard,
  } = useDayPlannerCtx();

  return (
    <>
{/* All-day tasks - inside sticky header group */}
{(visibleDates.some(date => getTasksForDate(date).some(t => t.isAllDay && !t.isExample) || getDeadlineTasksForDate(dateToString(date)).some(t => !t.isExample)) || (routinesEnabled && todayRoutines.some(r => r.isAllDay && !String(r.id).startsWith('example-')))) && (
  <div ref={mobileAllDaySectionRef} className={`border-b ${borderClass} ${cardBg} ${mobileDragPreviewTime === 'all-day' ? 'ring-2 ring-inset ring-blue-500' : ''}`}>
    <div className="flex">
      <div className={`w-12 flex-shrink-0 px-2 py-2 text-[10px] font-semibold ${textSecondary} border-r ${borderClass} flex items-start justify-center`}>
        ALL DAY
      </div>
      <div className="flex-1 min-w-0 p-2 space-y-1.5">
        {visibleDates.map((date) => {
          const dayTasks = getTasksForDate(date).filter(t => t.isAllDay && !t.isExample).sort((a, b) => {
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
          const deadlineTasks = getDeadlineTasksForDate(dateStr).filter(t => !t.isExample);
          return (
            <React.Fragment key={dateStr}>
              {dayTasks.map((task) => {
                const taskCalendarStyle = getTaskCalendarStyle(task, darkMode);
                const isImported = task.imported;
                return (
                  <div key={task.id} className={`relative ${task.completed && (!isImported || task.isTaskCalendar) ? 'opacity-50' : ''}`} style={(!isImported || !!task.nativeEventId) ? { marginLeft: '12px' } : {}}
                    data-ctx-menu
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setTaskContextMenu({
                        x: e.clientX, y: e.clientY,
                        taskId: task.id,
                        isRecurring: !!(typeof task.id === 'string' && task.id.startsWith('recurring-')),
                        isImported: !!isImported,
                        isAllDay: true,
                        dateStr,
                      });
                    }}
                  >
                    {/* Swipe action strips — outside data-swipe-container so they stay put as content slides */}
                    {!isImported && (
                      <>
                        <div data-swipe-strip="right" style={{ display: 'none', left: '8px' }} className={`absolute inset-0 ${typeof task.id === 'string' && task.id.startsWith('recurring-') ? (darkMode ? 'bg-red-900/80 text-red-300' : 'bg-red-100 text-red-600') : (darkMode ? 'bg-blue-900/80 text-blue-300' : 'bg-blue-100 text-blue-600')} rounded-lg flex items-center pl-3 text-xs font-medium`}>
                          {typeof task.id === 'string' && task.id.startsWith('recurring-') ? (
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
                    {/* Swipe container: drag tab + task card slide together on swipe */}
                    <div data-swipe-container className="flex items-start">
                    {/* Protruding drag tab */}
                    {(!isImported || !!task.nativeEventId) && (
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
                    <div className="relative flex-1 min-w-0 rounded-lg overflow-hidden">
                  <div
                    data-task-id={task.id}
                    className={`relative ${task.isTaskCalendar ? '' : task.color} rounded-lg p-2.5 text-white text-sm select-none ${mobileDragTaskIdState === task.id ? 'scale-105 shadow-2xl z-40' : ''}`}
                    style={{ touchAction: 'pan-y', ...(taskCalendarStyle || {}) }}
                    onTouchStart={(e) => handleMobileTaskTouchStart(e, task, 'allday')}
                    onTouchMove={(e) => handleMobileTaskTouchMove(e)}
                    onTouchEnd={(e) => handleMobileTaskTouchEnd(e, task.id, 'allday')}
                  >
                    <div className="flex items-center gap-2">
                      {(!isImported || task.isTaskCalendar) && (
                        <button
                          onClick={() => toggleComplete(task.id)}
                          className={`rounded flex-shrink-0 ${task.completed ? 'bg-white/40' : 'bg-white/20'} border-2 border-white w-4 h-4 flex items-center justify-center`}
                        >
                          {task.completed && <Check size={10} strokeWidth={3} />}
                        </button>
                      )}
                      <Calendar size={14} className="flex-shrink-0" />
                      <span className={`truncate flex-1 ${task.isTaskCalendar ? 'font-bold' : 'font-medium'} ${task.completed && !isImported ? 'line-through' : ''}`}>
                        {renderTitle(task.title)}
                      </span>
                      {isNativeAndroid() && extractWikilinks(task.title).map((note, i) => (
                        <button key={i} className="flex-shrink-0 text-purple-200 active:text-purple-100" onClick={(e) => { e.stopPropagation(); window.DayGlanceObsidian?.openNote(note); }} title={`Open "${note}" in Obsidian`}><NotebookPen size={14} /></button>
                      ))}
                      {!isImported && (
                        <>
                          {typeof task.id === 'string' && task.id.startsWith('recurring-') && (
                            <RefreshCw size={10} className="flex-shrink-0 opacity-60" />
                          )}
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
                            onTouchStart={(e) => {
                              e.stopPropagation();
                              if (isLinkOnlyTask(task)) {
                                if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
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
                            className={`notes-toggle-button hover:bg-white/20 rounded p-1 transition-colors flex-shrink-0 ${hasNotesOrSubtasks(task) ? '' : 'opacity-40'}`}
                          >
                            {isLinkOnlyTask(task) ? <ExternalLink size={14} /> : hasOnlySubtasks(task) ? <CheckSquare size={14} /> : isObsidianNoteOnlyTask(task) ? <BookOpen size={14} /> : <FileText size={14} />}
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); postponeTask(task.id); }}
                            className="hover:bg-white/20 rounded p-1 transition-colors flex-shrink-0"
                          >
                            <SkipForward size={14} />
                          </button>
                        </>
                      )}
                      {isImported && !task.isTaskCalendar && task.notes && (
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
                      )}
                    </div>
                  </div>
                  </div>
                  </div>{/* end data-swipe-container */}
                  </div>
                );
              })}
              {deadlineTasks.map((task) => (
                <div key={`deadline-${task.id}`} className="relative" style={{ marginLeft: '12px' }}>
                  {/* Swipe action strips — outside data-swipe-container so they stay put as content slides */}
                  <div data-swipe-strip="right" style={{ display: 'none', left: '8px' }} className={`absolute inset-0 ${darkMode ? 'bg-blue-900/80 text-blue-300' : 'bg-blue-100 text-blue-600'} rounded-lg flex items-center pl-3 text-xs font-medium`}>
                    <Inbox size={14} className="mr-1" />Inbox
                  </div>
                  <div data-swipe-strip="left" style={{ display: 'none', left: '8px' }} className={`absolute inset-0 ${darkMode ? 'bg-amber-900/80 text-amber-300' : 'bg-amber-100 text-amber-600'} rounded-lg flex items-center justify-end pr-3 text-xs font-medium`}>
                    Edit<Settings size={14} className="ml-1" />
                  </div>
                  {/* Swipe container: drag tab + task card slide together on swipe */}
                  <div data-swipe-container className={`flex items-start ${task.completed ? 'opacity-50' : 'opacity-90'}`}>
                  {/* Protruding drag tab */}
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
                  <div className={`relative flex-1 min-w-0 rounded-lg ${showDeadlinePicker === task.id ? '' : 'overflow-hidden'}`}>
                <div
                  data-task-id={task.id}
                  data-ctx-menu
                  className={`relative ${task.color} rounded-lg p-2.5 text-white text-sm select-none border-2 border-dashed border-white/60 ${mobileDragTaskIdState === task.id ? 'scale-105 shadow-2xl z-40' : ''}`}
                  style={{ touchAction: 'pan-y' }}
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
                >
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => toggleComplete(task.id, true)}
                      className={`rounded flex-shrink-0 ${task.completed ? 'bg-white/40' : 'bg-white/20'} border-2 border-white w-4 h-4 flex items-center justify-center`}
                    >
                      {task.completed && <Check size={10} strokeWidth={3} />}
                    </button>
                    <AlertCircle size={14} className="flex-shrink-0" />
                    <span className={`truncate flex-1 font-medium ${task.completed ? 'line-through' : ''}`}>{renderTitle(task.title)}</span>
                    {isNativeAndroid() && extractWikilinks(task.title).map((note, i) => (
                      <button key={i} className="flex-shrink-0 text-purple-200 active:text-purple-100" onClick={(e) => { e.stopPropagation(); window.DayGlanceObsidian?.openNote(note); }} title={`Open "${note}" in Obsidian`}><NotebookPen size={14} /></button>
                    ))}
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
                      onTouchStart={(e) => {
                        e.stopPropagation();
                        if (isLinkOnlyTask(task)) {
                          if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
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
                      className={`notes-toggle-button hover:bg-white/20 rounded p-1 transition-colors flex-shrink-0 ${hasNotesOrSubtasks(task) ? '' : 'opacity-40'}`}
                    >
                      {isLinkOnlyTask(task) ? <ExternalLink size={14} /> : hasOnlySubtasks(task) ? <CheckSquare size={14} /> : isObsidianNoteOnlyTask(task) ? <BookOpen size={14} /> : <FileText size={14} />}
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); postponeDeadlineTask(task.id); }}
                      className="hover:bg-white/20 rounded p-1 transition-colors flex-shrink-0"
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
                        className="hover:bg-white/20 rounded p-1 transition-colors bg-white/20 flex-shrink-0"
                        title={task.deadline ? `Deadline: ${formatDeadlineDate(task.deadline)}` : 'Set deadline'}
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
                  </div>
                </div>
                </div>{/* end flex-1 content */}
                </div>{/* end data-swipe-container */}
                </div>
              ))}
              {/* Routine pills in all-day (today only) */}
              {routinesEnabled && dateToString(date) === dateToString(new Date()) && todayRoutines.filter(r => r.isAllDay && !String(r.id).startsWith('example-')).map((routine) => (
                <div
                  key={`routine-${routine.id}`}
                  className={`rounded-full px-3 py-1 text-xs font-medium inline-block mr-1 mb-1 select-none ${darkMode ? 'bg-teal-700/80 text-teal-100' : 'bg-teal-600/80 text-white'} ${mobileDragTaskIdState === routine.id ? 'scale-105 shadow-2xl z-40' : ''}`}
                  style={{ touchAction: 'none', WebkitTouchCallout: 'none', WebkitUserSelect: 'none' }}
                  onTouchStart={(e) => handleMobileTaskTouchStart(e, { ...routine, isRoutineDrag: true, duration: routine.duration || 15 }, 'allday')}
                  onTouchMove={(e) => handleMobileTaskTouchMove(e)}
                  onTouchEnd={(e) => handleMobileTaskTouchEnd(e, routine.id, 'allday')}
                >
                  {routine.name}
                </div>
              ))}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  </div>
)}
    </>
  );
};

export default MobileAllDaySection;
