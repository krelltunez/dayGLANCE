package com.dayglance.app.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Crash-window tests for the temp/delete/rename vault write. Each "crash" is
 * an exception thrown mid-sequence by the fake — the unwind models the
 * process dying at exactly that step — after which the test asserts what is
 * on disk, runs recovery the way the repository would on next touch, and
 * asserts the note survived (or, pre-commit, that the original was never
 * harmed).
 */
class SafeReplaceTest {

    private class Crash : RuntimeException("simulated crash")

    /** In-memory directory with failure and crash injection. */
    private class FakeDir : SafeReplace.Dir {
        val files = LinkedHashMap<String, String>()
        val ops = mutableListOf<String>()

        var refuseCreateOf: String? = null      // createAndWrite returns false for this name
        var renameSupported = true              // rename returns false when unsupported
        var crashDuringWriteOf: String? = null  // partial content lands, then the process "dies"
        var crashBeforeRename = false           // dies after the delete, before the rename

        override fun exists(name: String) = files.containsKey(name)

        override fun createAndWrite(name: String, text: String): Boolean {
            ops += "create:$name"
            if (name == refuseCreateOf) return false
            if (name == crashDuringWriteOf) {
                files[name] = text.take(text.length / 2) // the buffer's partial flush
                throw Crash()
            }
            files[name] = text
            return true
        }

        override fun delete(name: String): Boolean {
            ops += "delete:$name"
            files.remove(name)
            return true
        }

        override fun rename(from: String, to: String): Boolean {
            if (crashBeforeRename) throw Crash()
            ops += "rename:$from->$to"
            if (!renameSupported) return false
            val content = files.remove(from) ?: return false
            files[to] = content
            return true
        }

        override fun read(name: String): String? = files[name]
    }

    private val NAME = "2026-08-28.md"
    private val TEMP = SafeReplace.tempNameFor(NAME)
    private val OLD = "## Tasks\n- [ ] Alpha\n"
    private val NEW = "## Tasks\n- [x] Alpha ^dg-a1b2c3d4\n"

    // ── Happy paths ──────────────────────────────────────────────────────────

    @Test
    fun `a brand-new file is written directly - no temp dance`() {
        val dir = FakeDir()
        assertTrue(SafeReplace.replace(dir, NAME, NEW))
        assertEquals(mapOf(NAME to NEW), dir.files)
        assertEquals(listOf("create:$NAME"), dir.ops)
    }

    @Test
    fun `an existing file is replaced via temp, delete, rename - no residue`() {
        val dir = FakeDir()
        dir.files[NAME] = OLD
        assertTrue(SafeReplace.replace(dir, NAME, NEW))
        assertEquals(mapOf(NAME to NEW), dir.files)
        assertEquals(listOf("create:$TEMP", "delete:$NAME", "rename:$TEMP->$NAME"), dir.ops)
    }

    // ── Crash windows ────────────────────────────────────────────────────────

    @Test
    fun `crash DURING the temp write - original intact, recovery discards the partial temp`() {
        val dir = FakeDir()
        dir.files[NAME] = OLD
        dir.crashDuringWriteOf = TEMP
        try {
            SafeReplace.replace(dir, NAME, NEW)
            throw AssertionError("expected the simulated crash")
        } catch (expected: Crash) { /* the process died mid-write */ }

        // On disk: the untouched original beside a PARTIAL temp.
        assertEquals(OLD, dir.files[NAME])
        assertTrue(dir.files.containsKey(TEMP))
        assertTrue(dir.files[TEMP] != NEW)

        // Next touch: original wins, partial temp discarded.
        dir.crashDuringWriteOf = null
        assertEquals(SafeReplace.Recovery.DISCARDED_STALE_TEMP, SafeReplace.recover(dir, NAME))
        assertEquals(mapOf(NAME to OLD), dir.files)
    }

    @Test
    fun `crash BETWEEN delete and rename - recovery restores the complete temp`() {
        val dir = FakeDir()
        dir.files[NAME] = OLD
        dir.crashBeforeRename = true
        try {
            SafeReplace.replace(dir, NAME, NEW)
            throw AssertionError("expected the simulated crash")
        } catch (expected: Crash) { /* died after the delete */ }

        // On disk: no original, and the temp holds the COMPLETE new content —
        // the delete is only issued after the temp write finished.
        assertNull(dir.files[NAME])
        assertEquals(NEW, dir.files[TEMP])

        // Next touch: the note comes back under its own name, with the
        // content the interrupted write intended.
        dir.crashBeforeRename = false
        assertEquals(SafeReplace.Recovery.RESTORED_FROM_TEMP, SafeReplace.recover(dir, NAME))
        assertEquals(mapOf(NAME to NEW), dir.files)
    }

    @Test
    fun `recovery restores by copy when the provider cannot rename`() {
        val dir = FakeDir()
        dir.files[TEMP] = NEW // the post-delete crash state
        dir.renameSupported = false
        assertEquals(SafeReplace.Recovery.RESTORED_FROM_TEMP, SafeReplace.recover(dir, NAME))
        assertEquals(mapOf(NAME to NEW), dir.files)
    }

    // ── Non-crash failures (the confirmed-write contract) ────────────────────

    @Test
    fun `a temp write failure aborts BEFORE the delete - the original is never touched`() {
        val dir = FakeDir()
        dir.files[NAME] = OLD
        dir.refuseCreateOf = TEMP
        assertFalse(SafeReplace.replace(dir, NAME, NEW))
        assertEquals(mapOf(NAME to OLD), dir.files)
        assertFalse(dir.ops.contains("delete:$NAME"))
    }

    @Test
    fun `a rename failure rolls forward by copy - content lands, temp cleaned`() {
        val dir = FakeDir()
        dir.files[NAME] = OLD
        dir.renameSupported = false
        assertTrue(SafeReplace.replace(dir, NAME, NEW))
        assertEquals(mapOf(NAME to NEW), dir.files)
    }

    @Test
    fun `a stale temp beside a live original is discarded before a fresh write`() {
        val dir = FakeDir()
        dir.files[NAME] = OLD
        dir.files[TEMP] = "half-written garba"
        assertTrue(SafeReplace.replace(dir, NAME, NEW))
        assertEquals(mapOf(NAME to NEW), dir.files)
    }

    @Test
    fun `recovery is a no-op when there is nothing to recover`() {
        val dir = FakeDir()
        dir.files[NAME] = OLD
        assertEquals(SafeReplace.Recovery.NONE, SafeReplace.recover(dir, NAME))
        assertEquals(mapOf(NAME to OLD), dir.files)
    }

    // ── Naming ───────────────────────────────────────────────────────────────

    @Test
    fun `temp names are dot-prefixed, suffixed, and round-trip to the original`() {
        assertEquals(".2026-08-28.md.dgtmp", SafeReplace.tempNameFor("2026-08-28.md"))
        assertTrue(SafeReplace.isTempName(".2026-08-28.md.dgtmp"))
        assertEquals("2026-08-28.md", SafeReplace.originalNameOf(".2026-08-28.md.dgtmp"))
        assertFalse(SafeReplace.isTempName("2026-08-28.md"))
        assertFalse(SafeReplace.isTempName(".obsidian"))
        assertFalse(SafeReplace.isTempName(".dgtmp")) // prefix+suffix alone is not a temp
    }
}
