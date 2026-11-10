import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDuration } from '../utils/formatDuration.js';
import { weekWindow, compactHourLabel, clippedCounts, gutterEdge } from '../utils/weekWindow.js';
import { HOUR_GUTTER_W } from '../constants/timeline.js';
import * as Icons from 'lucide-react';
import { Zap } from 'lucide-react';
import { dateToString } from '../utils/taskUtils.js';
import { cardTitleTooltip } from '../utils/cardTitle.js';
import { splitChipTitleTag } from '../utils/textFormatting.jsx';
import { columnTimeFromEvent, dragBlockRange, dropClampMinutes } from '../utils/dragUtils.js';
import { continuationLayoutRow, dragPreviewSpillFor } from '../utils/continuations.js';
import DragBlockPreview from './DragBlockPreview.jsx';
import { NextDayMark } from './TimeRange.jsx';
import TimelineTaskCardContent from './TimelineTaskCardContent.jsx';
import { PastDoDetails, pastDoChipStyle, pastDoColor } from './jobo/PastDoCard.jsx';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../context/FeaturesContext.jsx';
import useWeekViewHourHeight from '../hooks/useWeekViewHourHeight.js';
import useTimelineZoom from '../hooks/useTimelineZoom.js';
import { getHGBarsForDate, isHGSessionReachable } from '../hooks/useHyperGlance.js';
import { hexToRgba, frameColorBg, frameColorBorder } from '../utils/colorUtils.js';
import { formatLocalizedDate } from '../utils/localeFormatting.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

// ── Task popover ──────────────────────────────────────────────────────────────

const WeekViewTaskPopover = ({ task, anchor, onClose }) => {
  const { cardBg, borderClass, darkMode, getTaskCalendarStyle, expandedNotesTaskId } = useDayPlannerCtx();
  const popoverRef = useRef(null);
  const POPOVER_W = 300;
  const POPOVER_H = 220;

  // The card shows a long title whole here, with its actions on a row of
  // their own (#2368), so the popover can grow past POPOVER_H: it is placed
  // by the height it actually has.
  const [measuredH, setMeasuredH] = useState(POPOVER_H);
  useLayoutEffect(() => {
    const h = popoverRef.current?.offsetHeight;
    if (h && h !== measuredH) setMeasuredH(h);
  }, [task, measuredH]);
  const popoverH = Math.max(POPOVER_H, measuredH);

  const isImported = task.imported;
  const isCalendarEvent = isImported && !task.isTaskCalendar;
  const taskCalStyle = getTaskCalendarStyle(task, darkMode);

  let left = anchor.right + 8;
  if (left + POPOVER_W > window.innerWidth - 8) left = anchor.left - POPOVER_W - 8;
  let top = anchor.top;
  if (top + popoverH > window.innerHeight - 8) top = window.innerHeight - popoverH - 8;
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
      className={`group/card fixed z-50 shadow-2xl rounded-xl border notes-panel-container text-white
        ${expandedNotesTaskId === task.id ? 'overflow-visible' : 'overflow-hidden'}
        ${task.joboDo ? pastDoColor(task) : task.isTaskCalendar ? '' : task.color}
        ${isCalendarEvent ? '' : ''}
      `}
      style={{
        left,
        top,
        width: POPOVER_W,
        minHeight: POPOVER_H,
        ...(isCalendarEvent || task.isTaskCalendar ? taskCalStyle : {}),
        ...(task.joboDo ? pastDoChipStyle : {}),
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* A recorded Do shows what was recorded, read-only, and the way to
          JOBO where it can be edited; a task shows its card as before. */}
      {task.joboDo ? (
        <PastDoDetails item={task} onClose={onClose} />
      ) : (
        <TimelineTaskCardContent
          task={task}
          height={POPOVER_H}
          isNarrowWidth={false}
          popover
          flipNotesPanel={top + popoverH > window.innerHeight / 2}
        />
      )}
    </div>
  );
};

// ── WeekViewColumn ────────────────────────────────────────────────────────────

const WEEK_GUTTER_W = HOUR_GUTTER_W; // the shared hour-label column (constants/timeline.js)

const WeekViewColumn = ({ date, dateStr, colIdx, hourHeight, zoom = 1, startHour, endHour, onTaskClick, activePopoverTaskId, isToday }) => {
  const { t } = useTranslation();
  const {
    darkMode, borderClass, cardBg,
    getTasksForDate, getDayDisplayForDate, getContinuationsForDate, getTaskCalendarStyle,
    calculateConflictPosition,
    timeToMinutes,
    setTaskContextMenu, setTimelineContextMenu,
    isTablet,
    draggedTask,
    dragPreviewTime, dragPreviewDate,
    setDragPreviewTime, setDragPreviewDate,
    handleDragStart, handleDragEnd, handleDropOnCalendar,
    formatTime,
  } = useDayPlannerCtx();
  const { projectFilter, routinesEnabled, todayRoutines, routineCompletions, goalsProjectsEnabled, projects, hgVisibleProjects, getFrameInstancesForDate, setFrameContextMenu, setHgContextMenu } = useFeaturesCtx();

  const [overflowPopover, setOverflowPopover] = useState(null); // { routines, rect }
  const overflowPopoverRef = useRef(null);
  const colRef = useRef(null);

  // Compute the snapped drop time for the cursor Y relative to this week-view
  // column. The column spans the visible window, so a drop is clamped to it at
  // both ends: you cannot drop a task into an hour the view is not showing you.
  const startMinute = startHour * 60;
  const timeFromEvent = (e, { taskDuration = 0 } = {}) => columnTimeFromEvent(e, colRef.current, {
    startMinute,
    hourHeight,
    minMinute: startMinute,
    maxMinute: endHour * 60,
    taskDuration,
  });

  const onColDragOver = (e) => {
    if (!draggedTask) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    // The cursor's time is the start; a task may run on past the window's end,
    // and past midnight onto the next date (#2278).
    const t = timeFromEvent(e, { taskDuration: dropClampMinutes(draggedTask.duration) });
    setDragPreviewTime(t);
    setDragPreviewDate(date);
  };

  const onColDrop = (e) => {
    if (!draggedTask) return;
    const t = timeFromEvent(e, { taskDuration: dropClampMinutes(draggedTask.duration) });
    handleDropOnCalendar(e, date, t);
  };

  const isDraggingOverThisCol = draggedTask && dragPreviewDate && dateToString(dragPreviewDate) === dateStr;

  const dayName = formatLocalizedDate(date, { weekday: 'short' });

  useEffect(() => {
    if (!overflowPopover) return;
    const onDown = (e) => { if (!overflowPopoverRef.current?.contains(e.target)) setOverflowPopover(null); };
    const onKey = (e) => { if (e.key === 'Escape') setOverflowPopover(null); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [overflowPopover]);

  // A past date shows what was done (slice 6): recorded Do replace the plan
  // chips they belong to, as striped read-only chips.
  const colTasks = (getDayDisplayForDate || getTasksForDate)(date).filter(t => {
    if (t.isAllDay || !t.startTime) return false;
    if (projectFilter && t.projectId !== projectFilter) return false;
    return true;
  });
  // The previous date's tasks running past midnight (#2278): chips from 00:00,
  // packed with this date's own, but not among this date's tasks.
  const continuations = (getContinuationsForDate ? getContinuationsForDate(date) : [])
    .filter(c => !projectFilter || c.task.projectId === projectFilter);
  const layoutTasks = continuations.length ? [...colTasks, ...continuations.map(continuationLayoutRow)] : colTasks;
  const fromDayName = (fromDate) => formatLocalizedDate(new Date(`${fromDate}T12:00:00`), { weekday: 'short' });

  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const nowY = isToday ? (nowMinutes - startMinute) * hourHeight / 60 : 0;
  const altRow = darkMode ? 'bg-white/[0.04]' : 'bg-stone-100/50';

  const hgBars = goalsProjectsEnabled
    ? getHGBarsForDate(hgVisibleProjects, dateStr, isToday ? nowMinutes : undefined)
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

  return (
    <div
      ref={colRef}
      data-week-col={dateStr}
      onDragOver={onColDragOver}
      onDrop={onColDrop}
      className={`flex-1 flex flex-col min-w-0 relative ${colIdx > 0 ? `border-l ${borderClass}` : ''} ${isToday ? (darkMode ? 'bg-blue-900/10' : 'bg-blue-50/40') : ''}`}
    >
      {/* Hour rows — only render visible hours */}
      {Array.from({ length: endHour - startHour }, (_, i) => {
        const hour = startHour + i;
        return (
          <div
            key={hour}
            className="relative"
            style={{ height: `${hourHeight}px` }}
            onContextMenu={(e) => {
              e.preventDefault();
              const rect = e.currentTarget.getBoundingClientRect();
              const fraction = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
              const minutes = hour * 60 + Math.round(fraction * 60 / 15) * 15;
              setTimelineContextMenu({ x: e.clientX, y: e.clientY, dateStr, timeMinutes: minutes });
            }}
          >
            <div className={`border-b h-full ${borderClass} ${hour % 2 === 1 ? altRow : ''}`} />
            <div
              className="absolute left-0 right-0 pointer-events-none"
              style={{ top: `${hourHeight / 2}px` }}
            >
              <div className={`border-b border-dashed ${borderClass} opacity-30`} />
            </div>
          </div>
        );
      })}

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

      {/* GTD Frame background zones — behind everything */}
      {getFrameInstancesForDate(date).map(frame => {
        const fStartMin = timeToMinutes(frame.start);
        const fEndMin = timeToMinutes(frame.end);
        const top = (fStartMin - startMinute) * hourHeight / 60;
        const height = Math.max((fEndMin - fStartMin) * hourHeight / 60, 4);
        const bg = frameColorBg(frame.color, darkMode);
        const border = frameColorBorder(frame.color, darkMode);
        return (
          <div
            key={frame.frameId}
            data-ctx-menu
            className="absolute left-0 right-0 pointer-events-auto select-none"
            style={{ top: `${top}px`, height: `${height}px`, background: bg, borderLeft: `3px solid ${border}` }}
            onContextMenu={(e) => { e.preventDefault(); setFrameContextMenu({ x: e.clientX, y: e.clientY, frameId: frame.frameId, dateStr }); }}
          />
        );
      })}

      {/* HyperGLANCE project strips — narrow left edge, display only */}
      {hgBars.length > 0 && (
        <div className="absolute top-0 bottom-0 left-0 pointer-events-none" style={{ width: '25%' }}>
          {hgBars.map(bar => {
            const hg = bar.project.hyperglance;
            const effectiveTime = hg.scheduledTimeOverrides?.[bar.date] || hg.scheduledTime || '0:0';
            const [bh, bm] = effectiveTime.split(':').map(Number);
            const startMin = bh * 60 + bm;
            const dur = bar.isCompleted ? 15 : (hg.scheduledDurationOverrides?.[bar.date] || hg.scheduledDuration || 60);
            const barTop = (startMin - startMinute) * hourHeight / 60;
            const barH = Math.max(dur * hourHeight / 60, 18);
            const barColor = hg.color || '#4f46e5';
            const IconComp = Icons[hg.icon] || Icons.Sparkles;
            const canEnter = !bar.isCompleted && isHGSessionReachable({ date: bar.date, isOverdue: false }, hg, now);
            return (
              <div
                key={bar.project.id}
                className="absolute overflow-hidden flex flex-col items-center pt-0.5 gap-0.5 pointer-events-auto"
                style={{
                  top: `${barTop}px`,
                  height: `${barH}px`,
                  left: 1,
                  right: 1,
                  backgroundColor: hexToRgba(barColor, 0.09),
                  borderLeft: `3px solid ${barColor}`,
                  borderRadius: 3,
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setHgContextMenu({ x: e.clientX, y: e.clientY, projectId: bar.project.id, date: bar.date, isCompleted: bar.isCompleted });
                }}
              >
                <IconComp size={12} style={{ color: barColor, flexShrink: 0 }} />
                {canEnter && (
                  <Zap size={10} style={{ color: barColor }} className="animate-pulse flex-shrink-0" />
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Task chips */}
      <div className="absolute top-0 left-0 right-0 bottom-0 pointer-events-none">
        {colTasks.map(task => {
          const taskStart = timeToMinutes(task.startTime || '0:00');
          // A chip stops at midnight; the next date draws the rest (#2278).
          const duration = Math.min(task.duration || 0, 24 * 60 - taskStart);
          const rawH = duration * hourHeight / 60;
          const chipH = Math.max(22 * zoom, rawH);
          const chipTop = (taskStart - startMinute) * hourHeight / 60;
          // Same lane packing as MULTI and DAY: transitive overlap clusters
          // with first-fit columns, from the shared interval packer.
          const conflictPos = calculateConflictPosition(task, layoutTasks);

          const isImported = task.imported;
          const isCalendarEvent = isImported && !task.isTaskCalendar;
          const taskCalStyle = getTaskCalendarStyle(task, darkMode);
          const isActive = activePopoverTaskId === task.id;
          const isRecurring = typeof task.id === 'string' && task.id.startsWith('recurring-');
          const [chipText, chipTag] = splitChipTitleTag(task.title);
          const chipDraggable = !task.joboDo && (!isImported || task.isTaskCalendar || !!task.nativeEventId) && !isTablet;

          return (
            <div
              key={task.id}
              data-task-id={task.id}
              draggable={chipDraggable}
              onDragStart={chipDraggable ? (e) => handleDragStart(task, 'calendar', e) : undefined}
              onDragEnd={chipDraggable ? handleDragEnd : undefined}
              className={`absolute pointer-events-auto rounded-sm overflow-hidden
                ${chipDraggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'}
                ${task.joboDo ? pastDoColor(task) : task.isTaskCalendar ? '' : task.color}
                ${task.completed ? 'opacity-50' : ''}
                ${isActive ? 'ring-2 ring-white/70 z-20' : 'z-10'}
                hover:brightness-90
              `}
              style={{
                top: `${chipTop}px`,
                height: `${chipH}px`,
                ...(hasBars && taskOverlapsHG(task)
                  ? { left: '25%', right: '1px', width: undefined }
                  : { left: conflictPos.left, right: conflictPos.right, width: conflictPos.width }),
                ...(isCalendarEvent || task.isTaskCalendar ? taskCalStyle : {}),
                ...(task.joboDo ? pastDoChipStyle : {}),
              }}
              data-jobo-past-do={task.joboDo ? task.joboRecordId : undefined}
              title={cardTitleTooltip(task.title)}
              onClick={(e) => {
                e.stopPropagation();
                onTaskClick(task, e.currentTarget.getBoundingClientRect());
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                // A recorded Do is read-only here: no task menu.
                if (task.joboDo) return;
                setTaskContextMenu({
                  x: e.clientX, y: e.clientY,
                  taskId: task.id,
                  isRecurring: typeof task.id === 'string' && task.id.startsWith('recurring-'),
                  isImported: !!isImported,
                  isAllDay: false,
                  dateStr,
                  supportsInlineNotes: false,
                });
              }}
            >
              <div className="flex items-center gap-0.5 text-white text-[11px] font-medium leading-tight px-1 py-0.5 min-w-0 overflow-hidden" style={zoom !== 1 ? { zoom } : undefined}>
                {isRecurring && <Icons.RefreshCw size={8} className="shrink-0 opacity-70" />}
                <span className="truncate min-w-0">{chipText}</span>
                {chipTag && <span className="shrink-0 italic opacity-75">{chipTag}</span>}
              </div>
            </div>
          );
        })}

        {/* The previous night's tasks, from midnight (#2278): the task's chip
            continued, a click shows the task, a drag moves the whole task. */}
        {continuations.map(c => {
          const { task } = c;
          const row = continuationLayoutRow(c);
          const chipTop = (0 - startMinute) * hourHeight / 60;
          const chipH = Math.max(22 * zoom, c.minutes * hourHeight / 60);
          const conflictPos = calculateConflictPosition(row, layoutTasks);
          const isImported = task.imported;
          const isCalendarEvent = isImported && !task.isTaskCalendar;
          const chipDraggable = (!isImported || task.isTaskCalendar || !!task.nativeEventId) && !isTablet;
          const [chipText, chipTag] = splitChipTitleTag(task.title);
          return (
            <div
              key={`continuation-${task.id}`}
              data-task-id={task.id}
              data-continuation-from={c.fromDate || ''}
              title={cardTitleTooltip(task.title)}
              draggable={chipDraggable}
              onDragStart={chipDraggable ? (e) => handleDragStart(task, 'calendar', e) : undefined}
              onDragEnd={chipDraggable ? handleDragEnd : undefined}
              className={`absolute pointer-events-auto rounded-b-sm overflow-hidden
                ${chipDraggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'}
                ${task.isTaskCalendar ? '' : task.color}
                ${task.completed ? 'opacity-50' : ''}
                ${activePopoverTaskId === task.id ? 'ring-2 ring-white/70 z-20' : 'z-10'}
                hover:brightness-90
              `}
              style={{
                top: `${chipTop}px`,
                height: `${chipH}px`,
                left: conflictPos.left, right: conflictPos.right, width: conflictPos.width,
                ...(isCalendarEvent || task.isTaskCalendar ? getTaskCalendarStyle(task, darkMode) : {}),
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
                  // The task lives on the date it started.
                  dateStr: c.fromDate,
                  supportsInlineNotes: false,
                });
              }}
            >
              <div className="absolute top-0 left-0 right-0 border-t-2 border-dashed border-white/60 pointer-events-none" />
              <div className="flex items-center gap-0.5 text-white text-[11px] font-medium leading-tight px-1 py-0.5 min-w-0 overflow-hidden" style={zoom !== 1 ? { zoom } : undefined}>
                <Icons.ChevronUp size={8} className="shrink-0 opacity-70" />
                <span className={`truncate min-w-0 ${task.completed ? 'line-through' : ''}`}>{chipText}</span>
                {chipTag && <span className="shrink-0 italic opacity-75">{chipTag}</span>}
                {c.fromDate && <span className="shrink-0 opacity-75">{t('task.continuesFrom', { day: fromDayName(c.fromDate) })}</span>}
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

          // Merge overlapping overflow routines into indicator spans (track actual routines)
          const overflowSpans = [];
          overflowRoutines.forEach(r => {
            const s = timeToMinutes(r.startTime), e = s + r.duration;
            const last = overflowSpans[overflowSpans.length - 1];
            if (last && s < last.e) { last.e = Math.max(last.e, e); last.routines.push(r); }
            else overflowSpans.push({ s, e, routines: [r] });
          });

          // Hide col-1 routines that overlap any overflow; fold them into the span routines
          const hiddenCol1 = new Set();
          assignments.filter(a => a.col === 1).forEach(({ r }) => {
            if (overflowRoutines.some(o => rangesOverlap(r, o))) {
              hiddenCol1.add(r.id);
              overflowSpans.forEach(sp => {
                const rS = timeToMinutes(r.startTime), rE = rS + r.duration;
                if (sp.s < rE && sp.e > rS) sp.routines.unshift(r); // col-1 first
              });
            }
          });

          const items = [];

          assignments.filter(({ r, col }) => col < 2 && !hiddenCol1.has(r.id)).forEach(({ r, col }) => {
            const rawTop = (timeToMinutes(r.startTime) - startMinute) * hourHeight / 60;
            const h = Math.max(22, r.duration * hourHeight / 60);
            // Clamp top so the chip never straddles the next hour line
            const nextHourPx = (Math.floor(timeToMinutes(r.startTime) / 60) + 1 - startHour) * hourHeight;
            const top = Math.min(rawTop, nextHourPx - h);
            const hasVisiblePartner = assignments.some(({ r: pr, col: pc }) =>
              pc === (1 - col) && !hiddenCol1.has(pr.id) && rangesOverlap(r, pr)
            );
            const hasOverlap = hasVisiblePartner || overflowSpans.some(sp => {
              const rS = timeToMinutes(r.startTime), rE = rS + r.duration;
              return sp.s < rE && sp.e > rS;
            });
            items.push(
              <div key={`routine-${r.id}`}
                draggable={!isTablet}
                onDragStart={!isTablet ? (e) => handleDragStart({ ...r }, 'routine', e) : undefined}
                onDragEnd={!isTablet ? handleDragEnd : undefined}
                className={`absolute pointer-events-auto flex items-start pt-0.5 ${!isTablet ? 'cursor-grab active:cursor-grabbing' : ''}`}
                style={{
                  top: `${top}px`, height: `${h}px`, zIndex: 5,
                  left: hasOverlap && col === 1 ? 'calc(50% + 1px)' : '1px',
                  right: hasOverlap && col === 0 ? 'calc(50% + 1px)' : '1px',
                }}>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium inline-flex items-center min-w-0 max-w-full overflow-hidden ${darkMode ? 'bg-teal-700 text-teal-100' : 'bg-teal-600 text-white'} ${routineCompletions[r.id] ? 'line-through opacity-75' : ''}`}>
                  <span className="truncate min-w-0">{r.name}</span>
                  <span className="shrink-0 ml-1 opacity-75">· {formatDuration(r.duration, t)}</span>
                </span>
              </div>
            );
          });

          overflowSpans.forEach((sp, i) => {
            items.push(
              <div key={`overflow-${i}`}
                className="absolute pointer-events-auto flex items-center justify-center cursor-pointer"
                style={{ top: `${Math.min((sp.s - startMinute) * hourHeight / 60, (Math.floor(sp.s / 60) + 1 - startHour) * hourHeight - Math.max(22, (sp.e - sp.s) * hourHeight / 60))}px`, height: `${Math.max(22, (sp.e - sp.s) * hourHeight / 60)}px`, left: 'calc(50% + 1px)', right: '1px', zIndex: 6 }}
                onClick={(e) => { e.stopPropagation(); setOverflowPopover({ routines: sp.routines, rect: e.currentTarget.getBoundingClientRect() }); }}>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${darkMode ? 'bg-teal-700/60 text-teal-200' : 'bg-teal-500/60 text-white'}`}>
                  +{sp.routines.length}
                </span>
              </div>
            );
          });

          return items;
        })()}
      </div>

      {/* Drag preview — the block the task becomes on the target day, at the
          cursor's time (#2277), placed and sized as its chip would be */}
      {isDraggingOverThisCol && dragPreviewTime && (() => {
        const block = dragBlockRange(timeToMinutes(dragPreviewTime), draggedTask.duration, {
          minMinute: startMinute,
          maxMinute: endHour * 60,
        });
        if (!block) return null;
        const topPx = (block.startMinute - startMinute) * hourHeight / 60;
        const heightPx = Math.max(22 * zoom, (block.endMinute - block.startMinute) * hourHeight / 60);
        return (
          <DragBlockPreview
            top={topPx}
            height={heightPx}
            label={<>{`${dayName} ${formatTime(block.startTime)}–${formatTime(block.endTime)}`}{block.endsNextDay && <NextDayMark />}</>}
            darkMode={darkMode}
            className="left-0 right-0 z-30"
          />
        );
      })()}

      {/* The drag preview's part past midnight, on the next date (#2278) */}
      {draggedTask && dragPreviewTime && dragPreviewDate && (() => {
        const spill = dragPreviewSpillFor(
          dragBlockRange(timeToMinutes(dragPreviewTime), draggedTask.duration),
          dateToString(dragPreviewDate), dateStr,
        );
        const visible = Math.min(spill, endHour * 60) - startMinute;
        if (!spill || visible <= 0) return null;
        return (
          <DragBlockPreview
            top={0}
            height={visible * hourHeight / 60}
            label=""
            darkMode={darkMode}
            className="left-0 right-0 z-30"
            showStart={false}
          />
        );
      })()}

      {/* Overflow routine popover */}
      {overflowPopover && (() => {
        const { routines, rect } = overflowPopover;
        let left = rect.right + 8;
        if (left + 200 > window.innerWidth - 8) left = rect.left - 200 - 8;
        let top = Math.max(8, Math.min(rect.top, window.innerHeight - routines.length * 36 - 24));
        return (
          <div
            ref={overflowPopoverRef}
            className={`fixed z-50 shadow-xl rounded-xl border p-2 space-y-1 ${cardBg} ${borderClass}`}
            style={{ left, top, minWidth: 160 }}
            onClick={(e) => e.stopPropagation()}
          >
            {routines.map(routine => (
              <div
                key={routine.id}
                className={`rounded-full px-3 py-1 text-xs font-medium inline-flex items-center min-w-0 max-w-full overflow-hidden ${darkMode ? 'bg-teal-700 text-teal-100' : 'bg-teal-600 text-white'} ${routineCompletions[routine.id] ? 'line-through opacity-75' : ''}`}
              >
                <span className="truncate min-w-0">{routine.name}</span>
                <span className="shrink-0 ml-1 opacity-75">· {formatDuration(routine.duration, t)}</span>
              </div>
            ))}
          </div>
        );
      })()}
    </div>
  );
};

// ── WeekView ──────────────────────────────────────────────────────────────────

const WeekView = () => {
  const { t } = useTranslation();
  const {
    calendarRef, stickyHeaderRef,
    weekViewDates,
    darkMode, borderClass, textSecondary,
    use24HourClock,
    cardBg,
    expandedNotesTaskId, setExpandedNotesTaskId,
    getTasksForDate, getDayDisplayForDate, getContinuationsForDate,
    weekTimelineStartHour,
    weekTimelineEndHour,
  } = useDayPlannerCtx();

  const [showAllHours, setShowAllHours] = useState(false);
  // showAllHours is the escape hatch for both bounds at once: whichever edge you
  // reach for, you get the whole day back.
  const { startHour, endHour, visibleHours } = weekWindow({
    startHour: weekTimelineStartHour,
    endHour: weekTimelineEndHour,
    showAll: showAllHours,
  });

  // What the band is hiding, so the toggle can say so. Counted against the
  // SETTINGS rather than the resolved window: while the day is expanded nothing
  // is hidden, and the counts are suppressed below instead of going stale.
  const clipped = useMemo(
    () => clippedCounts(
      weekViewDates.flatMap((d) => [
        ...(getDayDisplayForDate || getTasksForDate)(d),
        // A continuation hidden above the window is hidden too (#2278).
        ...(getContinuationsForDate ? getContinuationsForDate(d).map(continuationLayoutRow) : []),
      ]),
      { startHour: weekTimelineStartHour, endHour: weekTimelineEndHour },
    ),
    [weekViewDates, getTasksForDate, getDayDisplayForDate, getContinuationsForDate, weekTimelineStartHour, weekTimelineEndHour],
  );

  const baseHourHeight = useWeekViewHourHeight(calendarRef, stickyHeaderRef, visibleHours);
  // Timeline magnification (utils/timelineZoom.js): WEEK fits its range on
  // screen at 100% and only grows, scrolling once it no longer fits.
  const weekRootRef = useRef(null);
  const zoom = useTimelineZoom('week', { scrollRef: calendarRef, originRef: weekRootRef });
  const hourHeight = baseHourHeight * zoom;
  const [popoverTask, setPopoverTask] = useState(null);
  const [popoverAnchor, setPopoverAnchor] = useState(null);

  const todayStr = dateToString(new Date());

  useEffect(() => {
    if (!expandedNotesTaskId) return;
    const chipEl = document.querySelector(`[data-task-id="${expandedNotesTaskId}"]`);
    if (!chipEl) return;
    const task = weekViewDates.flatMap(d => getTasksForDate(d))
      .find(t => String(t.id) === String(expandedNotesTaskId));
    if (!task) return;
    setPopoverTask(task);
    setPopoverAnchor(chipEl.getBoundingClientRect());
    // Fires when a note chip is expanded; reads the current week's dates/tasks at
    // that moment. Re-running on weekViewDates/getTasksForDate identity would
    // reposition the popover on unrelated re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandedNotesTaskId]);

  const handleTaskClick = (task, anchor) => {
    if (popoverTask?.id === task.id) {
      setPopoverTask(null);
      setPopoverAnchor(null);
      setExpandedNotesTaskId(null);
    } else {
      setPopoverTask(task);
      setPopoverAnchor(anchor);
    }
  };

  const handleClosePopover = () => {
    setPopoverTask(null);
    setPopoverAnchor(null);
    setExpandedNotesTaskId(null);
  };

  return (
    <div ref={weekRootRef} className="flex" style={zoom === 1 ? { height: '100%' } : { minHeight: '100%' }}>
      {/* Hour-label gutter */}
      <div
        className={`flex-shrink-0 border-r ${borderClass} flex flex-col relative`}
        style={{ width: WEEK_GUTTER_W }}
      >
        {Array.from({ length: visibleHours }, (_, i) => {
          const hour = startHour + i;
          // A toggle sits at each TRIMMED edge, and either one restores the whole
          // day. The arrow points the way the hidden hours lie: up at the top
          // edge, down at the bottom, and the other way once they are showing.
          // Which end it is also decides where in the row it hangs — see
          // gutterEdge.
          const edge = gutterEdge(hour, {
            startHour: weekTimelineStartHour,
            endHour: weekTimelineEndHour,
          });
          const atTopEdge = edge === 'top';
          const edgeHour = atTopEdge ? weekTimelineStartHour : weekTimelineEndHour;
          const edgeLabel = compactHourLabel(edgeHour, use24HourClock);
          const arrow = atTopEdge ? (showAllHours ? '▼' : '▲') : (showAllHours ? '▲' : '▼');
          // Only while collapsed: expanded, nothing is hidden and a count would
          // be describing a state that is no longer on screen.
          const hiddenHere = showAllHours ? 0 : (atTopEdge ? clipped.above : clipped.below);
          return (
            <div
              key={hour}
              className="relative flex-shrink-0"
              style={{ height: `${hourHeight}px` }}
            >
              {edge && (
                <button
                  data-gutter-foot={atTopEdge ? undefined : ''}
                  onClick={() => setShowAllHours(v => !v)}
                  className={`absolute ${atTopEdge ? 'top-0.5' : 'bottom-0.5'} right-2 text-[10px] leading-none text-blue-500 hover:text-blue-400 transition-colors select-none`}
                  title={hiddenHere ? t('settings.weekTimelineHidden', { count: hiddenHere }) : undefined}
                >
                  {hiddenHere ? `${arrow} ${edgeLabel} · ${hiddenHere}` : `${arrow} ${edgeLabel}`}
                </button>
              )}
              {/* The top toggle stands in for its row's hour label, since the
                  two name the same line. The bottom one sits at the row's FOOT
                  and names the next line down, so that row still shows its own
                  hour at its head like every other. The bottom toggle and the
                  last row's label are marked data-gutter-foot: the summary
                  strip's caret measures them to stay clear (#2118). */}
              {!atTopEdge && hour % 3 === 0 && (
                <span
                  data-gutter-foot={hour === endHour - 1 ? '' : undefined}
                  className={`absolute top-0.5 right-2 text-[10px] leading-none ${textSecondary} select-none`}
                  style={zoom !== 1 ? { zoom } : undefined}
                >
                  {use24HourClock
                    ? `${String(hour).padStart(2, '0')}:00`
                    : hour === 0 ? '12 AM' : hour === 12 ? '12 PM' : hour < 12 ? `${hour} AM` : `${hour - 12} PM`
                  }
                </span>
              )}
            </div>
          );
        })}
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
            zoom={zoom}
            startHour={startHour}
            endHour={endHour}
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
