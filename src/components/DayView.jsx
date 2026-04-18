import React from 'react';
import {
  Check, ChevronDown, ChevronUp, Inbox,
  Pencil, RefreshCw, SkipForward, Trash2,
} from 'lucide-react';
import { renderTitleWithoutTags } from '../utils/textFormatting.jsx';
import { formatHourLabel } from '../utils/timeFormatting.jsx';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../context/FeaturesContext.jsx';
import useDayViewHourHeight from '../hooks/useDayViewHourHeight.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function getTaskSlice(task, col, hourHeight, timeToMinutes) {
  const taskStart = timeToMinutes(task.startTime || '0:00');
  const taskEnd = taskStart + (task.duration || 0);
  const colStart = col.startHour * 60;
  const colEnd = col.endHour * 60;

  if (taskEnd <= colStart || taskStart >= colEnd) return null;

  const visStart = Math.max(taskStart, colStart);
  const visEnd = Math.min(taskEnd, colEnd);
  const rawH = (visEnd - visStart) * hourHeight / 60;

  return {
    top: (visStart - colStart) * hourHeight / 60,
    height: Math.max(27, rawH),
    clippedTop: taskStart < colStart,
    clippedBottom: taskEnd > colEnd,
    showTitle: taskStart >= colStart,
  };
}

function columnConflictPos(task, colTasks, timeToMinutes) {
  const tStart = timeToMinutes(task.startTime || '0:00');
  const tEnd = tStart + (task.duration || 0);

  const peers = colTasks.filter(other => {
    if (other.id === task.id) return false;
    const oStart = timeToMinutes(other.startTime || '0:00');
    const oEnd = oStart + (other.duration || 0);
    return tStart < oEnd && tEnd > oStart;
  });

  if (peers.length === 0) return { left: '0%', width: '100%' };

  const group = [task, ...peers].sort((a, b) => {
    const diff = timeToMinutes(a.startTime || '0:00') - timeToMinutes(b.startTime || '0:00');
    return diff !== 0 ? diff : String(a.id).localeCompare(String(b.id));
  });

  const idx = group.findIndex(t => t.id === task.id);
  const total = group.length;
  const pct = 100 / total;
  return { left: `${idx * pct}%`, width: `${pct}%` };
}

// ── DayViewColumn ─────────────────────────────────────────────────────────────

const DayViewColumn = ({ col, colIdx, hourHeight }) => {
  const {
    isTablet,
    darkMode, use24HourClock,
    borderClass, textSecondary,
    taskContextMenu, setTaskContextMenu,
    toggleComplete,
    moveToRecycleBin, moveToInbox, postponeTask,
    openMobileEditTask,
    setEditingRecurrenceTaskId,
    getTasksForDate,
    getTaskCalendarStyle,
    timeToMinutes, formatTime,
  } = useDayPlannerCtx();

  const { projectFilter } = useFeaturesCtx();

  const allDayTasks = getTasksForDate(col.date);
  const colTasks = allDayTasks.filter(t => {
    if (t.isAllDay || !t.startTime) return false;
    if (projectFilter && t.projectId !== projectFilter) return false;
    const start = timeToMinutes(t.startTime);
    const end = start + (t.duration || 0);
    return end > col.startHour * 60 && start < col.endHour * 60;
  });

  const hours = Array.from({ length: 8 }, (_, i) => col.startHour + i);
  const altRow = darkMode ? 'bg-white/[0.04]' : 'bg-stone-100/50';

  return (
    <div className={`flex-1 flex flex-col min-w-0 ${colIdx > 0 ? `border-l ${borderClass}` : ''}`}>
      <div className="flex-1 relative">
        {/* Hour rows — each is a full-width flex row matching TimeGrid's structure */}
        {hours.map((hour, i) => (
          <div key={hour} className="relative">
            <div className={`flex border-b ${borderClass} ${i % 2 === 1 ? altRow : ''}`}>
              <div
                className={`w-16 flex-shrink-0 px-3 py-1 text-sm ${textSecondary} border-r ${borderClass} flex items-start`}
                style={{ height: `${hourHeight}px` }}
              >
                {formatHourLabel(hour, use24HourClock)}
              </div>
              <div className="flex-1" style={{ height: `${hourHeight}px` }} />
            </div>
            {/* Half-hour dashed line — full-width flex matching TimeGrid */}
            <div
              className="absolute left-0 right-0 pointer-events-none"
              style={{ top: `${hourHeight / 2}px` }}
            >
              <div className={`flex border-b border-dashed ${borderClass} opacity-50`}>
                <div className="w-16 flex-shrink-0" />
                <div className="flex-1" />
              </div>
            </div>
          </div>
        ))}

        {/* Task pill overlay — covers the event area only (right of gutter) */}
        <div className="absolute top-0 left-16 right-0 bottom-0 pointer-events-none">
          {colTasks.map(task => {
            const slice = getTaskSlice(task, col, hourHeight, timeToMinutes);
            if (!slice) return null;

            const { top, height, clippedTop, clippedBottom, showTitle } = slice;
            const { left, width } = columnConflictPos(task, colTasks, timeToMinutes);

            const isImported = task.imported;
            const isCalendarEvent = isImported && !task.isTaskCalendar;
            const taskCalStyle = getTaskCalendarStyle(task, darkMode);
            const isCompleted = task.completed;
            const isRecurring = typeof task.id === 'string' && task.id.startsWith('recurring-');

            const radiusTop = clippedTop ? '' : 'rounded-t-lg';
            const radiusBot = clippedBottom ? '' : 'rounded-b-lg';

            return (
              <div
                key={`${task.id}-${col.startHour}`}
                data-ctx-menu
                className={`absolute pointer-events-auto shadow-md overflow-hidden
                  ${task.isTaskCalendar ? '' : task.color}
                  ${radiusTop} ${radiusBot}
                  ${isCompleted && !isCalendarEvent ? 'opacity-50' : ''}
                  ${isCalendarEvent ? 'cursor-default' : 'cursor-pointer'}
                `}
                style={{
                  top: `${top}px`,
                  height: `${height}px`,
                  left,
                  width,
                  ...(isCalendarEvent || task.isTaskCalendar ? taskCalStyle : {}),
                }}
                onClick={() => {
                  if (!isCalendarEvent || task.isTaskCalendar || task.nativeEventId) {
                    openMobileEditTask(task, false);
                  }
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setTaskContextMenu({
                    x: e.clientX, y: e.clientY,
                    taskId: task.id,
                    isRecurring: !!isRecurring,
                    isImported: !!isImported,
                    isAllDay: false,
                    dateStr: col.dateStr,
                  });
                }}
              >
                {/* Clipped-top indicator */}
                {clippedTop && (
                  <div className="absolute top-0 left-0 right-0 flex justify-center pointer-events-none">
                    <ChevronUp size={12} className="text-white/70" />
                  </div>
                )}

                <div className="px-1.5 py-0.5 h-full flex flex-col text-white overflow-hidden">
                  {/* Completion checkbox + title row */}
                  {showTitle && (
                    <div className="flex items-start gap-1 min-w-0">
                      {(!isImported || task.isTaskCalendar) && (
                        <button
                          onClick={(e) => { e.stopPropagation(); toggleComplete(task.id); }}
                          className={`mt-0.5 rounded flex-shrink-0 border-2 border-white w-3.5 h-3.5 flex items-center justify-center transition-colors ${task.completed ? 'bg-white/40' : 'bg-white/20'} hover:bg-white/30`}
                        >
                          {task.completed && <Check size={9} strokeWidth={3} />}
                        </button>
                      )}
                      {isRecurring && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setEditingRecurrenceTaskId(task.id); }}
                          className="mt-0.5 flex-shrink-0 opacity-75 hover:opacity-100"
                        >
                          <RefreshCw size={10} />
                        </button>
                      )}
                      <div
                        className={`font-semibold leading-tight truncate flex-1 min-w-0 ${task.completed ? 'line-through' : ''}`}
                        style={{ fontSize: '13px' }}
                        title={task.title}
                      >
                        {renderTitleWithoutTags(task.title)}
                      </div>
                    </div>
                  )}

                  {/* Time label (shown when there's enough height) */}
                  {showTitle && height > 42 && (
                    <div className="text-[10px] opacity-80 leading-none mt-0.5 flex-shrink-0">
                      {formatTime(task.startTime)}
                      {task.duration ? ` · ${task.duration}m` : ''}
                    </div>
                  )}
                </div>

                {/* Clipped-bottom indicator */}
                {clippedBottom && (
                  <div className="absolute bottom-0 left-0 right-0 flex justify-center pointer-events-none">
                    <ChevronDown size={12} className="text-white/70" />
                  </div>
                )}

                {/* Action buttons (non-imported, non-tablet) — top-right corner */}
                {!isImported && !isTablet && height > 55 && showTitle && (
                  <div className="absolute top-0.5 right-0.5 flex gap-0.5">
                    <button
                      onClick={(e) => { e.stopPropagation(); postponeTask(task.id); }}
                      className="hover:bg-white/20 rounded p-0.5 transition-colors text-white/80"
                      title="Postpone to tomorrow"
                    >
                      <SkipForward size={11} />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); openMobileEditTask(task, false); }}
                      className="hover:bg-white/20 rounded p-0.5 transition-colors text-white/80"
                      title="Edit"
                    >
                      <Pencil size={11} />
                    </button>
                    {isRecurring ? (
                      <button
                        onClick={(e) => { e.stopPropagation(); moveToRecycleBin(task.id); }}
                        className="hover:bg-white/20 rounded p-0.5 transition-colors text-white/80"
                        title="Delete"
                      >
                        <Trash2 size={11} />
                      </button>
                    ) : (
                      <button
                        onClick={(e) => { e.stopPropagation(); moveToInbox(task.id); }}
                        className="hover:bg-white/20 rounded p-0.5 transition-colors text-white/80"
                        title="Move to Inbox"
                      >
                        <Inbox size={11} />
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

// ── DayView ───────────────────────────────────────────────────────────────────

const DayView = () => {
  const {
    calendarRef, stickyHeaderRef,
    dayViewColumns,
  } = useDayPlannerCtx();

  const hourHeight = useDayViewHourHeight(calendarRef, stickyHeaderRef);

  return (
    <div className="flex" style={{ height: '100%' }}>
      {dayViewColumns.map((col, colIdx) => (
        <DayViewColumn
          key={`${col.dateStr}-${col.startHour}`}
          col={col}
          colIdx={colIdx}
          hourHeight={hourHeight}
        />
      ))}
    </div>
  );
};

export default DayView;
