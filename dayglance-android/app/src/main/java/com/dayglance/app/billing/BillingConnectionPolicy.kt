package com.dayglance.app.billing

/**
 * Decision table for the shared BillingClient's connection lifecycle — the
 * pure half of the connection-ownership fix (the AckRetryPolicy pattern:
 * decisions in a dependency-free file with tests, wiring in BillingManager).
 * No Play Billing import on purpose, so the tests run on a plain JVM; the
 * constants below are Play's stable public BillingClient.ConnectionState
 * values.
 *
 * WHY THIS EXISTS: a BillingClient cannot be reused after endConnection() —
 * confirmed on a real device ("Client was already closed and can't be
 * reused"). The old lifecycle built one client per activity and closed it on
 * every onStop, so after the first background/foreground cycle every billing
 * operation in that process silently no-opped: restore reported success from
 * the stale cache, purchases errored with billing_not_ready, and
 * queryPurchases (entitlement refresh + the re-acknowledgement lane) never
 * ran again until process death.
 *
 * The invariant the two decisions enforce, structurally rather than by
 * remembering to check:
 *
 *  - [clientAction], consulted on EVERY access to the shared client: a CLOSED
 *    instance is never handed out — it is replaced first, so the closed
 *    object becomes unreachable and reuse-after-endConnection is impossible
 *    by construction.
 *  - [connectAction], consulted by the foreground connect: startConnection is
 *    only issued when it will do something — never re-issued on a live
 *    connection (keep-alive across backgrounds), never stacked on a
 *    connection already in flight (rapid foregrounds).
 */
object BillingConnectionPolicy {

    // BillingClient.ConnectionState values (stable public constants),
    // declared locally to keep this file JVM-pure.
    const val DISCONNECTED = 0
    const val CONNECTING = 1
    const val CONNECTED = 2
    const val CLOSED = 3

    enum class ClientAction {
        /** The held instance is safe to hand out (it may still need connecting). */
        REUSE,
        /** The held instance is closed and can never be used again: replace it
         *  with a fresh one before doing anything. */
        RECREATE,
    }

    enum class ConnectAction {
        /** Live connection: nothing to start — proceed straight to the
         *  on-foreground queries. */
        ALREADY_CONNECTED,
        /** A startConnection is already in flight: issuing another stacks
         *  setup callbacks for nothing. Let the in-flight one finish. */
        WAIT,
        /** No connection and none in flight: startConnection now. */
        CONNECT,
    }

    /**
     * Decide, for every access to the shared client, whether the held
     * instance may be used or must be replaced first.
     */
    fun clientAction(connectionState: Int): ClientAction =
        if (connectionState == CLOSED) ClientAction.RECREATE else ClientAction.REUSE

    /**
     * Decide what the foreground connect should do, given the state of an
     * instance [clientAction] already deemed usable. CLOSED still maps to
     * CONNECT as defence in depth: it is unreachable through the accessor
     * (a closed instance is replaced first, and a fresh client starts
     * DISCONNECTED), but the total function's answer for a replacement
     * client is to connect it.
     */
    fun connectAction(connectionState: Int): ConnectAction = when (connectionState) {
        CONNECTED -> ConnectAction.ALREADY_CONNECTED
        CONNECTING -> ConnectAction.WAIT
        else -> ConnectAction.CONNECT
    }
}
