package com.dayglance.app.notifications

import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import com.dayglance.app.DayGlanceApplication
import com.dayglance.app.MainActivity
import com.dayglance.app.R

/**
 * Phase 5: BroadcastReceiver for scheduled reminder alarms.
 *
 * Fired by AlarmManager when a scheduled reminder is due. Builds a rich
 * notification with Snooze / Mark Complete action buttons matching the
 * in-app toast UX.
 *
 * Also handles BOOT_COMPLETED to reschedule alarms cancelled on device restart.
 *
 * TODO Phase 5: implement BOOT_COMPLETED rescheduling from persisted alarms
 */
class ReminderReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            Intent.ACTION_BOOT_COMPLETED -> {
                // TODO Phase 5: restore scheduled alarms from Room DB
            }
            else -> showReminder(context, intent)
        }
    }

    private fun showReminder(context: Context, intent: Intent) {
        val id = intent.getStringExtra(EXTRA_ID) ?: return
        val taskId = intent.getStringExtra(EXTRA_TASK_ID) ?: id
        val title = intent.getStringExtra(EXTRA_TITLE) ?: "DayGlance"
        val body = intent.getStringExtra(EXTRA_BODY) ?: ""
        val type = intent.getStringExtra(EXTRA_TYPE) ?: "start"
        val isCalendar = intent.getBooleanExtra(EXTRA_IS_CALENDAR, false)

        val notifId = id.hashCode()

        val tapIntent = PendingIntent.getActivity(
            context, 0,
            Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val builder = NotificationCompat.Builder(context, DayGlanceApplication.CHANNEL_REMINDERS)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentText(body)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setContentIntent(tapIntent)
            .setAutoCancel(true)

        // Snooze 15m — available for all types except "end"
        if (type != "end") {
            val snoozeIntent = Intent(context, NotificationActionReceiver::class.java).apply {
                action = NotificationActionReceiver.ACTION_SNOOZE
                putExtra(NotificationActionReceiver.EXTRA_NOTIF_ID, notifId)
                putExtra(NotificationActionReceiver.EXTRA_TASK_ID, taskId)
                putExtra(NotificationActionReceiver.EXTRA_TITLE, title)
                putExtra(NotificationActionReceiver.EXTRA_BODY, body)
                putExtra(NotificationActionReceiver.EXTRA_TYPE, type)
                putExtra(NotificationActionReceiver.EXTRA_IS_CALENDAR, isCalendar)
            }
            val snoozePi = PendingIntent.getBroadcast(
                context, notifId + 1, snoozeIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            builder.addAction(0, "Snooze 15m", snoozePi)
        }

        // Mark Complete — available for start/end reminders on non-calendar tasks
        if ((type == "start" || type == "end") && !isCalendar) {
            val completeIntent = Intent(context, NotificationActionReceiver::class.java).apply {
                action = NotificationActionReceiver.ACTION_COMPLETE
                putExtra(NotificationActionReceiver.EXTRA_NOTIF_ID, notifId)
                putExtra(NotificationActionReceiver.EXTRA_TASK_ID, taskId)
            }
            val completePi = PendingIntent.getBroadcast(
                context, notifId + 2, completeIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            builder.addAction(0, "Mark Complete", completePi)
        }

        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.notify(notifId, builder.build())
    }

    companion object {
        const val EXTRA_ID = "reminder_id"
        const val EXTRA_TASK_ID = "reminder_task_id"
        const val EXTRA_TITLE = "reminder_title"
        const val EXTRA_BODY = "reminder_body"
        const val EXTRA_TYPE = "reminder_type"
        const val EXTRA_IS_CALENDAR = "reminder_is_calendar"
    }
}
