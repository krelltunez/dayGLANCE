package com.dayglance.app.data

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Log
import androidx.documentfile.provider.DocumentFile
import org.json.JSONObject

/**
 * Direct Access sync (docs/direct-access-sync.md): the folder half on Android.
 *
 * The user picks a folder through the Storage Access Framework and the
 * persisted grant keeps it across reboots, exactly as the Obsidian vault is
 * held (ObsidianRepository). The web layer reads and writes dayglance-sync.json
 * in it and a third-party app mirrors the folder between devices. Only an app
 * that mirrors to a real local folder works here — Syncthing, FolderSync,
 * Autosync — because the Google Drive and Dropbox apps do not offer a folder
 * tree to the picker.
 *
 * Reads are classified by [DirectAccessRead] (pure, JVM-tested) over a
 * DocumentFile-backed source. Writes go through [SafeReplace] so a crash
 * mid-write cannot leave a torn file for the syncing app to ship everywhere;
 * every read heals a crashed write first. An unchanged file (same
 * lastModified and length) is served from a cache rather than re-read.
 */
class DirectAccessRepository(private val context: Context) {

    private val dataStore = SharedDataStore(context)

    // Read on the bridge's worker thread, cleared from the picker's (main) thread.
    @Volatile private var cache: Cached? = null
    private data class Cached(val lastModified: Long, val length: Long, val text: String)

    // ── Folder ───────────────────────────────────────────────────────────────

    fun isConfigured(): Boolean = dataStore.directAccessPath != null

    /** Records the picked tree. The caller has already taken the persistable grant. */
    fun setFolder(uri: Uri) {
        dataStore.directAccessPath = uri.toString()
        cache = null
    }

    /** Forgets the folder and releases the grant; the file in it is left alone. */
    fun clearFolder() {
        val uriString = dataStore.directAccessPath
        // A persisted grant belongs to the URI, not to the feature that took
        // it: when the sync folder is the same tree as the Obsidian vault
        // (one picker each, the same folder chosen in both), releasing it here
        // would revoke the vault's access too, and the Obsidian card would
        // report the vault unreachable with nothing left to fix but a re-pick.
        if (uriString != null && !GrantSharing.stillInUse(uriString, dataStore.vaultPath)) {
            try {
                context.contentResolver.releasePersistableUriPermission(
                    Uri.parse(uriString),
                    Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION,
                )
            } catch (e: Exception) {
                // Not held any more — nothing to release.
            }
        }
        dataStore.directAccessPath = null
        cache = null
    }

    private fun root(): DocumentFile? {
        val uriString = dataStore.directAccessPath ?: return null
        return try { DocumentFile.fromTreeUri(context, Uri.parse(uriString)) } catch (e: Exception) { null }
    }

    /**
     * True when a tree URI is stored but the persisted grant behind it is gone.
     * DocumentFile hides this (listFiles just returns empty), so this is the only
     * way to tell "the folder is empty" from "we can no longer see it at all".
     */
    private fun grantRevoked(): Boolean {
        val uriString = dataStore.directAccessPath ?: return false
        return try {
            val uri = Uri.parse(uriString)
            context.contentResolver.persistedUriPermissions.none { it.uri == uri && it.isReadPermission && it.isWritePermission }
        } catch (e: Exception) {
            false // can't tell — never invent an error
        }
    }

    private fun folderReachable(root: DocumentFile?): Boolean =
        root != null && !grantRevoked() && try { root.exists() && root.isDirectory } catch (e: Exception) { false }

    /** { configured, name, path, reachable } — the shape the web transport consumes. */
    fun status(): JSONObject {
        val root = root()
        val configured = isConfigured()
        return JSONObject().apply {
            put("configured", configured)
            put("name", if (configured) (root?.name ?: JSONObject.NULL) else JSONObject.NULL)
            put("path", dataStore.directAccessPath ?: JSONObject.NULL)
            put("reachable", configured && folderReachable(root))
        }
    }

    // ── Snapshot ─────────────────────────────────────────────────────────────

    /** The classified read as JSON (see DirectAccessRead). */
    fun read(): String {
        val root = root()
        if (root != null && folderReachable(root)) {
            // Heal a crashed write before anything reads the file.
            recover(root)
        }
        val source = SafSource(root)
        val result = DirectAccessRead.classify(source)
        return DirectAccessRead.toJson(result)
    }

    /** Crash-safe create-or-replace of the snapshot. */
    fun write(text: String): Boolean {
        val root = root() ?: return false
        if (!folderReachable(root)) return false
        cache = null
        return try {
            SafeReplace.replace(SafDir(root), DirectAccessRead.SYNC_FILE, text)
        } catch (e: Exception) {
            Log.w(TAG, "write failed: ${e.message}")
            false
        }
    }

    /** Deletes the snapshot (reset scope "everywhere"). A missing file counts as deleted. */
    fun delete(): Boolean {
        val root = root() ?: return false
        if (!folderReachable(root)) return false
        cache = null
        return try {
            root.child(DirectAccessRead.SYNC_FILE)?.delete() ?: true
        } catch (e: Exception) {
            false
        }
    }

    // ── Files by path (Phase 5: the household roster; Phase 7: intents) ──────
    //
    // Every path is relative to the folder and confined to it by
    // DirectAccessPath; the walk is one child lookup per segment, which
    // never leaves the tree the grant covers. The snapshot calls above are
    // untouched.

    /** The directory at [segments], created on the way when [create]; null when missing or not a directory. */
    private fun dirAt(root: DocumentFile, segments: List<String>, create: Boolean): DocumentFile? {
        var dir = root
        for (seg in segments) {
            val next = try { dir.child(seg) } catch (e: Exception) { null }
            dir = when {
                next != null && next.isDirectory -> next
                next != null -> return null
                create -> (try { dir.createDirectory(seg) } catch (e: Exception) { null }) ?: return null
                else -> return null
            }
        }
        return dir
    }

    /** JSON array of the file names in the directory ([] when it is missing), or "null" when the folder is unusable or the path escapes it. */
    fun listFiles(rel: String?): String {
        val root = root()
        val segments = DirectAccessPath.segments(rel)
        if (root == null || !folderReachable(root) || segments == null) return "null"
        val dir = dirAt(root, segments, create = false) ?: return "[]"
        return try {
            org.json.JSONArray(dir.children().filter { it.isFile }.map { it.name }).toString()
        } catch (e: Exception) {
            "null"
        }
    }

    /** The classified read of the file at [rel] as JSON, the way [read] classifies the snapshot. */
    fun readFile(rel: String?): String {
        val root = root()
        val segments = DirectAccessPath.fileSegments(rel)
            ?: return DirectAccessRead.toJson(DirectAccessRead.Result.Error("path outside the folder"))
        val name = segments.last()
        val parent = if (root != null && folderReachable(root)) dirAt(root, segments.dropLast(1), create = false) else null
        val source = PathSource(root, parent, name)
        return DirectAccessRead.toJson(DirectAccessRead.classify(source, name))
    }

    /** Crash-safe create-or-replace of the file at [rel], creating its directories. */
    fun writeFile(rel: String?, text: String): Boolean {
        val root = root() ?: return false
        if (!folderReachable(root)) return false
        val segments = DirectAccessPath.fileSegments(rel) ?: return false
        val parent = dirAt(root, segments.dropLast(1), create = true) ?: return false
        return try {
            SafeReplace.replace(SafDir(parent), segments.last(), text)
        } catch (e: Exception) {
            Log.w(TAG, "writeFile failed: ${e.message}")
            false
        }
    }

    /** Deletes the file at [rel]. A missing file counts as deleted. */
    fun deleteFile(rel: String?): Boolean {
        val root = root() ?: return false
        if (!folderReachable(root)) return false
        val segments = DirectAccessPath.fileSegments(rel) ?: return false
        val parent = dirAt(root, segments.dropLast(1), create = false) ?: return true
        return try {
            val f = parent.child(segments.last()) ?: return true
            if (f.isDirectory) false else f.delete()
        } catch (e: Exception) {
            false
        }
    }

    /** Creates the directory at [rel] with its parents. */
    fun makeDir(rel: String?): Boolean {
        val root = root() ?: return false
        if (!folderReachable(root)) return false
        val segments = DirectAccessPath.segments(rel) ?: return false
        return dirAt(root, segments, create = true) != null
    }

    private fun recover(root: DocumentFile) {
        try {
            when (SafeReplace.recover(SafDir(root), DirectAccessRead.SYNC_FILE)) {
                SafeReplace.Recovery.RESTORED_FROM_TEMP -> {
                    Log.w(TAG, "Restored ${DirectAccessRead.SYNC_FILE} from a crashed write's temp")
                    cache = null
                }
                SafeReplace.Recovery.DISCARDED_STALE_TEMP ->
                    Log.w(TAG, "Discarded a crashed write's temp (snapshot intact)")
                SafeReplace.Recovery.RESTORE_FAILED ->
                    Log.e(TAG, "Could not restore ${DirectAccessRead.SYNC_FILE} from a crashed write's temp")
                SafeReplace.Recovery.NONE -> {}
            }
        } catch (e: Exception) {
            // Recovery is best effort; the classified read below reports the state.
        }
    }

    // ── SAF bindings ─────────────────────────────────────────────────────────

    // Lookups in two provider calls whatever the folder holds (SafChildren.kt).
    // DocumentFile.findFile and a listFiles() read of each child's name cost one
    // query per file in the folder, and every call here runs while the page
    // waits: the 15-second poll read the folder about four times per pass (the
    // snapshot's crash-temp check and lookup, the intents file's path walk and
    // lookup), so a folder of a few dozen files held the app for a noticeable
    // moment every poll.
    private fun DocumentFile.children(): List<SafChild> = childrenOf(context.contentResolver, this)
    private fun DocumentFile.child(name: String): DocumentFile? = findChild(context.contentResolver, this, name)

    private fun readText(file: DocumentFile): String? =
        context.contentResolver.openInputStream(file.uri)?.use {
            it.bufferedReader().readText()
        }

    /** The read-side seam: one read's view, with the unchanged-file cache. */
    private inner class SafSource(private val root: DocumentFile?) : DirectAccessRead.Source {
        private var file: DocumentFile? = null
        private var looked = false
        private fun file(): DocumentFile? {
            if (!looked) {
                looked = true
                file = try { root?.child(DirectAccessRead.SYNC_FILE) } catch (e: Exception) { null }
            }
            return file
        }
        override fun configured() = isConfigured()
        override fun grantRevoked() = this@DirectAccessRepository.grantRevoked()
        override fun folderExists() = try { root != null && root.exists() && root.isDirectory } catch (e: Exception) { false }
        override fun fileExists() = file() != null
        override fun fileIsDirectory() = file()?.isDirectory == true
        override fun fileLength() = file()?.length() ?: 0L
        override fun readText(): String? {
            val f = file() ?: return null
            val stamp = Cached(f.lastModified(), f.length(), "")
            cache?.let { if (it.lastModified == stamp.lastModified && it.length == stamp.length) return it.text }
            val text = this@DirectAccessRepository.readText(f) ?: return null
            if (text.isNotEmpty()) cache = stamp.copy(text = text)
            return text
        }
    }

    /** One read of a file named by a path: no cache, the parent found by the caller. */
    private inner class PathSource(
        private val root: DocumentFile?,
        private val parent: DocumentFile?,
        private val name: String,
    ) : DirectAccessRead.Source {
        private var file: DocumentFile? = null
        private var looked = false
        private fun file(): DocumentFile? {
            if (!looked) {
                looked = true
                file = try { parent?.child(name) } catch (e: Exception) { null }
            }
            return file
        }
        override fun configured() = isConfigured()
        override fun grantRevoked() = this@DirectAccessRepository.grantRevoked()
        override fun folderExists() = try { root != null && root.exists() && root.isDirectory } catch (e: Exception) { false }
        override fun fileExists() = file() != null
        override fun fileIsDirectory() = file()?.isDirectory == true
        override fun fileLength() = file()?.length() ?: 0L
        override fun readText(): String? = file()?.let { this@DirectAccessRepository.readText(it) }
    }

    /** The write-side seam for SafeReplace, mirroring ObsidianRepository.SafDir. */
    private inner class SafDir(private val dir: DocumentFile) : SafeReplace.Dir {
        override fun exists(name: String) = dir.child(name) != null
        override fun createAndWrite(name: String, text: String): Boolean {
            // octet-stream: providers only append an extension when the MIME
            // maps to one, so the exact display name survives.
            val created = dir.createFile("application/octet-stream", name) ?: return false
            if (created.name != name) {
                created.delete()
                return false
            }
            // Close the BufferedWriter (not just the raw stream) so its buffer
            // reaches the provider before the stream closes.
            val outputStream = context.contentResolver.openOutputStream(created.uri, "wt") ?: return false
            outputStream.use { stream ->
                stream.bufferedWriter().use { writer -> writer.write(text) }
            }
            return true
        }
        override fun delete(name: String) = dir.child(name)?.delete() ?: true
        override fun rename(from: String, to: String): Boolean {
            val f = dir.child(from) ?: return false
            return try { f.renameTo(to) && f.name == to } catch (e: Exception) { false }
        }
        override fun read(name: String): String? = dir.child(name)?.let { readText(it) }
    }

    companion object {
        private const val TAG = "DirectAccessRepository"
    }
}
