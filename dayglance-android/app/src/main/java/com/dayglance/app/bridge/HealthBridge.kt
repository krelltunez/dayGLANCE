package com.dayglance.app.bridge

import android.webkit.JavascriptInterface
import com.dayglance.app.data.HealthRepository
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate
import java.time.format.DateTimeParseException

/**
 * Health Connect bridge.
 *
 * Reads step counts and sleep data from Android Health Connect via
 * [HealthRepository]. Methods are called on a WebView background thread, so
 * [runBlocking] is safe here — it never blocks the main thread.
 *
 * Permission flow: [requestPermission] delegates to [onRequestPermission], which
 * posts an [ActivityResultLauncher] launch on the main thread in MainActivity.
 */
class HealthBridge(
    private val repository: HealthRepository,
    private val onRequestPermission: () -> Unit,
) {

    @JavascriptInterface
    fun getSteps(date: String): String {
        val localDate = parseDate(date)
        val steps = runBlocking { repository.getSteps(localDate) }
        return JSONObject()
            .put("steps", steps)
            .put("goal", 10000)
            .toString()
    }

    @JavascriptInterface
    fun getSleep(date: String): String {
        val localDate = parseDate(date)
        val result = runBlocking { repository.getSleep(localDate) }
        val stagesArray = JSONArray()
        result.stages.forEach { s ->
            stagesArray.put(
                JSONObject()
                    .put("stage", s.stage)
                    .put("durationMinutes", s.durationMinutes)
            )
        }
        return JSONObject()
            .put("durationMinutes", result.durationMinutes)
            .put("stages", stagesArray)
            .toString()
    }

    @JavascriptInterface
    fun requestPermission(): String {
        onRequestPermission()
        return "pending"
    }

    private fun parseDate(date: String): LocalDate = try {
        LocalDate.parse(date)
    } catch (e: DateTimeParseException) {
        LocalDate.now()
    }
}
