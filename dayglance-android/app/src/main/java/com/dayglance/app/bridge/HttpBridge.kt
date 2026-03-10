package com.dayglance.app.bridge

import android.webkit.JavascriptInterface
import org.json.JSONObject
import java.io.OutputStream
import java.net.HttpURLConnection
import java.net.URL

/**
 * Native HTTP bridge — lets the WebView JS make arbitrary HTTP requests
 * from the native layer, bypassing CORS and the /api/webdav-proxy/ server.
 *
 * Used by cloud sync (WebDAV/Nextcloud) when running as an Android app,
 * where there is no proxy server available.
 *
 * All methods run on whatever thread Android calls @JavascriptInterface on
 * (not the main thread), so blocking I/O is safe here.
 */
class HttpBridge {

    /**
     * Performs a synchronous HTTP request and returns a JSON result string.
     *
     * @param method      HTTP method: GET, PUT, POST, DELETE, MKCOL, PROPFIND, …
     * @param url         Full URL to request
     * @param headersJson JSON object of request headers, e.g. {"Authorization":"Basic xxx"}
     * @param body        Request body (empty string if none)
     * @return JSON string: { status: number, ok: boolean, body: string, error?: string }
     */
    @JavascriptInterface
    fun request(method: String, url: String, headersJson: String, body: String): String {
        return try {
            val connection = URL(url).openConnection() as HttpURLConnection
            connection.requestMethod = method
            connection.connectTimeout = 20_000
            connection.readTimeout = 20_000
            connection.instanceFollowRedirects = true

            // Apply request headers
            try {
                val headers = JSONObject(headersJson)
                headers.keys().forEach { key ->
                    connection.setRequestProperty(key, headers.getString(key))
                }
            } catch (_: Exception) {}

            // Write body if provided
            if (body.isNotEmpty() && method !in listOf("GET", "HEAD", "DELETE")) {
                connection.doOutput = true
                val os: OutputStream = connection.outputStream
                os.write(body.toByteArray(Charsets.UTF_8))
                os.flush()
                os.close()
            }

            val statusCode = connection.responseCode
            val responseBody = try {
                if (statusCode >= 400) {
                    connection.errorStream?.bufferedReader(Charsets.UTF_8)?.readText() ?: ""
                } else {
                    connection.inputStream.bufferedReader(Charsets.UTF_8).readText()
                }
            } catch (_: Exception) { "" }
            connection.disconnect()

            JSONObject().apply {
                put("status", statusCode)
                put("ok", statusCode in 200..299)
                put("body", responseBody)
            }.toString()
        } catch (e: Exception) {
            JSONObject().apply {
                put("status", 0)
                put("ok", false)
                put("body", "")
                put("error", e.message ?: "Network error")
            }.toString()
        }
    }
}
