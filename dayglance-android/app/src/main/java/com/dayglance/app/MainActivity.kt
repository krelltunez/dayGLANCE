package com.dayglance.app

import android.Manifest
import android.app.AlarmManager
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.health.connect.client.PermissionController
import androidx.webkit.WebViewAssetLoader
import com.dayglance.app.bridge.NativeBridge
import com.dayglance.app.bridge.ObsidianBridge
import com.dayglance.app.data.HealthRepository
import com.dayglance.app.databinding.ActivityMainBinding

/**
 * Phase 1: WebView shell.
 *
 * Loads the DayGlance web frontend and injects the NativeBridge so the
 * frontend can detect `window.DayGlanceNative` and enable native features.
 *
 * To load the bundled frontend from assets:
 *   webView.loadUrl("file:///android_asset/web/index.html")
 *
 * To load a hosted instance (development / self-hosted):
 *   webView.loadUrl("https://your-dayglance-instance.example.com")
 */
class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private lateinit var webView: WebView
    private lateinit var nativeBridge: NativeBridge
    private lateinit var obsidianBridge: ObsidianBridge
    private lateinit var healthRepository: HealthRepository

    // Shown at most once per session so we don't nag the user repeatedly
    private var exactAlarmPromptShown = false

    // File chooser callback for <input type="file"> in WebView
    private var fileChooserCallback: ValueCallback<Array<Uri>>? = null
    private val filePickerLauncher = registerForActivityResult(
        ActivityResultContracts.OpenDocument()
    ) { uri ->
        val callback = fileChooserCallback
        fileChooserCallback = null
        callback?.onReceiveValue(if (uri != null) arrayOf(uri) else emptyArray())
    }

    // Registered in onCreate (before the activity starts) — safe to call from any thread
    private val requestHealthPermissions = registerForActivityResult(
        PermissionController.createRequestPermissionResultContract()
    ) { _ ->
        // Permissions result is handled transparently: the next getSteps/getSleep
        // call will succeed if granted, or return zeros if still denied.
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        webView = binding.webView
        healthRepository = HealthRepository(this)
        obsidianBridge = ObsidianBridge(this)
        nativeBridge = NativeBridge(
            context = this,
            healthRepository = healthRepository,
            onRequestHealthPermission = {
                // Launch must run on the main thread; JS interface callbacks run on a bg thread.
                runOnUiThread {
                    requestHealthPermissions.launch(healthRepository.requiredPermissions)
                }
            }
        )

        // Android 15 (targetSdk 35) forces edge-to-edge, so the window extends behind the
        // gesture navigation bar. Consume the bottom navigation-bar inset as padding on the
        // root layout so the WebView viewport ends above the bar.  This keeps
        // env(safe-area-inset-bottom) = 0 inside the WebView, matching the web-browser behaviour
        // where the tab bar is exactly h-14 (56 dp) tall with no extra space.
        ViewCompat.setOnApplyWindowInsetsListener(binding.root) { v, insets ->
            val navBottom = insets.getInsets(WindowInsetsCompat.Type.navigationBars()).bottom
            v.setPadding(0, 0, 0, navBottom)
            insets
        }

        configureWebView()
        requestRuntimePermissions()

        // WebViewAssetLoader serves assets via https://appassets.androidplatform.net
        // so ES module scripts load without CORS errors (file:// blocks type="module")
        webView.loadUrl("https://appassets.androidplatform.net/assets/web/index.html")
    }

    private fun configureWebView() {
        val assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            // Serve root-relative paths (e.g. /dayglance-dark.svg) from assets/web/
            .addPathHandler("/", WebViewAssetLoader.PathHandler { path ->
                try {
                    val stream = assets.open("web/$path")
                    val mime = when {
                        path.endsWith(".svg") -> "image/svg+xml"
                        path.endsWith(".png") -> "image/png"
                        path.endsWith(".ico") -> "image/x-icon"
                        path.endsWith(".js")  -> "application/javascript"
                        path.endsWith(".css") -> "text/css"
                        path.endsWith(".html") -> "text/html"
                        else -> "application/octet-stream"
                    }
                    WebResourceResponse(mime, "utf-8", stream)
                } catch (e: Exception) { null }
            })
            .build()

        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(
                view: WebView,
                request: WebResourceRequest
            ) = assetLoader.shouldInterceptRequest(request.url)

        }
        webView.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                webView: WebView,
                filePathCallback: ValueCallback<Array<Uri>>,
                fileChooserParams: FileChooserParams,
            ): Boolean {
                // Cancel any previous pending callback
                fileChooserCallback?.onReceiveValue(emptyArray())
                fileChooserCallback = filePathCallback
                val mimeTypes = fileChooserParams.acceptTypes
                    .filter { it.isNotBlank() }
                    .toTypedArray()
                    .ifEmpty { arrayOf("application/json", "*/*") }
                filePickerLauncher.launch(mimeTypes)
                return true
            }
        }

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = true
            cacheMode = WebSettings.LOAD_DEFAULT
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            mediaPlaybackRequiresUserGesture = false
        }

        // Inject the native bridge — exposes window.DayGlanceNative in JS
        webView.addJavascriptInterface(nativeBridge, "DayGlanceNative")
        // Expose Obsidian vault methods on the same interface name (separate object)
        webView.addJavascriptInterface(obsidianBridge, "DayGlanceObsidian")
    }

    private fun requestRuntimePermissions() {
        val permissions = mutableListOf<String>()

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_CALENDAR)
            != PackageManager.PERMISSION_GRANTED) {
            permissions += Manifest.permission.READ_CALENDAR
            permissions += Manifest.permission.WRITE_CALENDAR
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
            != PackageManager.PERMISSION_GRANTED) {
            permissions += Manifest.permission.POST_NOTIFICATIONS
        }

        if (permissions.isNotEmpty()) {
            ActivityCompat.requestPermissions(this, permissions.toTypedArray(), RC_PERMISSIONS)
        }
    }

    override fun onResume() {
        super.onResume()
        applyStatusBarAppearance()
        maybePromptExactAlarmPermission()
    }

    /**
     * On Android 12+ (API 31+), SCHEDULE_EXACT_ALARM requires explicit user approval
     * via Settings → Apps → Special app access → Alarms & Reminders. Without it,
     * AlarmManager falls back to inexact alarms that Android batches during Doze mode —
     * causing all missed notifications to arrive at once when the device wakes up.
     *
     * We show a one-time-per-session dialog directing the user to the right settings page.
     */
    private fun maybePromptExactAlarmPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return
        val am = getSystemService(Context.ALARM_SERVICE) as AlarmManager
        if (am.canScheduleExactAlarms()) return
        if (exactAlarmPromptShown) return
        exactAlarmPromptShown = true

        AlertDialog.Builder(this)
            .setTitle("Enable precise reminders")
            .setMessage(
                "DayGlance needs permission to schedule exact alarms so your task " +
                "reminders arrive on time, even when the app is closed.\n\n" +
                "Tap \"Grant access\", then enable \"DayGlance\" on the next screen."
            )
            .setPositiveButton("Grant access") { _, _ ->
                startActivity(
                    Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM).apply {
                        data = Uri.fromParts("package", packageName, null)
                    }
                )
            }
            .setNegativeButton("Not now", null)
            .show()
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        applyStatusBarAppearance()
    }

    /**
     * Sets the status-bar icon colour to match the current light/dark mode.
     *
     * Called from onResume, onPageFinished, and onConfigurationChanged so it
     * wins over any resets by Android 15's edge-to-edge enforcement or the
     * WebView's first paint.
     *
     * Uses the direct WindowInsetsController API on API 30+ (more reliable on
     * API 35 than the compat wrapper), with the compat path as fallback.
     */
    private fun applyStatusBarAppearance() {
        val isNightMode = (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) ==
            Configuration.UI_MODE_NIGHT_YES
        // Disable automatic contrast enforcement so our flag isn't overridden.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            window.isStatusBarContrastEnforced = false
        }
        // isAppearanceLightStatusBars = true  → dark (black) icons → light mode
        // isAppearanceLightStatusBars = false → light (white) icons → dark mode
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            // Direct platform API — bypasses the compat wrapper which can be unreliable
            // when the window is in forced edge-to-edge mode on API 35.
            val appearance = if (!isNightMode) android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS else 0
            window.insetsController?.setSystemBarsAppearance(
                appearance,
                android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS,
            )
        } else {
            WindowCompat.getInsetsController(window, window.decorView)
                .isAppearanceLightStatusBars = !isNightMode
        }
    }

    override fun onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack()
        } else {
            super.onBackPressed()
        }
    }

    companion object {
        private const val RC_PERMISSIONS = 1001
    }
}
