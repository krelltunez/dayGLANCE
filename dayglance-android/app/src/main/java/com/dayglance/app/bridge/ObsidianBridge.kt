package com.dayglance.app.bridge

import android.content.Context
import android.webkit.JavascriptInterface
import com.dayglance.app.data.ObsidianRepository

/**
 * Phase 4: Obsidian vault bridge.
 *
 * Exposes vault file I/O to the WebView via window.DayGlanceObsidian. The vault
 * root URI and daily note settings are configured in SettingsActivity.
 *
 * All methods run synchronously on the JavascriptInterface background thread —
 * SAF I/O is acceptable here since it's typically fast for local storage.
 */
class ObsidianBridge(private val context: Context) {

    private val repository = ObsidianRepository(context)

    /**
     * Returns the raw markdown content of the daily note for [date] (ISO: yyyy-MM-dd).
     * Returns "" if vault isn't configured or the note doesn't exist.
     */
    @JavascriptInterface
    fun getDailyNote(date: String): String = repository.getDailyNote(date)

    /**
     * Returns a JSON array of note paths (relative to vault root) in [folder].
     * Returns "[]" if vault isn't configured or the folder doesn't exist.
     */
    @JavascriptInterface
    fun listNotes(folder: String): String = repository.listNotes(folder)

    /**
     * Appends [content] to the note at [path] (relative to vault root).
     * Creates the file and any missing parent directories if needed.
     * Returns false if the vault isn't configured or a write error occurs.
     */
    @JavascriptInterface
    fun appendToNote(path: String, content: String): Boolean =
        repository.appendToNote(path, content)

    /**
     * Returns a JSON array of all daily notes in [folder] on or after [cutoff] (yyyy-MM-dd).
     * Each entry: { "date": "yyyy-MM-dd", "text": "<markdown>" }.
     * Pass an empty string for [cutoff] to return all notes.
     *
     * Preferred over repeated getDailyNote calls: a single native round trip avoids
     * blocking the JS thread N times during vault sync.
     */
    @JavascriptInterface
    fun getAllDailyNotes(folder: String, cutoff: String): String =
        repository.getAllDailyNotes(folder, cutoff)

    /**
     * Parses GFM task items from the note at [path] (relative to vault root).
     * Returns a JSON array: [{ "text": "...", "completed": false, "line": 1 }, ...]
     */
    @JavascriptInterface
    fun getTasksFromNote(path: String): String = repository.getTasksFromNote(path)

    /** Returns true if the vault root URI has been configured via SettingsActivity. */
    @JavascriptInterface
    fun isVaultConfigured(): Boolean = repository.isVaultConfigured()

    /**
     * Returns JSON: { configured: Boolean, folder: String, pattern: String }.
     * Called by the web frontend on Android startup to detect vault state and
     * learn which daily-note sub-folder has been set natively.
     */
    @JavascriptInterface
    fun getVaultConfig(): String = repository.getVaultConfig()

    /**
     * Creates or overwrites the daily note for [date] (ISO: yyyy-MM-dd) with [content].
     * Returns false if the vault isn't configured or a write error occurs.
     */
    @JavascriptInterface
    fun writeDailyNote(date: String, content: String): Boolean =
        repository.writeDailyNote(date, content)
}
