package com.dayglance.app.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
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
    fun `peek (the Home-exit notification path) does not consume the armed state`() {
        // The notification tap cannot be observed (no trampolines on 12+), so
        // an ignored notification must not eat the wake: repeated Home exits
        // re-post, and a later back-exit still direct-launches.
        val p = LaunchOnWritePolicy()
        p.setEnabled(true)
        p.onWrite("a")
        assertEquals("a", p.peekPending())
        assertEquals("a", p.peekPending()) // second Home exit re-posts
        assertEquals("a", p.takePending()) // back-exit still delivers
        assertNull(p.peekPending())        // and only then is it gone
    }

    @Test
    fun `peek respects disabled and cancelled states like take does`() {
        val p = LaunchOnWritePolicy()
        p.onWrite("a")
        assertNull(p.peekPending()) // disabled: nothing armed
        p.setEnabled(true)
        p.onWrite("b")
        p.cancelPending()
        assertNull(p.peekPending()) // vault swap dropped it
    }

    @Test
    fun `a tapped offer (notification gone on resume) consumes the arm - no redundant later launch`() {
        // Home exit posts an offer, the user taps it (Obsidian opens and syncs),
        // then returns to dayGLANCE. The tap itself is unobservable, but the
        // notification's absence resolves it: the arm is spent, so a later
        // back-exit must NOT open Obsidian again.
        val p = LaunchOnWritePolicy()
        p.setEnabled(true)
        p.onWrite("a")
        p.peekPending()          // Home exit posts the notification
        p.onOfferPosted()
        assertFalse(p.onAppResumed(offerStillShowing = false)) // gone → nothing to retire
        assertNull(p.takePending())                            // back-exit: no launch
    }

    @Test
    fun `an ignored offer (still showing on resume) keeps the arm and is retired`() {
        // The wake was never delivered, so the arm survives; the caller only
        // retires the notification, which is noise while the user is in the app.
        val p = LaunchOnWritePolicy()
        p.setEnabled(true)
        p.onWrite("a")
        p.peekPending()
        p.onOfferPosted()
        assertTrue(p.onAppResumed(offerStillShowing = true)) // caller retires it
        assertEquals("a", p.takePending())                   // back-exit still delivers
    }

    @Test
    fun `a resume with no offer in flight leaves the arm alone`() {
        // Screen-off then screen-on fires onStart without any notification
        // having been posted — that must not discard a perfectly good arm.
        val p = LaunchOnWritePolicy()
        p.setEnabled(true)
        p.onWrite("a")
        assertFalse(p.onAppResumed(offerStillShowing = false))
        assertEquals("a", p.takePending())
    }

    @Test
    fun `resolving an offer is one-shot - a second resume does not re-resolve`() {
        val p = LaunchOnWritePolicy()
        p.setEnabled(true)
        p.onWrite("a")
        p.onOfferPosted()
        assertTrue(p.onAppResumed(offerStillShowing = true)) // retire, keep arm
        // Notification already retired: a further resume has no offer to resolve
        // and must not consume the arm just because nothing is showing.
        assertFalse(p.onAppResumed(offerStillShowing = false))
        assertEquals("a", p.takePending())
    }

    @Test
    fun `a new write after a spent offer arms again`() {
        val p = LaunchOnWritePolicy()
        p.setEnabled(true)
        p.onWrite("a")
        p.onOfferPosted()
        p.onAppResumed(offerStillShowing = false) // tapped → spent
        assertNull(p.peekPending())
        p.onWrite("b")                            // user edits again
        assertEquals("b", p.takePending())
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
