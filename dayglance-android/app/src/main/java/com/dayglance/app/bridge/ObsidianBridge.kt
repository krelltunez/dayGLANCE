package com.dayglance.app.bridge

import android.content.Context
import android.webkit.JavascriptInterface

/**
 * Phase 4: Obsidian vault bridge.
 *
 * Reads and writes markdown files in the user's Obsidian vault. The vault
 * root path is configured in SettingsActivity and stored in SharedPreferences.
 *
 * Unlike the PWA (which uses the File System Access API), the native app can
 * read/write vault files directly from the file system.
 *
 * TODO Phase 4: implement with ObsidianRepository
 */
class ObsidianBridge(private val context: Context) {

    @JavascriptInterface
    fun getDailyNote(date: String): String {
        // TODO Phase 4: ObsidianRepository.getDailyNote(date)
        // Returns raw markdown content of the daily note, or "" if not found
        return ""
    }

    @JavascriptInterface
    fun listNotes(folder: String): String {
        // TODO Phase 4: ObsidianRepository.listNotes(folder)
        // Returns JSON array of note paths relative to vault root
        return "[]"
    }

    @JavascriptInterface
    fun appendToNote(path: String, content: String): Boolean {
        // TODO Phase 4: ObsidianRepository.appendToNote(path, content)
        return false
    }

    @JavascriptInterface
    fun getTasksFromNote(path: String): String {
        // TODO Phase 4: ObsidianRepository.getTasksFromNote(path)
        // Returns JSON array: [{ "text": "...", "completed": false, "line": 12 }]
        return "[]"
    }
}
