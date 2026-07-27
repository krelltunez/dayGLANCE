package com.dayglance.app.bridge

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.webkit.WebView
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import org.json.JSONObject
import java.util.Locale

/**
 * On-device speech recognition via android.speech.SpeechRecognizer — lets the
 * voice quick-add work without any AI provider configured (free, no API key,
 * on-device on modern devices).
 *
 * JS contract (see native.js in the web app):
 *   DayGlanceNative.supportsSpeechRecognition() → "true" | "false"
 *   DayGlanceNative.startSpeechRecognition()    → "ok" | {"error":"..."}
 *   DayGlanceNative.stopSpeechRecognition()     → "ok" (final text via event)
 *   DayGlanceNative.cancelSpeechRecognition()   → "ok" (no final event)
 * Events are pushed into the WebView as:
 *   window.__speechEvent({ status: 'partial'|'final'|'error', text?, message? })
 *
 * All SpeechRecognizer calls must happen on the main thread —
 * @JavascriptInterface methods run on a WebView bridge thread, so everything
 * is trampolined through [mainHandler]. Attached to NativeBridge after the
 * WebView exists (it needs the WebView to deliver events).
 */
class SpeechBridge(
    private val activity: Activity,
    private val webView: WebView,
) {

    companion object {
        // Distinct from MainActivity's RC_MICROPHONE (getUserMedia path).
        const val RC_SPEECH_PERMISSION = 7301
    }

    private val mainHandler = Handler(Looper.getMainLooper())
    private var recognizer: SpeechRecognizer? = null
    private var listening = false
    // Retained so ERROR_NO_MATCH / ERROR_SPEECH_TIMEOUT after stop can still
    // deliver whatever was heard — the recognizer often reports "no match"
    // when the user stops mid-utterance even though partials arrived fine.
    private var lastPartial = ""

    fun isAvailable(): Boolean = SpeechRecognizer.isRecognitionAvailable(activity)

    fun start(): String {
        if (!isAvailable()) {
            return """{"error":"speech recognition not available on this device"}"""
        }
        if (ContextCompat.checkSelfPermission(activity, Manifest.permission.RECORD_AUDIO)
            != PackageManager.PERMISSION_GRANTED
        ) {
            // Request now so the user's retry succeeds; this attempt reports why.
            ActivityCompat.requestPermissions(
                activity,
                arrayOf(Manifest.permission.RECORD_AUDIO),
                RC_SPEECH_PERMISSION,
            )
            return """{"error":"microphone permission needed — grant it and try again"}"""
        }
        mainHandler.post { startOnMain() }
        return "ok"
    }

    fun stop() {
        mainHandler.post { recognizer?.stopListening() }
    }

    fun cancel() {
        mainHandler.post {
            listening = false
            recognizer?.cancel()
        }
    }

    /** Called from Activity.onDestroy — releases the platform recognizer. */
    fun destroy() {
        mainHandler.post {
            listening = false
            recognizer?.destroy()
            recognizer = null
        }
    }

    // ── Internals (main thread only) ────────────────────────────────────────

    private fun startOnMain() {
        if (listening) {
            // A stale session would answer the new start with ERROR_RECOGNIZER_BUSY.
            recognizer?.cancel()
        }
        lastPartial = ""
        val rec = recognizer ?: SpeechRecognizer.createSpeechRecognizer(activity).also {
            it.setRecognitionListener(listener)
            recognizer = it
        }
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault().toLanguageTag())
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
        }
        listening = true
        rec.startListening(intent)
    }

    private val listener = object : RecognitionListener {
        override fun onPartialResults(partialResults: Bundle?) {
            val text = partialResults
                ?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                ?.firstOrNull()
                ?.trim()
                .orEmpty()
            if (text.isNotEmpty()) {
                lastPartial = text
                emit("partial", text = text)
            }
        }

        override fun onResults(results: Bundle?) {
            listening = false
            val text = results
                ?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                ?.firstOrNull()
                ?.trim()
                .orEmpty()
                .ifEmpty { lastPartial }
            emit("final", text = text)
        }

        override fun onError(error: Int) {
            listening = false
            when (error) {
                // Both fire routinely when the user stops mid-utterance or after a
                // pause — deliver what was heard instead of surfacing an error.
                SpeechRecognizer.ERROR_NO_MATCH,
                SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> emit("final", text = lastPartial)
                else -> emit("error", message = errorName(error))
            }
        }

        override fun onReadyForSpeech(params: Bundle?) {}
        override fun onBeginningOfSpeech() {}
        override fun onRmsChanged(rmsdB: Float) {}
        override fun onBufferReceived(buffer: ByteArray?) {}
        override fun onEndOfSpeech() {}
        override fun onEvent(eventType: Int, params: Bundle?) {}
    }

    private fun errorName(code: Int): String = when (code) {
        SpeechRecognizer.ERROR_AUDIO -> "audio recording error"
        SpeechRecognizer.ERROR_CLIENT -> "client error"
        SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "insufficient permissions"
        SpeechRecognizer.ERROR_NETWORK -> "network error"
        SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "network timeout"
        SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "recognizer busy"
        SpeechRecognizer.ERROR_SERVER -> "server error"
        else -> "error $code"
    }

    private fun emit(status: String, text: String? = null, message: String? = null) {
        val json = JSONObject().apply {
            put("status", status)
            if (text != null) put("text", text)
            if (message != null) put("message", message)
        }
        webView.post {
            webView.evaluateJavascript(
                "window.__speechEvent && window.__speechEvent($json);",
                null,
            )
        }
    }
}
