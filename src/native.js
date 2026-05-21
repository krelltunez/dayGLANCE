/**
 * DayGlanceNative bridge detection and access.
 *
 * The Android app injects `window.DayGlanceNative` into the WebView's
 * JavaScript context. This module provides feature detection and typed
 * access to the bridge so the rest of the frontend can gracefully degrade
 * when running as a PWA (no bridge present).
 *
 * Intent protocol constants from @glance-apps/intents are re-exported here
 * so all bridge-related concerns live in one namespace.
 *
 * Usage:
 *   import { isNativeAndroid, nativeBridge } from './native.js';
 *   import { ACTIONS, ANDROID_ACTIONS, SOURCE_APPS } from './native.js';
 *
 *   if (isNativeAndroid()) {
 *     const steps = await nativeBridge.getSteps('2026-03-08');
 *   }
 */

export {
  ACTIONS,
  ANDROID_ACTIONS,
  ENTITY_TYPES,
  EVENTS,
  PRIORITY,
  PRIORITY_ALIASES,
  QUERY_RETURN_VARS,
  RETURN_VARS,
  RETURN_VAR_TYPES,
  SCHEMA_VERSION,
  SOURCE_APPS,
  TABS,
  UNIVERSAL_RETURN_VARS,
  UPDATED_FIELDS,
} from '@glance-apps/intents';

const DEVICE_ID_KEY = 'dayglance_device_id';

/**
 * Returns a stable per-installation device ID, generating and persisting one
 * on first call. Used to identify which device last auto-synced a habit so
 * other devices can display the correct cross-device badge label.
 */
export const getDeviceId = () => {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
};

/**
 * Returns true when running inside the DayGlance Android WebView.
 */
export const isNativeAndroid = () =>
  typeof window !== 'undefined' && !!window.DayGlanceNative && !window.DayGlanceIOS;

/**
 * Returns true when running inside the DayGlance iOS WKWebView shell.
 * Swift injects window.DayGlanceIOS = true at document start.
 */
export const isNativeIOS = () =>
  typeof window !== 'undefined' && !!window.DayGlanceIOS;

/**
 * Returns true when running inside any native shell (Android or iOS).
 */
export const isNativeApp = () => isNativeAndroid() || isNativeIOS();

/**
 * Returns the native bridge object (Health, Calendar, Notifications), or null when running as a PWA.
 *
 * The bridge exposes (when implemented in the Android app):
 *
 *   Health Connect (Phase 2):
 *     getSteps(date: string): string       — JSON: { steps, goal }
 *     getSleep(date: string): string       — JSON with sleep stages/duration
 *
 *   Calendar (Phase 3):
 *     getEvents(date: string): string      — JSON array of calendar events
 *     createEvent(eventJson: string): string
 *     updateEvent(eventJson: string): string
 *     deleteEvent(eventId: string): string
 *
 *   Notifications (Phase 5):
 *     scheduleReminder(id, title, body, triggerAtMillis): void
 *     cancelReminder(id: string): void
 *     showNotification(title: string, body: string): void
 */
export const nativeBridge = () =>
  (isNativeAndroid() || isNativeIOS()) ? window.DayGlanceNative : null;

/**
 * Returns the Obsidian vault bridge object (Phase 4), or null when running as a PWA.
 *
 * Registered separately as window.DayGlanceObsidian so vault file I/O is
 * isolated from the main bridge. The bridge exposes:
 *
 *   getDailyNote(date: string): string     — raw markdown content
 *   listNotes(folder: string): string      — JSON array of note paths relative to vault root
 *   appendToNote(path: string, content: string): boolean
 *   getTasksFromNote(path: string): string — JSON array of { text, completed, line }
 *   getNote(path: string): string          — JSON { text, lastModified } or "" if not found
 *   writeNote(path: string, content: string): boolean — create or overwrite arbitrary note
 */
export const obsidianBridge = () =>
  typeof window !== 'undefined' ? window.DayGlanceObsidian ?? null : null;

/**
 * Convenience helpers — each returns null / empty value when the bridge is
 * absent so call sites don't need to repeat the null-check.
 */

export const nativeGetSteps = async (date) => {
  const bridge = nativeBridge();
  if (!bridge?.getSteps) return null;
  try {
    return JSON.parse(bridge.getSteps(date));
  } catch {
    return null;
  }
};

export const nativeGetSleep = async (date) => {
  const bridge = nativeBridge();
  if (!bridge?.getSleep) return null;
  try {
    return JSON.parse(bridge.getSleep(date));
  } catch {
    return null;
  }
};

export const nativeGetCalendars = () => {
  const bridge = nativeBridge();
  if (!bridge?.getCalendars) return [];
  try {
    return JSON.parse(bridge.getCalendars()) ?? [];
  } catch {
    return [];
  }
};

export const nativeGetEvents = (date) => {
  const bridge = nativeBridge();
  if (!bridge?.getEvents) return null;
  try {
    return JSON.parse(bridge.getEvents(date));
  } catch {
    return null;
  }
};

export const nativeCreateEvent = async (eventJson) => {
  const bridge = nativeBridge();
  if (!bridge?.createEvent) return null;
  try {
    return JSON.parse(bridge.createEvent(JSON.stringify(eventJson)));
  } catch {
    return null;
  }
};

export const nativeUpdateEvent = async (eventJson) => {
  const bridge = nativeBridge();
  if (!bridge?.updateEvent) return null;
  try {
    return JSON.parse(bridge.updateEvent(JSON.stringify(eventJson)));
  } catch {
    return null;
  }
};

/**
 * Triggers a full vault tree scan to build the in-memory note URI index.
 * After this completes, bare-name getNote() calls are O(1).
 * Called automatically by getAllDailyNotes(); use this to rebuild after
 * external vault changes.
 */
export const nativeBuildNoteIndex = () => {
  const bridge = obsidianBridge();
  if (!bridge?.buildNoteIndex) return;
  bridge.buildNoteIndex();
};

/**
 * Opens the system folder picker so the user can select an Obsidian vault.
 * On Android this launches SAF; on iOS it presents UIDocumentPickerViewController.
 * The bridge posts a webview reload notification after the user picks a folder.
 */
export const nativePickVault = () => {
  const bridge = obsidianBridge();
  if (!bridge?.pickVault) return;
  bridge.pickVault();
};

/**
 * Persists daily-notes folder, date pattern, and new-notes folder to native storage
 * (UserDefaults on iOS) so getDailyNote/writeDailyNote use the correct paths.
 * No-op on Android where these are set via SettingsActivity.
 */
export const nativeSetVaultSettings = (folder, pattern, newNotesFolder) => {
  const bridge = obsidianBridge();
  if (!bridge?.setVaultSettings) return;
  bridge.setVaultSettings(folder ?? '', pattern ?? 'yyyy-MM-dd', newNotesFolder ?? 'dayGLANCE');
};

/**
 * Clears the stored vault URI, resetting the integration to unconfigured state.
 * The SAF permission is not revoked on Android.
 */
export const nativeClearVault = () => {
  const bridge = obsidianBridge();
  if (!bridge?.clearVault) return;
  bridge.clearVault();
};

/**
 * Opens [noteName] in the Obsidian app via the obsidian:// URI scheme.
 * No-op when the bridge is unavailable or Obsidian isn't installed.
 */
export const nativeOpenNote = (noteName) => {
  const bridge = obsidianBridge();
  if (!bridge?.openNote) return;
  bridge.openNote(noteName);
};

export const nativeGetDailyNote = (date) => {
  const bridge = obsidianBridge();
  if (!bridge?.getDailyNote) return null;
  return bridge.getDailyNote(date);
};

export const nativeListNotes = (folder) => {
  const bridge = obsidianBridge();
  if (!bridge?.listNotes) return null;
  try {
    return JSON.parse(bridge.listNotes(folder));
  } catch {
    return null;
  }
};

export const nativeGetTasksFromNote = (path) => {
  const bridge = obsidianBridge();
  if (!bridge?.getTasksFromNote) return null;
  try {
    return JSON.parse(bridge.getTasksFromNote(path));
  } catch {
    return null;
  }
};

export const nativeAppendToNote = (path, content) => {
  const bridge = obsidianBridge();
  if (!bridge?.appendToNote) return false;
  return bridge.appendToNote(path, content);
};

/** Returns true if the vault root has been configured in the native settings. */
export const nativeIsVaultConfigured = () => {
  const bridge = obsidianBridge();
  if (!bridge?.isVaultConfigured) return false;
  try { return bridge.isVaultConfigured(); } catch { return false; }
};

/**
 * Returns { configured, folder, pattern } from the native settings store.
 * Used on Android startup to detect vault state and retrieve the folder path.
 */
export const nativeGetVaultConfig = () => {
  const bridge = obsidianBridge();
  if (!bridge?.getVaultConfig) return null;
  try { return JSON.parse(bridge.getVaultConfig()); } catch { return null; }
};

/**
 * Reads an arbitrary vault note by wikilink name (e.g. "My Note" or "Folder/My Note").
 * Bare names are resolved by searching the vault recursively, matching Obsidian's behaviour.
 * Returns { text, lastModified } or null if not found / vault not configured.
 */
export const nativeGetNote = (path) => {
  const bridge = obsidianBridge();
  if (!bridge?.getNote) return null;
  try {
    const raw = bridge.getNote(path);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

/**
 * Creates or overwrites an arbitrary vault note by wikilink name.
 * For bare names the vault is searched first; if not found the file is created at vault root.
 * Returns false if vault isn't configured or write fails.
 */
export const nativeWriteNote = (path, content) => {
  const bridge = obsidianBridge();
  if (!bridge?.writeNote) return false;
  try { return bridge.writeNote(path, content); } catch { return false; }
};

/**
 * Creates or overwrites the daily note for [date] (ISO: yyyy-MM-dd) with [content].
 * Returns false if vault isn't configured or write fails.
 */
export const nativeWriteDailyNote = (date, content) => {
  const bridge = obsidianBridge();
  if (!bridge?.writeDailyNote) return false;
  try { return bridge.writeDailyNote(date, content); } catch { return false; }
};

export const nativeScheduleReminder = (id, title, body, triggerAtMillis) => {
  const bridge = nativeBridge();
  if (!bridge?.scheduleReminder) return;
  bridge.scheduleReminder(id, title, body, triggerAtMillis);
};

export const nativeCancelReminder = (id) => {
  const bridge = nativeBridge();
  if (!bridge?.cancelReminder) return;
  bridge.cancelReminder(id);
};

export const nativeShowNotification = (title, body) => {
  const bridge = nativeBridge();
  if (!bridge?.showNotification) return;
  bridge.showNotification(title, body);
};

/**
 * Shows a rich task reminder notification with Snooze / Mark Complete action buttons.
 *
 * @param reminder  The reminder object from the App.jsx reminder engine:
 *   { id, taskId, taskTitle, message, type, isCalendarEvent }
 */
export const nativeShowTaskNotification = (reminder) => {
  const bridge = nativeBridge();
  if (!bridge?.showTaskNotification) return;
  bridge.showTaskNotification(
    String(reminder.id),
    String(reminder.taskId),
    reminder.taskTitle,
    reminder.message,
    reminder.type,
    reminder.isCalendarEvent === true,
  );
};

/**
 * Reads and clears any pending action stored by a notification action button.
 * Returns null if nothing is pending, or { action: 'complete', taskId: '...' }.
 *
 * Call this on app focus / visibilitychange to pick up actions that happened
 * while the app was backgrounded.
 */
export const nativeGetPendingAction = () => {
  const bridge = nativeBridge();
  if (!bridge?.getPendingAction) return null;
  try {
    const raw = bridge.getPendingAction();
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

/**
 * Performs a native HTTP request (Android only), bypassing CORS and the
 * /api/webdav-proxy/ server. Used by WebDAV cloud sync providers.
 *
 * @param method   HTTP verb: GET, PUT, POST, DELETE, MKCOL, PROPFIND, …
 * @param url      Full target URL
 * @param headers  Plain object of request headers
 * @param body     Request body string (default empty)
 * @returns        { status, ok, body, error? } or null if bridge unavailable
 */
export const nativeHttpRequest = (method, url, headers = {}, body = '') => {
  const bridge = nativeBridge();
  if (!bridge?.httpRequest) return null;
  try {
    return JSON.parse(bridge.httpRequest(method, url, JSON.stringify(headers), body));
  } catch {
    return null;
  }
};

/**
 * Replaces all scheduled background reminder alarms with a new set.
 *
 * Call this whenever tasks or reminder settings change so AlarmManager always
 * has the correct upcoming alarms — even when the app is closed or the device
 * restarts (BOOT_COMPLETED handler re-registers from the persisted list).
 *
 * @param reminders  Array of upcoming reminders:
 *   [{ id, taskId, title, body, type, isCalendarEvent, triggerAtMillis }, ...]
 */
export const nativeSyncReminders = (reminders) => {
  const bridge = nativeBridge();
  if (!bridge?.syncReminders) return;
  bridge.syncReminders(JSON.stringify(reminders));
};

// ── Audio recording ───────────────────────────────────────────────────────────

/**
 * Starts native audio capture via Android's MediaRecorder.
 * Returns "ok" on success, or { error: string } on failure.
 * Returns null when the bridge is unavailable (PWA / web).
 */
export const nativeStartRecording = () => {
  const bridge = nativeBridge();
  if (!bridge?.startRecording) return null;
  const result = bridge.startRecording();
  if (result === 'ok') return 'ok';
  try { return JSON.parse(result); } catch { return { error: result }; }
};

/**
 * Stops native audio capture and returns the audio as a Blob (audio/mp4).
 * Returns null when the bridge is unavailable or if an error occurred.
 */
export const nativeStopRecording = () => {
  const bridge = nativeBridge();
  if (!bridge?.stopRecording) return null;
  const result = bridge.stopRecording();
  if (!result.startsWith('data:')) {
    let error = result;
    try { error = JSON.parse(result).error; } catch { /* use raw */ }
    return { error };
  }
  const base64 = result.split(',')[1];
  const bytes = atob(base64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type: 'audio/m4a' });
};

// ── Focus mode ────────────────────────────────────────────────────────────────

/**
 * Enters native focus mode: hides status bar + nav bar (immersive mode),
 * cancels own scheduled reminder alarms, and enables Do Not Disturb
 * (INTERRUPTION_FILTER_ALARMS) if ACCESS_NOTIFICATION_POLICY is granted.
 *
 * Returns { dndEnabled: bool } — false means DND permission hasn't been granted yet.
 * No-op when running as a PWA (bridge absent).
 */
export const nativeEnterFocusMode = () => {
  const bridge = nativeBridge();
  if (!bridge?.enterFocusMode) return null;
  try {
    return JSON.parse(bridge.enterFocusMode());
  } catch {
    return null;
  }
};

/**
 * Exits native focus mode: restores system bars, previous DND filter,
 * and reschedules reminder alarms paused on entry.
 * No-op when running as a PWA.
 */
export const nativeExitFocusMode = () => {
  const bridge = nativeBridge();
  if (!bridge?.exitFocusMode) return;
  bridge.exitFocusMode();
};

/**
 * Hides (enter=true) or restores (enter=false) the system bars without
 * the DND/alarm side effects of full focus mode. Used by hyperGLANCE.
 * No-op when running as a PWA.
 */
export const nativeSetImmersiveMode = (enter) => {
  const bridge = nativeBridge();
  if (!bridge?.setImmersiveMode) return;
  bridge.setImmersiveMode(enter);
};

/**
 * Returns true if the user has granted Do Not Disturb access to this app.
 * Always returns false when running as a PWA.
 */
export const nativeIsDndPermissionGranted = () => {
  const bridge = nativeBridge();
  if (!bridge?.isDndPermissionGranted) return false;
  try { return bridge.isDndPermissionGranted(); } catch { return false; }
};

/**
 * Opens the system Do Not Disturb access settings screen so the user can
 * grant ACCESS_NOTIFICATION_POLICY. Call this when isDndPermissionGranted()
 * returns false and the user taps the "Enable DND" prompt.
 */
export const nativeRequestDndPermission = () => {
  const bridge = nativeBridge();
  if (!bridge?.requestDndPermission) return;
  bridge.requestDndPermission();
};

/**
 * Triggers the Android system share sheet for a JSON backup file.
 *
 * The web `<a download>` trick is silently ignored inside a WebView; this
 * native bridge call writes the file to the app cache dir and opens the
 * share sheet so the user can send it to Files, Drive, email, etc.
 *
 * @param filename  Suggested file name, e.g. "dayglance-backup-2026-03-13.json"
 * @param content   The file contents as a string
 * @returns         { success: true } or { success: false, error: string }
 */
// ── Focus timer notification ──────────────────────────────────────────────────

/**
 * Posts or updates the persistent focus timer notification in the Android
 * notification drawer. Kotlin computes endEpochMillis from [remainingSeconds]
 * to avoid JS→Java Long precision issues. The countdown is handled natively
 * (setChronometerCountDown) so it ticks even when the WebView is backgrounded.
 *
 * @param phase            "work" | "shortBreak" | "longBreak"
 * @param remainingSeconds seconds remaining in the current phase
 * @param isPaused         true while the timer is paused
 */
export const nativeShowFocusTimerNotification = (phase, remainingSeconds, isPaused, cycleCount) => {
  const bridge = nativeBridge();
  if (!bridge?.showFocusTimerNotification) return;
  bridge.showFocusTimerNotification(phase, remainingSeconds, isPaused, cycleCount);
};

/** Cancels the focus timer notification. Call when the session ends or is dismissed. */
export const nativeDismissFocusTimerNotification = () => {
  const bridge = nativeBridge();
  if (!bridge?.dismissFocusTimerNotification) return;
  bridge.dismissFocusTimerNotification();
};

/**
 * Returns and clears any pending focus action from a notification button tap:
 * "focus-pause" | "focus-resume" | "focus-stop", or null if none pending.
 *
 * Poll this at ~500 ms while a focus session is active. Notification button
 * taps won't trigger visibilitychange when the app is already in the foreground,
 * so polling is the only way to pick them up promptly.
 */
export const nativeGetFocusPendingAction = () => {
  const bridge = nativeBridge();
  if (!bridge?.getFocusPendingAction) return null;
  const raw = bridge.getFocusPendingAction();
  return raw || null;
};

export const nativeShareFile = (filename, content) => {
  const bridge = nativeBridge();
  if (!bridge?.shareFile) return null;
  try {
    return JSON.parse(bridge.shareFile(filename, content));
  } catch {
    return null;
  }
};
