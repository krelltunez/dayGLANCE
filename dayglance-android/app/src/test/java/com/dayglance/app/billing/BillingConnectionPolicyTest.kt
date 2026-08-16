package com.dayglance.app.billing

import com.dayglance.app.billing.BillingConnectionPolicy.ClientAction
import com.dayglance.app.billing.BillingConnectionPolicy.ConnectAction
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

/**
 * Unit tests for the connection-lifecycle decisions (plain JVM, no billing
 * client — the AckRetryPolicy precedent).
 *
 * The stakes: a BillingClient is dead forever after endConnection(). The old
 * lifecycle reconnected a closed instance on every foreground after the
 * first, which silently broke restores, purchases, and the entitlement
 * refresh for the rest of the process. These decisions make that reuse
 * impossible (closed instances are replaced before use) while keeping
 * connect idempotent (no churn, no stacked startConnection calls).
 */
class BillingConnectionPolicyTest {

    private val allStates = listOf(
        BillingConnectionPolicy.DISCONNECTED,
        BillingConnectionPolicy.CONNECTING,
        BillingConnectionPolicy.CONNECTED,
        BillingConnectionPolicy.CLOSED,
    )

    @Test
    fun `a closed client is never reused - it is replaced`() {
        assertEquals(
            ClientAction.RECREATE,
            BillingConnectionPolicy.clientAction(BillingConnectionPolicy.CLOSED),
        )
    }

    @Test
    fun `every non-closed state hands the held instance out unchanged`() {
        for (state in allStates.filter { it != BillingConnectionPolicy.CLOSED }) {
            assertEquals(
                "state=$state must REUSE",
                ClientAction.REUSE,
                BillingConnectionPolicy.clientAction(state),
            )
        }
    }

    @Test
    fun `the invariant - no state both hands out and is closed`() {
        // Property form of the fix: for every state, either the instance is
        // not closed, or it is replaced. There is no third cell in the
        // table, which is what "impossible by construction" means.
        for (state in allStates) {
            val handedOut = BillingConnectionPolicy.clientAction(state) == ClientAction.REUSE
            assertFalse(
                "state=$state would hand out a closed client",
                handedOut && state == BillingConnectionPolicy.CLOSED,
            )
        }
    }

    @Test
    fun `foreground connect on a live connection does nothing (keep-alive)`() {
        assertEquals(
            ConnectAction.ALREADY_CONNECTED,
            BillingConnectionPolicy.connectAction(BillingConnectionPolicy.CONNECTED),
        )
    }

    @Test
    fun `foreground connect while connecting waits - no stacked startConnection`() {
        // Rapid background/foreground cycles must not pile startConnection
        // calls onto the attempt already in flight.
        assertEquals(
            ConnectAction.WAIT,
            BillingConnectionPolicy.connectAction(BillingConnectionPolicy.CONNECTING),
        )
    }

    @Test
    fun `disconnected connects - first launch and after a service drop`() {
        assertEquals(
            ConnectAction.CONNECT,
            BillingConnectionPolicy.connectAction(BillingConnectionPolicy.DISCONNECTED),
        )
    }

    @Test
    fun `closed maps to connect as defence in depth`() {
        // Unreachable through the accessor (clientAction replaces CLOSED
        // first, and a fresh client starts DISCONNECTED), but the total
        // function's right answer for the replacement client is: connect.
        assertEquals(
            ConnectAction.CONNECT,
            BillingConnectionPolicy.connectAction(BillingConnectionPolicy.CLOSED),
        )
    }

    @Test
    fun `repeated buy taps during a slow connect never stack`() {
        // The not-ready purchase guard kicks connect() on every failed tap
        // (launchPurchaseFlow's billing_not_ready path), so a user hammering
        // buy on a slow connection is the same shape as rapid foregrounds.
        // First tap finds DISCONNECTED and starts the one attempt; every
        // further tap while that attempt is in flight must WAIT — this is
        // the rule that keeps the reconnect-on-failure change from stacking
        // startConnection calls.
        assertEquals(
            ConnectAction.CONNECT,
            BillingConnectionPolicy.connectAction(BillingConnectionPolicy.DISCONNECTED),
        )
        repeat(5) {
            assertEquals(
                "tap ${it + 2} while connecting must WAIT",
                ConnectAction.WAIT,
                BillingConnectionPolicy.connectAction(BillingConnectionPolicy.CONNECTING),
            )
        }
    }

    @Test
    fun `the constants are Play's ConnectionState values`() {
        // BillingClient.ConnectionState: DISCONNECTED=0, CONNECTING=1,
        // CONNECTED=2, CLOSED=3 — mirrored locally so the policy stays
        // JVM-pure; this pins the mirror to the documented values.
        assertEquals(0, BillingConnectionPolicy.DISCONNECTED)
        assertEquals(1, BillingConnectionPolicy.CONNECTING)
        assertEquals(2, BillingConnectionPolicy.CONNECTED)
        assertEquals(3, BillingConnectionPolicy.CLOSED)
    }

    @Test
    fun `the confirmed device sequence - background and foreground twice`() {
        // The sequence from the device check that confirmed the hazard:
        // connect, background, foreground, background, foreground. Old code
        // closed the client on each background and reconnected the dead
        // instance. Under the new table the client is never closed on
        // background, so each foreground is a no-op reuse of the live
        // connection — and if anything ever HAS closed it, the table
        // replaces rather than reuses.
        assertEquals(
            ClientAction.REUSE,
            BillingConnectionPolicy.clientAction(BillingConnectionPolicy.CONNECTED),
        )
        assertEquals(
            ConnectAction.ALREADY_CONNECTED,
            BillingConnectionPolicy.connectAction(BillingConnectionPolicy.CONNECTED),
        )
        assertEquals(
            ClientAction.RECREATE,
            BillingConnectionPolicy.clientAction(BillingConnectionPolicy.CLOSED),
        )
    }
}
