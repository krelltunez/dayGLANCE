import React from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { formatHourLabel } from '../utils/timeFormatting.jsx';
import { dateToString } from '../utils/taskUtils.js';
import TimelineTaskCardContent from './TimelineTaskCardContent.jsx';
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
    darkMode, use24HourClock,
    borderClass, textSecondary,
    expandedNotesTaskId,
    taskContextMenu, setTaskContextMenu,
    openMobileEditTask,
    getTasksForDate,
    getTaskCalendarStyle,
    timeToMinutes,
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

  const now = new Date();
  const colStartMin = col.startHour * 60;
  const colEndMin = col.endHour * 60;
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const showNowLine = col.dateStr === dateToString(now) && nowMinutes >= colStartMin && nowMinutes < colEndMin;
  const nowY = showNowLine ? (nowMinutes - colStartMin) * hourHeight / 60 : 0;

  const isToday = col.dateStr === dateToString(new Date());

  return (
    <div className={`flex-1 flex flex-col min-w-0 ${colIdx > 0 ? `border-l ${borderClass}` : ''} ${isToday ? (darkMode ? 'bg-blue-900/10' : 'bg-blue-50/40') : ''}`}>
      <div className="flex-1 relative flex flex-col">
        {/* Hour rows — each is a full-width flex row matching TimeGrid's structure */}
        {hours.map((hour, i) => (
          <div
            key={hour}
            className={`relative${i === hours.length - 1 ? ' flex-1' : ''}`}
            style={i === hours.length - 1 ? { minHeight: `${hourHeight}px` } : { height: `${hourHeight}px` }}
          >
            <div className={`flex border-b h-full ${borderClass} ${i % 2 === 1 ? altRow : ''}`}>
              <div
                className={`w-16 flex-shrink-0 px-3 py-1 text-sm ${textSecondary} border-r ${borderClass} flex items-start h-full`}
              >
                {formatHourLabel(hour, use24HourClock)}
              </div>
              <div className="flex-1 h-full" />
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

        {/* Current-time indicator — dot at gutter edge, line across event area */}
        {showNowLine && (
          <div
            className="absolute left-16 right-0 pointer-events-none z-10"
            style={{ top: `${nowY}px` }}
          >
            <div className="flex items-center">
              <div className="w-2 h-2 bg-red-500 rounded-full -ml-1" />
              <div className="flex-1 h-0.5 bg-red-500" />
            </div>
          </div>
        )}

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

            const _nowMin = new Date().getHours() * 60 + new Date().getMinutes();
            const _taskStart = timeToMinutes(task.startTime || '0:00');
            const isCurrentTask = col.dateStr === dateToString(new Date()) && !isCompleted && !isCalendarEvent
              && _nowMin >= _taskStart && _nowMin < _taskStart + (task.duration || 0);

            const radiusTop = clippedTop ? '' : 'rounded-t-lg';
            const radiusBot = clippedBottom ? '' : 'rounded-b-lg';

            return (
              <div
                key={`${task.id}-${col.startHour}`}
                data-task-id={task.id}
                data-ctx-menu
                className={`absolute pointer-events-auto shadow-md notes-panel-container
                  ${task.isTaskCalendar ? '' : task.color}
                  ${radiusTop} ${radiusBot}
                  ${isCompleted && !isCalendarEvent ? 'opacity-50' : ''}
                  ${isCalendarEvent ? 'cursor-default' : 'cursor-pointer'}
                  ${expandedNotesTaskId === task.id ? 'overflow-visible z-30' : 'overflow-hidden'}
                  ${isCurrentTask ? 'current-task-pulse' : ''}
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
                    isRecurring: typeof task.id === 'string' && task.id.startsWith('recurring-'),
                    isImported: !!isImported,
                    isAllDay: false,
                    dateStr: col.dateStr,
                  });
                }}
              >
                {clippedTop && (
                  <div className="absolute top-0 left-0 right-0 flex justify-center pointer-events-none">
                    <ChevronUp size={12} className="text-white/70" />
                  </div>
                )}
                {showTitle && (
                  <TimelineTaskCardContent
                    task={task}
                    height={height}
                    isNarrowWidth={false}
                    flipNotesPanel={(8 * hourHeight) - (top + height) < 200}
                  />
                )}
                {clippedBottom && (
                  <div className="absolute bottom-0 left-0 right-0 flex justify-center pointer-events-none">
                    <ChevronDown size={12} className="text-white/70" />
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
