package com.dayglance.app.billing

import android.app.Activity
import android.content.Context
import com.android.billingclient.api.AcknowledgePurchaseParams
import com.android.billingclient.api.BillingClient
import com.android.billingclient.api.BillingClientStateListener
import com.android.billingclient.api.BillingFlowParams
import com.android.billingclient.api.BillingResult
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
 * Monthly plan → Play Console: Monetize → Subscriptions (product type SUBS).
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
        // These IDs must match what you create in the Play Console exactly.
        const val PRODUCT_MONTHLY  = "dayglance_pro_monthly"
        const val PRODUCT_LIFETIME = "dayglance_pro_lifetime"
        val SUBSCRIPTION_PRODUCTS = listOf(PRODUCT_MONTHLY)
        val INAPP_PRODUCTS        = listOf(PRODUCT_LIFETIME)
        val ALL_PRODUCTS          = SUBSCRIPTION_PRODUCTS + INAPP_PRODUCTS
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
        .enablePendingPurchases()
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
     * Monthly (SUBS): filters for the INFINITE_RECURRING phase (recurrenceMode 1).
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
                    if (details.productId == PRODUCT_MONTHLY) dataStore.productPriceMonthly = price
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

    fun queryPurchases() {
        if (!billingClient.isReady) return
        scope.launch {
            var activePurchase: Purchase? = null

            // Check subscriptions first.
            billingClient.queryPurchasesAsync(
                QueryPurchasesParams.newBuilder()
                    .setProductType(BillingClient.ProductType.SUBS)
                    .build()
            ) { _, purchases ->
                activePurchase = purchases.firstOrNull { it.purchaseState == Purchase.PurchaseState.PURCHASED }
            }

            // If no active subscription, check one-time (lifetime) purchases.
            if (activePurchase == null) {
                billingClient.queryPurchasesAsync(
                    QueryPurchasesParams.newBuilder()
                        .setProductType(BillingClient.ProductType.INAPP)
                        .build()
                ) { _, purchases ->
                    activePurchase = purchases.firstOrNull { it.purchaseState == Purchase.PurchaseState.PURCHASED }
                }
            }

            val active = activePurchase
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
     * Launches the Google Play purchase sheet for [productId].
     * Routes to SUBS or INAPP depending on the product. Must be called with
     * [activity] set; the billing flow is dispatched to the main thread.
     */
    fun launchPurchaseFlow(productId: String) {
        val act = activity ?: return
        if (!billingClient.isReady) return

        val productType = if (productId in INAPP_PRODUCTS) BillingClient.ProductType.INAPP
                          else BillingClient.ProductType.SUBS

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
                if (result.responseCode != BillingClient.BillingResponseCode.OK) return@queryProductDetailsAsync
                val details = detailsList.firstOrNull() ?: return@queryProductDetailsAsync

                val productDetailsParams = BillingFlowParams.ProductDetailsParams.newBuilder()
                    .setProductDetails(details)
                    .apply {
                        if (productType == BillingClient.ProductType.SUBS) {
                            // Use the first available offer (base plan or cheapest trial offer).
                            val offerToken = details.subscriptionOfferDetails?.firstOrNull()?.offerToken
                                ?: return@queryProductDetailsAsync
                            setOfferToken(offerToken)
                        }
                    }
                    .build()

                val flowParams = BillingFlowParams.newBuilder()
                    .setProductDetailsParamsList(listOf(productDetailsParams))
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
