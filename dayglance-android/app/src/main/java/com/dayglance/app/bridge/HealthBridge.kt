package com.dayglance.app.bridge

import android.content.Context
import android.webkit.JavascriptInterface

/**
 * Phase 2: Health Connect bridge.
 *
 * Reads step counts, sleep data, and other health metrics from Android
 * Health Connect. Works with Samsung Health, Google Fit, and any app that
 * writes to Health Connect.
 *
 * Health Connect permissions are requested at runtime via the Health Connect
 * permission contract — see HealthRepository for the implementation.
 *
 * TODO Phase 2: implement with HealthRepository
 */
class HealthBridge(private val context: Context) {

    @JavascriptInterface
    fun getSteps(date: String): String {
        // TODO Phase 2: query HealthRepository.getSteps(date)
        // Returns JSON: { "steps": 8432, "goal": 10000 }
        return "{\"steps\":0,\"goal\":10000}"
    }

    @JavascriptInterface
    fun getSleep(date: String): String {
        // TODO Phase 2: query HealthRepository.getSleep(date)
        // Returns JSON: { "durationMinutes": 0, "stages": [] }
        return "{\"durationMinutes\":0,\"stages\":[]}"
    }

    @JavascriptInterface
    fun requestPermission(): String {
        // TODO Phase 2: launch Health Connect permission contract via MainActivity.
        // The real flow uses HealthDataClient and HealthPermission.getHealthPermission()
        // called from an ActivityResultLauncher registered in MainActivity.
        // Returns "granted" or "denied".
        return "granted"
    }
}
