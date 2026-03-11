package com.dayglance.app.data

import android.content.Context
import android.net.Uri
import androidx.documentfile.provider.DocumentFile
import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException

/**
 * Phase 4: Reads and writes markdown files in the user's Obsidian vault via
 * the Storage Access Framework (SAF).
 *
 * The vault root is a persisted tree URI stored in SharedDataStore.vaultPath.
 * All file navigation uses DocumentFile so it works on Android 10+ scoped storage.
 *
 * Daily note location = <vault root>/<dailyNoteFolder>/<date formatted by dailyNotePattern>.md
 * Both folder and pattern are configurable in SettingsActivity.
 */
class ObsidianRepository(private val context: Context) {

    private val dataStore = SharedDataStore(context)

    // ── Internal helpers ─────────────────────────────────────────────────────

    private fun vaultRoot(): DocumentFile? {
        val uriString = dataStore.vaultPath ?: return null
        return DocumentFile.fromTreeUri(context, Uri.parse(uriString))
    }

    /**
     * Traverses from this DocumentFile to a relative path such as "Daily Notes/2026"
     * by walking each path segment. Returns null if any segment is missing.
     */
    private fun DocumentFile.navigateTo(relativePath: String): DocumentFile? {
        if (relativePath.isBlank()) return this
        var current: DocumentFile = this
        for (segment in relativePath.split("/").filter { it.isNotBlank() }) {
            current = current.findFile(segment) ?: return null
        }
        return current
    }

    /**
     * Like [navigateTo] but creates missing directories along the way.
     */
    private fun DocumentFile.navigateOrCreate(relativePath: String): DocumentFile? {
        if (relativePath.isBlank()) return this
        var current: DocumentFile = this
        for (segment in relativePath.split("/").filter { it.isNotBlank() }) {
            current = current.findFile(segment)
                ?: current.createDirectory(segment)
                ?: return null
        }
        return current
    }

    private fun readText(file: DocumentFile): String =
        context.contentResolver.openInputStream(file.uri)?.use {
            it.bufferedReader().readText()
        } ?: ""

    private fun writeText(file: DocumentFile, text: String) {
        context.contentResolver.openOutputStream(file.uri, "wt")?.use {
            it.bufferedWriter().write(text)
        }
    }

    // ── Public API ───────────────────────────────────────────────────────────

    /**
     * Returns the raw markdown content of the daily note for [date] (ISO: yyyy-MM-dd).
     * Returns "" if vault isn't configured, the folder is missing, or the note doesn't exist.
     */
    fun getDailyNote(date: String): String {
        val root = vaultRoot() ?: return ""
        val folder = dataStore.dailyNoteFolder
        val pattern = dataStore.dailyNotePattern

        val localDate = try {
            LocalDate.parse(date)
        } catch (e: DateTimeParseException) {
            return ""
        }
        val formatter = try {
            DateTimeFormatter.ofPattern(pattern)
        } catch (e: IllegalArgumentException) {
            return ""
        }

        val fileName = "${localDate.format(formatter)}.md"
        val dir = if (folder.isBlank()) root else (root.navigateTo(folder) ?: return "")
        val file = dir.findFile(fileName) ?: return ""
        return readText(file)
    }

    /**
     * Returns a JSON array of note filenames in [folder] (relative to vault root).
     * Each entry is the path relative to the vault root, e.g. "Daily Notes/2026-03-08.md".
     * Returns "[]" if the vault isn't configured or the folder doesn't exist.
     */
    fun listNotes(folder: String): String {
        val root = vaultRoot() ?: return "[]"
        val dir = if (folder.isBlank()) root else (root.navigateTo(folder) ?: return "[]")
        val prefix = if (folder.isBlank()) "" else "$folder/"
        val arr = JSONArray()
        dir.listFiles()
            .filter { it.isFile && it.name?.endsWith(".md") == true }
            .sortedByDescending { it.name }
            .forEach { arr.put(prefix + it.name) }
        return arr.toString()
    }

    /**
     * Appends [content] to the note at [path] (relative to vault root).
     * Creates the file (and any missing parent directories) if needed.
     * Returns false if the vault isn't configured or a write error occurs.
     */
    fun appendToNote(path: String, content: String): Boolean = runCatching {
        val root = vaultRoot() ?: return false
        val segments = path.split("/").filter { it.isNotBlank() }
        if (segments.isEmpty()) return false

        val fileName = segments.last()
        val folderPath = segments.dropLast(1).joinToString("/")
        val dir = if (folderPath.isBlank()) root
                  else (root.navigateOrCreate(folderPath) ?: return false)

        val file = dir.findFile(fileName)
            ?: dir.createFile("text/markdown", fileName)
            ?: return false

        val existing = readText(file)
        // Ensure a newline separator before the new content
        val separator = if (existing.isNotEmpty() && !existing.endsWith("\n")) "\n" else ""
        writeText(file, "$existing$separator$content")
        true
    }.getOrDefault(false)

    /**
     * Parses GFM-style task items from the note at [path] (relative to vault root).
     * Returns a JSON array: [{ "text": "...", "completed": false, "line": 1 }, ...]
     * Line numbers are 1-based.
     */
    /** Returns true if a vault root URI has been configured. */
    fun isVaultConfigured(): Boolean = dataStore.vaultPath != null

    /**
     * Returns a JSON object with the current vault configuration:
     *   { configured: Boolean, folder: String, pattern: String }
     * The web frontend calls this on Android to detect vault state and
     * synchronise the dailyNotesPath it uses for native bridge calls.
     */
    fun getVaultConfig(): String = JSONObject().apply {
        put("configured", dataStore.vaultPath != null)
        put("folder", dataStore.dailyNoteFolder)
        put("pattern", dataStore.dailyNotePattern)
    }.toString()

    /**
     * Creates or overwrites the daily note for [date] (ISO: yyyy-MM-dd) with [content].
     * Creates the daily note folder and file if they don't already exist.
     * Returns false if the vault isn't configured or a write error occurs.
     */
    fun writeDailyNote(date: String, content: String): Boolean = runCatching {
        val root = vaultRoot() ?: return false
        val folder = dataStore.dailyNoteFolder
        val pattern = dataStore.dailyNotePattern

        val localDate = try {
            LocalDate.parse(date)
        } catch (e: DateTimeParseException) {
            return false
        }
        val formatter = try {
            DateTimeFormatter.ofPattern(pattern)
        } catch (e: IllegalArgumentException) {
            return false
        }

        val fileName = "${localDate.format(formatter)}.md"
        val dir = if (folder.isBlank()) root else (root.navigateOrCreate(folder) ?: return false)
        val file = dir.findFile(fileName)
            ?: dir.createFile("text/markdown", fileName)
            ?: return false

        writeText(file, content)
        true
    }.getOrDefault(false)

    fun getTasksFromNote(path: String): String {
        val root = vaultRoot() ?: return "[]"
        val segments = path.split("/").filter { it.isNotBlank() }
        if (segments.isEmpty()) return "[]"

        val fileName = segments.last()
        val folderPath = segments.dropLast(1).joinToString("/")
        val dir = if (folderPath.isBlank()) root else (root.navigateTo(folderPath) ?: return "[]")
        val file = dir.findFile(fileName) ?: return "[]"

        val taskRegex = Regex("""^- \[([xX ])] (.+)$""")
        val arr = JSONArray()
        readText(file).lines().forEachIndexed { index, line ->
            val match = taskRegex.find(line.trim()) ?: return@forEachIndexed
            arr.put(JSONObject().apply {
                put("text", match.groupValues[2])
                put("completed", match.groupValues[1].equals("x", ignoreCase = true))
                put("line", index + 1)
            })
        }
        return arr.toString()
    }
}
