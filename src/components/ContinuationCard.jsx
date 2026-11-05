import React from 'react';
import { Check, ChevronUp, GripVertical } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { renderTitleWithoutTags } from '../utils/textFormatting.jsx';
import { dateToString, stripWikilinks } from '../utils/taskUtils.js';
import { formatLocalizedDate } from '../utils/localeFormatting.js';
import { opensEditorOnDoubleClick } from '../utils/cardDoubleClick.js';

// The part of a timed task that runs past midnight, drawn on the next date's
// timeline (#2278). It is a VIEW of the task, never a second one: every
// gesture takes `continuation.task`, the real row (or the recurring
// occurrence, whose id carries its own date), through the handlers the
// task's own card uses.
//
//   - a click opens the task's editor (a read-only calendar event has none);
//   - the checkbox completes the task, on the date it started;
//   - dragging moves the WHOLE task: the drop time is its new start, and the
//     drag preview draws the whole task, as every task drag does (#2277);
//   - the bottom edge resizes the task's end at the view's real hour height
//     (#2273); the top edge is midnight, which is not the task's to move.
//
// Its look follows DAY's clipped slices (#2273): the task's colour and title,
// a squared top with an up chevron, and a small "from <day>" naming the date
// it started on. The date it is drawn on does not list it among its tasks.
//
// `variant` 'touch' is the phone's card: a protruding drag tab (long press)
// and a touch resize handle, measured from 00:00 of `dateStr`.
const ContinuationCard = ({
  continuation,
  dateStr,
  top,
  height,
  positionStyle = {},
  hourHeight,
  zoom = 1,
  variant = 'desktop',
  showHeader = true,
  showResize = true,
  minHeight = 27,
  dropHandlers = {},
  onOpen,
}) => {
  const { t } = useTranslation();
  const {
    darkMode, isTablet, currentTime,
    openMobileEditTask, toggleComplete,
    handleDragStart, handleDragEnd,
    handleResizeStart, handleTouchResizeStart,
    handleMobileTaskTouchStart, handleMobileTaskTouchMove, handleMobileTaskTouchEnd,
    getTaskCalendarStyle,
    setTaskContextMenu,
    mobileDragTaskIdState,
  } = useDayPlannerCtx();
  const { task, fromDate, minutes } = continuation;
  const touch = variant === 'touch' || isTablet;

  const isImported = !!task.imported;
  const isCalendarEvent = isImported && !task.isTaskCalendar;
  const movable = !isImported || task.isTaskCalendar || !!task.nativeEventId;
  const resizable = !isImported || !!task.nativeEventId;
  const completable = !isImported || task.isTaskCalendar;
  const isRecurring = typeof task.id === 'string' && task.id.startsWith('recurring-');

  const now = currentTime instanceof Date ? currentTime : new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const isCurrent = !task.completed && !isCalendarEvent && dateStr === dateToString(now) && nowMin < minutes;

  const fromDay = fromDate ? formatLocalizedDate(new Date(`${fromDate}T12:00:00`), { weekday: 'short' }) : '';
  const calStyle = getTaskCalendarStyle ? getTaskCalendarStyle(task, darkMode) : {};
  const colorClass = task.isTaskCalendar || (!task.color && task.nativeCalendarColor) ? '' : (task.color || '');

  const open = () => {
    if (onOpen) { onOpen(task); return; }
    if (isImported) return;
    openMobileEditTask(task, false);
  };

  const resizeHandle = resizable && showResize && (
    <div
      data-no-card-dblclick
      data-resize-handle="bottom"
      onMouseDown={(e) => handleResizeStart(task, e, { hourHeight })}
      onTouchStart={(e) => handleTouchResizeStart(task, e, { hourHeight })}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
      className="absolute bottom-0 left-1/3 right-1/3 h-3 cursor-ns-resize hover:bg-white/20 flex items-center justify-center select-none"
      style={{ marginBottom: '-4px', touchAction: 'none', WebkitTouchCallout: 'none' }}
    >
      <div className="w-12 h-1 bg-white rounded-full" />
    </div>
  );

  return (
    <div
      data-task-id={task.id}
      data-continuation-from={fromDate || ''}
      data-ctx-menu
      draggable={movable && !touch}
      onDragStart={movable && !touch ? (e) => handleDragStart(task, 'calendar', e) : undefined}
      onDragEnd={movable && !touch ? handleDragEnd : undefined}
      {...dropHandlers}
      onClick={(e) => {
        e.stopPropagation();
        if (!opensEditorOnDoubleClick(e.target, e.currentTarget)) return;
        open();
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setTaskContextMenu?.({
          x: e.clientX, y: e.clientY,
          taskId: task.id,
          isRecurring,
          isImported,
          isAllDay: false,
          // The task lives on the date it started: the menu finds it there.
          // No inline rename: this piece draws no title field, so the menu's
          // Rename opens the editor.
          dateStr: fromDate,
        });
      }}
      className={`group/card absolute pointer-events-auto text-white shadow-md rounded-b-lg ${colorClass}
        ${(task.completed && completable) ? 'opacity-50' : ''}
        ${movable && !touch ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'}
        ${mobileDragTaskIdState === task.id ? 'z-40 shadow-2xl' : ''}
        ${isCurrent ? 'current-task-pulse' : ''}`}
      style={{
        top: `${top}px`,
        height: `${height}px`,
        minHeight: `${minHeight * zoom}px`,
        ...positionStyle,
        ...calStyle,
      }}
      aria-label={t('task.continuesFromLabel', { title: stripWikilinks(task.title || ''), day: fromDay })}
    >
      {/* The top edge is midnight: a dashed line, not a rounded card edge. */}
      <div className="absolute top-0 left-0 right-0 border-t-2 border-dashed border-white/60 pointer-events-none" />
      {touch && movable && (
        <div
          data-drag-handle
          className="absolute left-0 top-0 w-5 h-6 flex items-center justify-center text-white/70 cursor-grab"
          style={{ touchAction: 'none', zIndex: 10 }}
          onTouchStart={(e) => handleMobileTaskTouchStart(e, task, 'timeline', { anchor: { startTime: '00:00', date: dateStr } })}
          onTouchMove={(e) => handleMobileTaskTouchMove(e)}
          onTouchEnd={(e) => handleMobileTaskTouchEnd(e, task.id, 'timeline')}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
        >
          <GripVertical size={14} />
        </div>
      )}
      {showHeader && (
        <div
          className={`flex items-center gap-1 ${touch && movable ? 'pl-5' : 'pl-2'} pr-2 pt-0.5 min-w-0 overflow-hidden`}
          style={zoom !== 1 ? { zoom } : undefined}
        >
          {completable && (
            <button
              type="button"
              data-continuation-checkbox
              aria-label={t('task.complete')}
              aria-pressed={!!task.completed}
              onClick={(e) => { e.stopPropagation(); toggleComplete(task.id); }}
              className={`rounded flex-shrink-0 ${task.completed ? 'bg-white/40' : 'bg-white/20'} border-2 border-white w-4 h-4 flex items-center justify-center hover:bg-white/30 transition-colors`}
            >
              {task.completed && <Check size={10} strokeWidth={3} />}
            </button>
          )}
          <ChevronUp size={12} className="flex-shrink-0 opacity-75" aria-hidden="true" />
          <span className={`text-sm font-semibold leading-tight truncate min-w-0 ${task.completed ? 'line-through' : ''}`} title={stripWikilinks(task.title || '')}>
            {renderTitleWithoutTags(task.title || '')}
          </span>
          {fromDay && (
            <span className="text-[10px] opacity-80 whitespace-nowrap flex-shrink-0">
              {t('task.continuesFrom', { day: fromDay })}
            </span>
          )}
        </div>
      )}
      {resizeHandle}
    </div>
  );
};

export default ContinuationCard;
