import React, { useEffect, useRef, useState } from 'react';
import { dateToString } from '../utils/taskUtils.js';
import { splitChipTitleTag } from '../utils/textFormatting.jsx';
import TimelineTaskCardContent from './TimelineTaskCardContent.jsx';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../context/FeaturesContext.jsx';
import useWeekViewHourHeight from '../hooks/useWeekViewHourHeight.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function weekColConflictPos(task, colTasks, timeToMinutes) {
  const tStart = timeToMinutes(task.startTime || '0:00');
  const tEnd = tStart + (task.duration || 0);

  const peers = colTasks.filter(other => {
    if (other.id === task.id) return false;
    const oStart = timeToMinutes(other.startTime || '0:00');
    const oEnd = oStart + (other.duration || 0);
    return tStart < oEnd && tEnd > oStart;
  });

  if (peers.length === 0) return { left: '1px', right: '1px', width: undefined };

  const group = [task, ...peers].sort((a, b) => {
    const diff = timeToMinutes(a.startTime || '0:00') - timeToMinutes(b.startTime || '0:00');
    return diff !== 0 ? diff : String(a.id).localeCompare(String(b.id));
  });
  const idx = group.findIndex(t => t.id === task.id);
  const total = group.length;
  const pct = 100 / total;
  return { left: `calc(${idx * pct}% + 1px)`, width: `calc(${pct}% - 2px)`, right: undefined };
}

// ── Task popover ──────────────────────────────────────────────────────────────

const WeekViewTaskPopover = ({ task, anchor, onClose }) => {
  const { cardBg, borderClass, darkMode, getTaskCalendarStyle, expandedNotesTaskId } = useDayPlannerCtx();
  const popoverRef = useRef(null);
  const POPOVER_W = 300;
  const POPOVER_H = 220;

  const isImported = task.imported;
  const isCalendarEvent = isImported && !task.isTaskCalendar;
  const taskCalStyle = getTaskCalendarStyle(task, darkMode);

  let left = anchor.right + 8;
  if (left + POPOVER_W > window.innerWidth - 8) left = anchor.left - POPOVER_W - 8;
  let top = anchor.top;
  if (top + POPOVER_H > window.innerHeight - 8) top = window.innerHeight - POPOVER_H - 8;
  top = Math.max(8, top);
  left = Math.max(8, left);

  useEffect(() => {
    const onDown = (e) => {
      if (!popoverRef.current?.contains(e.target)) onClose();
    };
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={popoverRef}
      className={`fixed z-50 shadow-2xl rounded-xl border notes-panel-container
        ${expandedNotesTaskId === task.id ? 'overflow-visible' : 'overflow-hidden'}
        ${task.isTaskCalendar ? '' : task.color}
        ${isCalendarEvent ? '' : ''}
      `}
      style={{
        left,
        top,
        width: POPOVER_W,
        minHeight: POPOVER_H,
        ...(isCalendarEvent || task.isTaskCalendar ? taskCalStyle : {}),
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <TimelineTaskCardContent
        task={task}
        height={POPOVER_H}
        isNarrowWidth={false}
        flipNotesPanel={top + POPOVER_H > window.innerHeight / 2}
      />
    </div>
  );
};

// ── WeekViewColumn ────────────────────────────────────────────────────────────

const WEEK_GUTTER_W = 64; // px — matches the hour-label column width

const WeekViewColumn = ({ date, dateStr, colIdx, hourHeight, onTaskClick, activePopoverTaskId, isToday }) => {
  const {
    darkMode, borderClass,
    getTasksForDate, getTaskCalendarStyle,
    timeToMinutes,
    setTaskContextMenu,
  } = useDayPlannerCtx();
  const { projectFilter, routinesEnabled, todayRoutines, routineCompletions } = useFeaturesCtx();

  const colTasks = getTasksForDate(date).filter(t => {
    if (t.isAllDay || !t.startTime) return false;
    if (projectFilter && t.projectId !== projectFilter) return false;
    return true;
  });

  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const nowY = isToday ? nowMinutes * hourHeight / 60 : 0;
  const altRow = darkMode ? 'bg-white/[0.04]' : 'bg-stone-100/50';

  return (
    <div
      data-week-col={dateStr}
      className={`flex-1 flex flex-col min-w-0 relative ${colIdx > 0 ? `border-l ${borderClass}` : ''} ${isToday ? (darkMode ? 'bg-blue-900/10' : 'bg-blue-50/40') : ''}`}
    >
      {/* Hour rows */}
      {Array.from({ length: 24 }, (_, hour) => (
        <div
          key={hour}
          className={`relative${hour === 23 ? ' flex-1' : ''}`}
          style={hour === 23 ? { minHeight: `${hourHeight}px` } : { height: `${hourHeight}px` }}
        >
          <div className={`border-b h-full ${borderClass} ${hour % 2 === 1 ? altRow : ''}`} />
          <div
            className="absolute left-0 right-0 pointer-events-none"
            style={{ top: `${hourHeight / 2}px` }}
          >
            <div className={`border-b border-dashed ${borderClass} opacity-30`} />
          </div>
        </div>
      ))}

      {/* Now line — today's column only */}
      {isToday && (
        <div
          className="absolute left-0 right-0 pointer-events-none z-10"
          style={{ top: `${nowY}px` }}
        >
          <div className="flex items-center">
            <div className="w-2 h-2 bg-red-500 rounded-full -ml-1 flex-shrink-0" />
            <div className="flex-1 h-0.5 bg-red-500" />
          </div>
        </div>
      )}

      {/* Task chips */}
      <div className="absolute top-0 left-0 right-0 bottom-0 pointer-events-none">
        {colTasks.map(task => {
          const taskStart = timeToMinutes(task.startTime || '0:00');
          const duration = task.duration || 0;
          const rawH = duration * hourHeight / 60;
          const chipH = Math.max(22, rawH);
          const chipTop = taskStart * hourHeight / 60;
          const { left, right, width } = weekColConflictPos(task, colTasks, timeToMinutes);

          const isImported = task.imported;
          const isCalendarEvent = isImported && !task.isTaskCalendar;
          const taskCalStyle = getTaskCalendarStyle(task, darkMode);
          const isActive = activePopoverTaskId === task.id;
          const [chipText, chipTag] = splitChipTitleTag(task.title);

          return (
            <div
              key={task.id}
              data-task-id={task.id}
              className={`absolute pointer-events-auto rounded-sm overflow-hidden cursor-pointer
                ${task.isTaskCalendar ? '' : task.color}
                ${task.completed ? 'opacity-50' : ''}
                ${isActive ? 'ring-2 ring-white/70 z-20' : 'z-10'}
                hover:brightness-90
              `}
              style={{
                top: `${chipTop}px`,
                height: `${chipH}px`,
                left,
                right: width ? undefined : right,
                width,
                ...(isCalendarEvent || task.isTaskCalendar ? taskCalStyle : {}),
              }}
              onClick={(e) => {
                e.stopPropagation();
                onTaskClick(task, e.currentTarget.getBoundingClientRect());
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                setTaskContextMenu({
                  x: e.clientX, y: e.clientY,
                  taskId: task.id,
                  isRecurring: typeof task.id === 'string' && task.id.startsWith('recurring-'),
                  isImported: !!isImported,
                  isAllDay: false,
                  dateStr,
                });
              }}
            >
              <div className="flex items-baseline gap-0.5 text-white text-[11px] font-medium leading-tight px-1 py-0.5 min-w-0 overflow-hidden">
                <span className="truncate min-w-0">{chipText}</span>
                {chipTag && <span className="shrink-0 italic opacity-75">{chipTag}</span>}
              </div>
            </div>
          );
        })}

        {/* Routine pills — today's column only, display only, max 2 wide + overflow indicator */}
        {routinesEnabled && isToday && (() => {
          const timedRoutines = todayRoutines
            .filter(r => !r.isAllDay && r.startTime)
            .sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));
          if (timedRoutines.length === 0) return null;

          // Greedy 2-col assignment
          const colTail = [null, null];
          const assignments = timedRoutines.map(r => {
            const rStart = timeToMinutes(r.startTime);
            for (let c = 0; c < 2; c++) {
              if (!colTail[c] || timeToMinutes(colTail[c].startTime) + colTail[c].duration <= rStart) {
                colTail[c] = r;
                return { r, col: c };
              }
            }
            return { r, col: 2 };
          });

          const rangesOverlap = (a, b) => {
            const aS = timeToMinutes(a.startTime), aE = aS + a.duration;
            const bS = timeToMinutes(b.startTime), bE = bS + b.duration;
            return aS < bE && bS < aE;
          };

          const overflowRoutines = assignments.filter(a => a.col === 2).map(a => a.r);

          // Merge overlapping overflow routines into indicator spans
          const overflowSpans = [];
          overflowRoutines.forEach(r => {
            const s = timeToMinutes(r.startTime), e = s + r.duration;
            const last = overflowSpans[overflowSpans.length - 1];
            if (last && s < last.e) { last.e = Math.max(last.e, e); last.count++; }
            else overflowSpans.push({ s, e, count: 1 });
          });

          // Hide col-1 routines that overlap any overflow; fold them into the span count
          const hiddenCol1 = new Set();
          assignments.filter(a => a.col === 1).forEach(({ r }) => {
            if (overflowRoutines.some(o => rangesOverlap(r, o))) {
              hiddenCol1.add(r.id);
              overflowSpans.forEach(sp => {
                const rS = timeToMinutes(r.startTime), rE = rS + r.duration;
                if (sp.s < rE && sp.e > rS) sp.count++;
              });
            }
          });

          const items = [];

          assignments.filter(({ r, col }) => col < 2 && !hiddenCol1.has(r.id)).forEach(({ r, col }) => {
            const top = timeToMinutes(r.startTime) * hourHeight / 60;
            const h = Math.max(22, r.duration * hourHeight / 60);
            const hasVisiblePartner = assignments.some(({ r: pr, col: pc }) =>
              pc === (1 - col) && !hiddenCol1.has(pr.id) && rangesOverlap(r, pr)
            );
            const hasOverlap = hasVisiblePartner || overflowSpans.some(sp => {
              const rS = timeToMinutes(r.startTime), rE = rS + r.duration;
              return sp.s < rE && sp.e > rS;
            });
            items.push(
              <div key={`routine-${r.id}`}
                className="absolute pointer-events-none flex items-center justify-center"
                style={{
                  top: `${top}px`, height: `${h}px`, zIndex: 5,
                  left: hasOverlap && col === 1 ? 'calc(50% + 1px)' : '1px',
                  right: hasOverlap && col === 0 ? 'calc(50% + 1px)' : '1px',
                }}>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium truncate max-w-full ${darkMode ? 'bg-teal-700 text-teal-100' : 'bg-teal-600 text-white'} ${routineCompletions[r.id] ? 'line-through opacity-75' : ''}`}>
                  {r.name}
                </span>
              </div>
            );
          });

          overflowSpans.forEach((sp, i) => {
            items.push(
              <div key={`overflow-${i}`}
                className="absolute pointer-events-none flex items-center justify-center"
                style={{ top: `${sp.s * hourHeight / 60}px`, height: `${Math.max(22, (sp.e - sp.s) * hourHeight / 60)}px`, left: 'calc(50% + 1px)', right: '1px', zIndex: 6 }}>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${darkMode ? 'bg-teal-700/60 text-teal-200' : 'bg-teal-500/60 text-white'}`}>
                  +{sp.count}
                </span>
              </div>
            );
          });

          return items;
        })()}
      </div>
    </div>
  );
};

// ── WeekView ──────────────────────────────────────────────────────────────────

const WeekView = () => {
  const {
    calendarRef, stickyHeaderRef,
    weekViewDates,
    darkMode, borderClass, textSecondary,
    use24HourClock,
    cardBg,
  } = useDayPlannerCtx();

  const hourHeight = useWeekViewHourHeight(calendarRef, stickyHeaderRef);
  const [popoverTask, setPopoverTask] = useState(null);
  const [popoverAnchor, setPopoverAnchor] = useState(null);

  const todayStr = dateToString(new Date());

  const handleTaskClick = (task, anchor) => {
    if (popoverTask?.id === task.id) {
      setPopoverTask(null);
      setPopoverAnchor(null);
    } else {
      setPopoverTask(task);
      setPopoverAnchor(anchor);
    }
  };

  const handleClosePopover = () => {
    setPopoverTask(null);
    setPopoverAnchor(null);
  };

  return (
    <div className="flex" style={{ height: '100%' }}>
      {/* Hour-label gutter */}
      <div
        className={`flex-shrink-0 border-r ${borderClass} flex flex-col`}
        style={{ width: WEEK_GUTTER_W }}
      >
        {Array.from({ length: 24 }, (_, hour) => (
          <div
            key={hour}
            className={`relative flex-shrink-0${hour === 23 ? ' flex-1' : ''}`}
            style={hour === 23 ? { minHeight: `${hourHeight}px` } : { height: `${hourHeight}px` }}
          >
            {hour % 3 === 0 && (
              <span
                className={`absolute top-0.5 right-2 text-[10px] leading-none ${textSecondary} select-none`}
              >
                {use24HourClock
                  ? `${String(hour).padStart(2, '0')}:00`
                  : hour === 0 ? '12 AM' : hour === 12 ? '12 PM' : hour < 12 ? `${hour} AM` : `${hour - 12} PM`
                }
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Day columns */}
      {weekViewDates.map((date, colIdx) => {
        const dateStr = dateToString(date);
        return (
          <WeekViewColumn
            key={dateStr}
            date={date}
            dateStr={dateStr}
            colIdx={colIdx}
            hourHeight={hourHeight}
            onTaskClick={handleTaskClick}
            activePopoverTaskId={popoverTask?.id}
            isToday={dateStr === todayStr}
          />
        );
      })}

      {/* Task detail popover */}
      {popoverTask && popoverAnchor && (
        <WeekViewTaskPopover
          task={popoverTask}
          anchor={popoverAnchor}
          onClose={handleClosePopover}
        />
      )}
    </div>
  );
};

export { WEEK_GUTTER_W };
export default WeekView;
