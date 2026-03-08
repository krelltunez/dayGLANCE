package com.dayglance.app.bridge

import android.content.Context
import android.webkit.JavascriptInterface
import com.dayglance.app.data.ObsidianRepository

/**
 * Phase 4: Obsidian vault bridge.
 *
 * Exposes vault file I/O to the WebView via window.DayGlanceNative. The vault
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
     * Parses GFM task items from the note at [path] (relative to vault root).
     * Returns a JSON array: [{ "text": "...", "completed": false, "line": 1 }, ...]
     */
    @JavascriptInterface
    fun getTasksFromNote(path: String): String = repository.getTasksFromNote(path)
}
