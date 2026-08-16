package com.dayglance.app.sse

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Unit tests for the native reconnect backoff. Mirrors the flap-guard / stability-
 * reset policy the renderer's createVaultEventClient is tested for, so native and
 * web reconnect behaviour match: a flap keeps backing off (no storm), a healthy
 * connection resets so a later drop reconnects fast.
 *
 * The ladder tests inject `random = { 1.0 }`: with equal jitter the delay is
 * exp/2 + r*(exp/2), so the upper edge recovers the pre-jitter exponential
 * ladder exactly and the original assertions (and their comments) stay true.
 * The jitter itself is covered by the seeded-distribution tests below.
 */
class SseBackoffTest {

    private val ceiling: () -> Double = { 1.0 }

    @Test
    fun `grows exponentially and caps at maxMs`() {
        val b = SseBackoff(baseMs = 1_000, maxMs = 30_000, minStableMs = 5_000, random = ceiling)
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
        val b = SseBackoff(baseMs = 1_000, maxMs = 60_000, minStableMs = 5_000, random = ceiling)
        assertEquals(1_000, b.nextDelayMs())
        b.onClosed(50)                        // opened then dropped fast → no reset
        assertEquals(2_000, b.nextDelayMs())  // continues to grow, no 1s storm
        b.onClosed(100)
        assertEquals(4_000, b.nextDelayMs())
    }

    @Test
    fun `a stable connection (open past minStableMs) resets so the next reconnect is fast`() {
        val b = SseBackoff(baseMs = 1_000, maxMs = 60_000, minStableMs = 5_000, random = ceiling)
        b.nextDelayMs(); b.nextDelayMs(); b.nextDelayMs() // climb to attempt=3
        b.onClosed(10_000)                    // healthy: open 10s ≥ 5s → reset
        assertEquals(1_000, b.nextDelayMs())  // back to base
    }

    @Test
    fun `reset returns to base`() {
        val b = SseBackoff(baseMs = 500, random = ceiling)
        b.nextDelayMs(); b.nextDelayMs()
        b.reset()
        assertEquals(500, b.nextDelayMs())
    }

    @Test
    fun `many attempts never overflow the delay (stays capped, non-negative)`() {
        val b = SseBackoff(baseMs = 1_000, maxMs = 30_000, minStableMs = 5_000, random = ceiling)
        repeat(200) { b.nextDelayMs() }
        val d = b.nextDelayMs()
        assertEquals(30_000, d) // clamped shift → no overflow/wrap to a bogus delay
    }

    // ── Equal jitter (seeded, deterministic) ─────────────────────────────────

    @Test
    fun `jitter spreads same-attempt delays instead of one aligned value (the anti-wave property)`() {
        // Many clients dropped by the same vault restart must not share a
        // schedule. Without jitter every attempt-3 delay is exactly 8000 and
        // this test fails on the distinct-count assertion (the negative
        // control removes the jitter to prove that).
        val rnd = java.util.Random(42)
        val b = SseBackoff(baseMs = 1_000, maxMs = 30_000, random = { rnd.nextDouble() })
        val samples = (1..500).map {
            b.reset()
            repeat(3) { b.nextDelayMs() }
            b.nextDelayMs()                   // the attempt-3 delay: exp = 8000
        }
        assertTrue("expected a spread, got ${samples.distinct().size} distinct", samples.distinct().size > 100)
        assertTrue("floor: every sample ≥ exp/2", samples.all { it >= 4_000 })
        assertTrue("range: every sample < exp", samples.all { it < 8_000 })
    }

    @Test
    fun `the cap still caps and the floor holds at high attempt counts`() {
        val rnd = java.util.Random(7)
        val b = SseBackoff(baseMs = 1_000, maxMs = 30_000, random = { rnd.nextDouble() })
        repeat(40) { b.nextDelayMs() }        // deep past the cap
        val samples = (1..500).map { b.nextDelayMs() }
        assertTrue("cap: no sample may exceed maxMs", samples.all { it < 30_000 })
        assertTrue("floor at cap: ≥ maxMs/2", samples.all { it >= 15_000 })
    }

    @Test
    fun `no delay is ever zero or negative, from the very first attempt`() {
        val rnd = java.util.Random(3)
        val b = SseBackoff(baseMs = 1_000, maxMs = 30_000, random = { rnd.nextDouble() })
        val first = (1..200).map { b.reset(); b.nextDelayMs() }
        assertTrue("attempt-0 floor is base/2", first.all { it >= 500 })
    }

    @Test
    fun `deterministic with a seeded source - same seed, same sequence`() {
        val a = SseBackoff(random = java.util.Random(99)::nextDouble)
        val b = SseBackoff(random = java.util.Random(99)::nextDouble)
        val seqA = (1..6).map { a.nextDelayMs() }
        val seqB = (1..6).map { b.nextDelayMs() }
        assertEquals(seqA, seqB)
    }
}
