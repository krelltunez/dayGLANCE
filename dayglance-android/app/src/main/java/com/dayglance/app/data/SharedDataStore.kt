package com.dayglance.app.data

import android.content.Context
import android.content.SharedPreferences
import androidx.core.content.edit

/**
 * Shared data store used by both the WebView and the home screen widget.
 *
 * Stores a JSON snapshot of today's agenda so the widget can render without
 * waiting for Health Connect / Calendar queries (which may be slow).
 *
 * The WebView writes a fresh snapshot whenever data changes; the widget reads
 * from this store so it stays fast.
 */
class SharedDataStore(context: Context) {

    private val prefs: SharedPreferences =
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    // ── Obsidian vault settings ─────────────────────────────────────────────

    /** SAF tree URI for the vault root, set by SettingsActivity. */
    var vaultPath: String?
        get() = prefs.getString(KEY_VAULT_PATH, null)
        set(value) = prefs.edit { putString(KEY_VAULT_PATH, value) }

    /**
     * Folder path relative to the vault root where daily notes are stored.
     * e.g. "Daily Notes" or "Journal/Daily". Empty string means vault root.
     */
    var dailyNoteFolder: String
        get() = prefs.getString(KEY_DAILY_NOTE_FOLDER, "") ?: ""
        set(value) = prefs.edit { putString(KEY_DAILY_NOTE_FOLDER, value) }

    /**
     * Java DateTimeFormatter pattern for daily note filenames (without .md).
     * Defaults to "yyyy-MM-dd" which produces e.g. "2026-03-08.md".
     */
    var dailyNotePattern: String
        get() = prefs.getString(KEY_DAILY_NOTE_PATTERN, DEFAULT_DAILY_NOTE_PATTERN)
            ?: DEFAULT_DAILY_NOTE_PATTERN
        set(value) = prefs.edit { putString(KEY_DAILY_NOTE_PATTERN, value) }

    /**
     * Folder inside the vault where new notes created by dayGLANCE are stored.
     * e.g. "dayGLANCE" or "Inbox/dayGLANCE". Empty string means vault root.
     * Only affects note creation — existing notes are always edited in-place.
     */
    var newNotesFolder: String
        get() = prefs.getString(KEY_NEW_NOTES_FOLDER, DEFAULT_NEW_NOTES_FOLDER)
            ?: DEFAULT_NEW_NOTES_FOLDER
        set(value) = prefs.edit { putString(KEY_NEW_NOTES_FOLDER, value) }

    // ── App appearance preference ───────────────────────────────────────────

    /**
     * The app's own dark-mode flag, independent of the Android system night-mode
     * setting. Written by NativeBridge.setStatusBarAppearance() whenever JS
     * updates the dark-mode state. Null until the first time JS writes it.
     *
     * Used by MainActivity.applyStatusBarAppearance() to restore the correct
     * status-bar icon colour on cold starts and after WebView first-paint resets.
     */
    var appDarkMode: Boolean?
        get() = if (prefs.contains(KEY_APP_DARK_MODE)) prefs.getBoolean(KEY_APP_DARK_MODE, false) else null
        set(value) = prefs.edit {
            if (value != null) putBoolean(KEY_APP_DARK_MODE, value) else remove(KEY_APP_DARK_MODE)
        }

    // ── Widget snapshot ─────────────────────────────────────────────────────

    /** JSON snapshot of today's agenda written by the app for the widget to read. */
    var widgetSnapshot: String?
        get() = prefs.getString(KEY_WIDGET_SNAPSHOT, null)
        set(value) = prefs.edit { putString(KEY_WIDGET_SNAPSHOT, value) }

    var widgetSnapshotUpdatedAt: Long
        get() = prefs.getLong(KEY_WIDGET_SNAPSHOT_TS, 0L)
        set(value) = prefs.edit { putLong(KEY_WIDGET_SNAPSHOT_TS, value) }

    // ── Notification pending actions ─────────────────────────────────────────

    /**
     * Task ID pending completion via a "Mark Complete" notification action button.
     * Written by NotificationActionReceiver; read and cleared by NativeBridge.getPendingAction().
     */
    var pendingCompleteTaskId: String?
        get() = prefs.getString(KEY_PENDING_COMPLETE, null)
        set(value) = prefs.edit {
            if (value != null) putString(KEY_PENDING_COMPLETE, value)
            else remove(KEY_PENDING_COMPLETE)
        }

    /**
     * Task ID pending a snooze-15-minute shift via the notification "Snooze 15m" button.
     * Written by NotificationActionReceiver; read and cleared by NativeBridge.getPendingAction().
     */
    var pendingSnoozeTaskId: String?
        get() = prefs.getString(KEY_PENDING_SNOOZE, null)
        set(value) = prefs.edit {
            if (value != null) putString(KEY_PENDING_SNOOZE, value)
            else remove(KEY_PENDING_SNOOZE)
        }

    /**
     * True when the app was launched via the "Voice Input" launcher shortcut.
     * Written by MainActivity; read and cleared by NativeBridge.getPendingAction().
     */
    var pendingVoiceInput: Boolean
        get() = prefs.getBoolean(KEY_PENDING_VOICE_INPUT, false)
        set(value) = prefs.edit { putBoolean(KEY_PENDING_VOICE_INPUT, value) }

    /**
     * True when the app was launched via the "Add Task" launcher shortcut.
     * Written by MainActivity; read and cleared by NativeBridge.getPendingAction().
     */
    var pendingAddTask: Boolean
        get() = prefs.getBoolean(KEY_PENDING_ADD_TASK, false)
        set(value) = prefs.edit { putBoolean(KEY_PENDING_ADD_TASK, value) }

    /**
     * True when the app was launched via the "Inbox Task" launcher shortcut.
     * Written by MainActivity; read and cleared by NativeBridge.getPendingAction().
     */
    var pendingAddInboxTask: Boolean
        get() = prefs.getBoolean(KEY_PENDING_ADD_INBOX_TASK, false)
        set(value) = prefs.edit { putBoolean(KEY_PENDING_ADD_INBOX_TASK, value) }

    /**
     * Text shared to dayGLANCE via the Android share sheet (ACTION_SEND).
     * Written by MainActivity; read and cleared by NativeBridge.getPendingAction().
     */
    var pendingShareText: String?
        get() = prefs.getString(KEY_PENDING_SHARE, null)
        set(value) = prefs.edit {
            if (value != null) putString(KEY_PENDING_SHARE, value)
            else remove(KEY_PENDING_SHARE)
        }

    // ── Scheduled reminders (background alarm persistence) ───────────────────

    /**
     * JSON array of upcoming reminder alarms registered with AlarmManager.
     * Written by NotificationBridge.syncReminders(); read by ReminderReceiver
     * on BOOT_COMPLETED to reschedule alarms lost when the device restarts.
     *
     * Schema per element:
     *   { id, taskId, title, body, type, isCalendarEvent, triggerAtMillis }
     */
    var scheduledRemindersJson: String?
        get() = prefs.getString(KEY_SCHEDULED_REMINDERS, null)
        set(value) = prefs.edit {
            if (value != null) putString(KEY_SCHEDULED_REMINDERS, value)
            else remove(KEY_SCHEDULED_REMINDERS)
        }

    /**
     * Pending focus timer action triggered by a notification action button.
     * Values: "focus-pause" | "focus-resume" | "focus-stop"
     * Written by NotificationActionReceiver; read and cleared by NativeBridge.getPendingAction().
     */
    var pendingFocusAction: String?
        get() = prefs.getString(KEY_PENDING_FOCUS_ACTION, null)
        set(value) = prefs.edit {
            if (value != null) putString(KEY_PENDING_FOCUS_ACTION, value)
            else remove(KEY_PENDING_FOCUS_ACTION)
        }

    // ── Step count cache ────────────────────────────────────────────────────

    /** Cached step count for today, updated by WidgetUpdateWorker. */
    var cachedStepsJson: String?
        get() = prefs.getString(KEY_STEPS_CACHE, null)
        set(value) = prefs.edit { putString(KEY_STEPS_CACHE, value) }

    companion object {
        private const val PREFS_NAME = "dayglance_shared"
        private const val KEY_VAULT_PATH = "obsidian_vault_path"
        private const val KEY_DAILY_NOTE_FOLDER = "obsidian_daily_note_folder"
        private const val KEY_DAILY_NOTE_PATTERN = "obsidian_daily_note_pattern"
        private const val KEY_NEW_NOTES_FOLDER = "obsidian_new_notes_folder"
        private const val KEY_WIDGET_SNAPSHOT = "widget_snapshot"
        private const val KEY_WIDGET_SNAPSHOT_TS = "widget_snapshot_ts"
        private const val KEY_SCHEDULED_REMINDERS = "scheduled_reminders"
        private const val KEY_STEPS_CACHE = "steps_cache"
        private const val KEY_PENDING_COMPLETE = "pending_complete_task_id"
        private const val KEY_PENDING_SNOOZE = "pending_snooze_task_id"
        private const val KEY_PENDING_VOICE_INPUT = "pending_voice_input"
        private const val KEY_PENDING_ADD_TASK = "pending_add_task"
        private const val KEY_PENDING_ADD_INBOX_TASK = "pending_add_inbox_task"
        private const val KEY_PENDING_SHARE = "pending_share_text"
        private const val KEY_PENDING_FOCUS_ACTION = "pending_focus_action"
        private const val KEY_APP_DARK_MODE = "app_dark_mode"

        const val DEFAULT_DAILY_NOTE_PATTERN = "yyyy-MM-dd"
        const val DEFAULT_NEW_NOTES_FOLDER = "dayGLANCE"
    }
}
