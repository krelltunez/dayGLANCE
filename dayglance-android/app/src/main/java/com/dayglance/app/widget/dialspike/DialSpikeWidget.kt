package com.dayglance.app.widget.dialspike

import android.app.AlarmManager
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import android.widget.RemoteViews
import com.dayglance.app.R
import com.dayglance.app.widget.exactWidgetSizes
import java.io.File
import java.io.FileOutputStream
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import kotlin.math.max
import kotlin.math.min

// ─────────────────────────────────────────────────────────────────────────────
// THROWAWAY — Day Dial spike, not for release. Answers three questions on a
// real device before the Android Day Dial is built:
//
//   1. THE NEEDLE. A <rotate> drawable over the face, turned with
//      ImageView.setImageLevel (a RemotableViewMethod) in a PARTIAL update
//      every 5 minutes: one int crosses to the launcher; the face does not.
//      Right after a full update the needle must sit on the face's thin white
//      ghost line (alignment); between full updates it moves off it.
//   2. THE FACE. Full-size, at the widget's own pixel size. Two ways, switched
//      by tapping the widget: served by URI (a PNG file through
//      DialSpikeFaceProvider, the launcher loads it) or a bitmap inside the
//      update (bounded by the binder / widget-bitmap limits). The face is
//      redrawn on the hour, standing in for the real dial's block boundaries.
//   3. THE COST. Non-wakeup RTC alarms every 5 minutes: exact when the app
//      holds the exact-alarm grant, a 1-minute window otherwise. They fire
//      while the phone is awake and wait while it sleeps, so the widget
//      catches up when the screen comes on. The strip in the middle reports
//      the alarm kind, ticks, lateness and the face's size and draw cost.
//      Battery: Settings → Battery → app usage after a day.
//
// A Chronometer counts down to the next quarter hour: the hub's live
// countdowns (iOS Text(timerInterval:)) in a widget, ticking with no updates.
// ─────────────────────────────────────────────────────────────────────────────

class DialSpikeWidget : AppWidgetProvider() {

    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        ids.forEach { fullUpdate(context, manager, it) }
        arm(context)
    }

    override fun onAppWidgetOptionsChanged(context: Context, manager: AppWidgetManager, id: Int, newOptions: Bundle) {
        fullUpdate(context, manager, id)
    }

    override fun onDeleted(context: Context, ids: IntArray) {
        ids.forEach { File(DialSpikeFaceProvider.dir(context), "face-$it.png").delete() }
    }

    override fun onDisabled(context: Context) {
        alarmManager(context).cancel(tickIntent(context))
        prefs(context).edit().clear().apply()
    }

    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            ACTION_TICK -> onTick(context)
            ACTION_TOGGLE -> {
                val p = prefs(context)
                p.edit().putString(KEY_MODE, if (mode(context) == MODE_URI) MODE_BITMAP else MODE_URI).apply()
                val manager = AppWidgetManager.getInstance(context)
                ids(context, manager).forEach { fullUpdate(context, manager, it) }
            }
            else -> super.onReceive(context, intent)
        }
    }

    private fun onTick(context: Context) {
        val now = System.currentTimeMillis()
        val p = prefs(context)
        val scheduled = p.getLong(KEY_SCHEDULED, 0L)
        val late = if (scheduled > 0) now - scheduled else 0L
        p.edit()
            .putInt(KEY_TICKS, p.getInt(KEY_TICKS, 0) + 1)
            .putLong(KEY_LAST_TICK, now)
            .putLong(KEY_MAX_LATE, max(p.getLong(KEY_MAX_LATE, 0L), late))
            .putInt(KEY_LATE_COUNT, p.getInt(KEY_LATE_COUNT, 0) + if (late > 60_000L) 1 else 0)
            .apply()
        arm(context)

        val manager = AppWidgetManager.getInstance(context)
        val ids = ids(context, manager)
        if (ids.isEmpty()) return
        val minute = Calendar.getInstance().get(Calendar.MINUTE)
        if (minute < 5) {
            // On the hour: a full update, the stand-in for a block boundary.
            ids.forEach { fullUpdate(context, manager, it) }
        } else {
            // Everything else: the needle, the countdown and the strip only.
            val views = RemoteViews(context.packageName, R.layout.widget_dial_spike)
            views.setInt(R.id.iv_dial_spike_needle, "setImageLevel", needleLevel())
            bindCountdown(views)
            views.setTextViewText(R.id.tv_dial_spike_diag, diagnostics(context))
            try {
                manager.partiallyUpdateAppWidget(ids, views)
            } catch (t: Throwable) {
                p.edit().putString(KEY_ERROR, "partial: ${t.javaClass.simpleName}").apply()
            }
        }
    }

    private fun fullUpdate(context: Context, manager: AppWidgetManager, id: Int) {
        val p = prefs(context)
        val views = RemoteViews(context.packageName, R.layout.widget_dial_spike)
        val scale = faceScale(context, manager.getAppWidgetOptions(id))

        val t0 = SystemClock.elapsedRealtime()
        val bmp = DialSpikeFace.draw(scale, minuteOfDay())
        val drawMs = SystemClock.elapsedRealtime() - t0
        val mode = mode(context)
        var faceInfo = "${bmp.width}×${bmp.height}, draw ${drawMs}ms"
        if (mode == MODE_URI) {
            val t1 = SystemClock.elapsedRealtime()
            val file = File(DialSpikeFaceProvider.dir(context), "face-$id.png")
            FileOutputStream(file).use { bmp.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }
            faceInfo += ", png ${file.length() / 1024}KB in ${SystemClock.elapsedRealtime() - t1}ms"
            // A fresh query each time: an ImageView ignores setImageURI with
            // an equal Uri, and the launcher would keep the old face.
            val uri = Uri.parse("content://${DialSpikeFaceProvider.authority(context)}/face-$id.png?v=${System.currentTimeMillis()}")
            views.setImageViewUri(R.id.iv_dial_spike_face, uri)
        } else {
            faceInfo += ", bitmap ${bmp.byteCount / 1024}KB"
            views.setImageViewBitmap(R.id.iv_dial_spike_face, bmp)
        }
        p.edit().putString(KEY_FACE, faceInfo).putLong(KEY_LAST_FULL, System.currentTimeMillis()).remove(KEY_ERROR).apply()

        views.setInt(R.id.iv_dial_spike_needle, "setImageLevel", needleLevel())
        bindCountdown(views)
        views.setTextViewText(R.id.tv_dial_spike_diag, diagnostics(context))
        views.setOnClickPendingIntent(
            R.id.dial_spike_root,
            PendingIntent.getBroadcast(
                context, 7301,
                Intent(ACTION_TOGGLE).setComponent(ComponentName(context, DialSpikeWidget::class.java)),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            ),
        )
        try {
            manager.updateAppWidget(id, views)
        } catch (t: Throwable) {
            // A bitmap past the limit can fail right here (TransactionTooLarge)
            // or later in the launcher ("Can't load widget"); record the first.
            p.edit().putString(KEY_ERROR, "full ($mode): ${t.javaClass.simpleName}").apply()
        }
    }

    /** The Chronometer counts down to the next quarter hour by itself. */
    private fun bindCountdown(views: RemoteViews) {
        val now = System.currentTimeMillis()
        val quarter = 15 * 60_000L
        val next = (now / quarter + 1) * quarter
        views.setChronometer(R.id.ch_dial_spike_countdown, SystemClock.elapsedRealtime() + (next - now), null, true)
        views.setChronometerCountDown(R.id.ch_dial_spike_countdown, true)
    }

    private fun diagnostics(context: Context): String {
        val p = prefs(context)
        val fmt = SimpleDateFormat("HH:mm:ss", Locale.US)
        val exact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || alarmManager(context).canScheduleExactAlarms()
        val lastTick = p.getLong(KEY_LAST_TICK, 0L)
        val lastFull = p.getLong(KEY_LAST_FULL, 0L)
        return buildString {
            append(if (exact) "exact alarms" else "inexact alarms (no exact grant)")
            append("\nticks ${p.getInt(KEY_TICKS, 0)}")
            if (lastTick > 0) append(" · last ${fmt.format(Date(lastTick))}")
            append("\nlate max ${p.getLong(KEY_MAX_LATE, 0L) / 1000}s · >1min ×${p.getInt(KEY_LATE_COUNT, 0)}")
            append("\nface ${mode(context).uppercase()}: ${p.getString(KEY_FACE, "-")}")
            if (lastFull > 0) append("\nlast full ${fmt.format(Date(lastFull))}")
            p.getString(KEY_ERROR, null)?.let { append("\nERROR $it") }
            append("\ntap: switch to ${if (mode(context) == MODE_URI) "BITMAP" else "URI"}")
        }
    }

    companion object {
        private const val ACTION_TICK = "com.dayglance.app.dialspike.TICK"
        private const val ACTION_TOGGLE = "com.dayglance.app.dialspike.TOGGLE"
        private const val TICK_MINUTES = 5
        private const val MODE_URI = "uri"
        private const val MODE_BITMAP = "bitmap"

        private const val KEY_MODE = "mode"
        private const val KEY_TICKS = "ticks"
        private const val KEY_SCHEDULED = "scheduled"
        private const val KEY_LAST_TICK = "lastTick"
        private const val KEY_MAX_LATE = "maxLate"
        private const val KEY_LATE_COUNT = "lateCount"
        private const val KEY_FACE = "face"
        private const val KEY_LAST_FULL = "lastFull"
        private const val KEY_ERROR = "error"

        private fun prefs(context: Context) = context.getSharedPreferences("dial_spike", Context.MODE_PRIVATE)
        private fun mode(context: Context) = prefs(context).getString(KEY_MODE, MODE_URI) ?: MODE_URI
        private fun alarmManager(context: Context): AlarmManager =
            context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        private fun ids(context: Context, manager: AppWidgetManager) =
            manager.getAppWidgetIds(ComponentName(context, DialSpikeWidget::class.java))

        private fun minuteOfDay(): Float {
            val c = Calendar.getInstance()
            return c.get(Calendar.HOUR_OF_DAY) * 60f + c.get(Calendar.MINUTE) + c.get(Calendar.SECOND) / 60f
        }

        /** 0 at midnight, 10000 a full turn (dial_spike_needle.xml). */
        private fun needleLevel(): Int = (minuteOfDay() / 1440f * 10000f).toInt().coerceIn(0, 10000)

        /** Pixels per spec point for the widget's largest reported size. */
        private fun faceScale(context: Context, options: Bundle): Float {
            val sizes = exactWidgetSizes(options)
            val (w, h) = if (sizes.isNotEmpty()) {
                val s = sizes.maxByOrNull { it.width * it.height }!!
                s.width to s.height
            } else {
                val w = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH, 0)
                val h = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 0)
                (if (w > 0) w.toFloat() else 250f) to (if (h > 0) h.toFloat() else 250f)
            }
            val density = context.resources.displayMetrics.density
            return min(w / DialSpikeFace.CANVAS_W, h / DialSpikeFace.CANVAS_H) * density
        }

        private fun tickIntent(context: Context): PendingIntent =
            PendingIntent.getBroadcast(
                context, 7300,
                Intent(ACTION_TICK).setComponent(ComponentName(context, DialSpikeWidget::class.java)),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )

        /** The next 5-minute boundary, non-wakeup: exact with the grant,
         *  a 1-minute window without. */
        fun arm(context: Context) {
            val step = TICK_MINUTES * 60_000L
            val next = (System.currentTimeMillis() / step + 1) * step
            prefs(context).edit().putLong(KEY_SCHEDULED, next).apply()
            val am = alarmManager(context)
            val pi = tickIntent(context)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !am.canScheduleExactAlarms()) {
                am.setWindow(AlarmManager.RTC, next, 60_000L, pi)
            } else {
                am.setExact(AlarmManager.RTC, next, pi)
            }
        }
    }
}
