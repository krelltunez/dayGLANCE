package com.glanceapps.billing

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * Capacitor plugin surface for PlayBillingCore. Pairs with the
 * `createCapacitorAdapter` factory in @glance-apps/billing/capacitor.
 *
 * JS contract (all methods promise-based):
 *   initialize({ yearlyProductId, lifetimeProductId, debugLogging? })
 *   getStatus()            → { active, productId }
 *   refresh()              → re-queries Play in the background
 *   purchase({ productId })
 *   getProductPrices()     → { yearly, lifetime, yearlyTrialDays }
 *   getTrialEligibility()  → { "<yearlyProductId>": boolean }
 *   consumeTestPurchase()  → debug builds only (gate in the app)
 *
 * Terminal purchase outcomes are emitted as 'billingEvent' listener events:
 *   { status, code, message, productId } — same shape as every other GLANCE
 * platform bridge.
 */
@CapacitorPlugin(name = "BillingBridge")
class BillingBridgePlugin : Plugin() {

    private var core: PlayBillingCore? = null
    private var yearlyProductId: String = ""

    override fun load() {
        core = PlayBillingCore(context).also { c ->
            c.onBillingEvent = { status, code, message, productId ->
                val ev = JSObject()
                ev.put("status", status)
                ev.put("code", code)
                ev.put("message", message)
                ev.put("productId", productId ?: "")
                notifyListeners("billingEvent", ev)
            }
        }
    }

    override fun handleOnStart() {
        super.handleOnStart()
        core?.let { c ->
            if (c.isConfigured) {
                c.activity = activity
                c.connect()
            }
        }
    }

    override fun handleOnStop() {
        super.handleOnStop()
        core?.let { c ->
            c.activity = null
            if (c.isConfigured) c.disconnect()
        }
    }

    @PluginMethod
    fun initialize(call: PluginCall) {
        val yearly = call.getString("yearlyProductId")
        val lifetime = call.getString("lifetimeProductId")
        if (yearly.isNullOrEmpty() || lifetime.isNullOrEmpty()) {
            call.reject("yearlyProductId and lifetimeProductId are required")
            return
        }
        yearlyProductId = yearly
        val debug = call.getBoolean("debugLogging") ?: false
        core?.let { c ->
            val firstConfigure = !c.isConfigured
            c.configure(yearly, lifetime, debug)
            if (firstConfigure) {
                c.activity = activity
                c.connect()
            }
        }
        call.resolve()
    }

    @PluginMethod
    fun getStatus(call: PluginCall) {
        val c = core ?: return call.reject("not loaded")
        val out = JSObject()
        out.put("active", c.cachedActive)
        out.put("productId", c.cachedProductId ?: JSObject.NULL)
        call.resolve(out)
    }

    @PluginMethod
    fun refresh(call: PluginCall) {
        core?.queryPurchases()
        core?.queryProductPrices()
        call.resolve()
    }

    @PluginMethod
    fun purchase(call: PluginCall) {
        val productId = call.getString("productId")
        if (productId.isNullOrEmpty()) {
            call.reject("productId is required")
            return
        }
        core?.let { it.activity = activity }
        core?.launchPurchaseFlow(productId)
        call.resolve()
    }

    @PluginMethod
    fun getProductPrices(call: PluginCall) {
        val c = core ?: return call.reject("not loaded")
        val out = JSObject()
        out.put("yearly", c.cachedPriceAnnual ?: JSObject.NULL)
        out.put("lifetime", c.cachedPriceLifetime ?: JSObject.NULL)
        val days = c.cachedTrialDays
        if (days > 0) out.put("yearlyTrialDays", days) else out.put("yearlyTrialDays", JSObject.NULL)
        call.resolve(out)
    }

    @PluginMethod
    fun getTrialEligibility(call: PluginCall) {
        val c = core ?: return call.reject("not loaded")
        val out = JSObject()
        out.put(yearlyProductId, c.cachedTrialEligible)
        call.resolve(out)
    }

    @PluginMethod
    fun consumeTestPurchase(call: PluginCall) {
        // Destructive test-only path: consuming the lifetime token revokes the
        // user's purchase. The APP must gate this on its own debug flag — the
        // plugin cannot know the host app's build type reliably.
        val c = core ?: return call.reject("not loaded")
        val productId = c.cachedProductId ?: ""
        c.consumeTestPurchase { success ->
            val ev = JSObject()
            ev.put("status", if (success) "consumed" else "consume_failed")
            ev.put("code", 0)
            ev.put("message", if (success) "test_consume" else "consume_error")
            ev.put("productId", productId)
            notifyListeners("billingEvent", ev)
        }
        call.resolve()
    }
}
