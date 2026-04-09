package com.dayglance.app.notifications

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.dayglance.app.bridge.NotificationBridge
import com.dayglance.app.data.SharedDataStore
import org.json.JSONObject
import java.util.Calendar

/**
 * BroadcastReceiver that refreshes the "Up Next" persistent notification from native data.
 *
 * Driven by AlarmManager so it keeps working even when the WebView is suspended in the
 * background. The alarm chain is started whenever JS writes a new widget snapshot (which
 * includes the nextTask), so this always has fresh task data to work from.
 *
 * Scheduling strategy:
 *  - While the task is upcoming: [setExact] fires each minute for a live countdown
 *    (fires when the screen is on / device not in Doze).  A second
 *    [setExactAndAllowWhileIdle] alarm is also armed at the exact start time so the
 *    "In progress" state is shown even if Doze kept the per-minute ticks from firing.
 *  - While the task is in progress: [setExactAndAllowWhileIdle] fires at the end time
 *    so the notification is cleared promptly when the task finishes.
 */
class UpNextNotificationUpdater : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        refresh(context)
    }

    companion object {
        private const val ACTION = "com.dayglance.app.notification.UP_NEXT_TICK"
        // Two request codes so we can hold a per-minute tick AND a transition alarm simultaneously.
        private const val RC_TICK = 7001
        private const val RC_TRANSITION = 7002

        /**
         * Called from [com.dayglance.app.bridge.NativeBridge.updateWidgetSnapshot] whenever JS
         * pushes a fresh snapshot.  Immediately refreshes the notification and arms the alarm
         * chain so future updates happen natively.
         */
        fun schedule(context: Context) = refresh(context)

        /**
         * Reads [SharedDataStore.widgetSnapshot], recomputes the correct notification body
         * for the current time, posts the notification, then schedules the next alarm.
         *
         * Also called by [com.dayglance.app.widget.WidgetUpdateWorker] as a 15-minute backstop.
         */
        fun refresh(context: Context) {
            val snapshot = SharedDataStore(context).widgetSnapshot
                ?.let { runCatching { JSONObject(it) }.getOrNull() }
                ?: return

            val nextTask = snapshot.optJSONObject("nextTask")
            val bridge = NotificationBridge(context)

            if (nextTask == null) {
                bridge.cancelUpNextNotification()
                cancelAlarms(context)
                return
            }

            val title = nextTask.optString("title", "")
            val startTime = nextTask.optString("startTime", "")
            val duration = nextTask.optInt("duration", 0)
            val use24Hour = snapshot.optBoolean("use24Hour", false)

            if (startTime.isEmpty()) {
                bridge.cancelUpNextNotification()
                cancelAlarms(context)
                return
            }

            val startMin = parseHhMm(startTime)
            if (startMin < 0) return

            val cal = Calendar.getInstance()
            val nowMin = cal.get(Calendar.HOUR_OF_DAY) * 60 + cal.get(Calendar.MINUTE)
            val endMin = startMin + duration

            // Task already ended — cancel and stop the chain.
            if (duration > 0 && nowMin >= endMin) {
                bridge.cancelUpNextNotification()
                cancelAlarms(context)
                return
            }

            val bodyText = buildBodyText(nowMin, startMin, duration, endMin, use24Hour)
            bridge.updateUpNextNotification(
                JSONObject().apply {
                    put("title", title)
                    put("bodyText", bodyText)
                }.toString()
            )
            // Keep the UpNextWidget in sync on the same alarm ticks.
            try { com.dayglance.app.widget.UpNextWidget.requestUpdate(context) } catch (_: Throwable) { }

            scheduleNextAlarm(context, cal, nowMin, startMin, endMin, duration)
        }

        // ── Internal helpers ────────────────────────────────────────────────

        private fun buildBodyText(
            nowMin: Int,
            startMin: Int,
            duration: Int,
            endMin: Int,
            use24Hour: Boolean,
        ): String = when {
            nowMin < startMin -> {
                val diff = startMin - nowMin
                if (diff >= 60) {
                    "Starts in ${diff / 60}h${if (diff % 60 > 0) " ${diff % 60}m" else ""}"
                } else {
                    "Starts in ${diff}m"
                }
            }
            duration == 0 -> "Starting now"
            else -> {
                val endH = (endMin / 60) % 24
                val endM = endMin % 60
                if (use24Hour) {
                    "In progress · ends at %d:%02d".format(endH, endM)
                } else {
                    val h = if (endH > 12) endH - 12 else if (endH == 0) 12 else endH
                    val amPm = if (endH >= 12) "PM" else "AM"
                    "In progress · ends at %d:%02d %s".format(h, endM, amPm)
                }
            }
        }

        private fun scheduleNextAlarm(
            context: Context,
            cal: Calendar,
            nowMin: Int,
            startMin: Int,
            endMin: Int,
            duration: Int,
        ) {
            val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager

            // Midnight of the current day in wall-clock millis.
            val midnight = Calendar.getInstance().apply {
                set(Calendar.HOUR_OF_DAY, 0)
                set(Calendar.MINUTE, 0)
                set(Calendar.SECOND, 0)
                set(Calendar.MILLISECOND, 0)
            }.timeInMillis

            when {
                nowMin < startMin -> {
                    val startMs = midnight + startMin * 60_000L
                    // Next whole-minute boundary for the countdown tick.
                    val nowMs = cal.timeInMillis
                    val nextMinMs = nowMs + (60_000L - nowMs % 60_000L)

                    if (nextMinMs < startMs - 500L) {
                        // Arm a per-minute countdown tick (fires when screen is on).
                        am.setExact(AlarmManager.RTC_WAKEUP, nextMinMs, pendingIntent(context, RC_TICK))
                    }
                    // Always arm a Doze-proof alarm at the exact start time so the
                    // "In progress" state is shown even if the tick alarms were throttled.
                    am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, startMs, pendingIntent(context, RC_TRANSITION))
                }
                duration > 0 -> {
                    // In progress — fire at the end time to clear the notification.
                    val endMs = midnight + endMin * 60_000L
                    am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, endMs, pendingIntent(context, RC_TRANSITION))
                }
                // duration == 0 ("Starting now") — one-shot, no follow-up alarm needed.
            }
        }

        private fun cancelAlarms(context: Context) {
            val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            pendingIntent(context, RC_TICK, noCreate = true)?.let { am.cancel(it); it.cancel() }
            pendingIntent(context, RC_TRANSITION, noCreate = true)?.let { am.cancel(it); it.cancel() }
        }

        private fun pendingIntent(context: Context, rc: Int, noCreate: Boolean = false): PendingIntent? {
            val flags =
                (if (noCreate) PendingIntent.FLAG_NO_CREATE else PendingIntent.FLAG_UPDATE_CURRENT) or
                        PendingIntent.FLAG_IMMUTABLE
            return PendingIntent.getBroadcast(
                context, rc,
                Intent(context, UpNextNotificationUpdater::class.java).apply { action = ACTION },
                flags,
            )
        }

        /** Parses "HH:mm" or "H:mm" into minutes since midnight; returns -1 on failure. */
        private fun parseHhMm(time: String): Int = runCatching {
            val parts = time.split(":")
            parts[0].trim().toInt() * 60 + parts[1].trim().toInt()
        }.getOrDefault(-1)
    }
}
