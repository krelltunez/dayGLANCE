package com.dayglance.app.data

/**
 * Launch-on-write policy (Obsidian build-out Phase 1): vault writes ARM the
 * launcher; leaving the app FIRES it. The last-written note is opened via
 * obsidian:// so Obsidian Sync pushes the change.
 *
 * Android deliberately has no quiet-window timer (unlike the desktop
 * scheduler in electron/obsidianLaunch.ts). Two reasons, recorded so this is
 * not relitigated:
 *
 *  1. UX: an intent fired while the user is inside dayGLANCE brings Obsidian
 *     to the foreground and interrupts their flow — there is no Android
 *     equivalent of macOS's background `activate: false` launch.
 *  2. Correctness: since Android 10 the OS blocks activity starts from apps
 *     that are no longer foreground (background-activity-launch restriction),
 *     so a timer expiring after the user left would be silently discarded.
 *     App exit — while the activity is still foreground — is the only moment
 *     that is both non-interruptive and reliably allowed to launch.
 *
 * The exit itself is therefore the debounce: any number of writes during a
 * session arm exactly one launch, of the last-written note. Delivery differs
 * by exit path (both hooked in MainActivity):
 *
 *  - Back-exit CAN direct-launch (the app is the foreground actor performing
 *    a legitimate app switch) → [takePending] consumes the armed state.
 *  - Home/Recents CANNOT: the Home press triggers the platform's
 *    stopAppSwitches suppression (built precisely so apps can't hijack the
 *    Home button), and the deferred start is then dropped by the
 *    background-activity-launch restriction. The sanctioned channel there is
 *    a tap-to-open notification → [peekPending] reads WITHOUT consuming, so
 *    the armed state survives for a later back-exit's direct launch (an
 *    ignored notification must not eat the wake).
 *
 * Pure state holder, JVM-testable. Starts DISABLED until the web frontend
 * pushes the device-local toggle via setLaunchOnWrite (Android default: off).
 */
class LaunchOnWritePolicy {

    private var enabled = false
    private var pendingNote: String? = null

    /** Web-pushed toggle. Turning off drops any armed launch. */
    @Synchronized
    fun setEnabled(value: Boolean) {
        enabled = value
        if (!value) pendingNote = null
    }

    /**
     * Drop any armed launch without touching the enabled flag — for
     * clearVault, where the pending note belongs to a vault the user just
     * swapped away from. The toggle is the user's setting and survives.
     */
    @Synchronized
    fun cancelPending() {
        pendingNote = null
    }

    /**
     * Record a successful vault write of [noteName] (bare name, no .md).
     * Arms the launcher; a later write in the same session simply replaces
     * the pending note (the exit opens the last-written file).
     */
    @Synchronized
    fun onWrite(noteName: String) {
        if (enabled) pendingNote = noteName
    }

    /**
     * The note to open at a CONFIRMED delivery moment (back-exit direct
     * launch), clearing the armed state so an exit fires at most once.
     * Null when nothing is armed.
     */
    @Synchronized
    fun takePending(): String? {
        val note = pendingNote
        pendingNote = null
        return note
    }

    /**
     * The armed note WITHOUT consuming it — for the Home/Recents notification
     * fallback, whose tap cannot be observed (Android 12+ forbids notification
     * trampolines, so the tap PendingIntent must target Obsidian directly).
     * Keeping the state armed means an ignored notification doesn't lose the
     * wake: a later back-exit still direct-launches, and re-posting uses a
     * constant notification id so at most one exists.
     */
    @Synchronized
    fun peekPending(): String? = pendingNote
}
