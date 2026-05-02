package com.dayglance.app.bridge

import android.app.AlarmManager
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.webkit.JavascriptInterface
import androidx.core.app.NotificationCompat
import com.dayglance.app.DayGlanceApplication
import com.dayglance.app.MainActivity
import com.dayglance.app.R
import com.dayglance.app.data.SharedDataStore
import com.dayglance.app.notifications.NotificationActionReceiver
import com.dayglance.app.notifications.ReminderReceiver
import org.json.JSONArray
import org.json.JSONObject

/**
 * Phase 5: Notification bridge.
 *
 * Schedules and shows native Android notifications for reminders, focus
 * mode timers, and calendar events.
 *
 * Two notification styles:
 *   showNotification     — simple, no action buttons (generic alerts)
 *   showTaskNotification — rich notification with Snooze / Mark Complete
 *                          action buttons matching the in-app toast UX
 *
 * Background delivery:
 *   syncReminders — replaces the full set of scheduled AlarmManager alarms
 *   and persists them to SharedDataStore so ReminderReceiver can reschedule
 *   on BOOT_COMPLETED.
 */
class NotificationBridge(private val context: Context) {

    private val dataStore = SharedDataStore(context)

    // ── Scheduling ───────────────────────────────────────────────────────────

    @JavascriptInterface
    fun scheduleReminder(id: String, title: String, body: String, triggerAtMillis: Long) {
        val intent = Intent(context, ReminderReceiver::class.java).apply {
            putExtra(ReminderReceiver.EXTRA_ID, id)
            putExtra(ReminderReceiver.EXTRA_TITLE, title)
            putExtra(ReminderReceiver.EXTRA_BODY, body)
        }
        val pi = PendingIntent.getBroadcast(
            context,
            id.hashCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        scheduleAlarm(pi, triggerAtMillis)
    }

    @JavascriptInterface
    fun cancelReminder(id: String) {
        val intent = Intent(context, ReminderReceiver::class.java)
        val pi = PendingIntent.getBroadcast(
            context,
            id.hashCode(),
            intent,
            PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE
        ) ?: return
        val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        am.cancel(pi)
        pi.cancel()
    }

    // ── Immediate notifications ──────────────────────────────────────────────

    /**
     * Shows a simple notification with no action buttons.
     */
    @JavascriptInterface
    fun showNotification(title: String, body: String) {
        val notification = NotificationCompat.Builder(context, DayGlanceApplication.CHANNEL_REMINDERS)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentText(body)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setContentIntent(tapPendingIntent())
            .setAutoCancel(true)
            .build()

        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.notify(System.currentTimeMillis().toInt(), notification)
    }

    /**
     * Shows a rich task reminder notification with action buttons mirroring the in-app toasts:
     *
     *   Snooze 15m    — available for all types except "end"
     *   Mark Complete — available for "start" and "end" types on non-calendar tasks
     *
     * @param reminderId     Unique reminder ID (e.g. "before5-task42-1741342000000")
     * @param taskId         Task ID used by the Complete action to update app state
     * @param title          Notification title (task name)
     * @param body           Notification body (e.g. "Starts in 5 minutes")
     * @param type           Reminder type: before15 | before10 | before5 | start | end | morning
     * @param isCalendarEvent  If true, the Complete action is omitted (read-only calendar events)
     */
    @JavascriptInterface
    fun showTaskNotification(
        reminderId: String,
        taskId: String,
        title: String,
        body: String,
        type: String,
        isCalendarEvent: Boolean,
    ) {
        // Use taskId (not reminderId) so subsequent reminders for the same
        // task/event replace prior ones instead of stacking.
        val notifId = taskId.hashCode()

        val builder = NotificationCompat.Builder(context, DayGlanceApplication.CHANNEL_REMINDERS)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentText(body)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setContentIntent(tapPendingIntent())
            .setAutoCancel(true)

        // Snooze 15m — available for all types except "end"
        if (type != "end") {
            builder.addAction(0, "Snooze 15m",
                snoozePendingIntent(notifId, taskId, title, body, type, isCalendarEvent))
        }

        // Mark Complete — available for start/end reminders on non-calendar tasks
        if ((type == "start" || type == "end") && !isCalendarEvent) {
            builder.addAction(0, "Mark Complete", completePendingIntent(notifId, taskId))
        }

        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.notify(notifId, builder.build())
    }

    // ── Background alarm sync ────────────────────────────────────────────────

    /**
     * Syncs scheduled reminder alarms with the new set using a diff-based approach.
     *
     * Only cancels alarms that have been removed or whose trigger time changed,
     * and only schedules alarms that are new or updated. Alarms that are unchanged
     * are left alone — this prevents the cancel-then-reschedule gap that could
     * cause a pending alarm to miss its window.
     *
     * Called by the JS layer whenever tasks or reminder settings change so that
     * AlarmManager always has the correct upcoming alarms — even when the app
     * is closed or the device restarts.
     *
     * [remindersJson] is a JSON array where each element has:
     *   { id, taskId, title, body, type, isCalendarEvent, triggerAtMillis }
     */
    @JavascriptInterface
    fun syncReminders(remindersJson: String) {
        // Build a map of currently scheduled alarms: id → (triggerAtMillis, body)
        data class OldMeta(val triggerMs: Long, val body: String)
        val oldMap = mutableMapOf<String, OldMeta>()
        dataStore.scheduledRemindersJson?.let { oldJson ->
            runCatching {
                val arr = JSONArray(oldJson)
                for (i in 0 until arr.length()) {
                    val obj = arr.getJSONObject(i)
                    oldMap[obj.getString("id")] = OldMeta(
                        obj.getLong("triggerAtMillis"),
                        obj.optString("body", ""),
                    )
                }
            }
        }

        // Build a map of the new desired alarms: id → object
        val newMap = mutableMapOf<String, JSONObject>()
        runCatching {
            val arr = JSONArray(remindersJson)
            for (i in 0 until arr.length()) {
                val obj = arr.getJSONObject(i)
                newMap[obj.getString("id")] = obj
            }
        }

        val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager

        // Cancel alarms that were removed or whose trigger time or body changed
        for ((id, oldMeta) in oldMap) {
            val newObj = newMap[id]
            val newTrigger = newObj?.optLong("triggerAtMillis", -1L) ?: -1L
            val newBody = newObj?.optString("body", "") ?: ""
            if (newTrigger == oldMeta.triggerMs && newBody == oldMeta.body) continue // unchanged
            val pi = PendingIntent.getBroadcast(
                context, id.hashCode(),
                Intent(context, ReminderReceiver::class.java),
                PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE
            ) ?: continue
            am.cancel(pi)
            pi.cancel()
        }

        // Persist the new list (used by ReminderReceiver on BOOT_COMPLETED)
        dataStore.scheduledRemindersJson = remindersJson

        // Schedule only new or changed alarms
        runCatching {
            for ((id, newObj) in newMap) {
                val oldMeta = oldMap[id]
                val newTrigger = newObj.getLong("triggerAtMillis")
                val newBody = newObj.optString("body", "")
                if (oldMeta != null && oldMeta.triggerMs == newTrigger && oldMeta.body == newBody) continue // unchanged
                scheduleFromJson(newObj)
            }
        }
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private fun scheduleAlarm(pi: PendingIntent, triggerAtMillis: Long) {
        val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !am.canScheduleExactAlarms()) {
            am.set(AlarmManager.RTC_WAKEUP, triggerAtMillis, pi)
        } else {
            am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAtMillis, pi)
        }
    }

    private fun tapPendingIntent(): PendingIntent = PendingIntent.getActivity(
        context, 0,
        Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP
        },
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )

    private fun snoozePendingIntent(
        notifId: Int,
        taskId: String,
        title: String,
        body: String,
        type: String,
        isCalendarEvent: Boolean,
    ): PendingIntent {
        val intent = Intent(context, NotificationActionReceiver::class.java).apply {
            action = NotificationActionReceiver.ACTION_SNOOZE
            putExtra(NotificationActionReceiver.EXTRA_NOTIF_ID, notifId)
            putExtra(NotificationActionReceiver.EXTRA_TASK_ID, taskId)
            putExtra(NotificationActionReceiver.EXTRA_TITLE, title)
            putExtra(NotificationActionReceiver.EXTRA_BODY, body)
            putExtra(NotificationActionReceiver.EXTRA_TYPE, type)
            putExtra(NotificationActionReceiver.EXTRA_IS_CALENDAR, isCalendarEvent)
        }
        return PendingIntent.getBroadcast(
            context, notifId + 1, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }

    private fun completePendingIntent(notifId: Int, taskId: String): PendingIntent {
        val intent = Intent(context, NotificationActionReceiver::class.java).apply {
            action = NotificationActionReceiver.ACTION_COMPLETE
            putExtra(NotificationActionReceiver.EXTRA_NOTIF_ID, notifId)
            putExtra(NotificationActionReceiver.EXTRA_TASK_ID, taskId)
        }
        return PendingIntent.getBroadcast(
            context, notifId + 2, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }

    /** Cancels every AlarmManager alarm whose ID is listed in the stored JSON. */
    internal fun cancelAlarmsFromJson(json: String) {
        runCatching {
            val arr = JSONArray(json)
            val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            for (i in 0 until arr.length()) {
                val id = arr.getJSONObject(i).getString("id")
                val pi = PendingIntent.getBroadcast(
                    context, id.hashCode(),
                    Intent(context, ReminderReceiver::class.java),
                    PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE
                ) ?: continue
                am.cancel(pi)
                pi.cancel()
            }
        }
    }

    // ── Up Next persistent notification ─────────────────────────────────────

    /**
     * Posts (or updates) the sticky "Up Next" notification on the lock screen and
     * in the notification drawer.
     *
     * Uses IMPORTANCE_LOW so it never makes sound or vibration. setOngoing(true)
     * prevents the user from swiping it away. setOnlyAlertOnce(true) suppresses
     * any animation on subsequent content updates (e.g. countdown tick).
     *
     * [taskJson] must contain: { title, bodyText }
     *   title    — task name
     *   bodyText — pre-formatted status string ("Starts in 15m", "In progress · ends at 3:15 PM")
     */
    fun updateUpNextNotification(taskJson: String) {
        try {
            val task = JSONObject(taskJson)
            val notification = NotificationCompat.Builder(context, DayGlanceApplication.CHANNEL_UP_NEXT)
                .setSmallIcon(R.drawable.ic_notification)
                .setSubText("Up Next")
                .setContentTitle(task.optString("title", "Up Next"))
                .setContentText(task.optString("bodyText", ""))
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setOngoing(true)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setOnlyAlertOnce(true)
                .setContentIntent(tapPendingIntent())
                .build()
            val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.notify(NOTIF_ID_UP_NEXT, notification)
        } catch (_: Throwable) { }
    }

    // ── Focus timer persistent notification ─────────────────────────────────

    /**
     * Posts or updates the persistent focus timer notification shown in the
     * notification drawer while a Pomodoro / hyperGLANCE session is active.
     *
     * Uses Android's native chronometer (setWhen + setChronometerCountDown) so
     * the countdown ticks independently of the JS layer — the WebView timer
     * can be throttled when backgrounded, but this notification keeps ticking.
     *
     * [remainingSeconds] is used to compute setWhen(now + remainingMs), avoiding
     * any JS→Java Long precision issues with epoch-millisecond values.
     *
     * When paused: shows static "MM:SS remaining · Paused" text.
     *
     * Action buttons (Pause/Resume, Stop) write a pendingFocusAction and bring
     * the app to the foreground. JS reads it via getFocusPendingAction() polling.
     *
     * @param phase            "work" | "shortBreak" | "longBreak"
     * @param remainingSeconds seconds left in the current phase
     * @param isPaused         true while the timer is paused
     */
    fun showFocusTimerNotification(phase: String, remainingSeconds: Int, isPaused: Boolean) {
        val phaseLabel = when (phase) {
            "shortBreak" -> "Short Break"
            "longBreak"  -> "Long Break"
            else         -> "Focus"
        }

        val builder = NotificationCompat.Builder(context, DayGlanceApplication.CHANNEL_FOCUS)
            .setSmallIcon(R.drawable.ic_notification)
            .setSubText("Focus Mode")
            .setContentTitle(phaseLabel)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setContentIntent(tapPendingIntent())

        if (isPaused) {
            val mm = remainingSeconds / 60
            val ss = remainingSeconds % 60
            builder
                .setContentText("%02d:%02d remaining · Paused".format(mm, ss))
                .addAction(0, "Resume", focusActionPendingIntent(
                    NotificationActionReceiver.ACTION_FOCUS_RESUME, FOCUS_RESUME_REQUEST))
        } else {
            val endAtMillis = System.currentTimeMillis() + remainingSeconds * 1000L
            builder
                .setWhen(endAtMillis)
                .setUsesChronometer(true)
                .setChronometerCountDown(true)
                .setContentText("In progress")
                .addAction(0, "Pause", focusActionPendingIntent(
                    NotificationActionReceiver.ACTION_FOCUS_PAUSE, FOCUS_PAUSE_REQUEST))
        }

        builder.addAction(0, "Stop", focusActionPendingIntent(
            NotificationActionReceiver.ACTION_FOCUS_STOP, FOCUS_STOP_REQUEST))

        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.notify(NOTIF_ID_FOCUS_TIMER, builder.build())
    }

    /** Cancels the focus timer notification (called when the session ends or is dismissed). */
    fun dismissFocusTimerNotification() {
        try {
            val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.cancel(NOTIF_ID_FOCUS_TIMER)
        } catch (_: Throwable) { }
    }

    /**
     * Returns and clears any pending focus action written by a notification
     * button tap ("focus-pause" | "focus-resume" | "focus-stop"), or "" if none.
     *
     * Called by JS polling every ~500 ms while a focus session is active so that
     * notification button taps are picked up even when the app is already in the
     * foreground (visibilitychange doesn't fire in that case).
     */
    fun getFocusPendingAction(): String {
        val action = dataStore.pendingFocusAction ?: return ""
        dataStore.pendingFocusAction = null
        return action
    }

    private fun focusActionPendingIntent(action: String, requestCode: Int): PendingIntent {
        val intent = Intent(context, NotificationActionReceiver::class.java).apply {
            this.action = action
        }
        return PendingIntent.getBroadcast(
            context, requestCode, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }

    /** Cancels the Up Next persistent notification (e.g. when no tasks remain today). */
    fun cancelUpNextNotification() {
        try {
            val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.cancel(NOTIF_ID_UP_NEXT)
        } catch (_: Throwable) { }
    }

    /** Schedules a single alarm from a JSON object (same schema as syncReminders). */
    internal fun scheduleFromJson(r: JSONObject) {
        val id = r.getString("id")
        val intent = Intent(context, ReminderReceiver::class.java).apply {
            putExtra(ReminderReceiver.EXTRA_ID, id)
            putExtra(ReminderReceiver.EXTRA_TASK_ID, r.getString("taskId"))
            putExtra(ReminderReceiver.EXTRA_TITLE, r.getString("title"))
            putExtra(ReminderReceiver.EXTRA_BODY, r.getString("body"))
            putExtra(ReminderReceiver.EXTRA_TYPE, r.getString("type"))
            putExtra(ReminderReceiver.EXTRA_IS_CALENDAR, r.getBoolean("isCalendarEvent"))
        }
        val pi = PendingIntent.getBroadcast(
            context, id.hashCode(), intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        scheduleAlarm(pi, r.getLong("triggerAtMillis"))
    }

    companion object {
        private const val NOTIF_ID_UP_NEXT = 9001
        private const val NOTIF_ID_FOCUS_TIMER = 9002

        private const val FOCUS_PAUSE_REQUEST = 9010
        private const val FOCUS_RESUME_REQUEST = 9011
        private const val FOCUS_STOP_REQUEST = 9012
    }
}
