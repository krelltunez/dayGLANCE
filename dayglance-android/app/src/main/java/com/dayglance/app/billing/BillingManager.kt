package com.dayglance.app.billing

import android.app.Activity
import android.content.Context
import com.android.billingclient.api.AcknowledgePurchaseParams
import com.android.billingclient.api.BillingClient
import com.android.billingclient.api.BillingClientStateListener
import com.android.billingclient.api.BillingFlowParams
import com.android.billingclient.api.BillingResult
import com.android.billingclient.api.PendingPurchasesParams
import com.android.billingclient.api.Purchase
import com.android.billingclient.api.PurchasesUpdatedListener
import com.android.billingclient.api.QueryProductDetailsParams
import com.android.billingclient.api.QueryPurchasesParams
import com.dayglance.app.data.SharedDataStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/**
 * Manages the Google Play Billing client lifecycle for dayGLANCE subscriptions.
 *
 * Product IDs must be created in the Google Play Console under
 * Monetize → Subscriptions before they will resolve here.
 *
 * Call [connect] from Activity.onStart() and [disconnect] from Activity.onStop().
 * Set [activity] before calling [launchSubscriptionFlow].
 */
class BillingManager(
    private val context: Context,
    private val dataStore: SharedDataStore,
) {

    companion object {
        // These IDs must match what you create in the Play Console exactly.
        const val PRODUCT_MONTHLY = "dayglance_pro_monthly"
        const val PRODUCT_ANNUAL  = "dayglance_pro_annual"
        val ALL_PRODUCTS = listOf(PRODUCT_MONTHLY, PRODUCT_ANNUAL)
    }

    var activity: Activity? = null

    private val scope = CoroutineScope(Dispatchers.IO)

    private val purchasesUpdatedListener = PurchasesUpdatedListener { result, purchases ->
        if (result.responseCode == BillingClient.BillingResponseCode.OK && purchases != null) {
            for (purchase in purchases) handlePurchase(purchase)
        }
    }

    private val billingClient: BillingClient = BillingClient.newBuilder(context)
        .setListener(purchasesUpdatedListener)
        .enablePendingPurchases(
            PendingPurchasesParams.newBuilder()
                .enableOneTimeProducts()
                .build()
        )
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
     * Fetches the base (non-trial) price for each subscription product from Play
     * and caches it in SharedPreferences so the subscription wall can display it.
     *
     * Filters for the INFINITE_RECURRING pricing phase (recurrenceMode == 1),
     * which is the regular recurring charge — not the free-trial phase.
     */
    fun queryProductPrices() {
        if (!billingClient.isReady) return
        val params = QueryProductDetailsParams.newBuilder()
            .setProductList(
                ALL_PRODUCTS.map { id ->
                    QueryProductDetailsParams.Product.newBuilder()
                        .setProductId(id)
                        .setProductType(BillingClient.ProductType.SUBS)
                        .build()
                }
            )
            .build()

        scope.launch {
            billingClient.queryProductDetailsAsync(params) { result, detailsList ->
                if (result.responseCode != BillingClient.BillingResponseCode.OK) return@queryProductDetailsAsync
                for (details in detailsList) {
                    // Find the base recurring price phase (recurrenceMode 1 = INFINITE_RECURRING).
                    val price = details.subscriptionOfferDetails
                        ?.flatMap { it.pricingPhases.pricingPhaseList }
                        ?.firstOrNull { it.recurrenceMode == 1 }
                        ?.formattedPrice ?: continue
                    when (details.productId) {
                        PRODUCT_MONTHLY -> dataStore.productPriceMonthly = price
                        PRODUCT_ANNUAL  -> dataStore.productPriceAnnual  = price
                    }
                }
            }
        }
    }

    fun disconnect() {
        billingClient.endConnection()
    }

    fun queryPurchases() {
        if (!billingClient.isReady) return
        billingClient.queryPurchasesAsync(
            QueryPurchasesParams.newBuilder()
                .setProductType(BillingClient.ProductType.SUBS)
                .build()
        ) { _, purchases ->
            val active = purchases.firstOrNull {
                it.purchaseState == Purchase.PurchaseState.PURCHASED
            }
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
        }
    }

    /**
     * Launches the Google Play subscription purchase sheet for [productId].
     * Must be called from a thread where [activity] is available; the billing
     * flow itself is dispatched to the main thread.
     */
    fun launchSubscriptionFlow(productId: String) {
        val act = activity ?: return
        if (!billingClient.isReady) return

        val params = QueryProductDetailsParams.newBuilder()
            .setProductList(
                listOf(
                    QueryProductDetailsParams.Product.newBuilder()
                        .setProductId(productId)
                        .setProductType(BillingClient.ProductType.SUBS)
                        .build()
                )
            )
            .build()

        scope.launch {
            billingClient.queryProductDetailsAsync(params) { result, detailsList ->
                if (result.responseCode != BillingClient.BillingResponseCode.OK) return@queryProductDetailsAsync
                val details = detailsList.firstOrNull() ?: return@queryProductDetailsAsync
                // Use the first available offer (base plan or cheapest trial offer).
                val offerToken = details.subscriptionOfferDetails?.firstOrNull()?.offerToken
                    ?: return@queryProductDetailsAsync

                val flowParams = BillingFlowParams.newBuilder()
                    .setProductDetailsParamsList(
                        listOf(
                            BillingFlowParams.ProductDetailsParams.newBuilder()
                                .setProductDetails(details)
                                .setOfferToken(offerToken)
                                .build()
                        )
                    )
                    .build()

                act.runOnUiThread {
                    billingClient.launchBillingFlow(act, flowParams)
                }
            }
        }
    }

    private fun handlePurchase(purchase: Purchase) {
        if (purchase.purchaseState != Purchase.PurchaseState.PURCHASED) return
        if (!purchase.isAcknowledged) acknowledgePurchase(purchase)
        dataStore.subscriptionActive = true
        dataStore.subscriptionProductId = purchase.products.firstOrNull()
        dataStore.subscriptionToken = purchase.purchaseToken
    }

    private fun acknowledgePurchase(purchase: Purchase) {
        val params = AcknowledgePurchaseParams.newBuilder()
            .setPurchaseToken(purchase.purchaseToken)
            .build()
        billingClient.acknowledgePurchase(params) { /* fire and forget */ }
    }
}
