package com.dayglance.app.notifications

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.dayglance.app.bridge.NotificationBridge

/**
 * Re-registers reminder alarms and refreshes the Up Next notification when the
 * system clock or timezone changes (travel, DST, or a manual clock change).
 *
 * AlarmManager RTC_WAKEUP alarms are pinned to an absolute epoch-millisecond
 * instant. When the wall clock or timezone shifts, those instants no longer line
 * up with the intended local times. Native can't recompute the discrete reminder
 * trigger times — only the JS reminder engine has the task data — so this receiver
 * does what native can do safely and immediately:
 *
 *   1. Re-registers the persisted future alarms so none are dropped across the
 *      change (idempotent: existing alarms are updated in place).
 *   2. Refreshes the Up Next notification, which recomputes its body and next
 *      alarm against the new wall clock (it reads "HH:mm" wall-clock times and
 *      compares against Calendar.getInstance()), so it self-heals right away.
 *
 * The discrete reminders are recomputed for the new local time by the JS reminder
 * engine on the next app foreground: it re-runs syncReminders for the new local
 * midnight and the diff corrects any alarms whose wall-clock time shifted.
 *
 * Registered in the manifest for ACTION_TIMEZONE_CHANGED and ACTION_TIME_CHANGED
 * (TIME_SET); both are exempt from the background implicit-broadcast restrictions.
 */
class TimeChangeReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            Intent.ACTION_TIMEZONE_CHANGED,
            Intent.ACTION_TIME_CHANGED -> {
                runCatching { NotificationBridge(context).reregisterPersistedReminders() }
                runCatching { UpNextNotificationUpdater.refresh(context) }
            }
        }
    }
}
