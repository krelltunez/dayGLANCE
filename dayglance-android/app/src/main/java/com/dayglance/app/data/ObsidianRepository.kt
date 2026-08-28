package com.dayglance.app.data

import android.content.Context
import android.net.Uri
import android.provider.DocumentsContract
import android.util.Log
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

    private companion object { const val TAG = "ObsidianRepository" }

    private val dataStore = SharedDataStore(context)

    /**
     * Post-write chokepoint listener (launch-on-write, Obsidian build-out
     * Phase 1). Every vault write — daily notes, wiki notes, appends — reaches
     * disk through [writeText], so this is the one place a successful write is
     * announced. Invoked with the written file's bare name (no .md).
     * ObsidianBridge wires this to its LaunchOnWritePolicy.
     */
    @Volatile
    var onVaultWrite: ((noteName: String) -> Unit)? = null

    /**
     * Crash-recovery outcome listener (surfacing, not control flow): invoked
     * with 'failed' when a note is missing and its temp could not be restored
     * (SafeReplace RESTORE_FAILED — the one recovery state a user may need to
     * act on), and with 'restored' when a later retry lands, so the surfaced
     * error can clear itself. Successful FIRST-TRY restores are deliberately
     * silent — the note contains exactly what the interrupted write intended.
     * ObsidianBridge wires this to a window event the web app listens on.
     */
    @Volatile
    var onRestoreEvent: ((outcome: String, fileName: String) -> Unit)? = null

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
        // Vault-wide crashed-write recovery rides the index build (which runs
        // on every sync via getAllDailyNotes and on cache misses): any note
        // stranded in a temp anywhere in the tree is healed before indexing.
        recoverStrayTemps(dir)
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
     * True when a vault URI is configured but the persisted SAF grant behind
     * it is gone — the OS or the user revoked it. DocumentFile hides this
     * (listFiles just returns empty on a revoked grant), so this is the only
     * way to tell "the vault is empty" from "we can no longer see the vault
     * at all". The scan uses it to fail loudly instead of reporting an empty
     * vault, and the answer names the user's fix: re-pick the folder.
     */
    private fun vaultGrantRevoked(): Boolean {
        val uriString = dataStore.vaultPath ?: return false
        return try {
            val uri = Uri.parse(uriString)
            context.contentResolver.persistedUriPermissions.none { it.uri == uri && it.isReadPermission }
        } catch (e: Exception) {
            false // can't tell — never invent an error
        }
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

    /**
     * Returns the file's content, or NULL when the read FAILED — a null input
     * stream (the provider refused to open the document). The read-side twin
     * of writeText's contract: "unreadable" must never masquerade as "empty",
     * because an empty read of a listed daily note erases its task keys from
     * the scan, and the deletion detector then tombstones them fleet-wide
     * (within its drop threshold) as if the user had deleted the lines.
     * An IOException propagates to the caller, same outcome.
     */
    private fun readText(file: DocumentFile): String? =
        context.contentResolver.openInputStream(file.uri)?.use {
            it.bufferedReader().readText()
        }

    /**
     * Returns whether the write reached the stream. A null stream (the provider
     * refused to open the document) writes NOTHING and must report false — the
     * JS side gates id/rawTitle bookkeeping on this result, and a false success
     * here would commit app state for a line that never reached the vault.
     * An IOException propagates to the caller's runCatching, same outcome.
     */
    private fun writeText(file: DocumentFile, text: String, announce: Boolean = true): Boolean {
        // Close the BufferedWriter (not just the raw OutputStream) so its internal
        // buffer is flushed to disk before the stream closes.  Closing only the
        // OutputStream while a BufferedWriter wraps it leaves the buffer unflushed,
        // which silently truncates the file to zero bytes.
        val outputStream = context.contentResolver.openOutputStream(file.uri, "wt") ?: return false
        outputStream.use { stream ->
            stream.bufferedWriter().use { writer ->
                writer.write(text)
            }
        }
        // Announce only a write that actually reached the stream (a null stream
        // above wrote nothing and must not wake Obsidian). Crash-safe replaces
        // pass announce = false for their intermediate temp write and announce
        // the FINAL name once the rename lands (replaceText below) — announcing
        // here would arm launch-on-write with the hidden temp's name.
        if (announce) {
            val noteName = file.name?.removeSuffix(".md")
            if (noteName != null) onVaultWrite?.invoke(noteName)
        }
        return true
    }

    // ── Crash-safe replacement (SafeReplace) ─────────────────────────────────
    //
    // The temp/delete/rename orchestration and its recovery rule live in
    // SafeReplace.kt (pure, JVM-tested); this section binds them to
    // DocumentFile. Every write path that knows its parent DIRECTORY goes
    // through replaceText; recovery hooks run at every point a note file is
    // resolved, so a crashed write is healed before anything reads, lists, or
    // rewrites the file — the temp dance runs exactly where recovery can see.

    private inner class SafDir(private val dir: DocumentFile) : SafeReplace.Dir {
        override fun exists(name: String) = dir.findFile(name) != null
        override fun createAndWrite(name: String, text: String): Boolean {
            // octet-stream for the temp: providers only append an extension
            // when the MIME maps to one, so the exact display name survives.
            val mime = if (name.endsWith(".md")) "text/markdown" else "application/octet-stream"
            val created = dir.createFile(mime, name) ?: return false
            if (created.name != name) {
                // Provider mangled the name — the rename step could never
                // find it again. Back out and let the caller fall back.
                created.delete()
                return false
            }
            return writeText(created, text, announce = false)
        }
        override fun delete(name: String) = dir.findFile(name)?.delete() ?: true
        override fun rename(from: String, to: String): Boolean {
            val f = dir.findFile(from) ?: return false
            return try { f.renameTo(to) && f.name == to } catch (e: Exception) { false }
        }
        override fun read(name: String): String? = dir.findFile(name)?.let { readText(it) }
    }

    /**
     * Crash-safe create-or-replace of [fileName] in [dir]; announces the FINAL
     * name on success (the one announce for the whole logical write).
     */
    private fun replaceText(dir: DocumentFile, fileName: String, text: String): Boolean {
        val ok = SafeReplace.replace(SafDir(dir), fileName, text)
        if (ok) onVaultWrite?.invoke(fileName.removeSuffix(".md"))
        return ok
    }

    /**
     * Heal any crashed-write residue for [fileName] before it is read or
     * rewritten. A restored note is announced (its content never reached
     * Obsidian — the crash killed the write's own announce) and logged; the
     * surviving content is the note as the interrupted write intended it.
     */
    private fun recoverIn(dir: DocumentFile, fileName: String): SafeReplace.Recovery {
        val outcome = SafeReplace.recover(SafDir(dir), fileName)
        when (outcome) {
            SafeReplace.Recovery.DISCARDED_STALE_TEMP ->
                Log.w(TAG, "Discarded stale temp of crashed write for $fileName (original intact)")
            SafeReplace.Recovery.RESTORED_FROM_TEMP -> {
                Log.w(TAG, "Restored $fileName from crashed write's temp")
                onVaultWrite?.invoke(fileName.removeSuffix(".md"))
                // Lets a previously SURFACED restore failure clear itself; a
                // first-try restore stays silent (the JS listener ignores
                // 'restored' unless a failure is latched).
                onRestoreEvent?.invoke("restored", fileName)
            }
            SafeReplace.Recovery.RESTORE_FAILED -> {
                Log.e(TAG, "Could not restore $fileName from crashed write's temp; leaving temp in place")
                onRestoreEvent?.invoke("failed", fileName)
            }
            SafeReplace.Recovery.NONE -> {}
        }
        return outcome
    }

    /**
     * Sweep one directory listing for crashed-write temps and heal each.
     * Returns true when anything was recovered (callers re-list). Hooked into
     * the traversals that enumerate notes, so orphaned content resurfaces on
     * the next sync even if its own file is never individually touched.
     */
    private fun recoverStrayTemps(dir: DocumentFile): Boolean {
        var recovered = false
        for (file in dir.listFiles()) {
            val name = file.name ?: continue
            if (!SafeReplace.isTempName(name)) continue
            if (recoverIn(dir, SafeReplace.originalNameOf(name)) != SafeReplace.Recovery.NONE) recovered = true
        }
        return recovered
    }

    /**
     * Best-effort tree directory for an index-resolved file URI, so bare-name
     * wiki-note overwrites can use the crash-safe replace. Document ids on
     * ExternalStorageProvider (every real vault — Obsidian requires a local
     * folder) are path-based: `<rootDocId>/<relative path>`. Anything that
     * doesn't match that shape returns null and the caller falls back to the
     * in-place write.
     */
    private fun treeDirOf(fileUri: Uri): DocumentFile? = try {
        val root = vaultRoot()
        if (root == null) null else {
            val rootId = DocumentsContract.getDocumentId(root.uri)
            val docId = DocumentsContract.getDocumentId(fileUri)
            if (!docId.startsWith("$rootId/")) null else {
                val parentSegments = docId.removePrefix("$rootId/").split("/").dropLast(1)
                if (parentSegments.isEmpty()) root else root.navigateTo(parentSegments.joinToString("/"))
            }
        }
    } catch (e: Exception) {
        null
    }

    // ── Public API ───────────────────────────────────────────────────────────

    /**
     * Returns the raw markdown content of the daily note for [date] (ISO: yyyy-MM-dd).
     *
     * READ CONTRACT: "" means the note is DETERMINATELY absent or empty (the
     * folder was listed, no such file — or the file is genuinely empty);
     * NULL means the answer could not be determined — vault unconfigured, an
     * invalid date/pattern, an unnavigable folder, or a read failure. The JS
     * side must never treat null as an empty note: an "empty" daily note
     * erases its tasks from the scan and arms the deletion detector.
     */
    fun getDailyNote(date: String): String? {
        val root = vaultRoot() ?: return null
        val folder = dataStore.dailyNoteFolder
        val pattern = dataStore.dailyNotePattern

        val localDate = try {
            LocalDate.parse(date)
        } catch (e: DateTimeParseException) {
            return null
        }
        val formatter = try {
            DateTimeFormatter.ofPattern(pattern)
        } catch (e: IllegalArgumentException) {
            return null
        }

        val fileName = "${localDate.format(formatter)}.md"
        val dir = if (folder.isBlank()) root else (root.navigateTo(folder) ?: return null)
        // Heal a crashed write first: without this, the post-delete crash
        // window reads as "note gone" — which the deletion detector upstream
        // would treat as a real vault deletion.
        recoverIn(dir, fileName)
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
        fun collect(d: DocumentFile, pathPrefix: String) {
            recoverStrayTemps(d)
            for (file in d.listFiles()) {
                val name = file.name ?: continue
                if (name.startsWith('.')) continue
                if (file.isFile && name.endsWith(".md")) {
                    arr.put(pathPrefix + name)
                } else if (file.isDirectory) {
                    collect(file, "$pathPrefix$name/")
                }
            }
        }
        collect(dir, prefix)
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

        // Heal any crashed write FIRST — resolving the file before recovery
        // could read a freshly-created empty original while the real content
        // sits in a temp, and the append would then wipe the note.
        recoverIn(dir, fileName)
        // A FAILED read of an existing note must abort the append: treating
        // it as "" would rewrite the note as just the appended line — erasing
        // its content. An absent file is genuinely "" (fresh note).
        val existingFile = dir.findFile(fileName)
        val existing = if (existingFile != null) (readText(existingFile) ?: return false) else ""
        // Ensure a newline separator before the new content
        val separator = if (existing.isNotEmpty() && !existing.endsWith("\n")) "\n" else ""
        replaceText(dir, fileName, "$existing$separator$content")
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
        replaceText(dir, fileName, content)
    }.getOrDefault(false)

    /**
     * Returns a JSON array of all daily notes in [folder] at or after [cutoff] (yyyy-MM-dd).
     * Each entry: { "date": "yyyy-MM-dd", "text": "<markdown content>", "lastModified": "<ISO-8601>" }.
     * Pass an empty [cutoff] to return all notes.
     * Returns "[]" if the vault isn't configured or the folder doesn't exist.
     *
     * READ CONTRACT — this is the scan the deletion detector diffs, so a read
     * that FAILED must never shape the result:
     *   • a LISTED note that cannot be read THROWS (IOException) — an empty
     *     "text" would erase the note's task keys from the scan, and within
     *     the detector's drop threshold those keys would be tombstoned
     *     fleet-wide as user deletions;
     *   • an EMPTY LISTING with the vault's SAF grant revoked THROWS
     *     (SecurityException naming the fix) — DocumentFile hides revocation
     *     as an empty directory, which the detector would treat as a real
     *     (fully) empty vault.
     * The sync bridge propagates the exception; the async wrapper reports it
     * through the error callback. Either way the JS scan fails loudly and is
     * treated as never having happened.
     *
     * Preferred over repeated getDailyNote calls because a single native round trip is
     * far cheaper than N synchronous JS→native calls (each blocking the JS thread).
     */
    fun getAllDailyNotes(folder: String, cutoff: String): String {
        val root = vaultRoot() ?: return "[]"
        val dir = if (folder.isBlank()) root else root.navigateTo(folder)
        if (dir == null) {
            if (vaultGrantRevoked()) throw SecurityException("Vault access has been revoked — re-select the vault folder in Settings")
            return "[]"
        }
        // Sweep crashed-write residue before the listing: a note stuck in the
        // post-delete window would otherwise be missing from this scan, and
        // the deletion detector would read that as a vault deletion.
        recoverStrayTemps(dir)
        val files = dir.listFiles()
        if (files.isEmpty() && vaultGrantRevoked()) {
            throw SecurityException("Vault access has been revoked — re-select the vault folder in Settings")
        }
        val arr = JSONArray()
        files
            .filter { it.isFile && it.name?.endsWith(".md") == true }
            .forEach { file ->
                val name = file.name ?: return@forEach
                val dateStr = name.removeSuffix(".md")
                if (!dateStr.matches(Regex("""\d{4}-\d{2}-\d{2}"""))) return@forEach
                if (cutoff.isNotBlank() && dateStr < cutoff) return@forEach
                val text = readText(file)
                    ?: throw java.io.IOException("Could not read daily note $name from the vault")
                arr.put(JSONObject().apply {
                    put("date", dateStr)
                    put("text", text)
                    // The file's REAL modification time, so the web frontend's merge
                    // uses a truthful last-writer-wins timestamp instead of stamping
                    // every scanned note as "now". Mirrors getNote() below.
                    put("lastModified", Instant.ofEpochMilli(file.lastModified()).toString())
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
            recoverIn(dir, fileName)
            dir.findFile(fileName) ?: return ""
        } else {
            // Bare name — use the in-memory index for O(1) lookup
            val uri = findNoteUri(segments[0]) ?: return ""
            DocumentFile.fromSingleUri(context, uri) ?: return ""
        }

        // A failed read returns an error envelope (an OBJECT, where success is
        // also an object but with "text") rather than pretending the note is
        // empty — the JS wrapper logs it and reports "not found" upward, but
        // the distinction is on the wire for callers that need it.
        val text = readText(file)
            ?: return JSONObject().apply { put("error", "note read failed") }.toString()
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
        if (segments.size > 1) {
            val folderPath = segments.dropLast(1).joinToString("/")
            val dir = root.navigateOrCreate(folderPath) ?: return false
            return replaceText(dir, fileName, content)
        }
        // Bare name: use the index to find the existing file's directory so
        // the overwrite is crash-safe too; if the note doesn't exist yet,
        // create it in newNotesFolder.
        val existingUri = findNoteUri(noteName)
        val existingFile = existingUri?.let { DocumentFile.fromSingleUri(context, it) }?.takeIf { it.exists() }
        val dir = if (existingFile != null) {
            treeDirOf(existingFile.uri)
                ?: // Provider whose document ids we can't map to a directory:
                   // fall back to the legacy in-place write rather than lose
                   // the write. Crash-safety degrades to pre-existing behavior
                   // on this (unobserved in practice) path.
                   return writeText(existingFile, content)
        } else {
            val folder = dataStore.newNotesFolder
            if (folder.isBlank()) root else (root.navigateOrCreate(folder) ?: return false)
        }
        if (!replaceText(dir, fileName, content)) return false
        // Keep the index truthful: the replace changes the document id on
        // providers with path-based ids (delete + rename mints a new one),
        // and a brand-new note was never indexed at all.
        dir.findFile(fileName)?.let { noteUriIndex[noteName.lowercase()] = it.uri }
        true
    }.getOrDefault(false)

    fun getTasksFromNote(path: String): String {
        val root = vaultRoot() ?: return "[]"
        val segments = path.split("/").filter { it.isNotBlank() }
        if (segments.isEmpty()) return "[]"

        val fileName = segments.last()
        val folderPath = segments.dropLast(1).joinToString("/")
        val dir = if (folderPath.isBlank()) root else (root.navigateTo(folderPath) ?: return "[]")
        recoverIn(dir, fileName)
        val file = dir.findFile(fileName) ?: return "[]"

        // Failed read → error envelope (object, not array); the JS wrapper
        // maps it to null so no caller mistakes "unreadable" for "no tasks".
        val noteText = readText(file)
            ?: return JSONObject().apply { put("error", "note read failed") }.toString()
        val taskRegex = Regex("""^- \[([xX ])] (.+)$""")
        val arr = JSONArray()
        noteText.lines().forEachIndexed { index, line ->
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
