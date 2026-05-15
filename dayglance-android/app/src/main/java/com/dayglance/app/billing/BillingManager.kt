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
 * Call [connect] from Activity.onStart() and [disconnect] from Activity.onStop().
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

    private val purchasesUpdatedListener = PurchasesUpdatedListener { result, purchases ->
        Log.d(TAG, "purchasesUpdatedListener: code=${result.responseCode} msg='${result.debugMessage}' purchases=${purchases?.size ?: "null"}")
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

    private val billingClient: BillingClient = BillingClient.newBuilder(context)
        .setListener(purchasesUpdatedListener)
        .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
        .build()

    fun connect() {
        billingClient.startConnection(object : BillingClientStateListener {
            override fun onBillingSetupFinished(result: BillingResult) {
                if (result.responseCode == BillingClient.BillingResponseCode.OK) {
                    queryPurchases()
                    queryProductPrices()
                }
            }
            override fun onBillingServiceDisconnected() {
                // Play will retry automatically; we reconnect on next connect() call.
            }
        })
    }

    /**
     * Fetches prices for all products and caches them in SharedPreferences.
     *
     * Annual (SUBS): filters for the INFINITE_RECURRING phase (recurrenceMode 1).
     * Lifetime (INAPP): reads oneTimePurchaseOfferDetails.formattedPrice directly.
     */
    fun queryProductPrices() {
        if (!billingClient.isReady) return

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
            billingClient.queryProductDetailsAsync(subsParams) { result, detailsList ->
                if (result.responseCode != BillingClient.BillingResponseCode.OK) return@queryProductDetailsAsync
                for (details in detailsList) {
                    val price = details.subscriptionOfferDetails
                        ?.flatMap { it.pricingPhases.pricingPhaseList }
                        ?.firstOrNull { it.recurrenceMode == 1 }
                        ?.formattedPrice ?: continue
                    if (details.productId == PRODUCT_ANNUAL) dataStore.productPriceAnnual = price
                }
            }
            billingClient.queryProductDetailsAsync(inappParams) { result, detailsList ->
                if (result.responseCode != BillingClient.BillingResponseCode.OK) return@queryProductDetailsAsync
                for (details in detailsList) {
                    val price = details.oneTimePurchaseOfferDetails?.formattedPrice ?: continue
                    if (details.productId == PRODUCT_LIFETIME) dataStore.productPriceLifetime = price
                }
            }
        }
    }

    fun disconnect() {
        billingClient.endConnection()
    }

    private suspend fun queryPurchasesForType(productType: String): List<Purchase> =
        suspendCancellableCoroutine { cont ->
            billingClient.queryPurchasesAsync(
                QueryPurchasesParams.newBuilder().setProductType(productType).build()
            ) { _, purchases -> cont.resume(purchases) }
        }

    fun queryPurchases() {
        if (!billingClient.isReady) return
        scope.launch {
            val activeSub = queryPurchasesForType(BillingClient.ProductType.SUBS)
                .firstOrNull { it.purchaseState == Purchase.PurchaseState.PURCHASED }

            val active = activeSub ?: queryPurchasesForType(BillingClient.ProductType.INAPP)
                .firstOrNull { it.purchaseState == Purchase.PurchaseState.PURCHASED }

            if (active != null) {
                if (!active.isAcknowledged) acknowledgePurchase(active)
                dataStore.subscriptionActive = true
                dataStore.subscriptionProductId = active.products.firstOrNull()
                dataStore.subscriptionToken = active.purchaseToken
            } else {
                dataStore.subscriptionActive = false
                dataStore.subscriptionProductId = null
                dataStore.subscriptionToken = null
            }
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
        if (!billingClient.isReady) {
            Log.w(TAG, "launchPurchaseFlow($productId): client not ready")
            onBillingEvent?.invoke("error", BillingClient.BillingResponseCode.SERVICE_DISCONNECTED, "billing_not_ready", productId)
            return
        }

        pendingProductId = productId
        val productType = if (productId in INAPP_PRODUCTS) BillingClient.ProductType.INAPP
                          else BillingClient.ProductType.SUBS

        Log.d(TAG, "launchPurchaseFlow($productId): type=$productType ts=${System.currentTimeMillis()}")

        val params = QueryProductDetailsParams.newBuilder()
            .setProductList(listOf(
                QueryProductDetailsParams.Product.newBuilder()
                    .setProductId(productId)
                    .setProductType(productType)
                    .build()
            ))
            .build()

        scope.launch {
            billingClient.queryProductDetailsAsync(params) { result, detailsList ->
                Log.d(TAG, "launchPurchaseFlow($productId): queryProductDetailsAsync code=${result.responseCode} msg='${result.debugMessage}' count=${detailsList.size} ts=${System.currentTimeMillis()}")

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
                            Log.d(TAG, "launchPurchaseFlow($productId): offerToken='${offerToken.take(20)}...'")
                            setOfferToken(offerToken)
                        }
                    }
                    .build()

                val flowParams = BillingFlowParams.newBuilder()
                    .setProductDetailsParamsList(listOf(productDetailsParams))
                    .build()

                act.runOnUiThread {
                    val launchResult = billingClient.launchBillingFlow(act, flowParams)
                    Log.d(TAG, "launchBillingFlow: code=${launchResult.responseCode} msg='${launchResult.debugMessage}' ts=${System.currentTimeMillis()}")
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

    private fun acknowledgePurchase(purchase: Purchase) {
        val params = AcknowledgePurchaseParams.newBuilder()
            .setPurchaseToken(purchase.purchaseToken)
            .build()
        billingClient.acknowledgePurchase(params) { /* fire and forget */ }
    }

    fun consumePurchase(token: String, onComplete: (success: Boolean) -> Unit) {
        // Always clear the local cache so the subscription wall reappears immediately.
        dataStore.subscriptionActive = false
        dataStore.subscriptionProductId = null
        dataStore.subscriptionToken = null

        if (!billingClient.isReady) {
            onComplete(true)
            return
        }
        scope.launch {
            // Query INAPP purchases directly rather than relying on the token stored in
            // dataStore. When an annual test subscription is active, queryPurchases() stores
            // the SUBS token (SUBS has priority), leaving the lifetime INAPP token untouched.
            // Querying INAPP directly ensures the lifetime token is always consumed.
            val inappPurchases = queryPurchasesForType(BillingClient.ProductType.INAPP)
            for (purchase in inappPurchases) {
                val p = ConsumeParams.newBuilder().setPurchaseToken(purchase.purchaseToken).build()
                suspendCancellableCoroutine { cont ->
                    billingClient.consumeAsync(p) { result, _ ->
                        Log.d(TAG, "consumeAsync INAPP ${purchase.purchaseToken.takeLast(8)}: code=${result.responseCode} msg='${result.debugMessage}'")
                        cont.resume(Unit)
                    }
                }
            }
            // Also attempt the originally stored token (may be a SUBS token for an annual
            // test subscription — consumeAsync can succeed on license-tester SUBS tokens).
            if (inappPurchases.none { it.purchaseToken == token }) {
                val p = ConsumeParams.newBuilder().setPurchaseToken(token).build()
                suspendCancellableCoroutine { cont ->
                    billingClient.consumeAsync(p) { result, _ ->
                        Log.d(TAG, "consumeAsync stored token ${token.takeLast(8)}: code=${result.responseCode} msg='${result.debugMessage}'")
                        cont.resume(Unit)
                    }
                }
            }
            onComplete(true)
        }
    }
}
