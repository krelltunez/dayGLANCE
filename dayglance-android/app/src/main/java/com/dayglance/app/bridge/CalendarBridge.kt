package com.dayglance.app.bridge

import android.content.Context
import android.webkit.JavascriptInterface
import com.dayglance.app.data.CalendarRepository
import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate
import java.time.format.DateTimeParseException

/**
 * Phase 3: Calendar bridge.
 *
 * Reads and writes calendar events via [CalendarRepository], which wraps the
 * Android [android.provider.CalendarContract] content provider. Works with any
 * calendar synced to the device — Google Calendar, Exchange, Nextcloud via DAVx⁵.
 *
 * Event JSON shape (returned by getEvents / accepted by createEvent + updateEvent):
 *   {
 *     "id":           string,          // CalendarContract event ID
 *     "title":        string,
 *     "start":        string,          // "YYYY-MM-DDThh:mm:ss" or "YYYY-MM-DD" for all-day
 *     "end":          string,          // same format as start
 *     "allDay":       boolean,
 *     "notes":        string,
 *     "location":     string,
 *     "calendarId":   string,
 *     "calendarName": string,          // read-only; ignored on write
 *     "color":        string           // "#RRGGBB"; read-only; ignored on write
 *   }
 */
class CalendarBridge(private val context: Context) {

    private val repository = CalendarRepository(context)

    @JavascriptInterface
    fun getCalendars(): String {
        val array = JSONArray()
        repository.getCalendars().forEach { c ->
            array.put(
                JSONObject()
                    .put("id",          c.id)
                    .put("name",        c.name)
                    .put("accountName", c.accountName)
                    .put("color",       c.color)
            )
        }
        return array.toString()
    }

    @JavascriptInterface
    fun getEvents(date: String): String {
        val localDate = parseDate(date)
        val array = JSONArray()
        repository.getEvents(localDate).forEach { e ->
            array.put(
                JSONObject()
                    .put("id",           e.id)
                    .put("title",        e.title)
                    .put("start",        e.start)
                    .put("end",          e.end)
                    .put("allDay",       e.allDay)
                    .put("notes",        e.notes)
                    .put("location",     e.location)
                    .put("calendarId",   e.calendarId)
                    .put("calendarName", e.calendarName)
                    .put("color",        e.color)
            )
        }
        return array.toString()
    }

    @JavascriptInterface
    fun createEvent(eventJson: String): String = try {
        val obj = JSONObject(eventJson)
        val id = repository.createEvent(
            title      = obj.optString("title"),
            start      = obj.optString("start"),
            end        = obj.optString("end"),
            allDay     = obj.optBoolean("allDay", false),
            notes      = obj.optString("notes", ""),
            calendarId = obj.optString("calendarId").takeIf { it.isNotEmpty() },
        )
        if (id != null) {
            JSONObject().put("success", true).put("id", id).toString()
        } else {
            JSONObject().put("success", false).put("error", "insert failed").toString()
        }
    } catch (e: Exception) {
        JSONObject().put("success", false).put("error", e.message ?: "error").toString()
    }

    @JavascriptInterface
    fun updateEvent(eventJson: String): String = try {
        val obj = JSONObject(eventJson)
        val success = repository.updateEvent(
            id       = obj.getString("id"),
            title    = obj.optString("title"),
            start    = obj.optString("start"),
            end      = obj.optString("end"),
            allDay   = obj.optBoolean("allDay", false),
            notes    = obj.optString("notes", ""),
            location = obj.optString("location", ""),
        )
        JSONObject().put("success", success).toString()
    } catch (e: Exception) {
        JSONObject().put("success", false).put("error", e.message ?: "error").toString()
    }

    @JavascriptInterface
    fun deleteEvent(eventId: String): String {
        val success = repository.deleteEvent(eventId)
        return JSONObject().put("success", success).toString()
    }

    private fun parseDate(date: String): LocalDate = try {
        LocalDate.parse(date.take(10))
    } catch (_: DateTimeParseException) {
        LocalDate.now()
    }
}
