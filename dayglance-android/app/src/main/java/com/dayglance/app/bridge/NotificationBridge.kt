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
import com.dayglance.app.notifications.NotificationActionReceiver
import com.dayglance.app.notifications.ReminderReceiver

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
 */
class NotificationBridge(private val context: Context) {

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
        val notifId = reminderId.hashCode()

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
}
