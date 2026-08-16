package com.dayglance.app.billing

/**
 * Decision logic for retrying Google Play purchase acknowledgement — the pure
 * half of the ack-retry lane (the SseBackoff pattern: decisions in a
 * dependency-free file with tests, wiring in AckRetryWorker/BillingManager).
 * No Play Billing import on purpose, so the tests run on a plain JVM; the
 * response-code constants below are Play's stable public API values.
 *
 * WHY THIS EXISTS: Google Play auto-refunds any purchase not acknowledged
 * within three days and revokes the entitlement. The ack call used to be
 * fire-and-forget; if it failed (dropped connection right after purchase) and
 * the user did not reopen the app within 72 hours, they were silently
 * refunded and lost what they paid for. The retry lane this file decides for
 * must terminate correctly in every case:
 *
 *  - OK, or a fresh Play query reporting the purchase already acknowledged
 *    (isAcknowledged is treated as AUTHORITATIVE success) → done.
 *  - ITEM_NOT_OWNED / DEVELOPER_ERROR → terminal: the purchase no longer
 *    exists for us (refunded, consumed) or the token is malformed; retrying
 *    forever would hammer Play for a purchase that can never be acknowledged.
 *    The pending record is cleared but the diagnostic evidence is kept.
 *  - Everything else → retry, until the pending record is older than the
 *    three-day acknowledgement window; then stop, evidence kept.
 *
 * CONSERVATIVE BY DESIGN: only the two clearly-terminal codes give up early.
 * A retry that gives up wrongly costs the user a refund and us a sale; a
 * retry that continues wrongly costs a log line. Connection failures are
 * never treated as terminal at all — only an actual acknowledge response can
 * claim the purchase is gone.
 */
object AckRetryPolicy {

    // BillingClient.BillingResponseCode values (stable public constants),
    // declared locally to keep this file JVM-pure.
    const val OK = 0
    const val DEVELOPER_ERROR = 5
    const val ITEM_NOT_OWNED = 8

    /**
     * Play's acknowledgement window: three days from purchase. The pending
     * record's firstFailedAt is a lower bound on purchase age, so measuring
     * the window from it never gives up early.
     */
    const val ACK_WINDOW_MS: Long = 3L * 24 * 60 * 60 * 1000

    enum class Decision {
        /** Acknowledged (now or previously). Clear the pending record. */
        SUCCESS,
        /** Transient failure inside the window. Keep the record, retry later. */
        RETRY,
        /** The purchase can never be acknowledged. Clear the record, keep evidence. */
        GIVE_UP_TERMINAL,
        /** The window has passed; Play has already resolved it one way or the
         *  other. Clear the record, keep evidence. */
        GIVE_UP_WINDOW,
    }

    /**
     * Decide the outcome of one acknowledge attempt.
     *
     * @param responseCode        BillingResponseCode from acknowledgePurchase
     * @param alreadyAcknowledged isAcknowledged from a FRESH purchases query,
     *                            checked before attempting the ack — authoritative
     *                            success regardless of any response code
     * @param firstFailedAtMs     epoch ms of the first failed ack for this token
     * @param nowMs               injected clock
     */
    fun decide(
        responseCode: Int,
        alreadyAcknowledged: Boolean,
        firstFailedAtMs: Long,
        nowMs: Long,
    ): Decision {
        if (alreadyAcknowledged || responseCode == OK) return Decision.SUCCESS
        if (responseCode == ITEM_NOT_OWNED || responseCode == DEVELOPER_ERROR) {
            return Decision.GIVE_UP_TERMINAL
        }
        if (nowMs - firstFailedAtMs >= ACK_WINDOW_MS) return Decision.GIVE_UP_WINDOW
        return Decision.RETRY
    }

    /**
     * Decide the outcome of a failed billing CONNECTION (the ack was never
     * attempted). Never terminal — a setup failure says nothing about the
     * purchase — but still window-capped so the chain cannot run forever.
     */
    fun decideConnectionFailure(firstFailedAtMs: Long, nowMs: Long): Decision {
        if (nowMs - firstFailedAtMs >= ACK_WINDOW_MS) return Decision.GIVE_UP_WINDOW
        return Decision.RETRY
    }
}
