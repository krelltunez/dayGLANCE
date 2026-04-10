package com.dayglance.app.data

import android.content.Context
import android.net.Uri
import androidx.documentfile.provider.DocumentFile
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException
import java.util.concurrent.ConcurrentHashMap

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

    // ── Note URI index ───────────────────────────────────────────────────────
    //
    // SAF recursive search (DocumentFile.listFiles + findFile) is expensive:
    // every call involves IPC with Android's content provider. For a vault
    // with hundreds of notes, a full tree walk on every wikilink tap can
    // take several seconds.
    //
    // The index maps lowercase note name (no .md extension) → document URI so
    // bare-name lookups are O(1) after the one-time build. The index is
    // built automatically at the end of getAllDailyNotes() (which runs on
    // vault sync) and can be triggered explicitly via buildNoteIndex().

    private val noteUriIndex = ConcurrentHashMap<String, Uri>()
    @Volatile private var noteIndexBuilt = false

    /**
     * Scans the vault tree and populates the in-memory note URI index.
     * Safe to call from any thread; subsequent getNote() bare-name lookups
     * complete in O(1) without any SAF traversal.
     */
    @Synchronized fun buildNoteIndex() {
        val root = vaultRoot() ?: return
        val fresh = ConcurrentHashMap<String, Uri>()
        indexDirectory(root, fresh)
        noteUriIndex.clear()
        noteUriIndex.putAll(fresh)
        noteIndexBuilt = true
    }

    private fun indexDirectory(dir: DocumentFile, index: ConcurrentHashMap<String, Uri>) {
        for (file in dir.listFiles()) {
            val name = file.name ?: continue
            if (name.startsWith('.')) continue // skip hidden files/dirs (.obsidian/, .trash/, etc.)
            if (file.isFile && name.endsWith(".md")) {
                index[name.removeSuffix(".md").lowercase()] = file.uri
            } else if (file.isDirectory) {
                indexDirectory(file, index)
            }
        }
    }

    /**
     * Returns the URI for a note by bare name.
     *
     * Checks the in-memory index first (O(1)). On a cache miss — which happens
     * when a note was added to the vault after the last sync — rebuilds the index
     * and tries once more. This keeps the common case fast while still finding
     * notes that were created outside of a sync cycle.
     */
    private fun findNoteUri(noteName: String): Uri? {
        if (!noteIndexBuilt) buildNoteIndex()
        return noteUriIndex[noteName.lowercase()]
            ?: run {
                // Cache miss: note may have been added since last build — rescan and retry
                buildNoteIndex()
                noteUriIndex[noteName.lowercase()]
            }
    }

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
        // Close the BufferedWriter (not just the raw OutputStream) so its internal
        // buffer is flushed to disk before the stream closes.  Closing only the
        // OutputStream while a BufferedWriter wraps it leaves the buffer unflushed,
        // which silently truncates the file to zero bytes.
        context.contentResolver.openOutputStream(file.uri, "wt")?.use { outputStream ->
            outputStream.bufferedWriter().use { writer ->
                writer.write(text)
            }
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
    /**
     * Clears the stored vault URI, resetting the integration to unconfigured state.
     * Does not revoke the SAF permission (the user can re-select the same folder).
     * Also clears the in-memory note index so stale entries don't linger.
     */
    fun clearVault() {
        dataStore.vaultPath = null
        noteUriIndex.clear()
        noteIndexBuilt = false
    }

    /** Returns true if a vault root URI has been configured. */
    fun isVaultConfigured(): Boolean = dataStore.vaultPath != null

    /** Returns the vault folder name (e.g. "MyVault"), or null if not configured. */
    fun getVaultName(): String? = vaultRoot()?.name

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
        put("newNotesFolder", dataStore.newNotesFolder)
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

    /**
     * Returns a JSON array of all daily notes in [folder] at or after [cutoff] (yyyy-MM-dd).
     * Each entry: { "date": "yyyy-MM-dd", "text": "<markdown content>" }.
     * Pass an empty [cutoff] to return all notes.
     * Returns "[]" if the vault isn't configured or the folder doesn't exist.
     *
     * Preferred over repeated getDailyNote calls because a single native round trip is
     * far cheaper than N synchronous JS→native calls (each blocking the JS thread).
     */
    fun getAllDailyNotes(folder: String, cutoff: String): String {
        val root = vaultRoot() ?: return "[]"
        val dir = if (folder.isBlank()) root else (root.navigateTo(folder) ?: return "[]")
        val arr = JSONArray()
        dir.listFiles()
            .filter { it.isFile && it.name?.endsWith(".md") == true }
            .forEach { file ->
                val name = file.name ?: return@forEach
                val dateStr = name.removeSuffix(".md")
                if (!dateStr.matches(Regex("""\d{4}-\d{2}-\d{2}"""))) return@forEach
                if (cutoff.isNotBlank() && dateStr < cutoff) return@forEach
                arr.put(JSONObject().apply {
                    put("date", dateStr)
                    put("text", readText(file))
                })
            }
        // Pre-warm the note URI index on the same sync pass so bare-name
        // wikilink lookups are instant when the user opens a task note panel.
        if (!noteIndexBuilt) buildNoteIndex()
        return arr.toString()
    }

    /**
     * Returns the raw markdown content and last-modified timestamp of the note at [path]
     * (relative to vault root, without the .md extension).
     *
     * If [path] contains slashes (e.g. "Folder/My Note") the exact path is used.
     * If [path] is a bare name (e.g. "My Note") the entire vault is searched recursively,
     * mirroring how Obsidian resolves wikilinks.
     *
     * Returns JSON: { "text": "<markdown>", "lastModified": "<ISO-8601>" }
     * Returns "" if vault isn't configured or the note doesn't exist.
     */
    fun getNote(path: String): String {
        val root = vaultRoot() ?: return ""
        val segments = path.split("/").filter { it.isNotBlank() }
        if (segments.isEmpty()) return ""

        val fileName = "${segments.last()}.md"
        val file = if (segments.size > 1) {
            // Explicit path — navigate directly (no index needed)
            val folderPath = segments.dropLast(1).joinToString("/")
            val dir = root.navigateTo(folderPath) ?: return ""
            dir.findFile(fileName) ?: return ""
        } else {
            // Bare name — use the in-memory index for O(1) lookup
            val uri = findNoteUri(segments[0]) ?: return ""
            DocumentFile.fromSingleUri(context, uri) ?: return ""
        }

        val text = readText(file)
        val lastModified = Instant.ofEpochMilli(file.lastModified()).toString()
        return JSONObject().apply {
            put("text", text)
            put("lastModified", lastModified)
        }.toString()
    }

    /**
     * Creates or overwrites the note at [path] (relative to vault root, without .md extension)
     * with [content].
     *
     * If [path] contains slashes (e.g. "Folder/My Note") the exact path is used and any
     * missing parent directories are created. If [path] is a bare name the vault is searched
     * first so edits land in the file's actual location; if not found the file is created at
     * the vault root — mirroring how web's writeWikiNote() behaves.
     *
     * Returns false if the vault isn't configured or a write error occurs.
     */
    fun writeNote(path: String, content: String): Boolean = runCatching {
        val root = vaultRoot() ?: return false
        val segments = path.split("/").filter { it.isNotBlank() }
        if (segments.isEmpty()) return false

        val noteName = segments.last()
        val fileName = "$noteName.md"
        val file = if (segments.size > 1) {
            val folderPath = segments.dropLast(1).joinToString("/")
            val dir = root.navigateOrCreate(folderPath) ?: return false
            dir.findFile(fileName)
                ?: dir.createFile("text/markdown", fileName)
                ?: return false
        } else {
            // Use the index to find the existing file; if not found create in newNotesFolder
            val existingUri = findNoteUri(noteName)
            val existingFile = existingUri?.let { DocumentFile.fromSingleUri(context, it) }
            existingFile?.takeIf { it.exists() }
                ?: run {
                    val folder = dataStore.newNotesFolder
                    val dir = if (folder.isBlank()) root
                              else (root.navigateOrCreate(folder) ?: return false)
                    (dir.createFile("text/markdown", fileName) ?: return false).also { created ->
                        // Keep the index up-to-date so the new file is found on next getNote()
                        noteUriIndex[noteName.lowercase()] = created.uri
                    }
                }
        }

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
