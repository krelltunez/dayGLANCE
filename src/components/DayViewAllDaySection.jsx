import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  AlertCircle, BookOpen, Calendar, Check, CheckSquare,
  ExternalLink, FileText, GripVertical, Inbox,
  Pencil, Settings, SkipForward,
} from 'lucide-react';
import AllDayTaskCard from './AllDayTaskCard.jsx';
import DeadlinePickerPopover from './DeadlinePickerPopover.jsx';
import NotesSubtasksPanel from './NotesSubtasksPanel.jsx';
import { dateToString, extractWikilinks, formatDeadlineDate } from '../utils/taskUtils.js';
import { renderTitle, getLinkUrl, hasNotesOrSubtasks, isLinkOnlyTask, hasOnlySubtasks, isObsidianNoteOnlyTask } from '../utils/textFormatting.jsx';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../context/FeaturesContext.jsx';
import { useSyncCtx } from '../context/SyncContext.jsx';

const CHIP_ROW_H = 40; // approximate AllDayTaskCard height in px
const ROW_GAP = 4;     // gap-1 = 4px
const MAX_ROWS = 2;
const MAX_H = CHIP_ROW_H * MAX_ROWS + ROW_GAP * (MAX_ROWS - 1);

// ── GroupChips — horizontal flex-wrap with 2-row cap + "+N more" popover ─────

const GroupChips = ({ tasks, deadlineTasks = [], date, dateStr, darkMode, borderClass, cardBg }) => {
  const {
    isTablet,
    handleDragStart, handleDragEnd,
    updateDragAutoScroll,
    setDragOverAllDay, setDragPreviewTime,
    handleDropOnDateHeader,
    showDeadlinePicker, setShowDeadlinePicker,
    postponeDeadlineTask, toggleComplete,
    expandedNotesTaskId, setExpandedNotesTaskId,
    updateTaskNotes, addSubtask, toggleSubtask, deleteSubtask, updateSubtaskTitle,
    setTaskContextMenu,
    longPressTimerRef, longPressTriggeredRef, openMobileEditTask,
    handleMobileTaskTouchStart, handleMobileTaskTouchMove, handleMobileTaskTouchEnd,
  } = useDayPlannerCtx();
  const { aiConfig, aiSubtasksLoadingForTask, generateAISubtasks } = useFeaturesCtx();
  const { loadWikiNote, saveWikiNote, openInObsidian } = useSyncCtx();

  const ghostRef = useRef(null);
  const buttonRef = useRef(null);
  const popoverRef = useRef(null);
  const [limit, setLimit] = useState(null);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [popoverPos, setPopoverPos] = useState({ top: 0, left: 0 });

  // Unified item list — tasks first, then deadline tasks
  const allItems = [
    ...tasks.map(t => ({ type: 'task', data: t })),
    ...deadlineTasks.map(t => ({ type: 'deadline', data: t })),
  ];

  useLayoutEffect(() => {
    const el = ghostRef.current;
    if (!el) return;

    const measure = () => {
      const chips = Array.from(el.children);
      if (!chips.length || !allItems.length) { setLimit(null); return; }
      const rowTop = chips[0].offsetTop;
      const maxBottom = rowTop + MAX_H;
      let lastFit = chips.length;
      for (let i = 0; i < chips.length; i++) {
        if (chips[i].offsetTop + chips[i].offsetHeight > maxBottom + 2) {
          lastFit = i;
          break;
        }
      }
      setLimit(lastFit < chips.length ? Math.max(0, lastFit - 1) : null);
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [tasks.length, deadlineTasks.length]);

  useEffect(() => {
    if (!overflowOpen) return;
    const onDown = (e) => {
      if (!buttonRef.current?.contains(e.target) && !popoverRef.current?.contains(e.target)) {
        setOverflowOpen(false);
      }
    };
    const onKey = (e) => { if (e.key === 'Escape') setOverflowOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [overflowOpen]);

  const handleTogglePopover = () => {
    if (!overflowOpen && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const popoverWidth = 400;
      const margin = 8;
      let left = rect.left;
      if (left + popoverWidth > window.innerWidth - margin) left = window.innerWidth - popoverWidth - margin;
      setPopoverPos({ top: rect.bottom + 4, left: Math.max(margin, left) });
    }
    setOverflowOpen(v => !v);
  };

  const shown = limit !== null ? allItems.slice(0, limit) : allItems;
  const overflowItems = limit !== null ? allItems.slice(limit) : [];

  // Renders the inner deadline card (shared between visible chips and overflow popover)
  const renderDeadlineCardInner = (task) => (
    <>
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
      <div {...(isTablet ? { 'data-swipe-container': '', className: `flex items-start ${task.completed ? 'opacity-50' : 'opacity-90'}` } : { className: task.completed ? 'opacity-50' : 'opacity-90' })}>
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
        <div className={`relative rounded-lg ${showDeadlinePicker === task.id ? '' : 'overflow-hidden'} ${isTablet ? 'flex-1 min-w-0' : 'w-full'}`}>
          <div
            data-task-id={task.id}
            data-ctx-menu
            draggable
            onDragStart={(e) => handleDragStart(task, 'inbox', e)}
            onDragEnd={handleDragEnd}
            onDragOver={(e) => { e.preventDefault(); updateDragAutoScroll(e); }}
            onDragEnter={(e) => { e.preventDefault(); setDragOverAllDay(dateStr); setDragPreviewTime(null); }}
            onDrop={(e) => handleDropOnDateHeader(e, date)}
            onContextMenu={(e) => {
              e.preventDefault();
              setTaskContextMenu({ x: e.clientX, y: e.clientY, taskId: task.id, isRecurring: false, isImported: false, isAllDay: true, dateStr });
            }}
            onTouchStart={(e) => handleMobileTaskTouchStart(e, { ...task, isDeadlineDrag: true }, 'deadline')}
            onTouchMove={(e) => handleMobileTaskTouchMove(e)}
            onTouchEnd={(e) => handleMobileTaskTouchEnd(e, task.id, 'deadline')}
            className={`${task.color} rounded-lg shadow-sm cursor-move relative border-2 border-dashed border-white/60`}
            style={{ touchAction: 'pan-y' }}
          >
            {task.isExample && (
              <span className="absolute -top-2 -right-2 bg-yellow-400 text-yellow-900 text-[10px] font-bold px-1.5 py-0.5 rounded-full shadow-sm z-10">Example</span>
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
                  <div className={`font-semibold text-sm truncate ${task.completed ? 'line-through' : ''}`} title={task.title}>
                    {renderTitle(task.title)}
                  </div>
                </div>
                <div className="flex items-center gap-0.5 flex-shrink-0">
                  <button
                    onMouseDown={() => { if (isLinkOnlyTask(task)) { longPressTriggeredRef.current = false; longPressTimerRef.current = setTimeout(() => { longPressTriggeredRef.current = true; setExpandedNotesTaskId(prev => prev === task.id ? null : task.id); }, 500); } }}
                    onMouseUp={() => { if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current); }}
                    onMouseLeave={() => { if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current); }}
                    onClick={(e) => { e.stopPropagation(); if (isLinkOnlyTask(task)) { if (!longPressTriggeredRef.current) window.open(getLinkUrl(task), '_blank', 'noopener,noreferrer'); longPressTriggeredRef.current = false; } else { setExpandedNotesTaskId(prev => prev === task.id ? null : task.id); } }}
                    className={`notes-toggle-button hover:bg-white/20 rounded p-1 transition-colors ${hasNotesOrSubtasks(task) || extractWikilinks(task.title).length > 0 ? '' : 'opacity-40'}`}
                    title={isLinkOnlyTask(task) ? `${getLinkUrl(task)} (hold to edit)` : 'Notes & subtasks'}
                  >
                    {isLinkOnlyTask(task) ? <ExternalLink size={14} /> : hasOnlySubtasks(task) ? <CheckSquare size={14} /> : isObsidianNoteOnlyTask(task) ? <BookOpen size={14} /> : <FileText size={14} />}
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); postponeDeadlineTask(task.id); }} className="hover:bg-white/20 rounded p-1 transition-colors" title="Postpone to tomorrow">
                    <SkipForward size={14} />
                  </button>
                  <div className="deadline-picker-container relative">
                    <button
                      onClick={(e) => { e.stopPropagation(); setShowDeadlinePicker(showDeadlinePicker === task.id ? null : task.id); }}
                      className="hover:bg-white/20 rounded p-1 transition-colors bg-white/20"
                      title={`Deadline: ${formatDeadlineDate(task.deadline)}`}
                    >
                      <Calendar size={14} />
                    </button>
                    {showDeadlinePicker === task.id && (
                      <DeadlinePickerPopover taskId={task.id} currentDeadline={task.deadline} onClose={() => setShowDeadlinePicker(null)} />
                    )}
                  </div>
                  {!isTablet && (
                    <button onClick={() => openMobileEditTask(task, true)} className="hover:bg-white/20 rounded p-1 transition-colors" title="Edit">
                      <Pencil size={14} />
                    </button>
                  )}
                </div>
              </div>
            </div>
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
      </div>
    </>
  );

  return (
    <div className="relative">
      {/* Ghost render for overflow measurement — invisible, no pointer events */}
      <div
        ref={ghostRef}
        className="absolute inset-0 flex flex-wrap gap-1 opacity-0 pointer-events-none"
        aria-hidden="true"
      >
        {allItems.map(item => (
          <div
            key={item.type === 'task' ? item.data.id : `deadline-${item.data.id}`}
            className="grow shrink-0 basis-[200px] max-w-[400px]"
          />
        ))}
      </div>

      {/* Visible chips */}
      <div className="flex flex-wrap gap-1">
        {shown.map(item => item.type === 'task' ? (
          <div
            key={item.data.id}
            draggable={(!item.data.imported || !!item.data.nativeEventId) && !isTablet}
            onDragStart={(e) => (!item.data.imported || !!item.data.nativeEventId) && handleDragStart(item.data, 'calendar', e)}
            onDragEnd={handleDragEnd}
            onDragOver={(e) => { e.preventDefault(); updateDragAutoScroll(e); }}
            onDragEnter={(e) => { e.preventDefault(); setDragOverAllDay(dateStr); setDragPreviewTime(null); }}
            onDrop={(e) => handleDropOnDateHeader(e, date)}
            className={`notes-panel-container relative grow shrink-0 basis-[200px] max-w-[400px] ${item.data.completed && (!item.data.imported || item.data.isTaskCalendar) ? 'opacity-50' : ''}`}
          >
            <AllDayTaskCard task={item.data} fillWidth={false} />
          </div>
        ) : (
          <div
            key={`deadline-${item.data.id}`}
            className="notes-panel-container relative grow shrink-0 basis-[200px] max-w-[400px]"
            style={isTablet ? { marginLeft: '12px' } : {}}
          >
            {renderDeadlineCardInner(item.data)}
          </div>
        ))}

        {/* "+N more" overflow chip */}
        {overflowItems.length > 0 && (
          <div className="relative flex-shrink-0 self-start">
            <button
              ref={buttonRef}
              onClick={handleTogglePopover}
              className={`text-xs font-medium px-2 py-1 rounded-md ${darkMode ? 'bg-gray-600 text-gray-200 hover:bg-gray-500' : 'bg-stone-200 text-stone-600 hover:bg-stone-300'} transition-colors`}
            >
              +{overflowItems.length} more
            </button>
          </div>
        )}
      </div>

      {/* Overflow popover — fixed to viewport so it doesn't overlap the timeline */}
      {overflowOpen && overflowItems.length > 0 && (
        <div
          ref={popoverRef}
          style={{ position: 'fixed', top: popoverPos.top, left: popoverPos.left, width: 400, zIndex: 200 }}
          className={`rounded-lg shadow-xl border ${borderClass} ${cardBg} p-2 flex flex-col gap-1 max-h-[60vh] overflow-y-auto`}
        >
          {overflowItems.map(item => (
            <div
              key={item.type === 'task' ? item.data.id : `deadline-${item.data.id}`}
              className={`notes-panel-container relative ${item.type === 'task' && item.data.completed && (!item.data.imported || item.data.isTaskCalendar) ? 'opacity-50' : ''}`}
              onClick={() => setOverflowOpen(false)}
            >
              {item.type === 'task' ? (
                <AllDayTaskCard task={item.data} fillWidth={false} />
              ) : (
                renderDeadlineCardInner(item.data)
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ── DayViewAllDaySection ──────────────────────────────────────────────────────

const allDayOrder = (t) => {
  if (t.importSource === 'file') return 0;
  if (t.imported && !t.isTaskCalendar) return 1;
  if (t.isTaskCalendar) return 2;
  if (typeof t.id === 'string' && t.id.startsWith('recurring-')) return 4;
  return 3;
};

const DayViewAllDaySection = () => {
  const {
    darkMode,
    borderClass, textSecondary, cardBg,
    dayViewColumns,
    getTasksForDate, getDeadlineTasksForDate,
    isTablet,
    handleDragStart, handleDragEnd, handleDropOnDateHeader, updateDragAutoScroll,
    dragOverAllDay, setDragOverAllDay, setDragPreviewTime,
    mobileDragPreviewTime,
    autoScrollInterval,
    handleMobileTaskTouchStart, handleMobileTaskTouchMove, handleMobileTaskTouchEnd,
  } = useDayPlannerCtx();
  const {
    projectFilter, routinesEnabled, todayRoutines, routineCompletions, toggleRoutineCompletion,
  } = useFeaturesCtx();
  const todayStr = dateToString(new Date());

  // Build date groups (same logic as CalendarHeader day-mode header)
  const dateGroups = [];
  for (const col of dayViewColumns) {
    const last = dateGroups[dateGroups.length - 1];
    if (last && last.dateStr === col.dateStr) {
      last.count++;
    } else {
      dateGroups.push({ dateStr: col.dateStr, date: col.date, count: 1 });
    }
  }

  const groupsWithTasks = dateGroups.map(group => ({
    ...group,
    tasks: getTasksForDate(group.date)
      .filter(t => t.isAllDay && (!projectFilter || t.projectId === projectFilter))
      .sort((a, b) => allDayOrder(a) - allDayOrder(b)),
    deadlineTasks: getDeadlineTasksForDate(group.dateStr).filter(t => !projectFilter || t.projectId === projectFilter),
  }));

  const hasAllDayRoutines = routinesEnabled && todayRoutines.some(r => r.isAllDay);
  if (!groupsWithTasks.some(g => g.tasks.length > 0 || g.deadlineTasks.length > 0) && !hasAllDayRoutines) return null;

  return (
    <div className={`border-b ${borderClass} ${cardBg}`} style={{ display: 'grid', gridTemplateColumns: `repeat(${dayViewColumns.length}, 1fr)` }}>
      {groupsWithTasks.map((group, idx) => (
        <div
          key={group.dateStr}
          style={{ gridColumn: `span ${group.count}` }}
          className={`flex min-w-0 ${idx > 0 ? `border-l ${borderClass}` : ''}`}
        >
          <div className={`w-16 flex-shrink-0 px-3 py-2 text-xs font-semibold ${textSecondary} border-r ${borderClass}`}>
            {idx === 0 ? 'ALL DAY' : ''}
          </div>
          <div
            className={`flex-1 min-w-0 p-2 ${dragOverAllDay === group.dateStr || (isTablet && mobileDragPreviewTime === 'all-day') ? (darkMode ? 'bg-green-700/50' : 'bg-green-100') : ''}`}
            onDragOver={(e) => { e.preventDefault(); if (autoScrollInterval.current) { clearInterval(autoScrollInterval.current); autoScrollInterval.current = null; } }}
            onDragEnter={(e) => { e.preventDefault(); setDragOverAllDay(group.dateStr); setDragPreviewTime(null); }}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOverAllDay(null); }}
            onDrop={(e) => handleDropOnDateHeader(e, group.date)}
          >
            {(group.tasks.length > 0 || group.deadlineTasks.length > 0) && (
              <div className="mb-1">
                <GroupChips
                  tasks={group.tasks}
                  deadlineTasks={group.deadlineTasks}
                  date={group.date}
                  dateStr={group.dateStr}
                  darkMode={darkMode}
                  borderClass={borderClass}
                  cardBg={cardBg}
                />
              </div>
            )}

            {/* Routine pills (today only) */}
            {routinesEnabled && group.dateStr === todayStr && todayRoutines.filter(r => r.isAllDay).map(routine => (
              <div
                key={`routine-${routine.id}`}
                draggable={!isTablet}
                onDragStart={!isTablet ? (e) => handleDragStart({ ...routine, duration: routine.duration || 15 }, 'routine', e) : undefined}
                onDragEnd={!isTablet ? handleDragEnd : undefined}
                {...(isTablet ? {
                  onTouchStart: (e) => handleMobileTaskTouchStart(e, { ...routine, isRoutineDrag: true, duration: routine.duration || 15 }, 'allday'),
                  onTouchMove: (e) => handleMobileTaskTouchMove(e),
                  onTouchEnd: (e) => handleMobileTaskTouchEnd(e, routine.id, 'allday'),
                } : {})}
                className={`rounded-full px-3 py-1 text-xs font-medium ${isTablet ? 'cursor-default select-none' : 'cursor-move'} inline-block mr-1 mb-1 ${darkMode ? 'bg-teal-700/80 text-teal-100' : 'bg-teal-600/80 text-white'} ${routineCompletions[routine.id] ? 'line-through opacity-75' : ''}`}
                style={isTablet ? { touchAction: 'none', WebkitTouchCallout: 'none', WebkitUserSelect: 'none' } : {}}
                onClick={() => toggleRoutineCompletion(routine.id)}
              >
                {routine.name}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};

export default DayViewAllDaySection;
