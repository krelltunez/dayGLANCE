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

    // ── Obsidian vault path ─────────────────────────────────────────────────

    var vaultPath: String?
        get() = prefs.getString(KEY_VAULT_PATH, null)
        set(value) = prefs.edit { putString(KEY_VAULT_PATH, value) }

    // ── Widget snapshot ─────────────────────────────────────────────────────

    /** JSON snapshot of today's agenda written by the app for the widget to read. */
    var widgetSnapshot: String?
        get() = prefs.getString(KEY_WIDGET_SNAPSHOT, null)
        set(value) = prefs.edit { putString(KEY_WIDGET_SNAPSHOT, value) }

    var widgetSnapshotUpdatedAt: Long
        get() = prefs.getLong(KEY_WIDGET_SNAPSHOT_TS, 0L)
        set(value) = prefs.edit { putLong(KEY_WIDGET_SNAPSHOT_TS, value) }

    // ── Step count cache ────────────────────────────────────────────────────

    /** Cached step count for today, updated by WidgetUpdateWorker. */
    var cachedStepsJson: String?
        get() = prefs.getString(KEY_STEPS_CACHE, null)
        set(value) = prefs.edit { putString(KEY_STEPS_CACHE, value) }

    companion object {
        private const val PREFS_NAME = "dayglance_shared"
        private const val KEY_VAULT_PATH = "obsidian_vault_path"
        private const val KEY_WIDGET_SNAPSHOT = "widget_snapshot"
        private const val KEY_WIDGET_SNAPSHOT_TS = "widget_snapshot_ts"
        private const val KEY_STEPS_CACHE = "steps_cache"
    }
}
