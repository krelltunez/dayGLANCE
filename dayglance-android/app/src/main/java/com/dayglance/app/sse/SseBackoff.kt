package com.dayglance.app.sse

/**
 * Capped exponential backoff with equal jitter and a stability reset — the
 * Kotlin mirror of the reconnect policy in `createVaultEventClient`
 * (src/sync/vaultEventStream.js, see backoffDelayMs there). Change both
 * together.
 *
 * A connection that stays open at least [minStableMs] is treated as healthy and
 * resets the attempt counter, so a genuine long-lived stream that finally drops
 * reconnects promptly. A connection that opens then drops immediately (a flap —
 * server closing fast, proxy timeout, network reset) keeps backing off, up to
 * [maxMs], so a broken endpoint can never storm the vault with reconnects.
 *
 * EQUAL JITTER on top: the exponential's lower half is kept as a floor that
 * still grows with the attempt count (the politeness the stability reset
 * protects), and the upper half is spread uniformly, so the many devices
 * dropped by a single vault restart reconnect scattered instead of in aligned
 * 1s/2s/4s… waves against the vault's per-IP rate limiter. Full jitter would
 * decorrelate harder but can retry almost immediately after a failure, which
 * undoes the backoff's purpose. The cap applies to the exponential BEFORE
 * jitter, so every delay is < [maxMs] and ≥ [baseMs]/2 (never zero).
 *
 * Pure, and deterministic with an injected [random] source (the SseBackoff
 * clock-injection pattern), so it is unit-testable with no clock or network.
 */
class SseBackoff(
    private val baseMs: Long = 1_000,
    private val maxMs: Long = 30_000,
    private val minStableMs: Long = 5_000,
    private val random: () -> Double = { Math.random() },
) {

    private var attempt = 0

    /**
     * The delay to wait before the NEXT reconnect attempt, then advances the
     * counter. `base * 2^attempt` capped at [maxMs], then equal jitter: the
     * result is uniform in [exp/2, exp). The shift amount is clamped so a
     * large attempt count can't overflow / wrap the Long shift.
     */
    fun nextDelayMs(): Long {
        val shift = attempt.coerceIn(0, 30)
        val exp = minOf(maxMs, baseMs shl shift)
        attempt++
        return exp / 2 + (random() * (exp / 2)).toLong()
    }

    /**
     * Record that a connection closed, given how long it had been open. Resets the
     * backoff only when the connection was open at least [minStableMs] (a healthy
     * stream), so the next reconnect starts back at [baseMs] rather than continuing
     * to grow; a flap leaves the counter climbing.
     */
    fun onClosed(openDurationMs: Long) {
        if (openDurationMs >= minStableMs) attempt = 0
    }

    /** Reset the backoff to its initial state. */
    fun reset() {
        attempt = 0
    }
}
