package com.dayglance.app.bridge

import android.content.Context
import android.content.Intent
import android.webkit.JavascriptInterface
import androidx.core.content.FileProvider
import com.dayglance.app.data.HealthRepository
import com.dayglance.app.data.SharedDataStore
import com.dayglance.app.settings.SettingsActivity
import java.io.File

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
    private val focus = FocusBridge(context, notifications)
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

    // ── File sharing ─────────────────────────────────────────────────────────

    /**
     * Saves [content] to the app's cache directory as [filename] then launches
     * the system share sheet so the user can send it to Files, Drive, etc.
     *
     * This is the Android replacement for the web `<a download>` trick, which
     * is silently ignored inside a WebView.
     *
     * Returns JSON: { "success": true } or { "success": false, "error": "…" }
     */
    @JavascriptInterface
    fun shareFile(filename: String, content: String): String {
        return try {
            val file = File(context.cacheDir, filename)
            file.writeText(content)
            val uri = FileProvider.getUriForFile(
                context,
                "${context.packageName}.fileprovider",
                file
            )
            val sendIntent = Intent(Intent.ACTION_SEND).apply {
                type = "application/json"
                putExtra(Intent.EXTRA_STREAM, uri)
                putExtra(Intent.EXTRA_SUBJECT, filename)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            val chooser = Intent.createChooser(sendIntent, "Save backup").apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(chooser)
            """{"success":true}"""
        } catch (e: Exception) {
            val msg = (e.message ?: "unknown").replace("\\", "\\\\").replace("\"", "\\\"")
            """{"success":false,"error":"$msg"}"""
        }
    }

    // ── Focus mode ───────────────────────────────────────────────────────────

    /**
     * Called when the JS app enters focus mode.
     * Hides system bars (immersive mode), cancels own reminder alarms, and
     * enables Do Not Disturb (INTERRUPTION_FILTER_ALARMS) if permission has
     * been granted.
     *
     * Returns JSON: { "dndEnabled": bool }
     */
    @JavascriptInterface
    fun enterFocusMode(): String = focus.enter()

    /**
     * Called when the JS app exits focus mode (including after the stats screen).
     * Restores system bars, previous DND filter, and rescheduled reminder alarms.
     */
    @JavascriptInterface
    fun exitFocusMode() = focus.exit()

    /** Returns true if the user has granted Do Not Disturb access to this app. */
    @JavascriptInterface
    fun isDndPermissionGranted(): Boolean = focus.isDndPermissionGranted()

    /**
     * Opens the system Do Not Disturb access settings screen so the user can
     * grant ACCESS_NOTIFICATION_POLICY to this app.
     */
    @JavascriptInterface
    fun requestDndPermission() = focus.requestDndPermission()

    // ── UI ───────────────────────────────────────────────────────────────────

    /**
     * Called by the web app whenever its own dark/light mode changes so the
     * native side can match the status-bar icon colour to the app theme.
     *
     * The app has its own dark-mode toggle (stored in localStorage) that is
     * independent of the Android OS dark-mode setting, so reading
     * resources.configuration.uiMode from Kotlin gives the wrong answer.
     *
     * [isDark] — true  → app is in dark mode → use light (white) icons
     *            false → app is in light mode → use dark (black) icons
     */
    @JavascriptInterface
    fun setStatusBarAppearance(isDark: Boolean) {
        (context as? android.app.Activity)?.runOnUiThread {
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.Q) {
                (context as android.app.Activity).window.isStatusBarContrastEnforced = false
            }
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R) {
                val appearance = if (!isDark) android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS else 0
                (context as android.app.Activity).window.insetsController?.setSystemBarsAppearance(
                    appearance,
                    android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS,
                )
            } else {
                androidx.core.view.WindowCompat.getInsetsController(
                    (context as android.app.Activity).window,
                    (context as android.app.Activity).window.decorView,
                ).isAppearanceLightStatusBars = !isDark
            }
        }
    }

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
