package com.dayglance.app

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.dayglance.app.bridge.NativeBridge
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

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        webView = binding.webView
        nativeBridge = NativeBridge(this)

        configureWebView()
        requestRuntimePermissions()

        // TODO Phase 1: replace with your hosted URL or switch to bundled assets
        webView.loadUrl("file:///android_asset/web/index.html")
    }

    private fun configureWebView() {
        webView.webViewClient = WebViewClient()
        webView.webChromeClient = WebChromeClient()

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
