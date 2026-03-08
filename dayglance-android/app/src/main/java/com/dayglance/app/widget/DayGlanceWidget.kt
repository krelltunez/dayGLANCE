package com.dayglance.app.widget

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import com.dayglance.app.MainActivity
import com.dayglance.app.R

/**
 * Phase 6: Home screen widget.
 *
 * Displays today's agenda using RemoteViews (Android widgets cannot use WebView).
 * Tapping the widget opens the full DayGlance app (the WebView).
 *
 * Data is read from SharedDataStore which is populated by WidgetUpdateWorker.
 * Widget refreshes every 15–30 minutes via WorkManager.
 *
 * Visual design should match DayGlance's design language:
 *   - Font: Lora (embed as a downloadable font or use a serif fallback)
 *   - Colors: blue (#3b82f6) / orange (#f97316) on white/dark backgrounds
 *   - Refer to src/index.css and tailwind.config.js in the web frontend
 *
 * TODO Phase 6: implement RemoteViews layout and data binding
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

    private fun updateWidget(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetId: Int
    ) {
        val views = RemoteViews(context.packageName, R.layout.widget_layout)

        // TODO Phase 6: bind agenda data from SharedDataStore to RemoteViews

        // Tapping the widget opens the main app
        val launchIntent = Intent(context, MainActivity::class.java)
        val pendingIntent = android.app.PendingIntent.getActivity(
            context, 0, launchIntent,
            android.app.PendingIntent.FLAG_UPDATE_CURRENT or android.app.PendingIntent.FLAG_IMMUTABLE
        )
        views.setOnClickPendingIntent(R.id.widget_root, pendingIntent)

        appWidgetManager.updateAppWidget(appWidgetId, views)
    }
}
