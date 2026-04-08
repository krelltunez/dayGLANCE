package com.dayglance.app.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.view.View
import android.widget.RemoteViews
import com.dayglance.app.MainActivity
import com.dayglance.app.R
import com.dayglance.app.data.SharedDataStore
import org.json.JSONObject
import java.time.LocalDate
import java.time.LocalTime
import java.time.format.DateTimeFormatter

/**
 * "Up Next" home screen widget.
 *
 * Shows rich detail for the next scheduled task: title, time range, time-until
 * countdown, project, tags, notes preview, and up to 5 subtasks.
 *
 * Data comes from the same [SharedDataStore.widgetSnapshot] JSON written by the JS
 * app. This widget reads the top-level "nextTask" object that the JS side computes
 * as the nearest non-completed scheduled task that hasn't ended yet.
 *
 * Unlike [DayGlanceWidget], this widget is a static RemoteViews layout (no ListView).
 * It updates whenever the JS app pushes a new snapshot and every 15 minutes via
 * [WidgetUpdateWorker] (shared with [DayGlanceWidget]).
 */
class UpNextWidget : AppWidgetProvider() {

    override fun onUpdate(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray,
    ) {
        for (id in appWidgetIds) {
            try { updateWidget(context, appWidgetManager, id) } catch (_: Throwable) { }
        }
    }

    override fun onEnabled(context: Context) {
        super.onEnabled(context)
        // Piggyback on the shared background worker — schedule only if not running.
        try { WidgetUpdateWorker.schedule(context) } catch (_: Throwable) { }
    }

    // onDisabled: do NOT cancel the worker — DayGlanceWidget may still need it.

    // ── Widget rendering ──────────────────────────────────────────────────────

    private fun updateWidget(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetId: Int,
    ) {
        val views = RemoteViews(context.packageName, R.layout.widget_upnext)
        val dataStore = SharedDataStore(context)
        val snapshot = dataStore.widgetSnapshot?.let { runCatching { JSONObject(it) }.getOrNull() }
        val use24Hour = snapshot?.optBoolean("use24Hour", false) ?: false

        // Header date
        val dateLabel = snapshot?.optString("dateLabel") ?: formatTodayLabel()
        views.setTextViewText(R.id.tv_upnext_date, dateLabel)

        // Tap root to open app
        val launchIntent = Intent(context, MainActivity::class.java)
        val launchPi = PendingIntent.getActivity(
            context, REQUEST_CODE_LAUNCH, launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        views.setOnClickPendingIntent(R.id.upnext_root, launchPi)

        // Refresh button
        val refreshIntent = Intent(ACTION_REFRESH).apply {
            component = ComponentName(context, UpNextWidget::class.java)
        }
        val refreshPi = PendingIntent.getBroadcast(
            context, REQUEST_CODE_REFRESH, refreshIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        views.setOnClickPendingIntent(R.id.btn_upnext_refresh, refreshPi)

        // Show task or empty state
        val nextTask = snapshot?.optJSONObject("nextTask")
        if (nextTask != null) {
            views.setViewVisibility(R.id.layout_upnext_task, View.VISIBLE)
            views.setViewVisibility(R.id.layout_upnext_empty, View.GONE)
            bindTaskViews(views, nextTask, use24Hour)
        } else {
            views.setViewVisibility(R.id.layout_upnext_task, View.GONE)
            views.setViewVisibility(R.id.layout_upnext_empty, View.VISIBLE)
        }

        appWidgetManager.updateAppWidget(appWidgetId, views)
    }

    private fun bindTaskViews(views: RemoteViews, task: JSONObject, use24Hour: Boolean) {
        // Color bar
        try {
            val colorHex = task.optString("colorHex", "#3b82f6")
            views.setInt(R.id.upnext_color_bar, "setBackgroundColor", Color.parseColor(colorHex))
        } catch (_: Throwable) { }

        // Title
        views.setTextViewText(R.id.tv_upnext_title, task.optString("title", "Untitled"))

        // Time range + time-until countdown
        val startTime = task.optString("startTime", "")
        val duration = task.optInt("duration", 0)
        val (timeStr, timeUntilStr) = buildTimeStrings(startTime, duration, use24Hour)
        views.setTextViewText(R.id.tv_upnext_time, timeStr)
        if (timeUntilStr.isNotEmpty()) {
            views.setTextViewText(R.id.tv_upnext_time_until, timeUntilStr)
            views.setViewVisibility(R.id.tv_upnext_time_until, View.VISIBLE)
        } else {
            views.setViewVisibility(R.id.tv_upnext_time_until, View.GONE)
        }

        // Project chip
        val projectName = task.optString("projectName", "")
        if (projectName.isNotEmpty()) {
            views.setTextViewText(R.id.tv_upnext_project, projectName)
            views.setViewVisibility(R.id.tv_upnext_project, View.VISIBLE)
        } else {
            views.setViewVisibility(R.id.tv_upnext_project, View.GONE)
        }

        // Tags
        val tagsArray = task.optJSONArray("tags")
        if (tagsArray != null && tagsArray.length() > 0) {
            val tagStr = (0 until tagsArray.length()).joinToString("  ") { "#${tagsArray.optString(it)}" }
            views.setTextViewText(R.id.tv_upnext_tags, tagStr)
            views.setViewVisibility(R.id.tv_upnext_tags, View.VISIBLE)
        } else {
            views.setViewVisibility(R.id.tv_upnext_tags, View.GONE)
        }

        // Notes preview
        val notes = task.optString("notes", "").trim()
        if (notes.isNotEmpty()) {
            views.setTextViewText(R.id.tv_upnext_notes, notes)
            views.setViewVisibility(R.id.tv_upnext_notes, View.VISIBLE)
        } else {
            views.setViewVisibility(R.id.tv_upnext_notes, View.GONE)
        }

        // Subtasks (up to 5 rows)
        val subtasksArray = task.optJSONArray("subtasks")
        val subtaskCount = subtasksArray?.length() ?: 0
        views.setViewVisibility(
            R.id.tv_upnext_subtasks_header,
            if (subtaskCount > 0) View.VISIBLE else View.GONE,
        )

        val subtaskRows = listOf(
            Triple(R.id.row_subtask_1, R.id.tv_subtask_1_check, R.id.tv_subtask_1_title),
            Triple(R.id.row_subtask_2, R.id.tv_subtask_2_check, R.id.tv_subtask_2_title),
            Triple(R.id.row_subtask_3, R.id.tv_subtask_3_check, R.id.tv_subtask_3_title),
            Triple(R.id.row_subtask_4, R.id.tv_subtask_4_check, R.id.tv_subtask_4_title),
            Triple(R.id.row_subtask_5, R.id.tv_subtask_5_check, R.id.tv_subtask_5_title),
        )
        for ((idx, row) in subtaskRows.withIndex()) {
            val (rowId, checkId, titleId) = row
            val sub = subtasksArray?.optJSONObject(idx)
            if (sub != null) {
                val completed = sub.optBoolean("completed", false)
                views.setViewVisibility(rowId, View.VISIBLE)
                views.setTextViewText(checkId, if (completed) "✓" else "○")
                views.setTextViewText(titleId, sub.optString("title", ""))
            } else {
                views.setViewVisibility(rowId, View.GONE)
            }
        }
    }

    // ── Time helpers ──────────────────────────────────────────────────────────

    /**
     * Returns a pair of (timeRangeStr, timeUntilStr).
     *
     * timeRangeStr: e.g. "2:30 PM – 3:15 PM" or "14:30 – 15:15"
     * timeUntilStr: e.g. "in 15m", "in 1h 30m", "in progress", or "" when ended
     */
    private fun buildTimeStrings(
        startTime: String,
        duration: Int,
        use24Hour: Boolean,
    ): Pair<String, String> {
        if (startTime.isEmpty()) return Pair("", "")
        return try {
            val parts = startTime.split(":").map { it.toInt() }
            val startMin = parts[0] * 60 + (parts.getOrNull(1) ?: 0)
            val endMin = startMin + duration

            val start = LocalTime.of(parts[0], parts.getOrNull(1) ?: 0)
            val fmt = if (use24Hour) DateTimeFormatter.ofPattern("H:mm") else DateTimeFormatter.ofPattern("h:mm a")
            val fmtShort = if (use24Hour) DateTimeFormatter.ofPattern("H:mm") else DateTimeFormatter.ofPattern("h:mm")

            val timeRangeStr = if (duration > 0) {
                val end = LocalTime.of(endMin / 60, endMin % 60)
                "${start.format(fmt)} – ${end.format(fmtShort)}"
            } else {
                start.format(fmt)
            }

            val now = LocalTime.now()
            val nowMin = now.hour * 60 + now.minute
            val timeUntilStr = when {
                nowMin < startMin -> {
                    val diff = startMin - nowMin
                    if (diff >= 60) {
                        val h = diff / 60
                        val m = diff % 60
                        if (m == 0) "in ${h}h" else "in ${h}h ${m}m"
                    } else {
                        "in ${diff}m"
                    }
                }
                nowMin < endMin -> "in progress"
                else -> "" // task has ended — no badge
            }

            Pair(timeRangeStr, timeUntilStr)
        } catch (_: Throwable) {
            Pair(startTime, "")
        }
    }

    private fun formatTodayLabel(): String = try {
        LocalDate.now().format(DateTimeFormatter.ofPattern("EEE, MMM d"))
    } catch (_: Throwable) { "Today" }

    // ── Manual refresh broadcast ──────────────────────────────────────────────

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == ACTION_REFRESH) {
            try { WidgetUpdateWorker.scheduleImmediate(context) } catch (_: Throwable) { }
            requestUpdate(context)
        } else {
            super.onReceive(context, intent)
        }
    }

    // ── Companion: trigger widget refresh from outside ────────────────────────

    companion object {
        const val ACTION_REFRESH = "com.dayglance.app.widget.UPNEXT_REFRESH"
        private const val REQUEST_CODE_LAUNCH = 200
        private const val REQUEST_CODE_REFRESH = 201

        fun requestUpdate(context: Context) {
            try {
                val manager = AppWidgetManager.getInstance(context)
                val ids = manager.getAppWidgetIds(ComponentName(context, UpNextWidget::class.java))
                if (ids.isEmpty()) return
                val intent = Intent(AppWidgetManager.ACTION_APPWIDGET_UPDATE).apply {
                    component = ComponentName(context, UpNextWidget::class.java)
                    putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids)
                }
                context.sendBroadcast(intent)
            } catch (_: Throwable) { }
        }
    }
}
