// Shared rich fixture for the Stream Deck payload: exercises every branch of
// the payload build (habits on, goals and projects with and without parent
// goals, hyperGLANCE active with sessions, focus active with block tasks,
// all-day + timed + recurring + imported-past-event tasks, tomorrow set,
// multi-user visibility filter). Used by the byte-identity check that guarded
// the extraction and by the ongoing shape tests: a field dropped or renamed
// anywhere in the payload changes the manifest built from this fixture.

// 14:30 local on a fixed date; all derived fields are TZ-stable because the
// suite pins TZ via the values below being wall-clock local.
export const FIXTURE_NOW = new Date(2026, 7, 16, 14, 30, 0);

export function fixtureInputs() {
  const hidden = { id: 'hidden-1', title: 'Other user task', date: '2026-08-16', startTime: '16:00', duration: 30, assignedUserSyncIds: ['someone-else'] };
  return {
    currentTime: FIXTURE_NOW,
    todayAgenda: [
      { id: 'ag-1', _agendaType: 'scheduled', title: 'In progress now', date: '2026-08-16', startTime: '14:00', duration: 60, color: 'bg-blue-500' },
      { id: 'ag-2', _agendaType: 'scheduled', title: 'Later today', date: '2026-08-16', startTime: '16:00', duration: 30, color: 'bg-red-500', tags: ['deep'] },
      { id: 'ag-3', _agendaType: 'scheduled', title: 'Done already', date: '2026-08-16', startTime: '09:00', duration: 30, completed: true },
    ],
    todayHGSessions: [
      { id: 'p-hg', title: 'HG session', colorHex: '#4f46e5', startTime: '17:00', duration: 50, isHGSession: true, reachable: true, date: '2026-08-16' },
    ],
    tasks: [
      { id: 't-timed', title: 'Timed today', date: '2026-08-16', startTime: '10:00', duration: 45, completed: false, color: 'bg-green-500' },
      { id: 't-done', title: 'Done today', date: '2026-08-16', startTime: '08:00', duration: 30, completed: true },
      { id: 't-past-import', title: 'Past calendar event', date: '2026-08-16', startTime: '09:00', duration: 60, imported: true, nativeCalendarColor: '#aa00aa' },
      { id: 't-allday', title: 'All day today', date: '2026-08-16', isAllDay: true, completed: false },
      { id: 't-tomorrow', title: 'Tomorrow timed', date: '2026-08-17', startTime: '09:15', duration: 20 },
      { id: 't-tomorrow-allday', title: 'Tomorrow all day', date: '2026-08-17', isAllDay: true },
      { id: 't-proj', title: 'Project task open', projectId: 'p-1', completed: false },
      { id: 't-proj-done', title: 'Project task done', projectId: 'p-1', completed: true, date: '2026-08-15' },
      hidden,
    ],
    unscheduledTasks: [
      { id: 'u-1', title: 'Inbox for goal', projectId: 'p-2', completed: false },
      { id: 'u-hg', title: 'HG next task', projectId: 'p-hg', completed: false },
    ],
    expandedRecurringTasks: [
      { id: 'recurring-1-2026-08-16', title: 'Daily standup', date: '2026-08-16', startTime: '15:30', duration: 15, color: 'bg-amber-500' },
      { id: 'recurring-1-2026-08-17', title: 'Daily standup', date: '2026-08-17', startTime: '15:30', duration: 15 },
      { id: 'recurring-allday-2026-08-16', title: 'Recurring all day', date: '2026-08-16', isAllDay: true },
    ],
    isVisibleForUser: (t) => !(t.assignedUserSyncIds ?? []).includes('someone-else'),
    // Focus
    focusModeAvailable: true,
    showFocusMode: true,
    focusShowSettings: false,
    focusShowStats: true,
    focusPhase: 'work',
    focusTimerSeconds: 1234,
    focusTimerRunning: true,
    focusWorkMinutes: 25,
    focusBreakMinutes: 5,
    focusLongBreakMinutes: 15,
    focusCycleCount: 2,
    focusBlockTasks: [
      { id: 'fb-1', title: 'Focus done', completed: true },
      { id: 'fb-2', title: 'Focus next', completed: false },
      { id: 'fb-3', title: 'Focus skipped', completed: false },
    ],
    focusCompletedTasks: new Set(['fb-2']),
    // HyperGLANCE
    showHyperGlanceMode: true,
    hyperGlanceProjectId: 'p-hg',
    hgShowSettings: false,
    hgCompleted: false,
    hgTimerPhase: 'break',
    hgTimerSeconds: 300,
    hgTimerRunning: false,
    hgCycleCount: 1,
    hgWorkMinutes: 50,
    hgBreakMinutes: 10,
    hgLongBreakMinutes: 20,
    // Habits
    habitsEnabled: true,
    activeHabits: [
      { id: 'h-1', name: 'Water', color: 'blue', target: 8, unit: 'glasses', type: 'doMore' },
      { id: 'h-2', name: 'Coffee', color: 'red', target: 2, type: 'limit' },
      { id: 'h-3', name: 'Untouched', color: 'nope', target: 3, type: 'doMore' },
    ],
    getTodayHabitCount: (id) => ({ 'h-1': 8, 'h-2': 3, 'h-3': 0 })[id] ?? 0,
    // Routines
    todayRoutines: [
      { id: 'r-done', name: 'Morning pages', startTime: '07:00' },
      { id: 'r-next', name: 'Shutdown ritual', startTime: '18:00' },
      { id: 'r-allday', name: 'All day routine', isAllDay: true },
    ],
    routineCompletions: { 'r-done': true },
    // Settings
    use24HourClock: true,
    // Goals and projects
    goalsProjectsEnabled: true,
    goals: [
      { id: 'g-1', title: 'Ship it', status: 'active', color: 'bg-blue-500', targetDate: '2026-09-01' },
      { id: 'g-archived', title: 'Old', status: 'archived' },
    ],
    projects: [
      { id: 'p-1', title: 'With goal', status: 'active', color: 'bg-green-500', goalId: 'g-1' },
      { id: 'p-2', title: 'Standalone project', status: 'active', color: 'nope' },
      { id: 'p-hg', title: 'HG project', status: 'active', hyperglance: { color: '#123456' } },
      { id: 'p-done', title: 'Completed project', status: 'completed' },
    ],
  };
}
