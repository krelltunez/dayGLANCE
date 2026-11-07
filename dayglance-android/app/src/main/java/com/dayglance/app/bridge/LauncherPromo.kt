package com.dayglance.app.bridge

import android.content.Context
import android.content.pm.PackageManager
import org.json.JSONObject

/**
 * The facts the GLANCElauncher card in Settings is shown on
 * (src/utils/launcherPromo.js decides; this only reports). The launcher pairs
 * through a `knownSigner` permission, which exists from Android 12, and the
 * link differs per flavour (BuildConfig.LAUNCHER_PROMO_URL; empty means the
 * build does not offer the launcher at all).
 *
 * Not on the headless bridge: a headless run shows no Settings.
 */
object LauncherPromo {

    /** GLANCElauncher's package. Listed in the manifest's <queries> so it is visible. */
    const val LAUNCHER_PACKAGE = "app.glance.launcher"

    /** `{"sdk": Int, "installed": Boolean, "url": String}` for the web side. */
    fun describe(sdkInt: Int, installed: Boolean, url: String): String =
        JSONObject()
            .put("sdk", sdkInt)
            .put("installed", installed)
            .put("url", url)
            .toString()

    /**
     * Whether the launcher is installed. A lookup that fails for any reason but
     * "no such package" counts as installed, so a doubtful answer hides the card
     * rather than offering an app the user may already have.
     */
    fun isInstalled(context: Context): Boolean = try {
        @Suppress("DEPRECATION")
        context.packageManager.getPackageInfo(LAUNCHER_PACKAGE, 0)
        true
    } catch (_: PackageManager.NameNotFoundException) {
        false
    } catch (_: Exception) {
        true
    }
}
