package com.glanceapps.billing

import android.app.Activity
import android.content.Context
import android.util.Log
import com.android.billingclient.api.AcknowledgePurchaseParams
import com.android.billingclient.api.BillingClient
import com.android.billingclient.api.BillingClientStateListener
import com.android.billingclient.api.BillingFlowParams
import com.android.billingclient.api.BillingResult
import com.android.billingclient.api.ConsumeParams
import com.android.billingclient.api.PendingPurchasesParams
import com.android.billingclient.api.Purchase
import com.android.billingclient.api.PurchasesUpdatedListener
import com.android.billingclient.api.QueryProductDetailsParams
import com.android.billingclient.api.QueryPurchasesParams
import java.time.Period
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume

/**
 * Google Play Billing core for GLANCE apps, decoupled from any single app:
 * product IDs are injected via [configure], and results are cached in this
 * module's own SharedPreferences so the JS-facing plugin can answer instantly.
 *
 * Ported from a production Play Billing integration. Load-bearing details,
 * each of which was tuned or fixed against real Play behavior — preserve them:
 *
 * - The annual price is read from the INFINITE_RECURRING pricing phase
 *   (recurrenceMode 1), not the first phase — the first phase may be the
 *   free-trial (zero-price) phase.
 * - Trial detection: Play only surfaces a zero-price phase while the user is
 *   still eligible; absence of one means the trial has been used. The trial
 *   LENGTH comes from that phase's ISO-8601 billingPeriod — never hardcode it.
 * - queryPurchases checks SUBS first, then INAPP — an active subscription
 *   wins over a stale one-time record.
 * - Purchases must be acknowledged or Play refunds them after three days.
 * - consumeTestPurchase queries INAPP directly rather than trusting the
 *   cached token: when an annual test subscription is active the cached token
 *   is the SUBS token (SUBS has priority), which would leave the lifetime
 *   INAPP token unconsumed.
 *
 * The annual plan must be a Play SUBS product; the lifetime plan an INAPP
 * (one-time) product.
 */
class PlayBillingCore(context: Context) {

    companion object {
        private const val TAG = "GlanceBilling"
        private const val PREFS = "glance_billing_cache"
        private const val KEY_ACTIVE = "subscription_active"
        private const val KEY_PRODUCT_ID = "subscription_product_id"
        private const val KEY_TOKEN = "subscription_token"
        private const val KEY_PRICE_ANNUAL = "price_annual"
        private const val KEY_PRICE_LIFETIME = "price_lifetime"
        private const val KEY_TRIAL_ELIGIBLE = "trial_eligible_annual"
        private const val KEY_TRIAL_DAYS = "trial_days_annual"
    }

    private val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private val scope = CoroutineScope(Dispatchers.IO)

    var activity: Activity? = null
    private var yearlyProductId: String? = null
    private var lifetimeProductId: String? = null
    private var debugLogging = false

    /** Tracks the product currently going through the purchase flow for error reporting. */
    private var pendingProductId: String? = null

    /**
     * Fires for every terminal purchase-flow outcome.
     * status: "success" | "cancelled" | "error"; code: BillingResponseCode.
     */
    var onBillingEvent: ((status: String, code: Int, message: String, productId: String?) -> Unit)? = null

    /** Called once after the first queryPurchases() completes (splash gating). */
    var onPurchasesQueried: (() -> Unit)? = null

    // Purchase-flow details (tokens, offer tokens) must never reach logcat in
    // release builds; callers opt in to debug logging explicitly.
    private fun logd(msg: String) {
        if (debugLogging) Log.d(TAG, msg)
    }

    private val purchasesUpdatedListener = PurchasesUpdatedListener { result, purchases ->
        logd("purchasesUpdatedListener: code=${result.responseCode} msg='${result.debugMessage}' purchases=${purchases?.size ?: "null"}")
        when {
            result.responseCode == BillingClient.BillingResponseCode.OK && !purchases.isNullOrEmpty() -> {
                for (purchase in purchases) handlePurchase(purchase)
            }
            result.responseCode == BillingClient.BillingResponseCode.USER_CANCELED -> {
                onBillingEvent?.invoke("cancelled", result.responseCode, result.debugMessage, pendingProductId)
            }
            result.responseCode == BillingClient.BillingResponseCode.OK -> {
                // OK but no purchases — the Play sheet was dismissed without completing.
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

    fun configure(yearly: String, lifetime: String, enableDebugLogging: Boolean) {
        yearlyProductId = yearly
        lifetimeProductId = lifetime
        debugLogging = enableDebugLogging
    }

    val isConfigured: Boolean get() = yearlyProductId != null && lifetimeProductId != null

    // ── Cached state (read by the plugin on the JS thread — always fast) ──────

    val cachedActive: Boolean get() = prefs.getBoolean(KEY_ACTIVE, false)
    val cachedProductId: String? get() = prefs.getString(KEY_PRODUCT_ID, null)
    val cachedPriceAnnual: String? get() = prefs.getString(KEY_PRICE_ANNUAL, null)
    val cachedPriceLifetime: String? get() = prefs.getString(KEY_PRICE_LIFETIME, null)
    val cachedTrialEligible: Boolean get() = prefs.getBoolean(KEY_TRIAL_ELIGIBLE, true)
    val cachedTrialDays: Int get() = prefs.getInt(KEY_TRIAL_DAYS, -1)

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    fun connect() {
        billingClient.startConnection(object : BillingClientStateListener {
            override fun onBillingSetupFinished(result: BillingResult) {
                if (result.responseCode == BillingClient.BillingResponseCode.OK) {
                    queryPurchases()
                    queryProductPrices()
                }
            }
            override fun onBillingServiceDisconnected() {
                // Play retries automatically; we reconnect on the next connect() call.
            }
        })
    }

    fun disconnect() {
        billingClient.endConnection()
    }

    // ── Queries ───────────────────────────────────────────────────────────────

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
                prefs.edit()
                    .putBoolean(KEY_ACTIVE, true)
                    .putString(KEY_PRODUCT_ID, active.products.firstOrNull())
                    .putString(KEY_TOKEN, active.purchaseToken)
                    .apply()
            } else {
                prefs.edit()
                    .putBoolean(KEY_ACTIVE, false)
                    .remove(KEY_PRODUCT_ID)
                    .remove(KEY_TOKEN)
                    .apply()
            }
            onPurchasesQueried?.invoke()
            onPurchasesQueried = null
        }
    }

    /**
     * Fetches prices, trial eligibility, and trial length, caching all of it.
     *
     * Annual (SUBS): the recurring price is the INFINITE_RECURRING phase
     * (recurrenceMode 1). A zero-price phase indicates a free trial — Play
     * only surfaces that offer while the user is still eligible — and its
     * billingPeriod (ISO-8601, e.g. "P14D"/"P2W") is the trial length.
     * Lifetime (INAPP): oneTimePurchaseOfferDetails.formattedPrice.
     */
    fun queryProductPrices() {
        if (!billingClient.isReady || !isConfigured) return
        val yearly = yearlyProductId ?: return
        val lifetime = lifetimeProductId ?: return

        val subsParams = QueryProductDetailsParams.newBuilder()
            .setProductList(listOf(
                QueryProductDetailsParams.Product.newBuilder()
                    .setProductId(yearly)
                    .setProductType(BillingClient.ProductType.SUBS)
                    .build()
            ))
            .build()

        val inappParams = QueryProductDetailsParams.newBuilder()
            .setProductList(listOf(
                QueryProductDetailsParams.Product.newBuilder()
                    .setProductId(lifetime)
                    .setProductType(BillingClient.ProductType.INAPP)
                    .build()
            ))
            .build()

        scope.launch {
            billingClient.queryProductDetailsAsync(subsParams) { result, detailsList ->
                if (result.responseCode != BillingClient.BillingResponseCode.OK) return@queryProductDetailsAsync
                for (details in detailsList) {
                    if (details.productId != yearly) continue
                    val offerDetails = details.subscriptionOfferDetails ?: continue
                    val price = offerDetails
                        .flatMap { it.pricingPhases.pricingPhaseList }
                        .firstOrNull { it.recurrenceMode == 1 }
                        ?.formattedPrice
                    val trialPhase = offerDetails
                        .flatMap { it.pricingPhases.pricingPhaseList }
                        .firstOrNull { it.priceAmountMicros == 0L }
                    val editor = prefs.edit()
                    if (price != null) editor.putString(KEY_PRICE_ANNUAL, price)
                    editor.putBoolean(KEY_TRIAL_ELIGIBLE, trialPhase != null)
                    val days = trialPhase?.billingPeriod?.let { parseIsoPeriodToDays(it) }
                    if (days != null && days > 0) editor.putInt(KEY_TRIAL_DAYS, days)
                    editor.apply()
                }
            }
            billingClient.queryProductDetailsAsync(inappParams) { result, detailsList ->
                if (result.responseCode != BillingClient.BillingResponseCode.OK) return@queryProductDetailsAsync
                for (details in detailsList) {
                    val price = details.oneTimePurchaseOfferDetails?.formattedPrice ?: continue
                    if (details.productId == lifetime) prefs.edit().putString(KEY_PRICE_LIFETIME, price).apply()
                }
            }
        }
    }

    /** "P14D" → 14, "P2W" → 14. Months/years approximated (not used for trials in practice). */
    private fun parseIsoPeriodToDays(iso: String): Int? = try {
        val p = Period.parse(iso)
        p.years * 365 + p.months * 30 + p.days
    } catch (_: Exception) {
        null
    }

    // ── Purchase flow ─────────────────────────────────────────────────────────

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
        val productType = if (productId == lifetimeProductId) BillingClient.ProductType.INAPP
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
                logd("launchPurchaseFlow($productId): query code=${result.responseCode} count=${detailsList.size}")

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
                            setOfferToken(offerToken)
                        }
                    }
                    .build()

                val flowParams = BillingFlowParams.newBuilder()
                    .setProductDetailsParamsList(listOf(productDetailsParams))
                    .build()

                act.runOnUiThread {
                    val launchResult = billingClient.launchBillingFlow(act, flowParams)
                    logd("launchBillingFlow: code=${launchResult.responseCode}")
                    if (launchResult.responseCode != BillingClient.BillingResponseCode.OK) {
                        onBillingEvent?.invoke("error", launchResult.responseCode, launchResult.debugMessage, productId)
                    }
                    // OK → wait for purchasesUpdatedListener to fire.
                }
            }
        }
    }

    private fun handlePurchase(purchase: Purchase) {
        if (purchase.purchaseState != Purchase.PurchaseState.PURCHASED) return
        if (!purchase.isAcknowledged) acknowledgePurchase(purchase)
        val pid = purchase.products.firstOrNull()
        prefs.edit()
            .putBoolean(KEY_ACTIVE, true)
            .putString(KEY_PRODUCT_ID, pid)
            .putString(KEY_TOKEN, purchase.purchaseToken)
            .apply()
        onBillingEvent?.invoke("success", BillingClient.BillingResponseCode.OK, "", pid)
    }

    private fun acknowledgePurchase(purchase: Purchase) {
        val params = AcknowledgePurchaseParams.newBuilder()
            .setPurchaseToken(purchase.purchaseToken)
            .build()
        billingClient.acknowledgePurchase(params) { /* fire and forget */ }
    }

    // ── Test-only consume ────────────────────────────────────────────────────

    fun consumeTestPurchase(onComplete: (success: Boolean) -> Unit) {
        val token = prefs.getString(KEY_TOKEN, null)
        // Always clear the local cache so the subscription wall reappears immediately.
        prefs.edit()
            .putBoolean(KEY_ACTIVE, false)
            .remove(KEY_PRODUCT_ID)
            .remove(KEY_TOKEN)
            .apply()

        if (!billingClient.isReady) {
            onComplete(true)
            return
        }
        scope.launch {
            // Query INAPP purchases directly rather than relying on the cached
            // token. When an annual test subscription is active, queryPurchases()
            // stores the SUBS token (SUBS has priority), leaving the lifetime
            // INAPP token untouched. Querying INAPP directly ensures the lifetime
            // token is always consumed.
            val inappPurchases = queryPurchasesForType(BillingClient.ProductType.INAPP)
            for (purchase in inappPurchases) {
                val p = ConsumeParams.newBuilder().setPurchaseToken(purchase.purchaseToken).build()
                suspendCancellableCoroutine { cont ->
                    billingClient.consumeAsync(p) { result, _ ->
                        logd("consumeAsync INAPP: code=${result.responseCode}")
                        cont.resume(Unit)
                    }
                }
            }
            // Also attempt the originally cached token (may be a SUBS token for an
            // annual test subscription — consumeAsync can succeed on license-tester
            // SUBS tokens).
            if (token != null && inappPurchases.none { it.purchaseToken == token }) {
                val p = ConsumeParams.newBuilder().setPurchaseToken(token).build()
                suspendCancellableCoroutine { cont ->
                    billingClient.consumeAsync(p) { result, _ ->
                        logd("consumeAsync cached token: code=${result.responseCode}")
                        cont.resume(Unit)
                    }
                }
            }
            onComplete(true)
        }
    }
}
