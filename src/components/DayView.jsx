import React from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { formatHourLabel } from '../utils/timeFormatting.jsx';
import { dateToString } from '../utils/taskUtils.js';
import TimelineTaskCardContent from './TimelineTaskCardContent.jsx';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../context/FeaturesContext.jsx';
import useDayViewHourHeight from '../hooks/useDayViewHourHeight.js';
import { getHGBarsForDate } from '../hooks/useHyperGlance.js';
import HyperGlanceBar from './HyperGlanceBar.jsx';

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
    expandedNotesTaskId,
    taskContextMenu, setTaskContextMenu,
    openMobileEditTask,
    getTasksForDate,
    getTaskCalendarStyle,
    timeToMinutes,
    handleRoutineResizeStart, handleTouchRoutineResizeStart,
  } = useDayPlannerCtx();

  const { projectFilter, routinesEnabled, todayRoutines, routineCompletions, toggleRoutineCompletion, goalsProjectsEnabled, projects } = useFeaturesCtx();

  const isDateToday = col.dateStr === dateToString(new Date());
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
  const hgBars = goalsProjectsEnabled
    ? getHGBarsForDate(projects, col.dateStr, isDateToday ? nowMin : undefined)
    : [];
  const hasBars = hgBars.length > 0;

  const taskOverlapsHG = (task) => {
    if (!task.startTime || !hasBars) return false;
    const [th, tm] = (task.startTime || '0:0').split(':').map(Number);
    const tStart = th * 60 + tm;
    const tEnd = tStart + (task.duration || 30);
    return hgBars.some(bar => {
      const hg = bar.project.hyperglance;
      const effectiveTime = hg.scheduledTimeOverrides?.[bar.date] || hg.scheduledTime || '0:0';
      const [bh, bm] = effectiveTime.split(':').map(Number);
      const bStart = bh * 60 + bm;
      const effectiveDur = bar.isCompleted ? 15 : (hg.scheduledDurationOverrides?.[bar.date] || hg.scheduledDuration || 60);
      return tStart < bStart + effectiveDur && tEnd > bStart;
    });
  };

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

  return (
    <div className={`flex-1 flex flex-col min-w-0 ${colIdx > 0 ? `border-l ${borderClass}` : ''} ${showNowLine ? (darkMode ? 'bg-blue-900/10' : 'bg-blue-50/40') : ''}`}>
      <div className="flex-1 relative flex flex-col">
        {/* Hour rows — each is a full-width flex row matching TimeGrid's structure */}
        {hours.map((hour, i) => (
          <div
            key={hour}
            className="relative"
            style={{ height: `${hourHeight}px` }}
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
          {/* HyperGLANCE project bars — left 50% of event area */}
          {hasBars && (
            <div className="absolute top-0 bottom-0 pointer-events-none" style={{ left: 0, width: '50%' }}>
              {hgBars.map(bar => {
                const hg = bar.project.hyperglance;
                const effectiveTime = hg.scheduledTimeOverrides?.[bar.date] || hg.scheduledTime || '0:0';
                const [bh, bm] = effectiveTime.split(':').map(Number);
                const bStartMin = bh * 60 + bm;
                const effectiveDur = bar.isCompleted ? 15 : (hg.scheduledDurationOverrides?.[bar.date] || hg.scheduledDuration || 60);
                const bEndMin = bStartMin + effectiveDur;
                const colStartMin = col.startHour * 60;
                const colEndMin = col.endHour * 60;
                if (bEndMin <= colStartMin || bStartMin >= colEndMin) return null;
                const visStart = Math.max(bStartMin, colStartMin);
                const visEnd = Math.min(bEndMin, colEndMin);
                const overrideTop = (visStart - colStartMin) * hourHeight / 60;
                const overrideFullHeight = Math.max((visEnd - visStart) * hourHeight / 60 - 1, 24);
                const overridePillHeight = Math.max(15 * hourHeight / 60 - 1, 18);
                return (
                  <HyperGlanceBar
                    key={bar.project.id}
                    {...bar}
                    overrideTop={overrideTop}
                    overrideFullHeight={overrideFullHeight}
                    overridePillHeight={overridePillHeight}
                  />
                );
              })}
            </div>
          )}

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
                  ...(hasBars && taskOverlapsHG(task)
                    ? { left: '50%', right: 0, width: undefined }
                    : { left, width }),
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

          {/* Timeline routine pills (today only) */}
          {routinesEnabled && col.dateStr === dateToString(new Date()) && (() => {
            const timedRoutines = todayRoutines.filter(r => !r.isAllDay && r.startTime);
            if (timedRoutines.length === 0) return null;

            const routineCols = [];
            const sorted = [...timedRoutines].sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));
            sorted.forEach(r => {
              const rStart = timeToMinutes(r.startTime);
              let placed = false;
              for (let c = 0; c < routineCols.length; c++) {
                const last = routineCols[c][routineCols[c].length - 1];
                if (timeToMinutes(last.startTime) + last.duration <= rStart) {
                  routineCols[c].push(r); placed = true; break;
                }
              }
              if (!placed) routineCols.push([r]);
            });

            const colMap = {};
            routineCols.forEach((rc, ci) => rc.forEach(r => { colMap[r.id] = ci; }));

            const overlapCount = {};
            timedRoutines.forEach(r => {
              const rStart = timeToMinutes(r.startTime);
              const rEnd = rStart + r.duration;
              const pts = new Set([rStart]);
              timedRoutines.forEach(o => { const s = timeToMinutes(o.startTime); if (s > rStart && s < rEnd) pts.add(s); });
              let max = 0;
              pts.forEach(t => {
                let cnt = 0;
                timedRoutines.forEach(o => { const s = timeToMinutes(o.startTime); if (s <= t && s + o.duration > t) cnt++; });
                max = Math.max(max, cnt);
              });
              overlapCount[r.id] = max;
            });

            const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();

            return timedRoutines.map(routine => {
              const slice = getTaskSlice(routine, col, hourHeight, timeToMinutes);
              if (!slice) return null;
              const { top, height } = slice;
              const rci = colMap[routine.id];
              const cols = overlapCount[routine.id];
              const wPct = cols > 1 ? `${100 / cols}%` : '100%';
              const lPct = cols > 1 ? `${(rci * 100) / cols}%` : '0%';
              const isPast = timeToMinutes(routine.startTime) + routine.duration <= nowMinutes;

              return (
                <div
                  key={`routine-tl-${routine.id}`}
                  className={`absolute pointer-events-auto flex items-center justify-center ${isPast ? 'opacity-50' : ''}`}
                  style={{ top: `${top}px`, height: `${Math.max(height, 27)}px`, left: `calc(${lPct} + 4px)`, width: `calc(${wPct} - 8px)` }}
                >
                  <div className={`absolute left-0 right-0 top-1/2 -translate-y-1/2 h-1.5 rounded-full ${darkMode ? 'bg-teal-700/80' : 'bg-teal-600/80'}`} />
                  <div className={`absolute top-0 bottom-0 left-1/2 -translate-x-1/2 w-1.5 rounded-full ${darkMode ? 'bg-teal-700/80' : 'bg-teal-600/80'}`} />
                  <span
                    className={`relative rounded-full px-3 py-1 text-xs font-medium cursor-pointer ${darkMode ? 'bg-teal-700 text-teal-100' : 'bg-teal-600 text-white'} ${routineCompletions[routine.id] ? 'line-through opacity-75' : ''}`}
                    onClick={() => toggleRoutineCompletion(routine.id)}
                  >{routine.name}</span>
                  {!isTablet && (
                    <div
                      className="absolute bottom-0 left-0 right-0 h-3 cursor-ns-resize flex justify-center items-center"
                      onMouseDown={(e) => handleRoutineResizeStart(routine, e)}
                      style={{ marginBottom: '-4px' }}
                    >
                      <div className="w-8 h-1 rounded-full bg-white" />
                    </div>
                  )}
                  {isTablet && (
                    <div
                      onTouchStart={(e) => handleTouchRoutineResizeStart(routine, e)}
                      className="absolute bottom-0 left-1/3 right-1/3 h-3 flex items-center justify-center select-none"
                      style={{ marginBottom: '-4px', touchAction: 'none', WebkitTouchCallout: 'none' }}
                    >
                      <div className="w-12 h-1 bg-white rounded-full" />
                    </div>
                  )}
                </div>
              );
            });
          })()}
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
