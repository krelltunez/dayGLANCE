package com.dayglance.app.bridge

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
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
class ObsidianBridge(private val context: Context, private val webView: android.webkit.WebView? = null) {

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
     * Non-blocking version of getAllDailyNotes. Returns immediately and dispatches the
     * result (or error) back to JS via window.__obsidianDispatch(callbackId, json, error).
     *
     * [callbackId] must be alphanumeric + underscore, max 32 chars — validated before use.
     */
    @JavascriptInterface
    fun getAllDailyNotesAsync(folder: String, cutoff: String, callbackId: String) {
        // Validate callbackId to prevent JS injection via the interpolated eval string.
        if (callbackId.length > 32 || !callbackId.matches(Regex("[a-z0-9_]+"))) {
            return
        }
        Thread {
            try {
                val json = repository.getAllDailyNotes(folder, cutoff)
                // Escape backslashes and backticks that could break the JS template literal.
                // The result is a JSON string so only ` and \ need escaping before eval.
                val safe = json.replace("\\", "\\\\").replace("`", "\\`")
                webView?.post {
                    webView.evaluateJavascript(
                        "window.__obsidianDispatch('$callbackId',`$safe`,null)",
                        null
                    )
                }
            } catch (e: Exception) {
                val msg = (e.message ?: "error").replace("'", "\\'")
                webView?.post {
                    webView.evaluateJavascript(
                        "window.__obsidianDispatch('$callbackId',null,'$msg')",
                        null
                    )
                }
            }
        }.start()
    }

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
     * Opens [noteName] (e.g. "My Note" or "folder/My Note") in the Obsidian app
     * using the obsidian:// URI scheme. The vault name is derived from the configured
     * vault root folder. Silently does nothing if Obsidian isn't installed.
     */
    @JavascriptInterface
    fun openNote(noteName: String) {
        val vaultName = repository.getVaultName() ?: return
        val uri = Uri.Builder()
            .scheme("obsidian")
            .authority("open")
            .appendQueryParameter("vault", vaultName)
            .appendQueryParameter("file", noteName)
            .build()
        val intent = Intent(Intent.ACTION_VIEW, uri).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        try {
            context.startActivity(intent)
        } catch (_: ActivityNotFoundException) {
            // Obsidian not installed — silently ignore
        }
    }

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

    /**
     * Returns the content and last-modified timestamp of the note at [path]
     * (relative to vault root, without .md extension).
     *
     * Bare names (e.g. "My Note") are resolved by searching the vault recursively,
     * mirroring Obsidian's own wikilink resolution. Explicit paths (e.g. "Folder/My Note")
     * are navigated directly.
     *
     * Returns JSON: { "text": "<markdown>", "lastModified": "<ISO-8601>" }
     * Returns "" if vault isn't configured or the note doesn't exist.
     */
    @JavascriptInterface
    fun getNote(path: String): String = repository.getNote(path)

    /**
     * Creates or overwrites the note at [path] (relative to vault root, without .md extension)
     * with [content]. For bare names the vault is searched first; if not found the file is
     * created at the vault root.
     * Returns false if the vault isn't configured or a write error occurs.
     */
    @JavascriptInterface
    fun writeNote(path: String, content: String): Boolean = repository.writeNote(path, content)

    /**
     * Builds (or rebuilds) the in-memory note URI index by scanning the vault tree.
     * After this returns, bare-name getNote() calls are O(1).
     * Automatically called at the end of getAllDailyNotes(); call explicitly when
     * the vault has changed outside of a normal sync cycle.
     */
    @JavascriptInterface
    fun buildNoteIndex() = repository.buildNoteIndex()

    /**
     * Clears the stored vault URI so the integration returns to unconfigured state.
     * Does NOT revoke the SAF permission — the user can re-select the same folder.
     */
    @JavascriptInterface
    fun clearVault() = repository.clearVault()
}
