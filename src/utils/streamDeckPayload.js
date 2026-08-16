// The Stream Deck state snapshot, extracted pure from useElectronBridge.js
// (trayFetchGate.js style): everything the ws:push-state payload contains is
// computed here from plain inputs, unit-tested and mutation-verified, so a
// dropped or renamed field fails a test instead of silently breaking real
// users' buttons. The hook keeps only the wiring: guard, build, badge, push.
//
// The Stream Deck plugin consumes this shape over ws://localhost:7892. It is
// a WIRE FORMAT: field names and shapes are the contract, and the extraction
// was verified byte-identical against the pre-extraction payload.

import { taskColorToHex, TAILWIND_TO_HEX } from './colorUtils.js';
import { dateToString } from './taskUtils.js';
import { calculateGoalProgress } from './goalProgress.js';
import { calculateProjectProgress } from './projectProgress.js';
import { PROTOCOL_VERSION, MSG_DAY_STATE } from '../../electron/protocol';

export const timeToMinutes = (time) => {
  if (!time) return 0;
  const [h, m] = time.split(':').map(Number);
  return h * 60 + (m || 0);
};

const HABIT_COLOR_HEX = {
  blue: '#3b82f6', green: '#22c55e', red: '#ef4444', amber: '#f59e0b',
  purple: '#a855f7', pink: '#ec4899', cyan: '#06b6d4', orange: '#f97316',
};

function habitRingColor(habit, count) {
  const base = HABIT_COLOR_HEX[habit.color] ?? '#3b82f6';
  if (habit.type === 'limit') {
    // Green while at or under the limit, red once exceeded — no amber state.
    return count <= habit.target ? '#22c55e' : '#ef4444';
  }
  return count === 0 ? '#d1d5db' : base;
}

/**
 * Build the full day-state payload plus the dock badge count.
 * Pure: no window, no refs, no side effects. Inputs are the values the
 * hook's push effect receives as props (isVisibleForUser included, as a
 * plain predicate).
 */
export function buildStreamDeckState({
  currentTime, todayAgenda, todayHGSessions, tasks, unscheduledTasks,
  expandedRecurringTasks, isVisibleForUser = () => true,
  focusModeAvailable, showFocusMode, focusShowSettings, focusShowStats,
  focusPhase, focusTimerSeconds, focusTimerRunning, focusWorkMinutes,
  focusBreakMinutes, focusLongBreakMinutes, focusCycleCount,
  focusBlockTasks, focusCompletedTasks,
  showHyperGlanceMode, hyperGlanceProjectId, hgShowSettings, hgCompleted,
  hgTimerPhase, hgTimerSeconds, hgTimerRunning, hgCycleCount,
  hgWorkMinutes, hgBreakMinutes, hgLongBreakMinutes,
  habitsEnabled, activeHabits, getTodayHabitCount,
  todayRoutines, routineCompletions,
  use24HourClock, goalsProjectsEnabled, goals, projects,
}) {
  const nowMin = currentTime.getHours() * 60 + currentTime.getMinutes();
  const hgSessions = (todayHGSessions || []);
  const scheduled = [
    ...todayAgenda.filter(t => t._agendaType === 'scheduled' && !t.completed && t.startTime),
    ...hgSessions,
  ].sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));

  const inProgress = scheduled.find(t => {
    const start = timeToMinutes(t.startTime);
    return start <= nowMin && start + (t.duration || 0) > nowMin;
  }) || null;

  const nextUpcoming = scheduled
    .filter(t => timeToMinutes(t.startTime) > nowMin)
    .sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime))[0] || null;

  const mapTask = (t) => t ? {
    id: t.id,
    title: t.title,
    startTime: t.startTime ?? null,
    duration: t.duration || 0,
    colorHex: t.colorHex || taskColorToHex(t.color, t.nativeCalendarColor),
    tags: t.tags || [],
    completed: !!t.completed,
    isAllDay: !!t.isAllDay,
    isHGSession: !!t.isHGSession,
    imported: !!t.imported,
    isTaskCalendar: !!t.isTaskCalendar,
  } : null;

  // A read-only calendar event whose time window has passed is effectively done.
  const isPastCalendarEvent = (t) =>
    t.imported && !t.isTaskCalendar && !t.isAllDay && t.startTime &&
    timeToMinutes(t.startTime) + (t.duration || 0) <= nowMin;

  const todayStr = dateToString(currentTime);
  // Multi-user: only surface the current user's tasks on tray/Stream Deck/menu bar.
  const vTasks = (tasks || []).filter(isVisibleForUser);
  const todayRecurring = (expandedRecurringTasks || []).filter(t => t.date === todayStr && isVisibleForUser(t));

  const tomorrowDate = new Date(currentTime);
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const tomorrowStr = dateToString(tomorrowDate);
  const tomorrowRecurring = (expandedRecurringTasks || []).filter(t => t.date === tomorrowStr && isVisibleForUser(t));
  const tomorrowAllDay = [
    ...vTasks.filter(t => t.date === tomorrowStr && !!t.isAllDay),
    ...tomorrowRecurring.filter(t => !!t.isAllDay),
  ];
  const tomorrowTimed = [
    ...vTasks.filter(t => t.date === tomorrowStr && t.startTime && !t.isAllDay),
    ...tomorrowRecurring.filter(t => t.startTime && !t.isAllDay),
  ].sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));
  // Include recurring instances in counts (stable denominator — all tasks regardless of completion/time)
  const todayTasks = [
    ...vTasks.filter(t => t.date === todayStr && t.startTime && !t.isAllDay),
    ...todayRecurring.filter(t => t.startTime && !t.isAllDay),
    ...hgSessions,
  ];
  const allDayTasks = [
    ...vTasks.filter(t => t.date === todayStr && t.isAllDay),
    ...todayRecurring.filter(t => t.isAllDay),
  ];

  // ── Habits ────────────────────────────────────────────────────────────
  const habits = habitsEnabled ? (activeHabits ?? []).map(h => {
    const count = getTodayHabitCount(h.id);
    const colorHex = HABIT_COLOR_HEX[h.color] ?? '#3b82f6';
    const ringColorHex = habitRingColor(h, count);
    return {
      id: h.id,
      name: h.name,
      colorHex,
      ringColorHex,
      count,
      target: h.target,
      unit: h.unit ?? '',
      type: h.type || 'doMore',
      complete: h.type === 'doMore' ? (h.target > 0 && count >= h.target) : false,
    };
  }) : [];

  // ── Next routine (next uncompleted scheduled routine for today) ────────
  const nextRoutineRaw = (todayRoutines ?? [])
    .filter(r => r.startTime && !r.isAllDay && !routineCompletions?.[r.id])
    .sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime))[0] ?? null;

  // ── Goals ─────────────────────────────────────────────────────────────
  const allTasksForGoals = [...vTasks, ...(unscheduledTasks || []).filter(isVisibleForUser)];
  const todayMs = new Date(dateToString(currentTime) + 'T00:00:00').getTime();
  const goalsPayload = goalsProjectsEnabled ? (goals || [])
    .filter(g => g.status === 'active' && isVisibleForUser(g))
    .map(g => {
      const progress = Math.round(calculateGoalProgress(g.id, projects || [], allTasksForGoals) * 100);
      const colorHex = TAILWIND_TO_HEX[g.color] || '#3b82f6';
      const daysLeft = g.targetDate
        ? Math.round((new Date(g.targetDate + 'T00:00:00').getTime() - todayMs) / 86400000)
        : null;
      return { id: g.id, title: g.title, progress, colorHex, daysLeft };
    }) : [];

  // ── Projects ──────────────────────────────────────────────────────────
  const mapProject = (p) => {
    const progress = Math.round(calculateProjectProgress(p.id, allTasksForGoals) * 100);
    const colorHex = TAILWIND_TO_HEX[p.color] || '#3b82f6';
    const parentGoal = p.goalId ? (goals || []).find(g => g.id === p.goalId) : null;
    const goalDaysLeft = parentGoal?.targetDate
      ? Math.round((new Date(parentGoal.targetDate + 'T00:00:00').getTime() - todayMs) / 86400000)
      : null;
    const projectTasks = allTasksForGoals.filter(t => t.projectId === p.id && !t.archived);
    const tasksTotal = projectTasks.length;
    const tasksDone = projectTasks.filter(t => t.completed).length;
    return {
      id: p.id, title: p.title, progress, colorHex,
      goalTitle: parentGoal?.title ?? null,
      goalDaysLeft,
      tasksDone,
      tasksTotal,
    };
  };
  const sortByProgressAsc = (a, b) => a.progress - b.progress;
  const activeProjects = goalsProjectsEnabled ? (projects || []).filter(p => p.status === 'active' && isVisibleForUser(p)) : [];
  const projectsPayload = [
    ...activeProjects.filter(p => p.goalId).map(mapProject).sort(sortByProgressAsc),
    ...activeProjects.filter(p => !p.goalId).map(mapProject).sort(sortByProgressAsc),
  ];

  // Dock badge: incomplete scheduled tasks today, excluding imported calendar events
  // (imported events can't be "completed" by the user and shouldn't inflate the badge)
  const badgeCount = todayTasks.filter(t => !t.completed && !(t.imported && !t.isTaskCalendar)).length;

  const payload = {
    v: PROTOCOL_VERSION,
    type: MSG_DAY_STATE,
    currentTask: mapTask(inProgress),
    nextTask: mapTask(nextUpcoming),
    scheduledTasks: [
      ...allDayTasks.map(mapTask),
      ...[...todayTasks]
        .sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime))
        .map(mapTask),
    ],
    today: {
      total: todayTasks.length + allDayTasks.length,
      completed: todayTasks.filter(t => t.completed || isPastCalendarEvent(t)).length + allDayTasks.filter(t => t.completed).length,
      date: todayStr,
    },
    tomorrow: {
      total: tomorrowAllDay.length + tomorrowTimed.length,
      tasks: [...tomorrowAllDay.map(mapTask), ...tomorrowTimed.map(mapTask)],
    },
    focus: {
      available: focusModeAvailable,
      active: showFocusMode,
      setup: !!focusShowSettings,
      showStats: !!focusShowStats,
      phase: focusPhase,
      secondsRemaining: focusTimerSeconds,
      running: focusTimerRunning,
      workMinutes: focusWorkMinutes,
      breakMinutes: focusBreakMinutes,
      longBreakMinutes: focusLongBreakMinutes,
      cycleCount: focusCycleCount || 0,
      nextFocusTask: (() => {
        const t = (focusBlockTasks || []).find(t => !t.completed && !focusCompletedTasks?.has(t.id));
        return t ? { id: t.id, title: t.title } : null;
      })(),
    },
    habits,
    nextRoutine: nextRoutineRaw ? {
      id: nextRoutineRaw.id,
      name: nextRoutineRaw.name,
      startTime: nextRoutineRaw.startTime,
      completed: false,
    } : null,
    use24Hour: !!use24HourClock,
    goals: goalsPayload,
    projects: projectsPayload,
    hg: {
      scheduled: (todayHGSessions || []).slice(0, 4).map(s => ({
        projectId: s.id,
        title: s.title,
        colorHex: s.colorHex,
        startTime: s.startTime,
        reachable: !!s.reachable,
        date: s.date,
      })),
      active: showHyperGlanceMode ? {
        projectId: hyperGlanceProjectId || '',
        title: (() => { const p = (projects || []).find(p => p.id === hyperGlanceProjectId); return p?.title || ''; })(),
        colorHex: (() => { const p = (projects || []).find(p => p.id === hyperGlanceProjectId); return p?.hyperglance?.color || '#4f46e5'; })(),
        setup: !!hgShowSettings,
        completed: !!hgCompleted,
        phase: hgTimerPhase || 'work',
        secondsRemaining: hgTimerSeconds || 0,
        running: !!hgTimerRunning,
        cycleCount: hgCycleCount || 0,
        workMinutes: hgWorkMinutes || 25,
        breakMinutes: hgBreakMinutes || 5,
        longBreakMinutes: hgLongBreakMinutes || 15,
        nextTask: (() => {
          if (!hyperGlanceProjectId) return null;
          const allT = [...(tasks || []), ...(unscheduledTasks || [])];
          const t = allT.find(t => t.projectId === hyperGlanceProjectId && !t.archived && !t.completed);
          return t ? { id: t.id, title: t.title } : null;
        })(),
      } : null,
    },
  };

  return { payload, badgeCount };
}
