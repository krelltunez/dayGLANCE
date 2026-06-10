package com.dayglance.app

import android.Manifest
import android.app.AlarmManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ActivityInfo
import org.json.JSONObject
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.View
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.health.connect.client.PermissionController
import androidx.webkit.WebViewAssetLoader
import com.dayglance.app.BuildConfig
import com.dayglance.app.billing.BillingManager
import com.dayglance.app.billing.SubscriptionBridge
import com.dayglance.app.bridge.NativeBridge
import com.dayglance.app.bridge.ObsidianBridge
import com.dayglance.app.data.HealthRepository
import com.dayglance.app.data.SharedDataStore
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
    private lateinit var dataStore: com.dayglance.app.data.SharedDataStore
    private lateinit var billingManager: BillingManager
    private lateinit var subscriptionBridge: SubscriptionBridge

    // Stored so onResume() can re-enable it after the app returns from background.
    // The callback sets isEnabled = false when the WebView has no back history, which
    // lets the system handle that specific press. Without re-enabling it, the callback
    // stays dark and back button does nothing on all subsequent resumes (Android 13+).
    private lateinit var backCallback: OnBackPressedCallback

    // Splash screen: held until all three conditions are true:
    //   1. WebView has finished its first page load (webViewReady)
    //   2. JS has signalled the app is interactive — i.e. the initial Obsidian
    //      sync (which blocks the JS thread) has completed (appReady).
    //      A fallback timer sets appReady after 10 s in case JS never calls back.
    //   3. Billing client has completed its first queryPurchases() so the
    //      subscription cache is current before the WebView reads it (billingReady).
    //      A 3 s fallback ensures billing never extends the splash beyond the WebView.
    @Volatile private var webViewReady = false
    @Volatile private var appReady = false
    @Volatile private var billingReady = false

    // Solid-colour overlay that covers the WebView while it repaints on resume,
    // preventing the stale-frame flash (UI → blank → UI) the user would otherwise see.
    private lateinit var resumeOverlay: View

    // Shown at most once per session so we don't nag the user repeatedly
    private var exactAlarmPromptShown = false

    // Receives the internal INTENT_RECEIVED broadcast sent by IntentReceiver and triggers
    // a visibilitychange event in the WebView so JS picks up the pending intent immediately.
    private val intentForwardReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            webView.post {
                webView.evaluateJavascript(
                    "(function(){ document.dispatchEvent(new Event('visibilitychange')); })();",
                    null
                )
            }
        }
    }

    // Pending WebRTC permission request (microphone) waiting for Android runtime permission result
    private var pendingWebPermissionRequest: PermissionRequest? = null

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
        // Notify JS so the Authorize/Add buttons update immediately without
        // depending on visibilitychange (which is unreliable when webView.onPause
        // is intentionally skipped).
        webView.evaluateJavascript(
            "window.__onHealthPermResult && window.__onHealthPermResult()", null
        )
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        val splashScreen = installSplashScreen()
        super.onCreate(savedInstanceState)
        splashScreen.setKeepOnScreenCondition { !webViewReady || !appReady || !billingReady }
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        // Lock phones to portrait; tablets (smallestScreenWidthDp >= 600) rotate freely.
        // The manifest uses screenOrientation="unspecified" so this runtime check is the
        // only thing preventing landscape on phones.
        if (resources.configuration.smallestScreenWidthDp < 600) {
            requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
        }

        // Store shortcut intent so JS can pick it up via getPendingAction()
        // after the WebView finishes loading.
        dataStore = SharedDataStore(this)
        val store = dataStore
        when (intent?.action) {
            ACTION_VOICE_INPUT    -> store.pendingVoiceInput = true
            ACTION_ADD_TASK       -> store.pendingAddTask = true
            ACTION_ADD_INBOX_TASK -> store.pendingAddInboxTask = true
            Intent.ACTION_SEND    -> storeShareIntent(intent, store)
        }

        billingManager = BillingManager(this, dataStore)

        // Debug and github flavor builds skip billing entirely.
        if (BuildConfig.DEBUG || !BuildConfig.BILLING_ENABLED) {
            billingReady = true
        } else if (dataStore.subscriptionActive) {
            // Fast path: cache already confirms active — no need to wait for Play.
            billingReady = true
        } else {
            billingManager.onPurchasesQueried = { billingReady = true }
            Handler(Looper.getMainLooper()).postDelayed({ billingReady = true }, 3_000)
        }

        webView = binding.webView
        // SubscriptionBridge needs webView to dispatch billing events back to JS, so it
        // must be constructed after webView is initialised.
        val isDark = (resources.configuration.uiMode and android.content.res.Configuration.UI_MODE_NIGHT_MASK) ==
            android.content.res.Configuration.UI_MODE_NIGHT_YES
        webView.setBackgroundColor(
            if (isDark) android.graphics.Color.parseColor("#0f172a")
            else android.graphics.Color.WHITE
        )

        // Resume overlay: sits above the WebView in the FrameLayout. Shown in onPause()
        // to hide the stale cached frame; hidden via postVisualStateCallback() once the
        // WebView has committed a fresh frame. Colour matches both dark (#0f172a) and
        // light (#ffffff) mode so the transition is seamless in either appearance setting.
        resumeOverlay = View(this).apply {
            setBackgroundColor(
                if (isDark) android.graphics.Color.parseColor("#0f172a")
                else android.graphics.Color.WHITE
            )
            visibility = View.GONE
        }
        binding.root.addView(resumeOverlay)

        healthRepository = HealthRepository(this)
        subscriptionBridge = SubscriptionBridge(billingManager, dataStore, webView)
        obsidianBridge = ObsidianBridge(this, webView)
        nativeBridge = NativeBridge(
            context = this,
            healthRepository = healthRepository,
            onRequestHealthPermission = {
                // Launch must run on the main thread; JS interface callbacks run on a bg thread.
                runOnUiThread {
                    requestHealthPermissions.launch(healthRepository.requiredPermissions)
                }
            },
            onAppReady = {
                runOnUiThread { appReady = true }
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

        backCallback = object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) {
                    webView.goBack()
                } else {
                    isEnabled = false
                    onBackPressedDispatcher.onBackPressed()
                }
            }
        }
        onBackPressedDispatcher.addCallback(this, backCallback)

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

            override fun onPageFinished(view: WebView, url: String) {
                super.onPageFinished(view, url)
                // Release the first half of the splash condition.
                webViewReady = true
                // Re-apply status bar appearance after the WebView's first paint,
                // which can reset the icon colour on Android 15 edge-to-edge mode.
                applyStatusBarAppearance()
                // Safety fallback: if JS never calls notifyAppReady() (e.g. Obsidian
                // not configured, or a JS error), dismiss the splash after 10 seconds.
                Handler(Looper.getMainLooper()).postDelayed({ appReady = true }, 10_000)
            }
        }
        webView.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) {
                val wantsAudio = PermissionRequest.RESOURCE_AUDIO_CAPTURE in request.resources
                if (!wantsAudio) {
                    request.deny()
                    return
                }
                if (ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.RECORD_AUDIO)
                    == PackageManager.PERMISSION_GRANTED) {
                    request.grant(request.resources)
                } else {
                    pendingWebPermissionRequest = request
                    ActivityCompat.requestPermissions(
                        this@MainActivity,
                        arrayOf(Manifest.permission.RECORD_AUDIO),
                        RC_MICROPHONE
                    )
                }
            }

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
                    .map { type ->
                        // Android's OpenDocument contract requires MIME types, not file extensions.
                        // Convert common extensions that the web frontend may pass via accept="…".
                        when (type.lowercase()) {
                            ".json" -> "application/json"
                            ".ics"  -> "text/calendar"
                            ".csv"  -> "text/csv"
                            ".txt"  -> "text/plain"
                            else    -> type
                        }
                    }
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
        // Expose subscription/billing methods — window.DayGlanceBilling
        webView.addJavascriptInterface(subscriptionBridge, "DayGlanceBilling")
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

        // Request RECORD_AUDIO at startup so the WebView renderer process inherits the
        // permission before getUserMedia is ever called. Granting it mid-session via
        // onPermissionRequest alone is not sufficient — the renderer can fail to open the
        // audio HAL with NotReadableError ("could not start audio source") because it
        // checked permission state at process creation time.
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
            != PackageManager.PERMISSION_GRANTED) {
            permissions += Manifest.permission.RECORD_AUDIO
        }

        if (permissions.isNotEmpty()) {
            ActivityCompat.requestPermissions(this, permissions.toTypedArray(), RC_PERMISSIONS)
        }
    }

    override fun onPause() {
        unregisterReceiver(intentForwardReceiver)
        super.onPause()
        // Show the overlay so the stale cached frame is hidden when the user returns.
        // dataStore.appDarkMode is the app's own dark/light preference (independent of the
        // Android system night-mode flag), so the overlay colour is correct in both modes.
        val isDarkMode = dataStore.appDarkMode
            ?: ((resources.configuration.uiMode and android.content.res.Configuration.UI_MODE_NIGHT_MASK) ==
                android.content.res.Configuration.UI_MODE_NIGHT_YES)
        resumeOverlay.setBackgroundColor(
            if (isDarkMode) android.graphics.Color.parseColor("#0f172a")
            else android.graphics.Color.WHITE
        )
        resumeOverlay.visibility = View.VISIBLE
    }

    override fun onStart() {
        super.onStart()
        if (BuildConfig.BILLING_ENABLED && !BuildConfig.DEBUG) {
            billingManager.activity = this
            billingManager.connect()
        }
    }

    override fun onStop() {
        super.onStop()
        if (BuildConfig.BILLING_ENABLED && !BuildConfig.DEBUG) {
            billingManager.activity = null
            billingManager.disconnect()
        }
    }

    override fun onResume() {
        super.onResume()
        registerReceiver(
            intentForwardReceiver,
            IntentFilter(ACTION_INTENT_RECEIVED),
            Context.RECEIVER_NOT_EXPORTED
        )
        // webView.onResume() intentionally omitted — we don't call webView.onPause() either,
        // so the GPU surface stays live. Calling resume without a prior pause triggers a
        // surface invalidation that causes a blank-frame flash on return from background.
        // Re-enable so back button works after returning from background or SettingsActivity.
        // The callback disables itself when the WebView has no back history; without this
        // reset it stays disabled for the rest of the session (Android 13+ behaviour).
        backCallback.isEnabled = true
        applyStatusBarAppearance()
        maybePromptExactAlarmPermission()

        // Hide the resume overlay once the WebView has committed a fresh frame.
        // postVisualStateCallback fires on the main thread when the WebView has a valid
        // picture ready to draw — at that point the overlay is no longer needed.
        // The 800 ms postDelayed is a safety net in case the callback doesn't fire
        // (e.g. WebView has no pending draw commands because the DOM hasn't changed).
        webView.postVisualStateCallback(System.currentTimeMillis(), object : WebView.VisualStateCallback() {
            override fun onComplete(requestId: Long) {
                resumeOverlay.visibility = View.GONE
            }
        })
        webView.postDelayed({ resumeOverlay.visibility = View.GONE }, 800)
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
     * Prefers the app's own dark-mode preference (stored by NativeBridge when JS
     * calls setStatusBarAppearance) over the system night-mode flag.  The app
     * setting can differ from the system setting, and using the system flag
     * causes white-on-white status bar icons when the device is in dark mode but
     * the app is in light mode.  Falls back to the system flag on first launch
     * before JS has had a chance to write the preference.
     *
     * Uses the direct WindowInsetsController API on API 30+ (more reliable on
     * API 35 than the compat wrapper), with the compat path as fallback.
     */
    private fun applyStatusBarAppearance() {
        val systemNightMode = (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) ==
            Configuration.UI_MODE_NIGHT_YES
        // Prefer the app's saved preference; fall back to system night mode on first launch.
        val isNightMode = dataStore.appDarkMode ?: systemNightMode
        // Disable automatic contrast enforcement so our flag isn't overridden.
        // isStatusBarContrastEnforced is deprecated in API 35 (ignored in edge-to-edge mode),
        // but there is no replacement — suppress the warning rather than remove the call.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            @Suppress("DEPRECATION")
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

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == RC_MICROPHONE) {
            val pending = pendingWebPermissionRequest
            pendingWebPermissionRequest = null
            if (grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) {
                pending?.grant(pending.resources)
            } else {
                pending?.deny()
            }
        }
    }

    /**
     * Called when the activity is already running (singleTop) and the user taps the
     * launcher shortcut again. Store the pending action so JS picks it up on next focus.
     */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        val store = SharedDataStore(this)
        when (intent.action) {
            ACTION_VOICE_INPUT    -> store.pendingVoiceInput = true
            ACTION_ADD_TASK       -> store.pendingAddTask = true
            ACTION_ADD_INBOX_TASK -> store.pendingAddInboxTask = true
            Intent.ACTION_SEND    -> storeShareIntent(intent, store)
            "app.dayglance.CREATE",
            "app.dayglance.COMPLETE",
            "app.dayglance.OPEN",
            "app.dayglance.QUERY" -> storeIntentAction(intent, store)
            else -> return
        }
        // The WebView is already loaded; trigger the JS check immediately.
        webView.post {
            webView.evaluateJavascript(
                "(function(){ if(document.visibilityState==='visible')" +
                "document.dispatchEvent(new Event('visibilitychange')); })();",
                null
            )
        }
    }

    /**
     * Extracts shared text from an ACTION_SEND intent and stores it for the JS layer.
     * Combines subject + text when both are present (e.g. shared from a browser: subject
     * is the page title, text is the URL).
     */
    private fun storeShareIntent(intent: Intent, store: SharedDataStore) {
        val text = intent.getStringExtra(Intent.EXTRA_TEXT) ?: return
        val subject = intent.getStringExtra(Intent.EXTRA_SUBJECT)
        val combined = if (!subject.isNullOrBlank() && !text.startsWith(subject)) {
            "$subject $text".trim()
        } else {
            text
        }
        store.pendingShareText = combined.take(500)
    }

    /**
     * Stores a CREATE/COMPLETE/OPEN/QUERY Activity intent as pendingIntentJson so JS picks it
     * up via NativeBridge.getPendingIntent() on the next visibilitychange event.
     */
    private fun storeIntentAction(intent: Intent, store: SharedDataStore) {
        val action = intent.action ?: return
        val payloadExtra = intent.getStringExtra("payload")
        // Parse and re-serialize via JSONObject to prevent JSON injection.
        val payloadObj = try {
            if (payloadExtra != null) JSONObject(payloadExtra) else JSONObject()
        } catch (e: Exception) {
            JSONObject()
        }
        store.pendingIntentJson = JSONObject().put("action", action).put("payload", payloadObj).toString()
    }

    companion object {
        private const val RC_PERMISSIONS = 1001
        private const val RC_MICROPHONE = 1002
        const val ACTION_VOICE_INPUT = "com.dayglance.app.ACTION_VOICE_INPUT"
        const val ACTION_ADD_TASK       = "com.dayglance.app.ACTION_ADD_TASK"
        const val ACTION_ADD_INBOX_TASK = "com.dayglance.app.ACTION_ADD_INBOX_TASK"
        const val ACTION_INTENT_RECEIVED = "com.dayglance.app.INTENT_RECEIVED"
    }
}
