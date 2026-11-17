package com.dayglance.app.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The join behind the batched SAF listing (SafChildren.kt): one metadata
 * query for a directory's children, joined to listFiles() by document id,
 * with a per-child read only where the batch has no row.
 */
class SafChildJoinTest {

    private data class Item(val id: String?, val slowName: String?)

    private val dirMime = SafChildMeta.DIR_MIME

    @Test
    fun joinsEveryChildFromTheBatchWithoutPerChildReads() {
        val items = listOf(Item("d/2026-11-16.md", null), Item("d/sub", null))
        val meta = mapOf(
            "d/2026-11-16.md" to SafChildMeta("2026-11-16.md", "text/markdown", 1_000L),
            "d/sub" to SafChildMeta("sub", dirMime, 0L),
        )
        var slowReads = 0
        val out = joinChildren(items, { it.id }, meta) { slowReads++; SafChildMeta(it.slowName, null, 0L) }

        assertEquals(0, slowReads)
        assertEquals(listOf("2026-11-16.md", "sub"), out.map { it.second.name })
        assertTrue(out[0].second.isFile)
        assertFalse(out[0].second.isDirectory)
        assertEquals(1_000L, out[0].second.lastModified)
        assertTrue(out[1].second.isDirectory)
        assertFalse(out[1].second.isFile)
    }

    @Test
    fun fallsBackPerChildWhenTheBatchQueryFailed() {
        val items = listOf(Item("d/a.md", "a.md"), Item("d/b.md", "b.md"))
        var slowReads = 0
        val out = joinChildren(items, { it.id }, null) { slowReads++; SafChildMeta(it.slowName, "text/markdown", 5L) }

        assertEquals(2, slowReads)
        assertEquals(listOf("a.md", "b.md"), out.map { it.second.name })
    }

    @Test
    fun fallsBackOnlyForAChildTheBatchMissedOrWhoseIdCannotBeParsed() {
        // A file created between the listing and the query, and a URI whose
        // document id could not be parsed: both are read the slow way, never
        // dropped (a dropped daily note reads as a deletion downstream).
        val items = listOf(Item("d/a.md", "a.md"), Item("d/new.md", "new.md"), Item(null, "odd.md"))
        val meta = mapOf("d/a.md" to SafChildMeta("a.md", "text/markdown", 1L))
        val slow = mutableListOf<String?>()
        val out = joinChildren(items, { it.id }, meta) { slow += it.slowName; SafChildMeta(it.slowName, "text/markdown", 2L) }

        assertEquals(listOf("new.md", "odd.md"), slow)
        assertEquals(listOf("a.md", "new.md", "odd.md"), out.map { it.second.name })
    }

    @Test
    fun dropsAChildWithNoNameAsTheOldLoopDid() {
        val items = listOf(Item("d/x", null), Item("d/a.md", null))
        val meta = mapOf(
            "d/x" to SafChildMeta(null, "text/markdown", 0L),
            "d/a.md" to SafChildMeta("a.md", "text/markdown", 0L),
        )
        val out = joinChildren(items, { it.id }, meta) { SafChildMeta(null, null, 0L) }
        assertEquals(listOf("a.md"), out.map { it.second.name })
    }

    @Test
    fun aChildWithNoTypeIsNeitherFileNorDirectory() {
        val m = SafChildMeta("weird", null, 0L)
        assertFalse(m.isFile)
        assertFalse(m.isDirectory)
    }
}
