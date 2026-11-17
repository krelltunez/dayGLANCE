package com.dayglance.app.data

import android.content.ContentResolver
import android.provider.DocumentsContract
import android.provider.DocumentsContract.Document
import android.util.Log
import androidx.documentfile.provider.DocumentFile

/**
 * Directory listings over the Storage Access Framework in a fixed number of
 * provider calls.
 *
 * DocumentFile.listFiles() returns bare URIs; every `.name`, `.isFile`,
 * `.isDirectory` and `.lastModified()` on a child is then its own
 * ContentResolver query, and `findFile(name)` is listFiles() plus a name query
 * for every child until the match. A lookup in a daily-notes folder of N notes
 * cost N+1 binder round trips, a vault write made about six such lookups, and
 * the write paths are synchronous @JavascriptInterface calls that hold the
 * WebView's JS thread. On a phone with a few years of daily notes the first
 * sync (which stamps a block id on every task line, one write each) froze the
 * app for minutes.
 *
 * [childrenOf] reads the same listing in two calls whatever the folder's size:
 * listFiles() for the real child DocumentFiles (so create, rename and delete
 * keep DocumentFile's own semantics), and one query on the children URI for
 * every child's name, type and mtime, joined on the document id, which is
 * parsed from the URI without a provider call.
 */
internal data class SafChild(
    val file: DocumentFile,
    val name: String,
    val isDirectory: Boolean,
    val isFile: Boolean,
    val lastModified: Long,
)

private const val TAG = "SafChildren"

private val CHILD_PROJECTION = arrayOf(
    Document.COLUMN_DOCUMENT_ID,
    Document.COLUMN_DISPLAY_NAME,
    Document.COLUMN_MIME_TYPE,
    Document.COLUMN_LAST_MODIFIED,
)

/**
 * Every child's metadata in one query, keyed by document id; null when the
 * query fails (the caller then falls back to per-child reads, the old cost but
 * the old answer).
 */
private fun queryChildMeta(resolver: ContentResolver, dir: DocumentFile): Map<String, SafChildMeta>? = try {
    val dirUri = dir.uri
    val childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(
        dirUri, DocumentsContract.getDocumentId(dirUri),
    )
    resolver.query(childrenUri, CHILD_PROJECTION, null, null, null)?.use { c ->
        val out = HashMap<String, SafChildMeta>(c.count.coerceAtLeast(0))
        while (c.moveToNext()) {
            val id = c.getString(0) ?: continue
            out[id] = SafChildMeta(
                name = c.getString(1),
                mimeType = c.getString(2),
                lastModified = if (c.isNull(3)) 0L else c.getLong(3),
            )
        }
        out
    }
} catch (e: Exception) {
    Log.w(TAG, "Batch child query failed; falling back to per-child reads", e)
    null
}

/** The children of [dir] with their name, type and mtime, in two provider calls. */
internal fun childrenOf(resolver: ContentResolver, dir: DocumentFile): List<SafChild> {
    val files = dir.listFiles()
    if (files.isEmpty()) return emptyList()
    val meta = queryChildMeta(resolver, dir)
    return joinChildren(
        files.asList(),
        idOf = { f -> try { DocumentsContract.getDocumentId(f.uri) } catch (e: Exception) { null } },
        meta = meta,
        // DocumentFile.type is null for a directory, so the fallback states
        // the directory type itself.
        fallback = { f ->
            SafChildMeta(f.name, if (f.isDirectory) SafChildMeta.DIR_MIME else f.type, f.lastModified())
        },
    ).map { (f, m) -> SafChild(f, m.name!!, m.isDirectory, m.isFile, m.lastModified) }
}

/** findFile(name) in two provider calls instead of one per child. */
internal fun findChild(resolver: ContentResolver, dir: DocumentFile, name: String): DocumentFile? =
    childrenOf(resolver, dir).firstOrNull { it.name == name }?.file
