package com.dayglance.app.bridge

import android.content.Context
import android.content.Intent
import android.webkit.JavascriptInterface
import com.dayglance.app.data.HealthRepository
import com.dayglance.app.data.SharedDataStore
import com.dayglance.app.settings.SettingsActivity

/**
 * Main bridge — exposed to JS as `window.DayGlanceNative`.
 *
 * Delegates to sub-bridges. The web frontend feature-detects this object:
 *
 *   if (window.DayGlanceNative) { ... }
 *
 * Each method is annotated with @JavascriptInterface so the Android runtime
 * makes it accessible from JavaScript.
 */
class NativeBridge(
    private val context: Context,
    healthRepository: HealthRepository,
    onRequestHealthPermission: () -> Unit,
) {

    private val health = HealthBridge(healthRepository, onRequestHealthPermission)
    private val calendar = CalendarBridge(context)
    private val obsidian = ObsidianBridge(context)
    private val notifications = NotificationBridge(context)
    private val dataStore = SharedDataStore(context)
    private val http = HttpBridge()

    // ── Health Connect ──────────────────────────────────────────────────────

    @JavascriptInterface
    fun getSteps(date: String): String = health.getSteps(date)

    @JavascriptInterface
    fun getSleep(date: String): String = health.getSleep(date)

    @JavascriptInterface
    fun requestHealthPermission(): String = health.requestPermission()

    // ── Calendar ────────────────────────────────────────────────────────────

    @JavascriptInterface
    fun getCalendars(): String = calendar.getCalendars()

    @JavascriptInterface
    fun getEvents(date: String): String = calendar.getEvents(date)

    @JavascriptInterface
    fun createEvent(eventJson: String): String = calendar.createEvent(eventJson)

    @JavascriptInterface
    fun updateEvent(eventJson: String): String = calendar.updateEvent(eventJson)

    @JavascriptInterface
    fun deleteEvent(eventId: String): String = calendar.deleteEvent(eventId)

    // ── Obsidian ────────────────────────────────────────────────────────────

    @JavascriptInterface
    fun getDailyNote(date: String): String = obsidian.getDailyNote(date)

    @JavascriptInterface
    fun listNotes(folder: String): String = obsidian.listNotes(folder)

    @JavascriptInterface
    fun appendToNote(path: String, content: String): Boolean = obsidian.appendToNote(path, content)

    @JavascriptInterface
    fun getTasksFromNote(path: String): String = obsidian.getTasksFromNote(path)

    // ── Notifications ───────────────────────────────────────────────────────

    @JavascriptInterface
    fun scheduleReminder(id: String, title: String, body: String, triggerAtMillis: Long) =
        notifications.scheduleReminder(id, title, body, triggerAtMillis)

    @JavascriptInterface
    fun cancelReminder(id: String) = notifications.cancelReminder(id)

    @JavascriptInterface
    fun showNotification(title: String, body: String) = notifications.showNotification(title, body)

    /**
     * Shows a rich task reminder notification with Snooze / Mark Complete action buttons.
     * Called by the JS reminder engine when running in the native WebView.
     */
    @JavascriptInterface
    fun showTaskNotification(
        reminderId: String,
        taskId: String,
        title: String,
        body: String,
        type: String,
        isCalendarEvent: Boolean,
    ) = notifications.showTaskNotification(reminderId, taskId, title, body, type, isCalendarEvent)

    /**
     * Replaces the full set of scheduled background reminder alarms.
     * Called by the JS layer whenever tasks or reminder settings change.
     * Also persists the list so ReminderReceiver can reschedule on device boot.
     *
     * [remindersJson] — JSON array of { id, taskId, title, body, type, isCalendarEvent, triggerAtMillis }
     */
    @JavascriptInterface
    fun syncReminders(remindersJson: String) = notifications.syncReminders(remindersJson)

    // ── HTTP ─────────────────────────────────────────────────────────────────

    /**
     * Performs a synchronous HTTP request from native code, bypassing CORS.
     * Used by the WebDAV cloud sync providers when running as an Android app.
     *
     * Returns JSON: { status: number, ok: boolean, body: string, error?: string }
     */
    @JavascriptInterface
    fun httpRequest(method: String, url: String, headersJson: String, body: String): String =
        http.request(method, url, headersJson, body)

    // ── Settings ─────────────────────────────────────────────────────────────

    /**
     * Opens the native SettingsActivity (Obsidian vault, daily note config).
     * Must dispatch on the main thread since JS interface callbacks are background.
     */
    @JavascriptInterface
    fun openSettings() {
        val intent = Intent(context, SettingsActivity::class.java)
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
    }

    /**
     * Returns a JSON object describing a pending action triggered by a notification
     * action button (e.g. Mark Complete), then clears it. Returns "" if none pending.
     *
     * Format: { "action": "complete", "taskId": "..." }
     *
     * The JS layer calls this on every visibilitychange event to pick up actions
     * that happened while the app was backgrounded.
     */
    @JavascriptInterface
    fun getPendingAction(): String {
        // Snooze takes priority (it was triggered most recently)
        val snoozeId = dataStore.pendingSnoozeTaskId
        if (snoozeId != null) {
            dataStore.pendingSnoozeTaskId = null
            val escaped = snoozeId.replace("\\", "\\\\").replace("\"", "\\\"")
            return """{"action":"snooze","taskId":"$escaped","minutes":15}"""
        }
        val completeId = dataStore.pendingCompleteTaskId ?: return ""
        dataStore.pendingCompleteTaskId = null
        val escaped = completeId.replace("\\", "\\\\").replace("\"", "\\\"")
        return """{"action":"complete","taskId":"$escaped"}"""
    }
}
