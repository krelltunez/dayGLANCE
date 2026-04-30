import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { Check, ChevronUp, Inbox, RefreshCw } from 'lucide-react';
import * as LucideIcons from 'lucide-react';
import { renderTitle } from '../utils/textFormatting.jsx';
import { dateToString } from '../utils/taskUtils.js';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../context/FeaturesContext.jsx';
import MobileViewToggle from './MobileViewToggle.jsx';

// px per hour — spine is pixel-accurate for solid/dotted logic and drag-drop
const HOUR_H = 48;
// Uniform height for task/event blocks (duration is text, not space)
const BLOCK_H = 52;
// Routine chip height
const CHIP_H = 22;
// Left edge of the spine line, matching the w-12 time-label column
const SPINE_X = 48;
const ORANGE = '#fe8b00';

const minToY = (min) => (min / 60) * HOUR_H;

const MobileListView = () => {
  const {
    selectedDate, currentTime, use24HourClock,
    tasks, setTasks,
    unscheduledTasks, setUnscheduledTasks,
    expandedRecurringTasks,
    darkMode, cardBg, borderClass, textPrimary, textSecondary,
    formatTime, timeToMinutes, minutesToTime,
    getTasksForDate, getTaskCalendarStyle, toggleComplete,
    pushUndo, playUISound,
  } = useDayPlannerCtx();

  const {
    routinesEnabled, todayRoutines, routineCompletions, toggleRoutineCompletion,
    goalsProjectsEnabled, projects,
  } = useFeaturesCtx();

  const [showPast, setShowPast] = useState(false);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [inboxPinned, setInboxPinned] = useState(false);
  const [activeDrag, setActiveDrag] = useState(null);
  const [dragSnapMin, setDragSnapMin] = useState(null);
  const [dragBlocked, setDragBlocked] = useState(false);
  // ID of the block currently animating its one-time pulse
  const [pulsingBlockId, setPulsingBlockId] = useState(null);

  const spineRef = useRef(null);
  const prevNextEventIdRef = useRef(null);
  const dragStateRef = useRef({ active: false, task: null, startX: 0, startY: 0 });

  const dateStr = dateToString(selectedDate);
  const isToday = dateStr === dateToString(new Date());

  // ── Derived data ──────────────────────────────────────────────────────────

  const dayTasks = useMemo(
    () => getTasksForDate(selectedDate).filter(t => !t.isAllDay && !t.isExample),
    // expandedRecurringTasks in deps ensures recurring instances are included
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

  // All scheduled items sorted by start time
  const allItems = useMemo(() => {
    const taskItems = dayTasks.map(t => ({ ...t, _kind: 'task' }));
    const routineItems = dayRoutines.map(r => ({
      ...r,
      _kind: 'routine',
      // stable key that won't collide with task IDs
      id: `routine-list-${r.id}`,
      _origId: r.id,
      title: r.name,
    }));
    return [...taskItems, ...routineItems].sort(
      (a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime),
    );
  }, [dayTasks, dayRoutines, timeToMinutes]);

  // Past = fully ended before now (today only); running tasks stay in future
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

  // Next non-completed task that hasn't started yet
  const nextEvent = useMemo(
    () => futureItems.find(
      i => i._kind === 'task' && !i.completed && timeToMinutes(i.startTime) > nowMin,
    ),
    [futureItems, nowMin, timeToMinutes],
  );

  // Single pulse when the next event identity changes
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
    return `${h > 0 ? `${h}h ` : ''}${m}m`.trim();
  }, [nextEvent, nowMin, isToday, timeToMinutes]);

  // Spine solid-segment map (every scheduled item occupies its duration)
  const occupiedSegs = useMemo(
    () => allItems.map(item => ({
      id: item.id,
      top: minToY(timeToMinutes(item.startTime)),
      height: Math.max(minToY(item.duration || 30), 4),
    })),
    [allItems, timeToMinutes],
  );

  // Scroll to anchor when the date changes
  useEffect(() => {
    if (!spineRef.current) return;
    const anchorMin = isToday
      ? (futureItems.length > 0
        ? Math.max(0, timeToMinutes(futureItems[0].startTime) - 30)
        : nowMin)
      : (allItems.length > 0 ? timeToMinutes(allItems[0].startTime) : 8 * 60);
    spineRef.current.scrollTop = Math.max(0, minToY(anchorMin) - 80);
    // Only re-run when the day actually changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateStr]);

  // ── Conflict detection & snap ─────────────────────────────────────────────

  const isSlotBlocked = useCallback((startMin, durMin) => {
    const endMin = startMin + durMin;
    // Both tasks AND routines block scheduling (functionally equivalent)
    for (const item of [...dayTasks, ...dayRoutines]) {
      const s = timeToMinutes(item.startTime);
      const e = s + (item.duration || 30);
      if (startMin < e && endMin > s) return true;
    }
    return false;
  }, [dayTasks, dayRoutines, timeToMinutes]);

  // Snap to nearest valid 15-min increment, skipping occupied slots
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
    return null; // no valid slot in the day
  }, [isSlotBlocked]);

  // ── Drag-and-drop from inbox drawer ──────────────────────────────────────
  // Touch events stay on the element where touchstart fired, so move/end
  // handlers on the inbox chip correctly track the finger even when it moves
  // up into the spine area.

  const handleInboxTouchStart = useCallback((e, task) => {
    const t = e.touches[0];
    dragStateRef.current = { active: false, task, startX: t.clientX, startY: t.clientY };
  }, []);

  const computeDragSnap = useCallback((clientY) => {
    const el = spineRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const y = clientY - rect.top + el.scrollTop;
    const rawMin = (y / HOUR_H) * 60;
    const durMin = dragStateRef.current.task?.duration || 30;
    const snapped = getValidSnap(rawMin, durMin);
    setDragSnapMin(snapped);
    setDragBlocked(snapped === null);
  }, [getValidSnap]);

  const handleInboxTouchMove = useCallback((e) => {
    const state = dragStateRef.current;
    if (!state.task) return;
    const t = e.touches[0];
    const dx = t.clientX - state.startX;
    const dy = t.clientY - state.startY;

    if (!state.active && Math.sqrt(dx * dx + dy * dy) > 8) {
      state.active = true;
      setActiveDrag(state.task);
      setInboxPinned(true);
    }
    if (state.active) computeDragSnap(t.clientY);
  }, [computeDragSnap]);

  const handleInboxTouchEnd = useCallback(() => {
    const state = dragStateRef.current;
    if (state.active && dragSnapMin !== null && !dragBlocked) {
      const startTime = minutesToTime(dragSnapMin);
      pushUndo();
      setTasks(prev => [...prev, {
        ...state.task,
        date: dateStr,
        startTime,
        duration: state.task.duration || 30,
        color: state.task.color || 'bg-blue-500',
        isAllDay: false,
      }]);
      setUnscheduledTasks(prev => prev.filter(t => t.id !== state.task.id));
      playUISound('pop');
    }
    dragStateRef.current = { active: false, task: null };
    setActiveDrag(null);
    setInboxPinned(false);
    setDragSnapMin(null);
    setDragBlocked(false);
  }, [dragSnapMin, dragBlocked, minutesToTime, dateStr, pushUndo,
      setTasks, setUnscheduledTasks, playUISound]);

  // ── Helpers ───────────────────────────────────────────────────────────────

  const fmtHour = (h) => {
    if (use24HourClock) return `${String(h).padStart(2, '0')}:00`;
    if (h === 0) return '12a';
    if (h === 12) return '12p';
    return h > 12 ? `${h - 12}p` : `${h}a`;
  };

  const inboxTasks = useMemo(
    () => unscheduledTasks.filter(t => !t.isExample && !t.completed),
    [unscheduledTasks],
  );

  // Items rendered in the spine (past hidden unless expanded)
  const visibleItems = showPast ? allItems : futureItems;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* Header row: view toggle + countdown */}
      <div className={`flex-shrink-0 flex items-center gap-2 px-2 py-1 border-b ${borderClass}`}>
        <div className="w-10 h-8 flex-shrink-0">
          <MobileViewToggle />
        </div>
        {countdownText && nextEvent ? (
          <p className={`flex-1 text-xs font-medium truncate ${darkMode ? 'text-amber-300' : 'text-amber-700'}`}>
            {countdownText} until {nextEvent.title}
          </p>
        ) : (
          <div className="flex-1" />
        )}
      </div>

      {/* Expand-past row */}
      {isToday && pastItems.length > 0 && !showPast && (
        <button
          onClick={() => setShowPast(true)}
          className={`flex-shrink-0 flex items-center gap-1.5 px-4 py-2 text-xs font-medium ${textSecondary} ${darkMode ? 'hover:bg-white/5' : 'hover:bg-black/5'} border-b ${borderClass} transition-colors`}
        >
          <ChevronUp size={13} />
          {pastItems.length} earlier item{pastItems.length !== 1 ? 's' : ''}
        </button>
      )}

      {/* Spine scroll area */}
      <div
        ref={spineRef}
        className={`flex-1 min-h-0 overflow-y-auto overflow-x-hidden relative ${darkMode ? 'dark-scrollbar' : ''}`}
        style={{ touchAction: 'pan-y' }}
      >
        {/* Full-day canvas — pixel-accurate for solid/dotted spine + drag */}
        <div className="relative" style={{ height: `${24 * HOUR_H}px` }}>

          {/* Hour labels + tick marks */}
          {Array.from({ length: 24 }, (_, h) => (
            <div
              key={h}
              className="absolute left-0 right-0 pointer-events-none"
              style={{ top: `${minToY(h * 60)}px` }}
            >
              <span
                className={`absolute text-[9px] leading-none ${textSecondary} opacity-60`}
                style={{ right: `calc(100% - ${SPINE_X - 5}px)`, top: '-5px', whiteSpace: 'nowrap', textAlign: 'right' }}
              >
                {fmtHour(h)}
              </span>
              {/* Small tick on spine for each hour */}
              <div
                className="absolute"
                style={{ left: `${SPINE_X - 4}px`, top: 0, width: '8px', height: '1px', backgroundColor: ORANGE, opacity: 0.25 }}
              />
            </div>
          ))}

          {/* Spine: dotted background = free time */}
          <div
            className="absolute top-0 bottom-0 pointer-events-none"
            style={{
              left: `${SPINE_X}px`,
              width: '2px',
              background: `repeating-linear-gradient(to bottom, ${ORANGE}55 0px, ${ORANGE}55 4px, transparent 4px, transparent 10px)`,
            }}
          />

          {/* Spine: solid overlays = occupied time */}
          {occupiedSegs.map(seg => (
            <div
              key={`seg-${seg.id}`}
              className="absolute pointer-events-none"
              style={{
                left: `${SPINE_X}px`,
                top: `${seg.top}px`,
                width: '2px',
                height: `${seg.height}px`,
                backgroundColor: ORANGE,
              }}
            />
          ))}

          {/* Task / event blocks — right of spine, uniform height */}
          {visibleItems.filter(i => i._kind === 'task').map(item => {
            const top = minToY(timeToMinutes(item.startTime));
            const endMin = timeToMinutes(item.startTime) + (item.duration || 30);
            const isPast = isToday && endMin <= nowMin;
            const isRecurring = typeof item.id === 'string' && item.id.startsWith('recurring-');
            const isImportedCal = item.imported && !item.isTaskCalendar;
            const calStyle = isImportedCal ? getTaskCalendarStyle(item, darkMode) : undefined;
            const isNext = nextEvent?.id === item.id;
            const isPulsing = pulsingBlockId === item.id;
            const proj = goalsProjectsEnabled && item.projectId
              ? projects.find(p => p.id === item.projectId) : null;
            const ProjIcon = proj?.hyperglance?.icon
              ? LucideIcons[proj.hyperglance.icon] : null;
            const durMin = item.duration || 30;
            const durLabel = durMin >= 60
              ? `${Math.floor(durMin / 60)}h${durMin % 60 > 0 ? `${durMin % 60}m` : ''}`
              : `${durMin}m`;
            const totalSubs = item.subtasks?.length ?? 0;
            const doneSubs = item.subtasks?.filter(s => s.completed).length ?? 0;

            return (
              <div
                key={item.id}
                className="absolute"
                style={{ top: `${top}px`, left: `${SPINE_X + 8}px`, right: '8px', height: `${BLOCK_H}px` }}
              >
                {/* Horizontal connector: spine → block */}
                <div
                  className="absolute pointer-events-none"
                  style={{ left: '-8px', top: `${BLOCK_H / 2 - 1}px`, width: '8px', height: '2px', backgroundColor: ORANGE, opacity: 0.45 }}
                />
                <div
                  className={[
                    'h-full rounded-lg shadow-sm flex flex-col justify-between px-2 py-1.5 overflow-hidden select-none',
                    isImportedCal ? '' : (item.color || 'bg-blue-500'),
                    isPast ? 'opacity-50' : '',
                    isNext ? (darkMode ? 'ring-2 ring-amber-400' : 'ring-2 ring-amber-500') : '',
                    isPulsing ? 'list-block-pulse' : '',
                  ].filter(Boolean).join(' ')}
                  style={calStyle}
                  onAnimationEnd={() => { if (isPulsing) setPulsingBlockId(null); }}
                >
                  {/* Title row */}
                  <div className="flex items-center gap-1 min-w-0">
                    {!isImportedCal && (
                      <button
                        onClick={() => toggleComplete(item.id)}
                        className={`rounded flex-shrink-0 ${item.completed ? 'bg-white/40' : 'bg-white/20'} border-2 border-white w-3.5 h-3.5 flex items-center justify-center`}
                      >
                        {item.completed && <Check size={8} strokeWidth={3} />}
                      </button>
                    )}
                    {isRecurring && <RefreshCw size={9} className="flex-shrink-0 text-white/70" />}
                    {ProjIcon && <ProjIcon size={10} className="flex-shrink-0 text-white/80" />}
                    <span className={`text-sm font-medium text-white truncate flex-1 min-w-0 ${item.completed ? 'line-through' : ''}`}>
                      {renderTitle(item.title)}
                    </span>
                    {totalSubs > 0 && (
                      <span className="flex-shrink-0 text-[10px] text-white/65 ml-0.5">
                        {doneSubs}/{totalSubs}
                      </span>
                    )}
                  </div>
                  {/* Meta row */}
                  <div className="text-[10px] text-white/60 leading-none">
                    {formatTime(item.startTime)}–{formatTime(minutesToTime(endMin))} · {durLabel}
                  </div>
                </div>
              </div>
            );
          })}

          {/* Routine chips — perpendicular to spine, left side */}
          {visibleItems.filter(i => i._kind === 'routine').map(item => {
            const centerY = minToY(timeToMinutes(item.startTime));
            const isCompleted = routineCompletions[item._origId];
            return (
              <div
                key={item.id}
                className="absolute flex items-center justify-end pointer-events-auto"
                style={{
                  top: `${centerY - CHIP_H / 2}px`,
                  left: 0,
                  // right edge touches the spine
                  right: `calc(100% - ${SPINE_X}px)`,
                  height: `${CHIP_H}px`,
                }}
              >
                <button
                  onClick={() => toggleRoutineCompletion(item._origId)}
                  className={`rounded-full px-2 py-0.5 text-[10px] font-medium leading-none truncate ${darkMode ? 'bg-teal-700 text-teal-100' : 'bg-teal-600 text-white'} ${isCompleted ? 'opacity-50 line-through' : ''}`}
                  style={{ maxWidth: `${SPINE_X - 4}px` }}
                >
                  {item.name}
                </button>
              </div>
            );
          })}

          {/* Drag preview block */}
          {activeDrag && dragSnapMin !== null && (
            <div
              className="absolute pointer-events-none z-20"
              style={{ top: `${minToY(dragSnapMin)}px`, left: `${SPINE_X + 8}px`, right: '8px', height: `${BLOCK_H}px` }}
            >
              <div
                className={`h-full rounded-lg border-2 flex items-center px-2 ${
                  dragBlocked
                    ? 'border-red-500 bg-red-500/20'
                    : 'border-orange-400 bg-orange-400/15'
                }`}
              >
                <span className={`text-xs font-semibold ${
                  dragBlocked
                    ? (darkMode ? 'text-red-400' : 'text-red-600')
                    : (darkMode ? 'text-orange-300' : 'text-orange-700')
                }`}>
                  {dragBlocked ? 'Blocked' : formatTime(minutesToTime(dragSnapMin))}
                </span>
              </div>
            </div>
          )}

          {/* Current-time line */}
          {isToday && (
            <div
              className="absolute pointer-events-none z-10"
              style={{ top: `${minToY(nowMin)}px`, left: `${SPINE_X - 5}px`, right: 0 }}
            >
              <div className="flex items-center">
                <div className="w-2.5 h-2.5 rounded-full bg-red-500 flex-shrink-0" />
                <div className="flex-1 h-0.5 bg-red-500 opacity-50" />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Inbox drawer */}
      <div className={`flex-shrink-0 border-t ${borderClass} ${cardBg}`}>
        <button
          disabled={inboxPinned}
          onClick={() => setInboxOpen(v => !v)}
          className={`w-full flex items-center justify-between px-4 py-2.5 ${textPrimary} active:bg-black/5 dark:active:bg-white/5 transition-colors`}
        >
          <div className="flex items-center gap-2">
            <Inbox size={14} className={textSecondary} />
            <span className="text-sm font-medium">Inbox</span>
            {inboxTasks.length > 0 && (
              <span className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ${darkMode ? 'bg-blue-900 text-blue-300' : 'bg-blue-100 text-blue-700'}`}>
                {inboxTasks.length}
              </span>
            )}
          </div>
          <ChevronUp
            size={15}
            className={`${textSecondary} transition-transform duration-200 ${inboxOpen || inboxPinned ? '' : 'rotate-180'}`}
          />
        </button>

        {(inboxOpen || inboxPinned) && (
          <div style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom, 0px))' }} className="px-4">
            {inboxTasks.length === 0 ? (
              <p className={`text-xs ${textSecondary} text-center py-2`}>Inbox empty</p>
            ) : (
              <div
                className="flex gap-2 overflow-x-auto pb-1"
                style={{ scrollSnapType: 'x mandatory' }}
              >
                {inboxTasks.map(task => (
                  <div
                    key={task.id}
                    className={`flex-shrink-0 rounded-lg px-3 py-2 min-w-[120px] max-w-[180px] select-none ${task.color || 'bg-blue-500'}`}
                    style={{
                      scrollSnapAlign: 'start',
                      touchAction: 'none',
                      opacity: activeDrag?.id === task.id ? 0.35 : 1,
                      transition: 'opacity 0.15s',
                    }}
                    onTouchStart={(e) => handleInboxTouchStart(e, task)}
                    onTouchMove={handleInboxTouchMove}
                    onTouchEnd={handleInboxTouchEnd}
                  >
                    <div className="text-white text-sm font-medium truncate leading-tight">
                      {task.title}
                    </div>
                    <div className="text-white/60 text-[10px] mt-0.5">
                      {task.duration || 30}m
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default MobileListView;
