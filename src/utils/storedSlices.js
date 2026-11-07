// Readers for the synced slices that useDataPersistence's loadData does NOT
// set: each one is the initial value a state hook would compute from storage.
//
// They exist so that two roots read the same thing from the same keys. The
// app's state initialisers (App.jsx and its hooks) call them, and so does the
// headless refresh root (src/headless/), which builds the sync payload from
// state it loads itself. buildSyncPayload sends every one of these slices
// with a fresh lastModified, so a root that read one of them differently
// would push that difference to every other device as if it were an edit.
// One reader per slice is what keeps that from happening; a hook that wants
// a different default for its slice changes the reader, not its own copy.
//
// Readers never throw: an unreadable key yields the slice's default, exactly
// as the initialisers they replaced did.

import { defaultUse24HourClock, defaultWeekStartDay } from './localeFormatting.js';
import { normalizeBucketConfig } from './bucketList.js';
import { recordLoadFailure } from './loadFailures.js';

const parseOr = (raw, fallback) => {
  try { return raw === null || raw === undefined ? fallback : JSON.parse(raw); } catch { return fallback; }
};

/** Collapsed-section layout, synced so the same layout follows the user. */
export const readMinimizedSections = () => {
  const saved = localStorage.getItem('minimizedSections');
  return saved ? JSON.parse(saved) : {
    overdue: false,
    inbox: false,
    dayglance: false,
    dailySummary: false,
    allTimeSummary: false,
    recycleBin: false,
    tags: false,
  };
};

export const readUse24HourClock = () => {
  const saved = localStorage.getItem('day-planner-use-24h-clock');
  return saved !== null ? JSON.parse(saved) : defaultUse24HourClock();
};

/** 0 = Sunday, 1 = Monday; anchors the recurring expansion range. */
export const readWeekStartDay = () => {
  const saved = localStorage.getItem('day-planner-week-start-day');
  return saved !== null ? JSON.parse(saved) : defaultWeekStartDay();
};

export const readBucketConfig = () => {
  try { return normalizeBucketConfig(JSON.parse(localStorage.getItem('day-planner-bucket-config') || 'null')); }
  catch { return normalizeBucketConfig(null); }
};

export const readMultiUserEnabled = () => JSON.parse(localStorage.getItem('dayglance-multi-user-enabled') || 'false');
export const readUsers = () => JSON.parse(localStorage.getItem('dayglance-users') || '[]');
export const readMeUserSyncId = () => {
  const r = localStorage.getItem('dayglance-multi-user-config');
  return r ? JSON.parse(r).meUserSyncId || null : null;
};

export const readObsidianConfig = () => {
  try {
    const saved = localStorage.getItem('day-planner-obsidian-config');
    return saved ? JSON.parse(saved) : null;
  } catch { return null; }
};

/** Completion-date markers in Obsidian notes; on unless switched off. */
export const readObsidianCompletionDates = () => {
  try {
    const saved = localStorage.getItem('day-planner-obsidian-completion-dates');
    return saved === null ? true : JSON.parse(saved) === true;
  } catch { return true; }
};

export const readWeatherZip = () => localStorage.getItem('day-planner-weather-zip') || '';
export const readWeatherTempUnit = () => localStorage.getItem('day-planner-weather-temp-unit') || 'fahrenheit';

// The device-calendar filter (utils/nativeCalendar.js: [] shows every
// calendar) and the user's edits to device events, keyed by event id. App and
// the headless root read them here; the launcher snapshot carries both so the
// shell can read the calendar itself (utils/launcherSnapshot.js).
export const readCalendarFilter = () => {
  try { return JSON.parse(localStorage.getItem('day-planner-calendar-filter') || '[]'); } catch { return []; }
};
export const readNativeTimeOverrides = () => {
  try { return JSON.parse(localStorage.getItem('day-planner-native-time-overrides') || '{}'); } catch { return {}; }
};

export const readGtdFrames = () => {
  try {
    const saved = localStorage.getItem('day-planner-gtd-frames');
    return saved ? JSON.parse(saved) : [];
  } catch { return []; }
};

export const FRAME_SETS_KEY = 'day-planner-frame-sets';
export const DELETED_FRAME_SET_IDS_KEY = 'day-planner-deleted-frame-set-ids';

/**
 * Frame sets (#2305, agenda-core frameSets.js): [] when this device has none,
 * UNDEFINED when the stored copy cannot be read. Unreadable is not empty: the
 * payload omits an undefined slice rather than publishing [] (which the vault
 * diff would read as every set deleted), and the failure is recorded so the
 * save pass does not write over the stored copy (utils/loadFailures.js).
 */
export const readFrameSets = () => {
  let saved = null;
  try {
    saved = localStorage.getItem(FRAME_SETS_KEY);
    if (saved === null) return [];
    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed)) throw new TypeError('frame sets are not a list');
    return parsed;
  } catch (error) {
    if (saved !== null) recordLoadFailure(FRAME_SETS_KEY, error, saved);
    return undefined;
  }
};

export const readTaskCalendarAuth = () => {
  const saved = localStorage.getItem('day-planner-task-calendar-auth');
  return saved ? JSON.parse(saved) : { username: '', appPassword: '', caldavBaseUrl: '' };
};

export const readSyncRetentionDays = () => {
  const saved = localStorage.getItem('day-planner-sync-retention-days');
  return saved ? JSON.parse(saved) : 30;
};

/**
 * Daily notes, as an initial value only. They live in IndexedDB since #2141
 * and arrive with loadData (utils/dailyNotesStore.js); this reads the
 * localStorage copy a device has until that first load moves it, and {} after.
 * Unreadable is not empty: the failure is recorded so nothing writes {} over
 * the stored copy (utils/loadFailures.js).
 */
export const readDailyNotes = () => {
  let saved = null;
  try {
    saved = localStorage.getItem('day-planner-daily-notes');
    return saved ? JSON.parse(saved) : {};
  } catch (error) {
    if (saved !== null) recordLoadFailure('day-planner-daily-notes', error, saved);
    return {};
  }
};

/**
 * Feature toggles with an upgrade migration: an explicit preference wins;
 * without one the feature is on when the user already has its data, so an
 * update never silently hides what they had.
 */
export const readHabitsEnabled = () => {
  const stored = localStorage.getItem('day-planner-habits-enabled');
  if (stored !== null) return JSON.parse(stored);
  try {
    if (parseOr(localStorage.getItem('day-planner-habits'), []).length > 0) return true;
  } catch { /* unreadable habits: no migration */ }
  return false;
};

/**
 * The JOBO experiment's per-device switch. Gates the interface and whether
 * this device creates Do records from its own completions, never the data
 * (CLAUDE.md, "JOBO ledger"). Read by App and by the headless root's detector.
 */
export const readJoboEnabled = () => {
  try {
    const saved = localStorage.getItem('day-planner-jobo-enabled');
    return saved !== null ? JSON.parse(saved) === true : false;
  } catch { return false; }
};

export const readRoutinesEnabled = () => {
  const stored = localStorage.getItem('day-planner-routines-enabled');
  if (stored !== null) return JSON.parse(stored);
  try {
    const existing = JSON.parse(localStorage.getItem('day-planner-routine-definitions') || 'null');
    if (existing) {
      const hasAny = Object.values(existing).some(arr => arr.length > 0);
      if (hasAny) return true;
    }
  } catch { /* unreadable definitions: no migration */ }
  return false;
};

export const readGoalsProjectsEnabled = () => {
  const stored = localStorage.getItem('day-planner-goals-projects-enabled');
  if (stored !== null) return JSON.parse(stored);
  try {
    const existingGoals = JSON.parse(localStorage.getItem('day-planner-goals') || '[]');
    const existingProjects = JSON.parse(localStorage.getItem('day-planner-projects') || '[]');
    if (existingGoals.length > 0 || existingProjects.length > 0) return true;
  } catch { /* unreadable: no migration */ }
  return false;
};

/** The empty week, the shape every routine-definition writer keeps. */
export const emptyRoutineDefinitions = () =>
  ({ monday: [], tuesday: [], wednesday: [], thursday: [], friday: [], saturday: [], sunday: [], everyday: [] });
