package com.dayglance.app

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.result.contract.ActivityResultContracts
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

        // Enforce correct status-bar icon colour regardless of Android version or
        // edge-to-edge behaviour.  android:windowLightStatusBar in themes.xml is
        // not reliably honoured on API 35 when the window is forced edge-to-edge.
        // isAppearanceLightStatusBars = true  → dark (black) icons  → use in light mode
        // isAppearanceLightStatusBars = false → light (white) icons → use in dark mode
        val isNightMode = (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) ==
            Configuration.UI_MODE_NIGHT_YES
        WindowCompat.getInsetsController(window, window.decorView)
            .isAppearanceLightStatusBars = !isNightMode

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
