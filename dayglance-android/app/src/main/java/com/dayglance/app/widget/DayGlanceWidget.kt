package com.dayglance.app.widget

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.view.View
import android.widget.RemoteViews
import com.dayglance.app.MainActivity
import com.dayglance.app.R
import com.dayglance.app.data.SharedDataStore
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter
import java.util.Date
import java.util.Locale

/**
 * Phase 6: Home screen widget.
 *
 * Displays today's agenda using RemoteViews (Android widgets cannot use WebView).
 * Tapping the widget opens the full DayGlance app (the WebView).
 *
 * Data is read from SharedDataStore, populated every 15 min by WidgetUpdateWorker.
 *
 * Visual design matches DayGlance's design language:
 *   - Colors: blue (#3b82f6) / orange (#f97316) on white/dark backgrounds
 *   - Lora font is unavailable in RemoteViews; serif fallback is used
 */
class DayGlanceWidget : AppWidgetProvider() {

    override fun onUpdate(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray
    ) {
        for (appWidgetId in appWidgetIds) {
            updateWidget(context, appWidgetManager, appWidgetId)
        }
    }

    override fun onEnabled(context: Context) {
        super.onEnabled(context)
        // Schedule periodic refresh when first widget is added
        try {
            WidgetUpdateWorker.schedule(context)
        } catch (_: Exception) {
            // WorkManager not yet initialized on this device — worker will be re-scheduled
            // the next time the app process starts (onEnabled is retriggered on reboot too).
        }
    }

    private fun updateWidget(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetId: Int
    ) {
        // Step 1: Create RemoteViews — if this fails we truly cannot proceed.
        val views = try {
            RemoteViews(context.packageName, R.layout.widget_layout)
        } catch (_: Exception) { return }

        // Step 2: Bind data, always falling back to the placeholder on any error.
        // Each sub-step is isolated so a data-layer failure cannot prevent the
        // widget from rendering something reasonable.
        try {
            val dataStore = SharedDataStore(context)
            val snapshotJson = dataStore.widgetSnapshot
            if (snapshotJson != null) {
                try {
                    bindSnapshot(views, JSONObject(snapshotJson), dataStore.widgetSnapshotUpdatedAt)
                } catch (_: Exception) {
                    bindPlaceholder(views)
                }
            } else {
                bindPlaceholder(views)
            }
        } catch (_: Exception) {
            try { bindPlaceholder(views) } catch (_: Exception) { /* ignore */ }
        }

        // Step 3: Attach the tap-to-open action — non-critical, silently ignored on error.
        try {
            val launchIntent = Intent(context, MainActivity::class.java)
            val pendingIntent = android.app.PendingIntent.getActivity(
                context, 0, launchIntent,
                android.app.PendingIntent.FLAG_UPDATE_CURRENT or android.app.PendingIntent.FLAG_IMMUTABLE
            )
            views.setOnClickPendingIntent(R.id.widget_root, pendingIntent)
        } catch (_: Exception) { /* Widget still renders, just won't launch the app on tap */ }

        // Step 4: Push the views to the launcher — must always be reached to avoid
        // the launcher showing "Problem loading widget" on freshly placed widgets.
        try {
            appWidgetManager.updateAppWidget(appWidgetId, views)
        } catch (_: Exception) { /* Nothing further we can do */ }
    }

    private fun bindSnapshot(views: RemoteViews, snapshot: JSONObject, updatedAt: Long) {
        // Date header
        val dateLabel = snapshot.optString("dateLabel", "Today")
        views.setTextViewText(R.id.tv_date, dateLabel)

        // Steps
        val steps = snapshot.optInt("steps", -1)
        val stepsText = when {
            steps < 0 -> "Steps: —"
            steps == 0 -> "Steps: 0"
            else -> "Steps: ${formatNumber(steps)}"
        }
        views.setTextViewText(R.id.tv_steps, stepsText)

        // Next/current event
        val nextEvent = snapshot.optJSONObject("nextEvent")
        if (nextEvent != null) {
            val title = nextEvent.optString("title", "Untitled")
            val startStr = nextEvent.optString("start", "")
            val endStr = nextEvent.optString("end", "")
            val timeRange = formatTimeRange(startStr, endStr)
            val colorHex = nextEvent.optString("color", "#3b82f6")

            views.setTextViewText(R.id.tv_next_event_label, "NEXT")
            views.setTextViewText(R.id.tv_next_event, title)
            views.setTextViewText(R.id.tv_next_event_time, timeRange)
            views.setViewVisibility(R.id.row_next_event, View.VISIBLE)

            // Color bar for event
            try {
                views.setInt(R.id.event_color_bar, "setBackgroundColor", Color.parseColor(colorHex))
            } catch (_: Exception) {
                views.setInt(R.id.event_color_bar, "setBackgroundColor", Color.parseColor("#3b82f6"))
            }
        } else {
            views.setTextViewText(R.id.tv_next_event_label, "")
            views.setTextViewText(R.id.tv_next_event, "No upcoming events")
            views.setTextViewText(R.id.tv_next_event_time, "")
            views.setInt(R.id.event_color_bar, "setBackgroundColor", Color.parseColor("#e5e7eb"))
        }

        // All-day events
        val allDayCount = snapshot.optInt("allDayCount", 0)
        if (allDayCount > 0) {
            val label = if (allDayCount == 1) "1 all-day event" else "$allDayCount all-day events"
            views.setTextViewText(R.id.tv_all_day, "📅 $label")
            views.setViewVisibility(R.id.tv_all_day, View.VISIBLE)
        } else {
            views.setViewVisibility(R.id.tv_all_day, View.GONE)
        }

        // Last updated footer
        if (updatedAt > 0) {
            val time = SimpleDateFormat("h:mm a", Locale.getDefault()).format(Date(updatedAt))
            views.setTextViewText(R.id.tv_updated, "Updated $time")
        } else {
            views.setTextViewText(R.id.tv_updated, "")
        }
    }

    private fun bindPlaceholder(views: RemoteViews) {
        views.setTextViewText(R.id.tv_date, "Today")
        views.setTextViewText(R.id.tv_steps, "Steps: —")
        views.setTextViewText(R.id.tv_next_event_label, "")
        views.setTextViewText(R.id.tv_next_event, "Tap to open dayGLANCE")
        views.setTextViewText(R.id.tv_next_event_time, "")
        views.setViewVisibility(R.id.tv_all_day, View.GONE)
        views.setTextViewText(R.id.tv_updated, "")
        views.setInt(R.id.event_color_bar, "setBackgroundColor", Color.parseColor("#e5e7eb"))
    }

    /** Format a number with commas: 10432 → "10,432" */
    private fun formatNumber(n: Int): String =
        String.format(Locale.getDefault(), "%,d", n)

    /** Format start–end ISO local datetime strings to "9:00 – 10:00 AM" style */
    private fun formatTimeRange(start: String, end: String): String {
        return try {
            val fmt = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss")
            val s = LocalDateTime.parse(start, fmt)
            val e = LocalDateTime.parse(end, fmt)
            val timeFmt = DateTimeFormatter.ofPattern("h:mm")
            val amPmFmt = DateTimeFormatter.ofPattern("h:mm a")
            "${s.format(timeFmt)} – ${e.format(amPmFmt)}"
        } catch (_: Exception) {
            start.take(5) // fallback: just show HH:mm if parsing fails
        }
    }
}
