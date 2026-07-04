package com.dayglance.app.sse

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Unit tests for the native reconnect backoff. Mirrors the flap-guard / stability-
 * reset policy the renderer's createVaultEventClient is tested for, so native and
 * web reconnect behaviour match: a flap keeps backing off (no storm), a healthy
 * connection resets so a later drop reconnects fast.
 */
class SseBackoffTest {

    @Test
    fun `grows exponentially and caps at maxMs`() {
        val b = SseBackoff(baseMs = 1_000, maxMs = 30_000, minStableMs = 5_000)
        assertEquals(1_000, b.nextDelayMs())  // 1000 * 2^0
        assertEquals(2_000, b.nextDelayMs())  // 2^1
        assertEquals(4_000, b.nextDelayMs())  // 2^2
        assertEquals(8_000, b.nextDelayMs())  // 2^3
        assertEquals(16_000, b.nextDelayMs()) // 2^4
        assertEquals(30_000, b.nextDelayMs()) // 32000 capped to 30000
        assertEquals(30_000, b.nextDelayMs()) // stays capped
    }

    @Test
    fun `a flap (closed before minStableMs) does NOT reset — backoff keeps growing`() {
        val b = SseBackoff(baseMs = 1_000, maxMs = 60_000, minStableMs = 5_000)
        assertEquals(1_000, b.nextDelayMs())
        b.onClosed(50)                        // opened then dropped fast → no reset
        assertEquals(2_000, b.nextDelayMs())  // continues to grow, no 1s storm
        b.onClosed(100)
        assertEquals(4_000, b.nextDelayMs())
    }

    @Test
    fun `a stable connection (open past minStableMs) resets so the next reconnect is fast`() {
        val b = SseBackoff(baseMs = 1_000, maxMs = 60_000, minStableMs = 5_000)
        b.nextDelayMs(); b.nextDelayMs(); b.nextDelayMs() // climb to attempt=3
        b.onClosed(10_000)                    // healthy: open 10s ≥ 5s → reset
        assertEquals(1_000, b.nextDelayMs())  // back to base
    }

    @Test
    fun `reset returns to base`() {
        val b = SseBackoff(baseMs = 500)
        b.nextDelayMs(); b.nextDelayMs()
        b.reset()
        assertEquals(500, b.nextDelayMs())
    }

    @Test
    fun `many attempts never overflow the delay (stays capped, non-negative)`() {
        val b = SseBackoff(baseMs = 1_000, maxMs = 30_000, minStableMs = 5_000)
        repeat(200) { b.nextDelayMs() }
        val d = b.nextDelayMs()
        assertEquals(30_000, d) // clamped shift → no overflow/wrap to a bogus delay
    }
}
