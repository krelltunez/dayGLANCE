package com.dayglance.app.sse

import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import kotlin.coroutines.coroutineContext

/**
 * Native GLANCEvault SSE reader (Path 2 — see the scoping investigation).
 *
 * The WebView cannot stream `text/event-stream` through the buffered bridge
 * (`window.DayGlanceNative.httpRequest` returns the whole body as one string), so
 * the SHELL opens the stream instead: an authenticated `GET {vaultUrl}/events`
 * with the Bearer device token, read incrementally, framed into SSE event blocks
 * ([SseFraming]), and each block pushed into the renderer via [frameSink] (which
 * the Activity wires to `window.__glanceVaultSseReceive`). The renderer reuses its
 * EXISTING `parseSseFrame` + coalescer + drains — this class owns ONLY the socket,
 * its lifecycle, and reconnect.
 *
 * Because this is a native HTTP client (no browser origin), it needs NO vault CORS
 * change. POLLING in the renderer stays the correctness backstop; these pushes only
 * add instant drains on top.
 *
 * LIFECYCLE — the reader runs only when BOTH are true:
 *   • the renderer has declared SSE desired ([enable] / [disable]), and
 *   • the Activity is foreground ([setForeground]).
 * It drops on background and reconnects with capped exponential backoff on any drop
 * ([SseBackoff]). Every transition funnels through [reconcile], which starts or
 * stops the SINGLE reader coroutine, so there is never more than one connection.
 *
 * RECONNECT-RECONCILE — on each (re)connect the vault sends an initial
 * `{seq, kind:"connected"}` frame; it flows through [frameSink] like any other, so
 * the renderer's coalescer drains and catches anything missed while disconnected.
 */
class VaultSseClient(
    private val frameSink: (String) -> Unit,
) {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var readerJob: Job? = null

    // The connection currently being read, so cancellation (background / disable)
    // can force-close it and unblock the reader's blocking read().
    @Volatile private var activeConnection: HttpURLConnection? = null

    @Volatile private var desired = false
    @Volatile private var foreground = false
    @Volatile private var vaultUrl: String? = null
    @Volatile private var token: String? = null
    @Volatile private var accountId: String? = null

    /** Renderer → "SSE desired ON", with the vault connection params. */
    @Synchronized
    fun enable(url: String, bearer: String, account: String) {
        vaultUrl = url.trimEnd('/')
        token = bearer
        accountId = account
        desired = true
        reconcile()
    }

    /** Renderer → "SSE desired OFF". */
    @Synchronized
    fun disable() {
        desired = false
        reconcile()
    }

    /** Activity foreground/background (onStart / onStop). */
    @Synchronized
    fun setForeground(fg: Boolean) {
        foreground = fg
        reconcile()
    }

    /** Full teardown — Activity destroyed. No leaked connection or coroutine. */
    @Synchronized
    fun shutdown() {
        desired = false
        foreground = false
        stopReader()
        scope.cancel()
    }

    private fun shouldRun(): Boolean =
        desired && foreground && vaultUrl != null && token != null && accountId != null

    private fun reconcile() {
        if (shouldRun()) startReader() else stopReader()
    }

    private fun startReader() {
        if (readerJob?.isActive == true) return
        val url = vaultUrl ?: return
        val bearer = token ?: return
        val account = accountId ?: return
        readerJob = scope.launch { runLoop(url, bearer, account) }
    }

    private fun stopReader() {
        readerJob?.cancel()
        readerJob = null
        // Unblock a reader parked in a blocking read(): coroutine cancellation alone
        // won't interrupt java.io, so force-close the socket.
        try { activeConnection?.disconnect() } catch (_: Exception) {}
    }

    private suspend fun runLoop(url: String, bearer: String, account: String) {
        val backoff = SseBackoff()
        while (coroutineContext[Job]?.isActive == true) {
            val openedAt = System.currentTimeMillis()
            try {
                connectAndRead(url, bearer, account)
            } catch (e: Exception) {
                if (coroutineContext[Job]?.isActive != true) return // cancelled → done
                Log.w(TAG, "SSE read error: ${e.message}")
                push(JSONObject().put("type", "error").put("message", e.message ?: "sse error"))
            }
            if (coroutineContext[Job]?.isActive != true) return
            // The stream ended (server close / read timeout / drop). Tell the
            // renderer, then reconnect with backoff — resetting it only if the
            // connection had been healthy long enough.
            push(JSONObject().put("type", "closed"))
            backoff.onClosed(System.currentTimeMillis() - openedAt)
            delay(backoff.nextDelayMs())
        }
    }

    private suspend fun connectAndRead(url: String, bearer: String, account: String) {
        val target = URL("$url/events?accountId=" + URLEncoder.encode(account, "UTF-8"))
        val conn = (target.openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            setRequestProperty("Authorization", "Bearer $bearer")
            setRequestProperty("Accept", "text/event-stream")
            connectTimeout = 20_000
            // Longer than the ~25 s server heartbeat so a healthy idle stream never
            // trips it, but a silently-dead connection is detected and reconnected
            // within the timeout instead of parking forever.
            readTimeout = 60_000
            instanceFollowRedirects = true
        }
        activeConnection = conn
        try {
            val code = conn.responseCode
            if (code !in 200..299) throw RuntimeException("vault SSE connect failed: $code")
            push(JSONObject().put("type", "open"))

            val framing = SseFraming()
            val reader = BufferedReader(InputStreamReader(conn.inputStream, Charsets.UTF_8))
            val chunk = CharArray(2048)
            while (coroutineContext[Job]?.isActive == true) {
                val n = reader.read(chunk) // blocks until data, EOF (-1), or read timeout
                if (n == -1) break         // server closed the stream
                for (block in framing.append(String(chunk, 0, n))) {
                    push(JSONObject().put("type", "frame").put("block", block))
                }
            }
        } finally {
            activeConnection = null
            try { conn.disconnect() } catch (_: Exception) {}
        }
    }

    private fun push(msg: JSONObject) {
        // frameSink hops to the main thread + evaluateJavascript (Activity-wired).
        frameSink(msg.toString())
    }

    companion object {
        private const val TAG = "VaultSseClient"
    }
}
