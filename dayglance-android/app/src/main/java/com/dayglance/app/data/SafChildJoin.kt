package com.dayglance.app.data

// The pure half of SafChildren.kt (no Android classes), unit-tested on the JVM.

/** One row of the children query. */
internal data class SafChildMeta(
    val name: String?,
    val mimeType: String?,
    val lastModified: Long,
) {
    // Same rules as TreeDocumentFile: a directory is the DIR mime type; a file
    // is anything else with a type at all.
    val isDirectory: Boolean get() = mimeType == DIR_MIME
    val isFile: Boolean get() = !isDirectory && !mimeType.isNullOrEmpty()

    companion object {
        /** DocumentsContract.Document.MIME_TYPE_DIR, spelled out so this file needs no Android classes. */
        const val DIR_MIME = "vnd.android.document/directory"
    }
}

/**
 * Joins listed children with their metadata rows. Pure, so the join and its
 * fallback are unit-testable without a provider: [idOf] is the document id of
 * an item (null when it cannot be parsed), [fallback] reads one item's
 * metadata the slow way for an item the batch query did not cover. Items with
 * no name are dropped, as listFiles + `.name ?: continue` dropped them.
 */
internal fun <T> joinChildren(
    items: List<T>,
    idOf: (T) -> String?,
    meta: Map<String, SafChildMeta>?,
    fallback: (T) -> SafChildMeta,
): List<Pair<T, SafChildMeta>> = items.mapNotNull { item ->
    val m = idOf(item)?.let { meta?.get(it) } ?: fallback(item)
    if (m.name == null) null else item to m
}
