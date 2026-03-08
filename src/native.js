/**
 * DayGlanceNative bridge detection and access.
 *
 * The Android app injects `window.DayGlanceNative` into the WebView's
 * JavaScript context. This module provides feature detection and typed
 * access to the bridge so the rest of the frontend can gracefully degrade
 * when running as a PWA (no bridge present).
 *
 * Usage:
 *   import { isNativeAndroid, nativeBridge } from './native.js';
 *
 *   if (isNativeAndroid()) {
 *     const steps = await nativeBridge.getSteps('2026-03-08');
 *   }
 */

/**
 * Returns true when running inside the DayGlance Android WebView.
 */
export const isNativeAndroid = () =>
  typeof window !== 'undefined' && !!window.DayGlanceNative;

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
  isNativeAndroid() ? window.DayGlanceNative : null;

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

export const nativeGetEvents = async (date) => {
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
