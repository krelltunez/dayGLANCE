// The headless root's state: every slice the sync payload reads and the sync
// apply writes, in one object with a setter per key. App.jsx spreads the same
// slices over its own state hooks; here they are read by the same readers
// (utils/storedSlices.js, the hooks' exported loaders) and then loaded by the
// same loadData, so the payload a headless cycle builds is the payload the
// app would build from the same storage.
//
// Setters accept a value or an updater, like React's, because the apply calls
// `setTasks(prev => …)` for its rescue and sticky-field passes. They are
// stable for the life of the root.

import { useMemo, useState } from 'react';
import { loadIcsCalendars, loadPrimaryCalendarMeta } from '../utils/icsFeedSync.js';
import { loadRoutineState } from '../hooks/useRoutines.js';
import {
  readMinimizedSections, readUse24HourClock, readBucketConfig, readDailyNotes,
  readMultiUserEnabled, readUsers, readMeUserSyncId, readObsidianConfig,
  readObsidianCompletionDates, readWeatherZip, readWeatherTempUnit, readGtdFrames, readFrameSets,
  readTaskCalendarAuth, readSyncRetentionDays, readHabitsEnabled, readRoutinesEnabled,
  readGoalsProjectsEnabled, emptyRoutineDefinitions,
} from '../utils/storedSlices.js';

const SETTER_NAME = (key) => `set${key[0].toUpperCase()}${key.slice(1)}`;

export function initialHeadlessState() {
  const routineState = loadRoutineState();
  return {
    dataLoaded: false,
    // Loaded by useDataPersistence's loadData from these defaults, as in App.
    tasks: [],
    unscheduledTasks: [],
    recycleBin: [],
    recurringTasks: [],
    unscheduledOrderTimestamp: null,
    darkMode: false,
    syncUrl: '',
    taskCalendarUrl: '',
    completedTaskUids: new Set(),
    dailyNotes: readDailyNotes(),
    routineDefinitions: emptyRoutineDefinitions(),
    todayRoutines: [],
    routinesDate: '',
    removedTodayRoutineIds: {},
    habits: [],
    habitLogs: {},
    habitsEnabled: readHabitsEnabled(),
    routinesEnabled: readRoutinesEnabled(),
    goals: [],
    projects: [],
    areas: [],
    goalsProjectsEnabled: readGoalsProjectsEnabled(),
    // Read at start by their own hooks in App; the same readers here.
    routineCompletions: routineState.completions,
    routineCompletionTimestamps: routineState.timestamps,
    icsCalendars: loadIcsCalendars(),
    primaryCalendarMeta: loadPrimaryCalendarMeta(),
    taskCalendarAuth: readTaskCalendarAuth(),
    syncRetentionDays: readSyncRetentionDays(),
    minimizedSections: readMinimizedSections(),
    use24HourClock: readUse24HourClock(),
    weatherZip: readWeatherZip(),
    weatherTempUnit: readWeatherTempUnit(),
    gtdFrames: readGtdFrames(),
    // Undefined when unreadable, as in App (not loaded is not empty).
    frameSets: readFrameSets(),
    bucketConfig: readBucketConfig(),
    obsidianConfig: readObsidianConfig(),
    obsidianCompletionDates: readObsidianCompletionDates(),
    multiUserEnabled: readMultiUserEnabled(),
    users: readUsers(),
    meUserSyncId: readMeUserSyncId(),
  };
}

export default function useHeadlessStore() {
  const [state, setState] = useState(initialHeadlessState);
  const setters = useMemo(() => {
    const out = {};
    for (const key of Object.keys(initialHeadlessState())) {
      out[SETTER_NAME(key)] = (next) => setState((prev) => {
        const value = typeof next === 'function' ? next(prev[key]) : next;
        return Object.is(value, prev[key]) ? prev : { ...prev, [key]: value };
      });
    }
    return out;
  }, []);
  return { ...state, ...setters };
}
