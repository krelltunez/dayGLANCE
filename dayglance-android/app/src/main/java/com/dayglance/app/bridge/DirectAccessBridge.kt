package com.dayglance.app.bridge

import android.content.Context
import android.net.Uri
import android.webkit.JavascriptInterface
import android.webkit.WebView
import com.dayglance.app.data.DirectAccessRepository
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.Executors

/**
 * Direct Access sync (docs/direct-access-sync.md): window.DayGlanceDirectAccess.
 *
 * The web layer's adapter (src/sync/directAccessAndroidBridge.js) wraps these
 * synchronous calls in the same promise-based shape the Electron preload
 * offers, so the shared transport and cycle run unchanged. The one asynchronous
 * step is the folder picker: [pickFolder] asks MainActivity to launch the SAF
 * tree picker, and the result comes back through [onFolderPicked], which calls
 * `window.__dgDirectAccessPicked(statusOrNull)` on the page.
 *
 * JS contract:
 *   pickFolder()            → void; later window.__dgDirectAccessPicked({…} | null)
 *   status()                → JSON { configured, name, path, reachable }
 *   read()                  → JSON { kind: absent|downloading|error|text, text?, error? }
 *   write(text)             → Boolean
 *   deleteSnapshot()        → Boolean
 *   disconnect()            → Boolean
 *   listFiles(rel)          → JSON array of names, "[]" for a missing directory, "null" when refused
 *   readFile(rel)           → JSON { kind, text? | error? }, as read()
 *   writeFile(rel, text)    → Boolean
 *   deleteFileAt(rel)       → Boolean (a missing file counts as deleted)
 *   makeDir(rel)            → Boolean
 * The last five take a path relative to the folder and confined to it in the
 * repository (docs/direct-access-sync.md, Phase 5: the household roster).
 *
 * The calls above are synchronous: the page's JS thread waits for each one,
 * so a slow folder holds taps, scrolling and rendering for as long as the call
 * takes. [callAsync] runs the same calls off that thread:
 *   callAsync(method, argsJson, callbackId) → void; later
 *     window.__dgDirectAccessDispatch(callbackId, resultText | null, error | null)
 * where resultText is the synchronous method's answer as text (its JSON, or
 * "true"/"false"). One worker thread runs them in the order they were made,
 * so two calls never touch the folder at once, as when they were synchronous.
 */
class DirectAccessBridge(
    context: Context,
    private val webView: WebView,
    private val launchPicker: () -> Unit,
) {
    private val repository = DirectAccessRepository(context)
    private val worker = Executors.newSingleThreadExecutor { r -> Thread(r, "DirectAccessIO").apply { isDaemon = true } }

    @JavascriptInterface
    fun pickFolder() = launchPicker()

    @JavascriptInterface
    fun status(): String = repository.status().toString()

    @JavascriptInterface
    fun read(): String = repository.read()

    @JavascriptInterface
    fun write(text: String): Boolean = repository.write(text)

    @JavascriptInterface
    fun deleteSnapshot(): Boolean = repository.delete()

    @JavascriptInterface
    fun disconnect(): Boolean {
        repository.clearFolder()
        return true
    }

    @JavascriptInterface
    fun listFiles(rel: String?): String = repository.listFiles(rel)

    @JavascriptInterface
    fun readFile(rel: String?): String = repository.readFile(rel)

    @JavascriptInterface
    fun writeFile(rel: String?, text: String): Boolean = repository.writeFile(rel, text)

    @JavascriptInterface
    fun deleteFileAt(rel: String?): Boolean = repository.deleteFile(rel)

    @JavascriptInterface
    fun makeDir(rel: String?): Boolean = repository.makeDir(rel)

    /**
     * Runs one of the folder calls on the worker thread and answers through
     * window.__dgDirectAccessDispatch. [argsJson] is a JSON array of the
     * call's arguments. The picker and disconnect are not offered here.
     */
    @JavascriptInterface
    fun callAsync(method: String, argsJson: String?, callbackId: String) {
        // Interpolated into the evaluated script below: validate before use.
        if (!DirectAccessAsync.validCallbackId(callbackId)) return
        val args = try { JSONArray(argsJson ?: "[]") } catch (e: Exception) { JSONArray() }
        worker.execute {
            val (result, error) = try {
                DirectAccessAsync.invoke(repository, method, args) to null
            } catch (e: Exception) {
                null to (e.message ?: "error")
            }
            // JSONObject.quote yields a valid JS string literal for any text.
            val resultJs = if (result != null) JSONObject.quote(result) else "null"
            val errorJs = if (error != null) JSONObject.quote(error) else "null"
            webView.post {
                webView.evaluateJavascript(
                    "window.__dgDirectAccessDispatch && window.__dgDirectAccessDispatch('$callbackId',$resultJs,$errorJs)",
                    null,
                )
            }
        }
    }

    /**
     * NOT a @JavascriptInterface: MainActivity's picker result. A null uri is a
     * cancelled picker and leaves the stored folder as it was. The status JSON
     * is built with org.json, so it is also a valid JS object literal.
     */
    fun onFolderPicked(uri: Uri?) {
        if (uri != null) repository.setFolder(uri)
        val json = if (uri != null) repository.status().toString() else "null"
        webView.post {
            webView.evaluateJavascript(
                "window.__dgDirectAccessPicked && window.__dgDirectAccessPicked($json)",
                null,
            )
        }
    }
}
