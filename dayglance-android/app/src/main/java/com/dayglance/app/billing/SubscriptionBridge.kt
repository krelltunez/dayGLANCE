package com.dayglance.app.billing

import android.webkit.JavascriptInterface
import com.dayglance.app.BuildConfig
import com.dayglance.app.data.SharedDataStore
import org.json.JSONObject

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
    private val webView: android.webkit.WebView? = null,
) {

    init {
        // Wire BillingManager terminal events to JS via window.__billingEvent.
        // Fires for every outcome: success, cancelled, error — so the JS layer
        // can clear the loading spinner without relying on a polling timeout.
        webView?.let { wv ->
            billingManager.onBillingEvent = { status, code, message, productId ->
                val json = JSONObject().apply {
                    put("status", status)
                    put("code", code)
                    put("message", message)
                    put("productId", productId ?: "")
                }
                wv.post {
                    wv.evaluateJavascript(
                        "window.__billingEvent && window.__billingEvent($json);", null)
                }
            }
        }
    }

    /**
     * Returns the cached subscription status as JSON.
     * Reads from SharedPreferences — always fast and safe to call on the JS thread.
     *
     * Response: `{"active": bool, "productId": "dayglance_pro_annual" | "dayglance_pro_lifetime" | ""}`
     */
    @JavascriptInterface
    fun getStatus(): String {
        val active = BuildConfig.DEBUG || !BuildConfig.BILLING_ENABLED || dataStore.subscriptionActive
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
     * Launches the Google Play purchase sheet for the given product ID.
     *
     * Valid product IDs:
     *   - "dayglance_pro_annual"   (subscription)
     *   - "dayglance_pro_lifetime" (one-time purchase)
     *
     * The purchase result is delivered asynchronously. JS should listen for
     * visibilitychange and re-call getStatus() when the app comes back to the foreground.
     */
    @JavascriptInterface
    fun purchase(productId: String) {
        val safeId = if (productId in BillingManager.ALL_PRODUCTS) productId
                     else BillingManager.PRODUCT_ANNUAL
        billingManager.launchPurchaseFlow(safeId)
    }

    /**
     * Returns the localized prices fetched from Play as JSON.
     * Values are null-safe empty strings until the billing client has connected
     * and queried product details at least once.
     *
     * Response: `{"annual": "£19.99", "lifetime": "£49.99"}`
     */
    @JavascriptInterface
    fun getProductPrices(): String {
        val annual   = (dataStore.productPriceAnnual   ?: "")
            .replace("\\", "\\\\").replace("\"", "\\\"")
        val lifetime = (dataStore.productPriceLifetime ?: "")
            .replace("\\", "\\\\").replace("\"", "\\\"")
        return """{"annual":"$annual","lifetime":"$lifetime"}"""
    }

    /**
     * Convenience: returns product IDs as a JSON array so JS knows exactly
     * which IDs to pass to purchase().
     */
    @JavascriptInterface
    fun getProductIds(): String =
        """["${BillingManager.PRODUCT_ANNUAL}","${BillingManager.PRODUCT_LIFETIME}"]"""

    /**
     * Consumes the stored lifetime purchase token so it can be bought again.
     * Only available on play builds (BILLING_ENABLED=true). Intended for testing.
     * Result is delivered via window.__billingEvent with status "consumed" or "consume_failed".
     */
    @JavascriptInterface
    fun consumeTestPurchase() {
        if (!BuildConfig.BILLING_ENABLED) return
        val token = dataStore.subscriptionToken ?: run {
            webView?.post {
                webView.evaluateJavascript(
                    """window.__billingEvent && window.__billingEvent({"status":"consume_failed","code":0,"message":"no_token","productId":""});""", null)
            }
            return
        }
        billingManager.consumePurchase(token) { success ->
            val json = JSONObject().apply {
                put("status", if (success) "consumed" else "consume_failed")
                put("code", 0)
                put("message", if (success) "test_consume" else "consume_error")
                put("productId", BillingManager.PRODUCT_LIFETIME)
            }
            webView?.post {
                webView.evaluateJavascript(
                    "window.__billingEvent && window.__billingEvent($json);", null)
            }
        }
    }
}
