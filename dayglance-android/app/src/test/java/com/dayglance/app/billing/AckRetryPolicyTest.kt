package com.dayglance.app.billing

import com.dayglance.app.billing.AckRetryPolicy.Decision
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Unit tests for the acknowledgement retry decisions (plain JVM, no billing
 * client, injected clock — the SseBackoff precedent).
 *
 * The stakes each rule protects: Play refunds any purchase not acknowledged
 * within three days, so giving up wrongly costs the user a refund and us a
 * sale; continuing wrongly costs a log line. Hence: only ITEM_NOT_OWNED and
 * DEVELOPER_ERROR are terminal, a fresh query's isAcknowledged is
 * authoritative success over ANY response code, and connection failures are
 * never terminal at all.
 */
class AckRetryPolicyTest {

    private val t0 = 1_000_000L

    // BillingResponseCode values not mirrored in the policy (it only names the
    // ones it treats specially); listed here to drive the everything-else rule.
    private val transientCodes = listOf(
        -2, // FEATURE_NOT_SUPPORTED
        -1, // SERVICE_DISCONNECTED
        1,  // USER_CANCELED (should not occur on ack; still not terminal)
        2,  // SERVICE_UNAVAILABLE
        3,  // BILLING_UNAVAILABLE
        4,  // ITEM_UNAVAILABLE
        6,  // ERROR
        7,  // ITEM_ALREADY_OWNED (not an ack code; conservative -> retry)
        12, // NETWORK_ERROR
    )

    @Test
    fun `OK is success`() {
        assertEquals(Decision.SUCCESS, AckRetryPolicy.decide(AckRetryPolicy.OK, false, t0, t0))
    }

    @Test
    fun `already-acknowledged from a fresh query is authoritative success over EVERY code`() {
        // The idempotence rule: acknowledging an already-acknowledged purchase
        // must be handled as success, never as an error to retry forever —
        // even when the response code would otherwise be terminal.
        val everyCode = transientCodes + listOf(
            AckRetryPolicy.OK, AckRetryPolicy.ITEM_NOT_OWNED, AckRetryPolicy.DEVELOPER_ERROR,
        )
        for (code in everyCode) {
            assertEquals(
                "code=$code with alreadyAcknowledged must be SUCCESS",
                Decision.SUCCESS,
                AckRetryPolicy.decide(code, true, t0, t0 + AckRetryPolicy.ACK_WINDOW_MS * 2),
            )
        }
    }

    @Test
    fun `ITEM_NOT_OWNED and DEVELOPER_ERROR are terminal immediately`() {
        // A purchase that no longer exists (refunded, consumed) or a malformed
        // token can never be acknowledged; retrying forever would hammer Play.
        assertEquals(Decision.GIVE_UP_TERMINAL, AckRetryPolicy.decide(AckRetryPolicy.ITEM_NOT_OWNED, false, t0, t0))
        assertEquals(Decision.GIVE_UP_TERMINAL, AckRetryPolicy.decide(AckRetryPolicy.DEVELOPER_ERROR, false, t0, t0))
    }

    @Test
    fun `terminal codes stay terminal past the window (evidence names the real reason)`() {
        val late = t0 + AckRetryPolicy.ACK_WINDOW_MS + 1
        assertEquals(Decision.GIVE_UP_TERMINAL, AckRetryPolicy.decide(AckRetryPolicy.ITEM_NOT_OWNED, false, t0, late))
    }

    @Test
    fun `every other code retries inside the window`() {
        for (code in transientCodes) {
            assertEquals(
                "code=$code inside the window must RETRY",
                Decision.RETRY,
                AckRetryPolicy.decide(code, false, t0, t0 + 60_000),
            )
        }
    }

    @Test
    fun `the three-day window ends the retry chain, boundary exact`() {
        val justInside = t0 + AckRetryPolicy.ACK_WINDOW_MS - 1
        val atWindow = t0 + AckRetryPolicy.ACK_WINDOW_MS
        assertEquals(Decision.RETRY, AckRetryPolicy.decide(6, false, t0, justInside))
        assertEquals(Decision.GIVE_UP_WINDOW, AckRetryPolicy.decide(6, false, t0, atWindow))
    }

    @Test
    fun `a failed ack retried later succeeds on OK (the recovery path)`() {
        // The sequence the retry lane exists for: fail transiently, retry, land.
        assertEquals(Decision.RETRY, AckRetryPolicy.decide(12, false, t0, t0))
        assertEquals(Decision.SUCCESS, AckRetryPolicy.decide(AckRetryPolicy.OK, false, t0, t0 + 120_000))
    }

    @Test
    fun `connection failures are never terminal, only window-capped`() {
        // A setup failure says nothing about the purchase: DEVELOPER_ERROR-class
        // codes from startConnection must not clear the pending record.
        assertEquals(Decision.RETRY, AckRetryPolicy.decideConnectionFailure(t0, t0 + 60_000))
        assertEquals(
            Decision.GIVE_UP_WINDOW,
            AckRetryPolicy.decideConnectionFailure(t0, t0 + AckRetryPolicy.ACK_WINDOW_MS),
        )
    }

    @Test
    fun `the window constant is Play's three days`() {
        assertEquals(3L * 24 * 60 * 60 * 1000, AckRetryPolicy.ACK_WINDOW_MS)
    }
}
