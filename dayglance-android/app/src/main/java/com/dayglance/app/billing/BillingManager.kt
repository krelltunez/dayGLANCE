package com.dayglance.app.billing

import android.app.Activity
import android.content.Context
import android.util.Log
import com.android.billingclient.api.AcknowledgePurchaseParams
import com.android.billingclient.api.BillingClient
import com.android.billingclient.api.ConsumeParams
import com.android.billingclient.api.BillingClientStateListener
import com.android.billingclient.api.BillingFlowParams
import com.android.billingclient.api.BillingResult
import com.android.billingclient.api.Purchase
import com.android.billingclient.api.PurchasesUpdatedListener
import com.android.billingclient.api.QueryProductDetailsParams
import com.android.billingclient.api.PendingPurchasesParams
import com.android.billingclient.api.QueryPurchasesParams
import com.dayglance.app.BuildConfig
import com.dayglance.app.data.SharedDataStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume

/**
 * Manages the Google Play Billing client lifecycle for dayGLANCE subscriptions.
 *
 * Annual plan → Play Console: Monetize → Subscriptions (product type SUBS).
 * Lifetime plan → Play Console: Monetize → In-app products (product type INAPP).
 *
 * Lifecycle: call [connect] from Activity.onStart() and [destroy] from
 * Activity.onDestroy(). Nothing is called on onStop — the connection is
 * deliberately kept alive across backgrounding. A BillingClient is dead
 * forever after endConnection() (device-confirmed: "Client was already
 * closed and can't be reused"), and the old close-on-onStop lifecycle left
 * every billing operation silently no-opping after the first
 * background/foreground cycle. The Play service binding is cheap to hold and
 * Google's own samples keep it for the life of the process.
 *
 * The shared client lives behind [client], the single accessor that replaces
 * a CLOSED instance before handing anything out (decision table in
 * [BillingConnectionPolicy]) — reuse of a closed client is impossible by
 * construction, not avoided by convention. AckRetryWorker deliberately does
 * NOT go through this accessor: its retry lane owns a short-lived client per
 * attempt precisely so it never depends on the shared instance's lifecycle.
 *
 * Set [activity] before calling [launchPurchaseFlow].
 */
class BillingManager(
    private val context: Context,
    private val dataStore: SharedDataStore,
) {

    companion object {
        private const val TAG = "DayGlanceBilling"
        // These IDs must match what you create in the Play Console exactly.
        const val PRODUCT_ANNUAL   = "dayglance_pro_annual"
        const val PRODUCT_LIFETIME = "dayglance_pro_lifetime"
        val SUBSCRIPTION_PRODUCTS = listOf(PRODUCT_ANNUAL)
        val INAPP_PRODUCTS        = listOf(PRODUCT_LIFETIME)
        val ALL_PRODUCTS          = SUBSCRIPTION_PRODUCTS + INAPP_PRODUCTS
    }

    var activity: Activity? = null

    /** Called once after the first queryPurchases() completes. Used to signal the splash screen. */
    var onPurchasesQueried: (() -> Unit)? = null

    /**
     * Fires exactly once per purchase flow with a terminal result.
     * status: "success" | "cancelled" | "error"
     * code: BillingResponseCode integer
     * message: debugMessage from Play, or an internal label for pre-launch exits
     * productId: the product that was being purchased, or null if unknown
     */
    var onBillingEvent: ((status: String, code: Int, message: String, productId: String?) -> Unit)? = null

    /** Tracks the product currently going through the purchase flow for error reporting. */
    private var pendingProductId: String? = null

    private val scope = CoroutineScope(Dispatchers.IO)

    /**
     * Debug-only logging. Purchase flow details (tokens, offer tokens, product ids)
     * must never reach logcat in release builds, so these are stripped when
     * BuildConfig.DEBUG is false. Log.w / Log.e are kept for release diagnostics.
     */
    private fun logd(msg: String) {
        if (BuildConfig.DEBUG) Log.d(TAG, msg)
    }

    private val purchasesUpdatedListener = PurchasesUpdatedListener { result, purchases ->
        logd("purchasesUpdatedListener: code=${result.responseCode} msg='${result.debugMessage}' purchases=${purchases?.size ?: "null"}")
        when {
            result.responseCode == BillingClient.BillingResponseCode.OK && !purchases.isNullOrEmpty() -> {
                for (purchase in purchases) handlePurchase(purchase)
                // success event fired per-purchase inside handlePurchase
            }
            result.responseCode == BillingClient.BillingResponseCode.USER_CANCELED -> {
                onBillingEvent?.invoke("cancelled", result.responseCode, result.debugMessage, pendingProductId)
            }
            result.responseCode == BillingClient.BillingResponseCode.OK -> {
                // OK but no purchases — play sheet dismissed without completing
                onBillingEvent?.invoke("cancelled", result.responseCode, result.debugMessage, pendingProductId)
            }
            else -> {
                onBillingEvent?.invoke("error", result.responseCode, result.debugMessage, pendingProductId)
            }
        }
    }

    /**
     * The ONLY reference to the shared BillingClient, and it is never touched
     * directly — every use goes through [client]. Lazily built: debug and
     * github-flavor builds, which never connect, never construct one either.
     */
    private var billingClient: BillingClient? = null

    /**
     * Single accessor for the shared client. Consults
     * [BillingConnectionPolicy.clientAction]: a CLOSED instance (dead forever,
     * per Play's documentation and the device-confirmed warning) is replaced
     * with a fresh one before anything is handed out, which makes the closed
     * object unreachable. Synchronized because billing entry points span the
     * main thread (onStart) and the WebView's JS thread (SubscriptionBridge).
     *
     * A fresh instance starts DISCONNECTED and holds no service binding until
     * startConnection — so an accessor hit after [destroy] (e.g. a late JS
     * bridge call during teardown) creates only an inert object, never a leak.
     */
    @Synchronized
    private fun client(): BillingClient {
        val held = billingClient
        if (held != null &&
            BillingConnectionPolicy.clientAction(held.connectionState) ==
                BillingConnectionPolicy.ClientAction.REUSE
        ) {
            return held
        }
        val fresh = BillingClient.newBuilder(context)
            .setListener(purchasesUpdatedListener)
            .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
            // PBL 8: service drops (Play killing the binding while we hold the
            // client) reconnect themselves instead of waiting for the next
            // foreground connect().
            .enableAutoServiceReconnection()
            .build()
        billingClient = fresh
        return fresh
    }

    /**
     * Idempotent foreground connect — called from Activity.onStart() on every
     * foreground. [BillingConnectionPolicy.connectAction] decides: a live
     * connection skips straight to the queries (keep-alive), an in-flight
     * connection is left to finish (its setup callback runs the queries), and
     * only a disconnected client actually starts a connection. Either path
     * ends with [queryPurchases] running on this foreground, which is what
     * keeps entitlement fresh and the re-acknowledgement lane live.
     */
    fun connect() {
        val client = client()
        when (BillingConnectionPolicy.connectAction(client.connectionState)) {
            BillingConnectionPolicy.ConnectAction.ALREADY_CONNECTED -> {
                queryPurchases()
                queryProductPrices()
            }
            BillingConnectionPolicy.ConnectAction.WAIT -> {
                // startConnection already in flight; its onBillingSetupFinished
                // will run the queries. Stacking another does nothing useful.
            }
            BillingConnectionPolicy.ConnectAction.CONNECT -> {
                client.startConnection(object : BillingClientStateListener {
                    override fun onBillingSetupFinished(result: BillingResult) {
                        if (result.responseCode == BillingClient.BillingResponseCode.OK) {
                            queryPurchases()
                            queryProductPrices()
                        }
                    }
                    override fun onBillingServiceDisconnected() {
                        // enableAutoServiceReconnection re-establishes the
                        // service connection on this same instance; the next
                        // onStart's connect() is the backstop.
                    }
                })
            }
        }
    }

    /**
     * Fetches prices for all products and caches them in SharedPreferences.
     *
     * Annual (SUBS): filters for the INFINITE_RECURRING phase (recurrenceMode 1).
     * Lifetime (INAPP): reads oneTimePurchaseOfferDetailsList[0].formattedPrice directly.
     */
    fun queryProductPrices() {
        val client = client()
        if (!client.isReady) return

        val subsParams = QueryProductDetailsParams.newBuilder()
            .setProductList(SUBSCRIPTION_PRODUCTS.map { id ->
                QueryProductDetailsParams.Product.newBuilder()
                    .setProductId(id)
                    .setProductType(BillingClient.ProductType.SUBS)
                    .build()
            })
            .build()

        val inappParams = QueryProductDetailsParams.newBuilder()
            .setProductList(INAPP_PRODUCTS.map { id ->
                QueryProductDetailsParams.Product.newBuilder()
                    .setProductId(id)
                    .setProductType(BillingClient.ProductType.INAPP)
                    .build()
            })
            .build()

        scope.launch {
            client.queryProductDetailsAsync(subsParams) { result, queryResult ->
                if (result.responseCode != BillingClient.BillingResponseCode.OK) return@queryProductDetailsAsync
                for (details in queryResult.productDetailsList) {
                    if (details.productId != PRODUCT_ANNUAL) continue
                    val offerDetails = details.subscriptionOfferDetails ?: continue
                    val price = offerDetails
                        .flatMap { it.pricingPhases.pricingPhaseList }
                        .firstOrNull { it.recurrenceMode == 1 }
                        ?.formattedPrice
                    if (price != null) dataStore.productPriceAnnual = price
                    // A zero-price phase indicates a free trial. Play only surfaces this offer
                    // when the user is still eligible; absence means the trial has been used.
                    val trialPhase = offerDetails
                        .flatMap { it.pricingPhases.pricingPhaseList }
                        .firstOrNull { it.priceAmountMicros == 0L }
                    dataStore.trialEligibleAnnual = trialPhase != null
                    // Trial LENGTH comes from the store too (ISO-8601 billingPeriod,
                    // e.g. "P14D"/"P2W") so the paywall never hardcodes a number.
                    trialPhase?.billingPeriod
                        ?.let { parseIsoPeriodToDays(it) }
                        ?.takeIf { it > 0 }
                        ?.let { dataStore.trialDaysAnnual = it }
                }
            }
            client.queryProductDetailsAsync(inappParams) { result, queryResult ->
                if (result.responseCode != BillingClient.BillingResponseCode.OK) return@queryProductDetailsAsync
                for (details in queryResult.productDetailsList) {
                    // PBL 8 replaced the singular oneTimePurchaseOfferDetails with a list
                    // (one-time products can carry multiple offers now); take the base offer.
                    val price = details.oneTimePurchaseOfferDetailsList?.firstOrNull()?.formattedPrice ?: continue
                    if (details.productId == PRODUCT_LIFETIME) dataStore.productPriceLifetime = price
                }
            }
        }
    }

    /**
     * Final teardown for THIS manager instance — Activity.onDestroy() only,
     * never onStop. Required, not cleanup: MainActivity handles
     * orientation/screenSize/screenLayout/keyboardHidden config changes
     * itself but NOT uiMode or locale, so a dark-mode toggle or language
     * change recreates the activity, which builds a new manager and client.
     * The old binding used to be released by onStop's disconnect purely by
     * accident; without this, every recreation would leak a binding.
     *
     * Under the accessor invariant each client is closed at most once, and
     * only here — which is also why the "Receiver is not registered" warning
     * (a second endConnection on an already-closed client) should never
     * appear again. Deliberately does not construct: closing nothing is fine.
     */
    @Synchronized
    fun destroy() {
        billingClient?.endConnection()
        billingClient = null
    }

    /** "P14D" → 14, "P2W" → 14. Months/years approximated (unused for trials in practice). */
    private fun parseIsoPeriodToDays(iso: String): Int? = try {
        val p = java.time.Period.parse(iso)
        p.years * 365 + p.months * 30 + p.days
    } catch (_: Exception) {
        null
    }

    private suspend fun queryPurchasesForType(client: BillingClient, productType: String): List<Purchase> =
        suspendCancellableCoroutine { cont ->
            client.queryPurchasesAsync(
                QueryPurchasesParams.newBuilder().setProductType(productType).build()
            ) { _, purchases -> cont.resume(purchases) }
        }

    fun queryPurchases() {
        val client = client()
        if (!client.isReady) return
        scope.launch {
            val activeSub = queryPurchasesForType(client, BillingClient.ProductType.SUBS)
                .firstOrNull { it.purchaseState == Purchase.PurchaseState.PURCHASED }

            val active = activeSub ?: queryPurchasesForType(client, BillingClient.ProductType.INAPP)
                .firstOrNull { it.purchaseState == Purchase.PurchaseState.PURCHASED }

            if (active != null) {
                if (!active.isAcknowledged) {
                    // Opportunistic re-ack lane: outcome-aware (recorded and
                    // retried on failure via acknowledgePurchase), no longer a
                    // blind extra attempt.
                    acknowledgePurchase(active)
                } else if (dataStore.pendingAckToken == active.purchaseToken) {
                    // Play reports the pending token acknowledged (the retry
                    // worker, a prior blind re-ack, or Play itself caught up):
                    // isAcknowledged from a fresh query is authoritative success.
                    AckRetryWorker.recordSuccess(dataStore, active.purchaseToken)
                    logd("pending ack cleared: Play reports token=…${active.purchaseToken.takeLast(8)} acknowledged")
                }
                dataStore.subscriptionActive = true
                dataStore.subscriptionProductId = active.products.firstOrNull()
                dataStore.subscriptionToken = active.purchaseToken
            } else {
                dataStore.subscriptionActive = false
                dataStore.subscriptionProductId = null
                dataStore.subscriptionToken = null
            }
            // Backstop: a pending-ack record with no live retry chain (WorkManager
            // state cleared by the OS or the user) gets re-scheduled here. KEEP
            // policy makes this a no-op while the chain is alive. The worker's
            // own query settles a record whose purchase has since vanished
            // (terminal ITEM_NOT_OWNED) or aged out (three-day window).
            if (dataStore.pendingAckToken != null) AckRetryWorker.schedule(context)
            onPurchasesQueried?.invoke()
            onPurchasesQueried = null
        }
    }

    /**
     * Launches the Google Play purchase sheet for [productId].
     * Routes to SUBS or INAPP depending on the product. Must be called with
     * [activity] set; the billing flow is dispatched to the main thread.
     */
    fun launchPurchaseFlow(productId: String) {
        val act = activity ?: run {
            Log.w(TAG, "launchPurchaseFlow($productId): activity null")
            onBillingEvent?.invoke("error", BillingClient.BillingResponseCode.DEVELOPER_ERROR, "activity_null", productId)
            return
        }
        val client = client()
        if (!client.isReady) {
            Log.w(TAG, "launchPurchaseFlow($productId): client not ready")
            onBillingEvent?.invoke("error", BillingClient.BillingResponseCode.SERVICE_DISCONNECTED, "billing_not_ready", productId)
            return
        }

        pendingProductId = productId
        val productType = if (productId in INAPP_PRODUCTS) BillingClient.ProductType.INAPP
                          else BillingClient.ProductType.SUBS

        logd("launchPurchaseFlow($productId): type=$productType ts=${System.currentTimeMillis()}")

        val params = QueryProductDetailsParams.newBuilder()
            .setProductList(listOf(
                QueryProductDetailsParams.Product.newBuilder()
                    .setProductId(productId)
                    .setProductType(productType)
                    .build()
            ))
            .build()

        scope.launch {
            client.queryProductDetailsAsync(params) { result, queryResult ->
                // PBL 8: the callback now delivers a QueryProductDetailsResult; the fetched
                // items live on .productDetailsList (unfetched products are reported separately).
                val detailsList = queryResult.productDetailsList
                logd("launchPurchaseFlow($productId): queryProductDetailsAsync code=${result.responseCode} msg='${result.debugMessage}' count=${detailsList.size} ts=${System.currentTimeMillis()}")

                // Verbose product details — debug builds only
                if (BuildConfig.DEBUG) {
                    detailsList.forEach { d ->
                        Log.d(TAG, "  ProductDetails: id=${d.productId} type=${d.productType}")
                        d.subscriptionOfferDetails?.forEachIndexed { i, o ->
                            Log.d(TAG, "  offer[$i]: basePlanId='${o.basePlanId}' offerId='${o.offerId}' token='${o.offerToken.take(20)}...'")
                        } ?: Log.d(TAG, "  subscriptionOfferDetails=null")
                    }
                }

                if (result.responseCode != BillingClient.BillingResponseCode.OK) {
                    Log.w(TAG, "launchPurchaseFlow($productId): query failed (exit A) code=${result.responseCode}")
                    onBillingEvent?.invoke("error", result.responseCode, result.debugMessage, productId)
                    return@queryProductDetailsAsync
                }
                val details = detailsList.firstOrNull() ?: run {
                    Log.w(TAG, "launchPurchaseFlow($productId): empty detailsList (exit B)")
                    onBillingEvent?.invoke("error", BillingClient.BillingResponseCode.ITEM_UNAVAILABLE, "product_not_found", productId)
                    return@queryProductDetailsAsync
                }

                val productDetailsParams = BillingFlowParams.ProductDetailsParams.newBuilder()
                    .setProductDetails(details)
                    .apply {
                        if (productType == BillingClient.ProductType.SUBS) {
                            val offerToken = details.subscriptionOfferDetails?.firstOrNull()?.offerToken ?: run {
                                Log.w(TAG, "launchPurchaseFlow($productId): no offerToken (exit C)")
                                onBillingEvent?.invoke("error", BillingClient.BillingResponseCode.ITEM_UNAVAILABLE, "no_offer_token", productId)
                                return@queryProductDetailsAsync
                            }
                            logd("launchPurchaseFlow($productId): offerToken='${offerToken.take(20)}...'")
                            setOfferToken(offerToken)
                        }
                    }
                    .build()

                val flowParams = BillingFlowParams.newBuilder()
                    .setProductDetailsParamsList(listOf(productDetailsParams))
                    .build()

                act.runOnUiThread {
                    val launchResult = client.launchBillingFlow(act, flowParams)
                    logd("launchBillingFlow: code=${launchResult.responseCode} msg='${launchResult.debugMessage}' ts=${System.currentTimeMillis()}")
                    if (launchResult.responseCode != BillingClient.BillingResponseCode.OK) {
                        onBillingEvent?.invoke("error", launchResult.responseCode, launchResult.debugMessage, productId)
                    }
                    // OK → wait for purchasesUpdatedListener to fire
                }
            }
        }
    }

    private fun handlePurchase(purchase: Purchase) {
        if (purchase.purchaseState != Purchase.PurchaseState.PURCHASED) return
        if (!purchase.isAcknowledged) acknowledgePurchase(purchase)
        dataStore.subscriptionActive = true
        val pid = purchase.products.firstOrNull()
        dataStore.subscriptionProductId = pid
        dataStore.subscriptionToken = purchase.purchaseToken
        onBillingEvent?.invoke("success", BillingClient.BillingResponseCode.OK, "", pid)
    }

    /**
     * Acknowledge a purchase, with the result recorded rather than discarded.
     * Play refunds any purchase not acknowledged within three days, so a
     * failure here is real money: it is persisted as a pending-ack record and
     * retried by AckRetryWorker (WorkManager: survives process death and
     * reboot, waits for connectivity, exponential backoff) until it succeeds,
     * proves terminal, or ages past the three-day window. Entitlement is NOT
     * gated on any of this — subscriptionActive is set by the callers before
     * or regardless of the ack outcome, deliberately.
     */
    private fun acknowledgePurchase(purchase: Purchase) {
        val token = purchase.purchaseToken
        val productId = purchase.products.firstOrNull()
        val params = AcknowledgePurchaseParams.newBuilder()
            .setPurchaseToken(token)
            .build()
        client().acknowledgePurchase(params) { result ->
            if (result.responseCode == BillingClient.BillingResponseCode.OK) {
                AckRetryWorker.recordSuccess(dataStore, token)
                logd("acknowledgePurchase OK: token=…${token.takeLast(8)}")
            } else {
                AckRetryWorker.recordFailureAndSchedule(
                    context, dataStore, token, productId, result.responseCode
                )
            }
        }
    }

    fun consumePurchase(token: String, onComplete: (success: Boolean) -> Unit) {
        // Always clear the local cache so the subscription wall reappears immediately.
        dataStore.subscriptionActive = false
        dataStore.subscriptionProductId = null
        dataStore.subscriptionToken = null

        val client = client()
        if (!client.isReady) {
            onComplete(true)
            return
        }
        scope.launch {
            // Query INAPP purchases directly rather than relying on the token stored in
            // dataStore. When an annual test subscription is active, queryPurchases() stores
            // the SUBS token (SUBS has priority), leaving the lifetime INAPP token untouched.
            // Querying INAPP directly ensures the lifetime token is always consumed.
            val inappPurchases = queryPurchasesForType(client, BillingClient.ProductType.INAPP)
            for (purchase in inappPurchases) {
                val p = ConsumeParams.newBuilder().setPurchaseToken(purchase.purchaseToken).build()
                suspendCancellableCoroutine { cont ->
                    client.consumeAsync(p) { result, _ ->
                        logd("consumeAsync INAPP ${purchase.purchaseToken.takeLast(8)}: code=${result.responseCode} msg='${result.debugMessage}'")
                        cont.resume(Unit)
                    }
                }
            }
            // Also attempt the originally stored token (may be a SUBS token for an annual
            // test subscription — consumeAsync can succeed on license-tester SUBS tokens).
            if (inappPurchases.none { it.purchaseToken == token }) {
                val p = ConsumeParams.newBuilder().setPurchaseToken(token).build()
                suspendCancellableCoroutine { cont ->
                    client.consumeAsync(p) { result, _ ->
                        logd("consumeAsync stored token ${token.takeLast(8)}: code=${result.responseCode} msg='${result.debugMessage}'")
                        cont.resume(Unit)
                    }
                }
            }
            onComplete(true)
        }
    }
}
