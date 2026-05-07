package com.dayglance.app.billing

import android.webkit.JavascriptInterface
import com.dayglance.app.data.SharedDataStore

/**
 * JavaScript interface exposed to the WebView as `window.DayGlanceBilling`.
 *
 * JS feature-detection pattern:
 *
 *   if (window.DayGlanceBilling) {
 *     const status = JSON.parse(window.DayGlanceBilling.getStatus());
 *     // { active: bool, productId: string }
 *   }
 *
 * Purchase flow is async — the Play sheet is shown natively. JS should re-read
 * getStatus() on visibilitychange after the user returns from the Play sheet.
 */
class SubscriptionBridge(
    private val billingManager: BillingManager,
    private val dataStore: SharedDataStore,
) {

    /**
     * Returns the cached subscription status as JSON.
     * Reads from SharedPreferences — always fast and safe to call on the JS thread.
     *
     * Response: `{"active": bool, "productId": "dayglance_pro_monthly" | "dayglance_pro_annual" | ""}`
     */
    @JavascriptInterface
    fun getStatus(): String {
        val active = dataStore.subscriptionActive
        val productId = (dataStore.subscriptionProductId ?: "")
            .replace("\\", "\\\\").replace("\"", "\\\"")
        return """{"active":$active,"productId":"$productId"}"""
    }

    /**
     * Re-queries Google Play for the current subscription state and updates the
     * SharedPreferences cache. JS can call getStatus() a moment later to pick up
     * the result (there is no callback — poll or wait for visibilitychange).
     */
    @JavascriptInterface
    fun refresh() {
        billingManager.queryPurchases()
    }

    /**
     * Launches the Google Play subscription purchase sheet for the given product ID.
     *
     * Valid product IDs:
     *   - "dayglance_pro_monthly"
     *   - "dayglance_pro_annual"
     *
     * The purchase result is delivered asynchronously. JS should listen for
     * visibilitychange and re-call getStatus() when the app comes back to the foreground.
     */
    @JavascriptInterface
    fun purchase(productId: String) {
        val safeId = if (productId in BillingManager.ALL_PRODUCTS) productId
                     else BillingManager.PRODUCT_MONTHLY
        billingManager.launchSubscriptionFlow(safeId)
    }

    /**
     * Returns the localized prices fetched from Play as JSON.
     * Values are null-safe empty strings until the billing client has connected
     * and queried product details at least once.
     *
     * Response: `{"monthly": "£2.99", "annual": "£19.99"}`
     */
    @JavascriptInterface
    fun getProductPrices(): String {
        val monthly = (dataStore.productPriceMonthly ?: "")
            .replace("\\", "\\\\").replace("\"", "\\\"")
        val annual = (dataStore.productPriceAnnual ?: "")
            .replace("\\", "\\\\").replace("\"", "\\\"")
        return """{"monthly":"$monthly","annual":"$annual"}"""
    }

    /**
     * Convenience: returns "dayglance_pro_monthly" and "dayglance_pro_annual" as a
     * JSON array so JS knows exactly which product IDs to pass to purchase().
     */
    @JavascriptInterface
    fun getProductIds(): String =
        """["${BillingManager.PRODUCT_MONTHLY}","${BillingManager.PRODUCT_ANNUAL}"]"""
}
