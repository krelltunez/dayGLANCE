package com.dayglance.app.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Unit tests for the armed-on-write / fired-on-exit launch policy. The exit is
 * the debounce on Android: any number of writes during a session produce
 * exactly one launch, of the last-written note, when the user leaves the app.
 * (The desktop scheduler in electron/obsidianLaunch.test.ts keeps the timer
 * contract; Android deliberately has none — see LaunchOnWritePolicy.)
 */
class LaunchOnWritePolicyTest {

    @Test
    fun `a burst of writes arms once - one exit fires once, with the last note`() {
        val p = LaunchOnWritePolicy()
        p.setEnabled(true)
        p.onWrite("a")
        p.onWrite("b")
        p.onWrite("c")
        assertEquals("c", p.takePending())
        // The armed state cleared: the same exit sequence cannot fire twice,
        // and the next exit with no new writes fires nothing.
        assertNull(p.takePending())
    }

    @Test
    fun `separate write-exit cycles fire once each`() {
        val p = LaunchOnWritePolicy()
        p.setEnabled(true)
        p.onWrite("a")
        assertEquals("a", p.takePending())
        p.onWrite("b")
        assertEquals("b", p.takePending())
    }

    @Test
    fun `disabled (the initial state) records nothing and fires nothing`() {
        val p = LaunchOnWritePolicy()
        p.onWrite("a")
        assertNull(p.takePending())
        // Enabling later must not resurrect the ignored write.
        p.setEnabled(true)
        assertNull(p.takePending())
    }

    @Test
    fun `toggling off drops an armed launch`() {
        val p = LaunchOnWritePolicy()
        p.setEnabled(true)
        p.onWrite("a")
        p.setEnabled(false)
        assertNull(p.takePending())
    }

    @Test
    fun `clearVault then a fresh vault - pending is dropped but the enabled flag is not left stale`() {
        // ObsidianBridge.clearVault calls cancelPending() — a launch must not
        // fire against a vault the user just swapped away from, but the user's
        // toggle survives the swap, so a write into the NEW vault arms
        // normally.
        val p = LaunchOnWritePolicy()
        p.setEnabled(true)
        p.onWrite("old-vault-note")
        p.cancelPending()
        assertNull(p.takePending())
        p.onWrite("new-vault-note")
        assertEquals("new-vault-note", p.takePending())
    }
}
