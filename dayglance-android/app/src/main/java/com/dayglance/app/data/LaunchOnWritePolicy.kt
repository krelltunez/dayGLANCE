package com.dayglance.app.data

/**
 * Launch-on-write debounce (Obsidian build-out Phase 1): after a quiet window
 * following vault writes, the last-written note is opened via obsidian:// so
 * Obsidian Sync pushes the change.
 *
 * Pure timing policy with all clocks injected, JVM-testable without Android —
 * the same pattern as [com.dayglance.app.sse.SseBackoff]. The platform layer
 * (ObsidianBridge) schedules a delayed check per write and calls [fireIfQuiet]
 * when it lands; a check made stale by a later write simply returns null, so
 * no platform timer ever needs cancelling.
 *
 * Starts DISABLED and stays so until the web frontend pushes the device-local
 * toggle over setLaunchOnWrite, so nothing can fire ahead of the user's
 * stored setting (Android default: off).
 */
class LaunchOnWritePolicy(private val quietMs: Long = QUIET_MS) {

    companion object {
        /**
         * 8 seconds, trailing edge, reset on every write (spec §6 Phase 1) —
         * matches LAUNCH_ON_WRITE_QUIET_MS in electron/obsidianLaunch.ts.
         */
        const val QUIET_MS = 8_000L
    }

    private var enabled = false
    private var pendingNote: String? = null
    private var deadlineMs = 0L

    /** Web-pushed toggle. Turning off drops any pending launch. */
    @Synchronized
    fun setEnabled(value: Boolean) {
        enabled = value
        if (!value) clearPending()
    }

    /**
     * Drop any pending launch without touching the enabled flag — for
     * clearVault, where the pending note belongs to a vault the user just
     * swapped away from. The toggle is the user's setting and survives.
     */
    @Synchronized
    fun cancelPending() = clearPending()

    /**
     * Record a successful vault write of [noteName] (bare name, no .md).
     * Returns the delay in ms after which the caller should schedule a
     * [fireIfQuiet] check, or null when launch-on-write is disabled.
     */
    @Synchronized
    fun onWrite(noteName: String, nowMs: Long): Long? {
        if (!enabled) return null
        pendingNote = noteName
        deadlineMs = nowMs + quietMs
        return quietMs
    }

    /**
     * Called when a scheduled check lands. Returns the note to open when the
     * quiet window has elapsed (clearing the pending state), or null when a
     * later write extended the window — that write's own check handles it.
     */
    @Synchronized
    fun fireIfQuiet(nowMs: Long): String? {
        val note = pendingNote ?: return null
        if (nowMs < deadlineMs) return null
        clearPending()
        return note
    }

    private fun clearPending() {
        pendingNote = null
        deadlineMs = 0L
    }
}
