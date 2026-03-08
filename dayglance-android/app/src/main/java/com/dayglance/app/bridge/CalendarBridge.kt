package com.dayglance.app.bridge

import android.content.Context
import android.webkit.JavascriptInterface

/**
 * Phase 3: Calendar bridge.
 *
 * Reads and writes calendar events via the Android CalendarContract content
 * provider. Works with any calendar synced to the device — Google Calendar,
 * Exchange, and Nextcloud via DAVx⁵.
 *
 * TODO Phase 3: implement with CalendarRepository
 */
class CalendarBridge(private val context: Context) {

    @JavascriptInterface
    fun getEvents(date: String): String {
        // TODO Phase 3: query CalendarRepository.getEvents(date)
        // Returns JSON array of event objects
        return "[]"
    }

    @JavascriptInterface
    fun createEvent(eventJson: String): String {
        // TODO Phase 3: CalendarRepository.createEvent(eventJson)
        // Returns JSON: { "id": "<new event id>", "success": true }
        return "{\"success\":false,\"error\":\"not implemented\"}"
    }

    @JavascriptInterface
    fun updateEvent(eventJson: String): String {
        // TODO Phase 3: CalendarRepository.updateEvent(eventJson)
        return "{\"success\":false,\"error\":\"not implemented\"}"
    }

    @JavascriptInterface
    fun deleteEvent(eventId: String): String {
        // TODO Phase 3: CalendarRepository.deleteEvent(eventId)
        return "{\"success\":false,\"error\":\"not implemented\"}"
    }
}
