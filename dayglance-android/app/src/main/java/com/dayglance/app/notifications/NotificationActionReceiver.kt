package com.dayglance.app.notifications

import android.app.AlarmManager
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import com.dayglance.app.MainActivity
import com.dayglance.app.data.SharedDataStore

/**
 * Phase 5: Handles notification action button taps — Snooze and Mark Complete.
 *
 * Snooze: cancels the current notification and schedules a new alarm for
 *         System.currentTimeMillis() + 15 minutes via ReminderReceiver.
 *
 * Complete: writes the taskId to SharedDataStore.pendingCompleteTaskId and
 *           brings the app to the foreground. The JS layer reads the pending
 *           action on the next visibilitychange event via getPendingAction().
 */
class NotificationActionReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val notifId = intent.getIntExtra(EXTRA_NOTIF_ID, 0)

        // Always dismiss the triggering notification
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.cancel(notifId)

        when (intent.action) {
            ACTION_SNOOZE -> handleSnooze(context, intent, notifId)
            ACTION_COMPLETE -> handleComplete(context, intent)
        }
    }

    private fun handleSnooze(context: Context, intent: Intent, notifId: Int) {
        val triggerAt = System.currentTimeMillis() + SNOOZE_MS
        val taskId = intent.getStringExtra(EXTRA_TASK_ID) ?: ""

        // Store the snooze request so JS can shift the task start time by 15 minutes
        // when the app next comes to the foreground.
        if (taskId.isNotEmpty()) {
            SharedDataStore(context).pendingSnoozeTaskId = taskId
        }

        val alarmIntent = Intent(context, ReminderReceiver::class.java).apply {
            putExtra(ReminderReceiver.EXTRA_ID, "snooze-$notifId")
            putExtra(ReminderReceiver.EXTRA_TASK_ID, taskId)
            putExtra(ReminderReceiver.EXTRA_TITLE, intent.getStringExtra(EXTRA_TITLE))
            putExtra(ReminderReceiver.EXTRA_BODY, intent.getStringExtra(EXTRA_BODY))
            putExtra(ReminderReceiver.EXTRA_TYPE, intent.getStringExtra(EXTRA_TYPE))
            putExtra(ReminderReceiver.EXTRA_IS_CALENDAR, intent.getBooleanExtra(EXTRA_IS_CALENDAR, false))
        }
        val pi = PendingIntent.getBroadcast(
            context,
            "snooze-$notifId".hashCode(),
            alarmIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !am.canScheduleExactAlarms()) {
            am.set(AlarmManager.RTC_WAKEUP, triggerAt, pi)
        } else {
            am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi)
        }
    }

    private fun handleComplete(context: Context, intent: Intent) {
        val taskId = intent.getStringExtra(EXTRA_TASK_ID) ?: return
        SharedDataStore(context).pendingCompleteTaskId = taskId

        // Bring the app to the foreground; JS will pick up pendingCompleteTaskId
        // on the next visibilitychange event via DayGlanceNative.getPendingAction()
        context.startActivity(
            Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
            }
        )
    }

    companion object {
        const val ACTION_SNOOZE = "com.dayglance.app.ACTION_SNOOZE"
        const val ACTION_COMPLETE = "com.dayglance.app.ACTION_COMPLETE"

        const val EXTRA_NOTIF_ID = "notif_id"
        const val EXTRA_TASK_ID = "task_id"
        const val EXTRA_TITLE = "notif_title"
        const val EXTRA_BODY = "notif_body"
        const val EXTRA_TYPE = "notif_type"
        const val EXTRA_IS_CALENDAR = "notif_is_calendar"

        /** 15 minutes in milliseconds */
        const val SNOOZE_MS = 15 * 60 * 1000L
    }
}
