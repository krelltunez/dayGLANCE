package com.dayglance.app.bridge

import com.dayglance.app.data.DirectAccessRepository
import org.json.JSONArray

/**
 * The method table behind DirectAccessBridge.callAsync: each name answers with
 * exactly the text its synchronous @JavascriptInterface twin returns, so the
 * web adapter parses both the same way.
 */
internal object DirectAccessAsync {
    private val CALLBACK_ID = Regex("[a-z0-9_]{1,32}")

    fun validCallbackId(id: String?): Boolean = id != null && CALLBACK_ID.matches(id)

    fun invoke(repository: DirectAccessRepository, method: String, args: JSONArray): String {
        fun str(i: Int): String? = if (args.isNull(i)) null else args.optString(i)
        return when (method) {
            "status" -> repository.status().toString()
            "read" -> repository.read()
            "write" -> repository.write(str(0) ?: "").toString()
            "deleteSnapshot" -> repository.delete().toString()
            "listFiles" -> repository.listFiles(str(0))
            "readFile" -> repository.readFile(str(0))
            "writeFile" -> repository.writeFile(str(0), str(1) ?: "").toString()
            "deleteFileAt" -> repository.deleteFile(str(0)).toString()
            "makeDir" -> repository.makeDir(str(0)).toString()
            else -> throw IllegalArgumentException("unknown method: $method")
        }
    }
}
