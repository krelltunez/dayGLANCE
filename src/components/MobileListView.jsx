import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  Check, ChevronUp, Edit2, ExternalLink, FileText, Inbox,
  RefreshCw, SkipForward,
} from 'lucide-react';
import * as LucideIcons from 'lucide-react';
import { renderTitle, isLinkOnlyTask, getLinkUrl, hasNotesOrSubtasks } from '../utils/textFormatting.jsx';
import { dateToString } from '../utils/taskUtils.js';
import { taskColorToHex } from '../utils/colorUtils.js';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../context/FeaturesContext.jsx';

const ORANGE = '#fe8b00';
// Gap-segment heights (px) — short <1h, medium 1–3h, long >3h
const GAP_H = { short: 20, medium: 40, long: 60 };

// Time-label column width — matches GRID view's w-12
const TIME_COL = 48;

function gapHeight(gapMin) {
  if (gapMin < 60) return GAP_H.short;
  if (gapMin <= 180) return GAP_H.medium;
  return GAP_H.long;
}

function fmtDur(min) {
  if (min >= 60) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  return `${min}m`;
}

// ── Spine line variants ──────────────────────────────────────────────────────
// Rendered inside the left time-column so borders appear as a continuous line.

const SolidSpineLine = ({ color }) => (
  <div
    className="absolute top-0 bottom-0 pointer-events-none"
    style={{ left: TIME_COL - 1, width: 2, backgroundColor: color }}
  />
);

const DashedSpineLine = ({ color }) => (
  <div
    className="absolute top-0 bottom-0 pointer-events-none"
    style={{
      left: TIME_COL - 1,
      width: 2,
      background: `repeating-linear-gradient(to bottom,${color}55 0px,${color}55 4px,transparent 4px,transparent 10px)`,
    }}
  />
);

// ── TaskBlock ────────────────────────────────────────────────────────────────

const TaskBlock = React.memo(({
  item, isPulsing, isNext, isPast,
  darkMode, textPrimary,
  formatTime, minutesToTime, timeToMinutes,
  toggleComplete, setExpandedNotesTaskId,
  postponeTask, moveToInbox, openMobileEditTask,
  getTaskCalendarStyle, goalsProjectsEnabled, projects,
  setPulsingBlockId, dateStr,
}) => {
  const isImportedCal = item.imported && !item.isTaskCalendar;
  const calStyle = isImportedCal ? getTaskCalendarStyle(item, darkMode) : undefined;
  const isRecurring = typeof item.id === 'string' && item.id.startsWith('recurring-');

  const hex = isImportedCal
    ? (calStyle?.backgroundColor || '#6b7280')
    : (taskColorToHex(item.color) || '#3b82f6');

  const cardStyle = {
    border: `1px solid ${hex}44`,
    borderLeft: `3px solid ${hex}`,
    background: `${hex}12`,
    borderRadius: 6,
  };

  const proj = goalsProjectsEnabled && item.projectId
    ? projects.find(p => p.id === item.projectId) : null;
  const ProjIcon = proj?.hyperglance?.icon ? LucideIcons[proj.hyperglance.icon] : null;

  const startMin = timeToMinutes(item.startTime);
  const durMin = item.duration || 30;
  const endMin = startMin + durMin;

  const NoteIcon = isLinkOnlyTask(item) ? ExternalLink : FileText;

  return (
    <div
      className={[
        'overflow-hidden select-none',
        isPast ? 'opacity-50' : '',
        isPulsing ? 'list-block-pulse' : '',
      ].filter(Boolean).join(' ')}
      style={cardStyle}
      onAnimationEnd={() => { if (isPulsing) setPulsingBlockId(null); }}
    >
      {/* Title row */}
      <div className="flex items-start gap-2 px-2 pt-1.5">
        {/* Completion dot */}
        {!isImportedCal && (
          <button
            onClick={(e) => { e.stopPropagation(); toggleComplete(item.id); }}
            className={`mt-0.5 w-4 h-4 flex-shrink-0 rounded-full border-2 flex items-center justify-center transition-colors`}
            style={{
              borderColor: hex,
              background: item.completed ? hex : 'transparent',
            }}
          >
            {item.completed && <Check size={8} strokeWidth={3} className="text-white" />}
          </button>
        )}

        {/* Title */}
        <div className="flex-1 min-w-0">
          <div className={`flex items-center gap-1 min-w-0`}>
            {isRecurring && <RefreshCw size={9} className="flex-shrink-0" style={{ color: hex, opacity: 0.7 }} />}
            {ProjIcon && <ProjIcon size={10} className="flex-shrink-0" style={{ color: hex, opacity: 0.8 }} />}
            <span
              className={`text-sm font-medium truncate ${textPrimary} ${item.completed ? 'line-through opacity-50' : ''}`}
            >
              {renderTitle(item.title)}
            </span>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-0.5 flex-shrink-0 ml-1">
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (isLinkOnlyTask(item)) {
                window.open(getLinkUrl(item), '_blank', 'noopener,noreferrer');
              } else {
                setExpandedNotesTaskId(prev => prev === item.id ? null : item.id);
              }
            }}
            className={`p-1 rounded transition-colors ${darkMode ? 'hover:bg-white/10 active:bg-white/20' : 'hover:bg-black/10 active:bg-black/15'} ${hasNotesOrSubtasks(item) || isLinkOnlyTask(item) ? 'opacity-80' : 'opacity-30'}`}
            title="Notes / links"
          >
            <NoteIcon size={13} style={{ color: hex }} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); postponeTask(item.id, dateStr); }}
            className={`p-1 rounded transition-colors ${darkMode ? 'hover:bg-white/10 active:bg-white/20' : 'hover:bg-black/10 active:bg-black/15'} opacity-70`}
            title="Postpone"
          >
            <SkipForward size={13} style={{ color: hex }} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); moveToInbox(item.id, dateStr); }}
            className={`p-1 rounded transition-colors ${darkMode ? 'hover:bg-white/10 active:bg-white/20' : 'hover:bg-black/10 active:bg-black/15'} opacity-70`}
            title="Move to inbox"
          >
            <Inbox size={13} style={{ color: hex }} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); openMobileEditTask(item, false); }}
            className={`p-1 rounded transition-colors ${darkMode ? 'hover:bg-white/10 active:bg-white/20' : 'hover:bg-black/10 active:bg-black/15'} opacity-70`}
            title="Edit"
          >
            <Edit2 size={13} style={{ color: hex }} />
          </button>
        </div>
      </div>

      {/* Meta row — indented to align with title text */}
      <div className="flex items-center pb-1.5 px-2 mt-0.5">
        <div className="w-4 flex-shrink-0 mr-2" />{/* spacer = completion dot width + gap */}
        <span className={`text-[11px] ${darkMode ? 'text-gray-400' : 'text-stone-500'}`}>
          {formatTime(item.startTime)}–{formatTime(minutesToTime(endMin))} · {fmtDur(durMin)}
          {isNext && (
            <span className={`ml-2 font-semibold ${darkMode ? 'text-amber-400' : 'text-amber-600'}`}>
              next
            </span>
          )}
        </span>
      </div>
    </div>
  );
});
TaskBlock.displayName = 'TaskBlock';

// ── MobileListView ───────────────────────────────────────────────────────────

const MobileListView = () => {
  const {
    selectedDate, currentTime, use24HourClock,
    tasks, setTasks,
    unscheduledTasks, setUnscheduledTasks,
    expandedRecurringTasks,
    darkMode, cardBg, borderClass, textPrimary, textSecondary,
    formatTime, timeToMinutes, minutesToTime,
    getTasksForDate, getTaskCalendarStyle,
    toggleComplete, postponeTask, moveToInbox, openMobileEditTask,
    setExpandedNotesTaskId,
    pushUndo, playUISound,
    goalsProjectsEnabled, projects,
  } = useDayPlannerCtx();

  const {
    routinesEnabled, todayRoutines, routineCompletions, toggleRoutineCompletion,
  } = useFeaturesCtx();

  const [showPast, setShowPast] = useState(false);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [activeDrag, setActiveDrag] = useState(null);
  const [dragSnapMin, setDragSnapMin] = useState(null);
  const [dragBlocked, setDragBlocked] = useState(false);
  const [pulsingBlockId, setPulsingBlockId] = useState(null);

  const spineRef = useRef(null);
  const prevNextEventIdRef = useRef(null);
  const dragStateRef = useRef({ active: false, task: null, startX: 0, startY: 0 });

  const dateStr = dateToString(selectedDate);
  const isToday = dateStr === dateToString(new Date());

  // ── Derived data ──────────────────────────────────────────────────────────

  const dayTasks = useMemo(
    () => getTasksForDate(selectedDate).filter(t => !t.isAllDay && !t.isExample),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedDate, tasks, expandedRecurringTasks],
  );

  const dayRoutines = useMemo(
    () => routinesEnabled && isToday
      ? todayRoutines.filter(r => !r.isAllDay && r.startTime && !String(r.id).startsWith('example-'))
      : [],
    [routinesEnabled, isToday, todayRoutines],
  );

  const nowMin = useMemo(
    () => currentTime.getHours() * 60 + currentTime.getMinutes(),
    [currentTime],
  );

  const allItems = useMemo(() => {
    const taskItems = dayTasks.map(t => ({ ...t, _kind: 'task' }));
    const routineItems = dayRoutines.map(r => ({
      ...r,
      _kind: 'routine',
      id: `routine-list-${r.id}`,
      _origId: r.id,
      title: r.name,
    }));
    return [...taskItems, ...routineItems].sort(
      (a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime),
    );
  }, [dayTasks, dayRoutines, timeToMinutes]);

  const pastItems = useMemo(
    () => isToday
      ? allItems.filter(i => timeToMinutes(i.startTime) + (i.duration || 30) <= nowMin)
      : [],
    [allItems, nowMin, isToday, timeToMinutes],
  );

  const futureItems = useMemo(
    () => isToday
      ? allItems.filter(i => timeToMinutes(i.startTime) + (i.duration || 30) > nowMin)
      : allItems,
    [allItems, nowMin, isToday, timeToMinutes],
  );

  const visibleItems = showPast ? allItems : futureItems;

  const nextEvent = useMemo(
    () => futureItems.find(
      i => i._kind === 'task' && !i.completed && timeToMinutes(i.startTime) > nowMin,
    ),
    [futureItems, nowMin, timeToMinutes],
  );

  // Single pulse on next-event identity change
  useEffect(() => {
    const id = nextEvent?.id ?? null;
    if (id && id !== prevNextEventIdRef.current) setPulsingBlockId(id);
    prevNextEventIdRef.current = id;
  }, [nextEvent?.id]);

  const countdownText = useMemo(() => {
    if (!nextEvent || !isToday) return null;
    const diff = timeToMinutes(nextEvent.startTime) - nowMin;
    if (diff <= 0) return null;
    const h = Math.floor(diff / 60);
    const m = diff % 60;
    const t = h > 0 ? `${h}h ${m}m` : `${m}m`;
    return `${t} until ${nextEvent.title}`;
  }, [nextEvent, nowMin, isToday, timeToMinutes]);

  // ── Segment list (content-driven, no pixel canvas) ─────────────────────────

  const segments = useMemo(() => {
    const segs = [];
    if (visibleItems.length === 0) return segs;

    let prevEndMin = timeToMinutes(visibleItems[0].startTime);

    visibleItems.forEach((item, i) => {
      const startMin = timeToMinutes(item.startTime);
      const durMin = item.duration || 30;
      const endMin = startMin + durMin;

      // Gap before this item
      const gapMin = startMin - prevEndMin;
      if (gapMin > 0) {
        segs.push({ type: 'gap', id: `gap-${i}`, gapMin, gapStart: prevEndMin, gapEnd: startMin });
      }

      segs.push({ type: item._kind, item, startMin, endMin });
      prevEndMin = Math.max(prevEndMin, endMin);
    });

    // Trailing padding gap so the last block isn't at the very bottom
    segs.push({ type: 'gap', id: 'gap-tail', gapMin: 30, gapStart: prevEndMin, gapEnd: prevEndMin + 30 });

    return segs;
  }, [visibleItems, timeToMinutes]);

  // ── Conflict detection & snap ─────────────────────────────────────────────

  const isSlotBlocked = useCallback((startMin, durMin) => {
    const endMin = startMin + durMin;
    for (const item of [...dayTasks, ...dayRoutines]) {
      const s = timeToMinutes(item.startTime);
      const e = s + (item.duration || 30);
      if (startMin < e && endMin > s) return true;
    }
    return false;
  }, [dayTasks, dayRoutines, timeToMinutes]);

  const getValidSnap = useCallback((rawMin, durMin) => {
    const base = Math.round(rawMin / 15) * 15;
    for (let d = 0; d <= 24 * 60; d += 15) {
      const fwd = base + d;
      if (fwd < 24 * 60 && !isSlotBlocked(fwd, durMin)) return fwd;
      if (d > 0) {
        const bck = base - d;
        if (bck >= 0 && !isSlotBlocked(bck, durMin)) return bck;
      }
    }
    return null;
  }, [isSlotBlocked]);

  // ── Drag from inbox panel ─────────────────────────────────────────────────
  // Touch events stay on the originating element. We use elementFromPoint to
  // find which gap segment the finger is over.

  const handleInboxTouchStart = useCallback((e, task) => {
    const t = e.touches[0];
    dragStateRef.current = { active: false, task, startX: t.clientX, startY: t.clientY };
  }, []);

  const findGapAtPoint = useCallback((clientX, clientY) => {
    // Temporarily hide the pointer-events on the drag ghost so elementFromPoint
    // sees the segment divs underneath.
    const el = document.elementFromPoint(clientX, clientY);
    if (!el) return null;
    const seg = el.closest('[data-gap-start]');
    if (!seg) return null;
    return {
      gapStart: parseInt(seg.dataset.gapStart, 10),
      gapEnd: parseInt(seg.dataset.gapEnd, 10),
    };
  }, []);

  const handleInboxTouchMove = useCallback((e) => {
    const state = dragStateRef.current;
    if (!state.task) return;
    const t = e.touches[0];
    const dx = t.clientX - state.startX;
    const dy = t.clientY - state.startY;

    if (!state.active && Math.sqrt(dx * dx + dy * dy) > 8) {
      state.active = true;
      setActiveDrag(state.task);
    }
    if (!state.active) return;

    e.preventDefault(); // prevent page scroll while dragging

    const gap = findGapAtPoint(t.clientX, t.clientY);
    if (gap) {
      const midMin = Math.round((gap.gapStart + gap.gapEnd) / 2 / 15) * 15;
      const durMin = state.task.duration || 30;
      const snapped = getValidSnap(midMin, durMin);
      setDragSnapMin(snapped);
      setDragBlocked(snapped === null);
    } else {
      setDragSnapMin(null);
      setDragBlocked(false);
    }
  }, [findGapAtPoint, getValidSnap]);

  const handleInboxTouchEnd = useCallback(() => {
    const state = dragStateRef.current;
    if (state.active && dragSnapMin !== null && !dragBlocked) {
      pushUndo();
      setTasks(prev => [...prev, {
        ...state.task,
        date: dateStr,
        startTime: minutesToTime(dragSnapMin),
        duration: state.task.duration || 30,
        color: state.task.color || 'bg-blue-500',
        isAllDay: false,
      }]);
      setUnscheduledTasks(prev => prev.filter(t => t.id !== state.task.id));
      playUISound('pop');
    }
    dragStateRef.current = { active: false, task: null };
    setActiveDrag(null);
    setDragSnapMin(null);
    setDragBlocked(false);
  }, [dragSnapMin, dragBlocked, minutesToTime, dateStr, pushUndo,
      setTasks, setUnscheduledTasks, playUISound]);

  // ── Helpers ───────────────────────────────────────────────────────────────

  const fmtHour = useCallback((min) => {
    const h = Math.floor(min / 60);
    if (use24HourClock) return `${String(h).padStart(2, '0')}:00`;
    if (h === 0) return '12a';
    if (h === 12) return '12p';
    return h > 12 ? `${h - 12}p` : `${h}a`;
  }, [use24HourClock]);

  const inboxTasks = useMemo(
    () => unscheduledTasks.filter(t => !t.isExample && !t.completed),
    [unscheduledTasks],
  );

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden relative">

      {/* ── Expand-past row ─────────────────────────────────────────────── */}
      {isToday && pastItems.length > 0 && !showPast && (
        <button
          onClick={() => setShowPast(true)}
          className={`flex-shrink-0 flex items-center gap-1.5 px-4 py-2 text-xs font-medium ${textSecondary} ${darkMode ? 'hover:bg-white/5' : 'hover:bg-black/5'} border-b ${borderClass} transition-colors`}
        >
          <ChevronUp size={13} />
          {pastItems.length} earlier item{pastItems.length !== 1 ? 's' : ''}
        </button>
      )}

      {/* ── Countdown ───────────────────────────────────────────────────── */}
      {countdownText && (
        <div
          className={`flex-shrink-0 px-4 py-1.5 text-xs font-medium border-b ${borderClass} ${darkMode ? 'text-amber-300 bg-amber-900/20' : 'text-amber-700 bg-amber-50'}`}
        >
          {countdownText}
        </div>
      )}

      {/* ── Main area: spine + optional inbox panel ──────────────────────── */}
      <div className="flex flex-row flex-1 min-h-0">

        {/* ── Spine scroll area ─────────────────────────────────────────── */}
        <div
          ref={spineRef}
          className={`flex-1 min-w-0 min-h-0 overflow-y-auto overflow-x-hidden ${darkMode ? 'dark-scrollbar' : ''}`}
          style={{ touchAction: activeDrag ? 'none' : 'pan-y' }}
        >
          {visibleItems.length === 0 ? (
            <div className={`flex flex-col items-center justify-center py-16 text-center ${textSecondary}`}>
              <p className="text-sm font-medium">No events scheduled</p>
              <p className="text-xs mt-1 opacity-70">
                {isToday ? 'Use + to add a task' : 'Nothing planned for this day'}
              </p>
            </div>
          ) : (
            <div className="flex flex-col">
              {segments.map((seg) => {
                // ── Gap segment ──────────────────────────────────────────
                if (seg.type === 'gap') {
                  const h = gapHeight(seg.gapMin);
                  const showLabel = seg.gapMin >= 60 && seg.id !== 'gap-tail';
                  // Highlight gap when a drag is targeting it
                  const isTarget = activeDrag && dragSnapMin !== null &&
                    dragSnapMin >= seg.gapStart && dragSnapMin < seg.gapEnd;

                  return (
                    <div
                      key={seg.id}
                      className="flex flex-row"
                      style={{ height: h }}
                      data-gap-start={seg.gapStart}
                      data-gap-end={seg.gapEnd}
                    >
                      {/* Time column — dashed spine */}
                      <div
                        className="flex-shrink-0 relative flex items-center justify-end pr-2"
                        style={{ width: TIME_COL }}
                      >
                        <DashedSpineLine color={ORANGE} />
                        {showLabel && (
                          <span
                            className="text-[9px] leading-none relative z-10"
                            style={{ color: ORANGE, opacity: 0.5 }}
                          >
                            {fmtHour(seg.gapStart)}
                          </span>
                        )}
                      </div>
                      {/* Free-time hint */}
                      <div className="flex-1 flex items-center pl-2">
                        {showLabel && (
                          <span className={`text-[10px] ${darkMode ? 'text-gray-600' : 'text-stone-300'}`}>
                            {fmtDur(seg.gapMin)} free
                          </span>
                        )}
                        {isTarget && (
                          <div
                            className={`ml-2 px-2 py-0.5 rounded text-[10px] font-semibold ${
                              dragBlocked
                                ? (darkMode ? 'bg-red-900/60 text-red-400' : 'bg-red-100 text-red-600')
                                : (darkMode ? 'bg-orange-900/60 text-orange-300' : 'bg-orange-100 text-orange-700')
                            }`}
                          >
                            {dragBlocked ? 'Blocked' : formatTime(minutesToTime(dragSnapMin))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                }

                // ── Routine segment ──────────────────────────────────────
                if (seg.type === 'routine') {
                  const { item } = seg;
                  const isCompleted = routineCompletions[item._origId];
                  return (
                    <div key={item.id} className="flex flex-row items-center" style={{ minHeight: 28 }}>
                      {/* Time column — solid spine, chip on left */}
                      <div
                        className="flex-shrink-0 relative flex items-center justify-end pr-1.5"
                        style={{ width: TIME_COL }}
                      >
                        <SolidSpineLine color={ORANGE} />
                        <button
                          onClick={() => toggleRoutineCompletion(item._origId)}
                          className={`relative z-10 rounded-full px-1.5 py-0.5 text-[9px] font-medium leading-none truncate transition-colors ${
                            darkMode
                              ? (isCompleted ? 'bg-teal-800 text-teal-300' : 'bg-teal-700 text-teal-100')
                              : (isCompleted ? 'bg-teal-100 text-teal-600' : 'bg-teal-600 text-white')
                          } ${isCompleted ? 'opacity-50 line-through' : ''}`}
                          style={{ maxWidth: TIME_COL - 6 }}
                        >
                          {item.name}
                        </button>
                      </div>
                      {/* Right: time label */}
                      <div className="flex-1 pl-3 py-1">
                        <span className={`text-[10px] ${darkMode ? 'text-gray-500' : 'text-stone-400'}`}>
                          {formatTime(item.startTime)}
                        </span>
                      </div>
                    </div>
                  );
                }

                // ── Task segment ─────────────────────────────────────────
                if (seg.type === 'task') {
                  const { item, startMin } = seg;
                  const isPast = isToday && seg.endMin <= nowMin;
                  const isNext = nextEvent?.id === item.id;
                  const isPulsing = pulsingBlockId === item.id;

                  return (
                    <div key={item.id} className="flex flex-row" style={{ minHeight: 52 }}>
                      {/* Time column — solid spine, start-time label */}
                      <div
                        className="flex-shrink-0 relative flex items-start justify-end pt-1.5 pr-2"
                        style={{ width: TIME_COL }}
                      >
                        <SolidSpineLine color={ORANGE} />
                        <span
                          className="text-[9px] leading-none relative z-10"
                          style={{ color: ORANGE, opacity: 0.75 }}
                        >
                          {fmtHour(startMin)}
                        </span>
                      </div>
                      {/* Block */}
                      <div className="flex-1 min-w-0 py-1 pr-2">
                        <TaskBlock
                          item={item}
                          isPulsing={isPulsing}
                          isNext={isNext}
                          isPast={isPast}
                          darkMode={darkMode}
                          textPrimary={textPrimary}
                          formatTime={formatTime}
                          minutesToTime={minutesToTime}
                          timeToMinutes={timeToMinutes}
                          toggleComplete={toggleComplete}
                          setExpandedNotesTaskId={setExpandedNotesTaskId}
                          postponeTask={postponeTask}
                          moveToInbox={moveToInbox}
                          openMobileEditTask={openMobileEditTask}
                          getTaskCalendarStyle={getTaskCalendarStyle}
                          goalsProjectsEnabled={goalsProjectsEnabled}
                          projects={projects}
                          setPulsingBlockId={setPulsingBlockId}
                          dateStr={dateStr}
                        />
                      </div>
                    </div>
                  );
                }

                return null;
              })}
            </div>
          )}
        </div>

        {/* ── Inbox panel (open state: pushes spine left) ──────────────── */}
        {inboxOpen && (
          <div
            className={`flex-shrink-0 flex flex-col border-l ${borderClass} ${darkMode ? 'bg-gray-800' : 'bg-stone-50'}`}
            style={{ width: 120 }}
          >
            {/* Panel header */}
            <div className={`flex items-center justify-between px-2 py-1.5 border-b ${borderClass}`}>
              <span className={`text-[10px] font-semibold uppercase tracking-wide ${textSecondary}`}>
                Inbox
              </span>
              <button
                onClick={() => setInboxOpen(false)}
                className={`p-0.5 rounded ${darkMode ? 'hover:bg-white/10' : 'hover:bg-black/10'} transition-colors`}
              >
                <span className={`text-xs leading-none ${textSecondary}`}>✕</span>
              </button>
            </div>

            {/* Task list */}
            <div className="flex-1 overflow-y-auto py-1 px-1.5 space-y-1.5">
              {inboxTasks.length === 0 ? (
                <p className={`text-[10px] ${textSecondary} text-center pt-4`}>Empty</p>
              ) : (
                inboxTasks.map(task => {
                  const hex = taskColorToHex(task.color) || '#3b82f6';
                  const isDragging = activeDrag?.id === task.id;
                  return (
                    <div
                      key={task.id}
                      className="rounded px-2 py-1.5 select-none"
                      style={{
                        border: `1px solid ${hex}44`,
                        borderLeft: `3px solid ${hex}`,
                        background: `${hex}15`,
                        touchAction: 'none',
                        opacity: isDragging ? 0.35 : 1,
                        transition: 'opacity 0.12s',
                      }}
                      onTouchStart={(e) => handleInboxTouchStart(e, task)}
                      onTouchMove={handleInboxTouchMove}
                      onTouchEnd={handleInboxTouchEnd}
                    >
                      <div
                        className={`text-[11px] font-medium leading-tight ${textPrimary} truncate`}
                      >
                        {task.title}
                      </div>
                      <div className={`text-[9px] mt-0.5 ${textSecondary}`}>
                        {task.duration || 30}m
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Inbox collapsed handle (right edge, only when closed) ────────── */}
      {!inboxOpen && (
        <button
          onClick={() => setInboxOpen(true)}
          className={`absolute right-0 z-20 flex flex-col items-center justify-center gap-1 rounded-l-lg shadow-md transition-colors ${
            darkMode
              ? 'bg-gray-700 hover:bg-gray-600 active:bg-gray-600'
              : 'bg-stone-100 hover:bg-stone-200 active:bg-stone-200'
          }`}
          style={{
            top: '50%',
            transform: 'translateY(-50%)',
            width: 22,
            height: 64,
          }}
          title="Open inbox"
        >
          <Inbox size={11} className={textSecondary} />
          {inboxTasks.length > 0 && (
            <span
              className={`text-[9px] font-bold leading-none ${darkMode ? 'text-blue-400' : 'text-blue-600'}`}
            >
              {inboxTasks.length > 9 ? '9+' : inboxTasks.length}
            </span>
          )}
        </button>
      )}
    </div>
  );
};

export default MobileListView;
