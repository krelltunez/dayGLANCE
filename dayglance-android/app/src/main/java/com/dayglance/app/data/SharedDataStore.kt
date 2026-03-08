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
        private const val KEY_WIDGET_SNAPSHOT = "widget_snapshot"
        private const val KEY_WIDGET_SNAPSHOT_TS = "widget_snapshot_ts"
        private const val KEY_SCHEDULED_REMINDERS = "scheduled_reminders"
        private const val KEY_STEPS_CACHE = "steps_cache"
        private const val KEY_PENDING_COMPLETE = "pending_complete_task_id"

        const val DEFAULT_DAILY_NOTE_PATTERN = "yyyy-MM-dd"
    }
}
