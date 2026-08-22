package com.dayglance.app.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Unit tests for the launch-on-write debounce policy. Mirrors the contract the
 * Electron scheduler is tested for (electron/obsidianLaunch.test.ts), so native
 * and desktop behaviour match: a burst of writes within the quiet window
 * produces exactly one launch, writes separated by more than the window produce
 * one each, and the toggle off produces none.
 *
 * All times are explicit millis — the policy owns no clock, so every test is
 * deterministic. The 8s window comes from LaunchOnWritePolicy.QUIET_MS.
 */
class LaunchOnWritePolicyTest {

    private val quiet = LaunchOnWritePolicy.QUIET_MS

    @Test
    fun `a burst of writes within the quiet window fires exactly once, with the last note`() {
        val p = LaunchOnWritePolicy()
        p.setEnabled(true)
        assertEquals(quiet, p.onWrite("a", 0))
        assertEquals(quiet, p.onWrite("b", 3_000))
        assertEquals(quiet, p.onWrite("c", 6_000))
        // The checks scheduled by "a" and "b" land while a later write holds
        // the deadline open — both are stale and must not fire.
        assertNull(p.fireIfQuiet(quiet))
        assertNull(p.fireIfQuiet(3_000 + quiet - 1))
        assertEquals("c", p.fireIfQuiet(6_000 + quiet))
        // And nothing more fires later.
        assertNull(p.fireIfQuiet(60_000))
    }

    @Test
    fun `writes separated by more than the window fire once each`() {
        val p = LaunchOnWritePolicy()
        p.setEnabled(true)
        p.onWrite("a", 0)
        assertEquals("a", p.fireIfQuiet(quiet))
        p.onWrite("b", 20_000)
        assertEquals("b", p.fireIfQuiet(20_000 + quiet))
    }

    @Test
    fun `disabled (the initial state) records nothing and fires nothing`() {
        val p = LaunchOnWritePolicy()
        assertNull(p.onWrite("a", 0))
        assertNull(p.fireIfQuiet(60_000))
        // Enabling later must not resurrect the ignored write.
        p.setEnabled(true)
        assertNull(p.fireIfQuiet(120_000))
    }

    @Test
    fun `toggling off drops a pending launch`() {
        val p = LaunchOnWritePolicy()
        p.setEnabled(true)
        p.onWrite("a", 0)
        p.setEnabled(false)
        assertNull(p.fireIfQuiet(quiet))
    }

    @Test
    fun `clearVault then a fresh vault - pending is dropped but the enabled flag is not left stale`() {
        // ObsidianBridge.clearVault calls cancelPending() — a launch must not
        // fire against a vault the user just swapped away from, but the user's
        // toggle survives the swap, so a write into the NEW vault schedules
        // normally.
        val p = LaunchOnWritePolicy()
        p.setEnabled(true)
        p.onWrite("old-vault-note", 0)
        p.cancelPending()
        assertNull(p.fireIfQuiet(quiet))
        assertEquals(quiet, p.onWrite("new-vault-note", 10_000))
        assertEquals("new-vault-note", p.fireIfQuiet(10_000 + quiet))
    }
}
