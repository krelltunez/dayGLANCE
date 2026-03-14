package com.dayglance.app.widget

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import androidx.work.WorkManager
import com.dayglance.app.MainActivity
import com.dayglance.app.R
import com.dayglance.app.data.SharedDataStore
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Date
import java.util.Locale

/**
 * Home screen widget AppWidgetProvider.
 *
 * The widget shows the full DayGlance agenda in a scrollable [android.widget.ListView]
 * backed by [DayGlanceWidgetListService] / [DayGlanceWidgetListFactory].
 *
 * Data sources:
 *  - Rich task/habit/routine/frame data — pushed by the JS app via
 *    [com.dayglance.app.bridge.NativeBridge.updateWidgetSnapshot] whenever state
 *    changes (task edit, habit log, etc.).
 *  - Steps + calendar events — refreshed in the background every 15 minutes by
 *    [WidgetUpdateWorker] even when the app is closed.
 *
 * Tapping anywhere on the widget opens the DayGlance app.
 * Supports system light/dark mode automatically via @color/widget_* resources
 * with night-mode variants.
 */
class DayGlanceWidget : AppWidgetProvider() {

    override fun onUpdate(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray,
    ) {
        for (id in appWidgetIds) {
            try {
                updateWidget(context, appWidgetManager, id)
            } catch (_: Throwable) {
                try {
                    appWidgetManager.updateAppWidget(
                        id,
                        RemoteViews(context.packageName, R.layout.widget_layout)
                    )
                } catch (_: Throwable) { /* nothing more we can do */ }
            }
        }
    }

    override fun onEnabled(context: Context) {
        super.onEnabled(context)
        try { WidgetUpdateWorker.schedule(context) } catch (_: Throwable) { }
        try { WidgetUpdateWorker.scheduleImmediate(context) } catch (_: Throwable) { }
    }

    override fun onDisabled(context: Context) {
        super.onDisabled(context)
        try {
            WorkManager.getInstance(context).cancelUniqueWork(WidgetUpdateWorker.WORK_NAME)
        } catch (_: Throwable) { }
    }

    // ── Widget rendering ──────────────────────────────────────────────────────

    private fun updateWidget(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetId: Int,
    ) {
        val views = RemoteViews(context.packageName, R.layout.widget_layout)

        // ── Header: date label + last-updated ─────────────────────────────
        try {
            val dataStore = SharedDataStore(context)
            val snapshot = dataStore.widgetSnapshot?.let { runCatching { JSONObject(it) }.getOrNull() }
            val dateLabel = snapshot?.optString("dateLabel") ?: formatTodayLabel()
            views.setTextViewText(R.id.tv_date, dateLabel)

            val updatedAt = dataStore.widgetSnapshotUpdatedAt
            if (updatedAt > 0) {
                val time = SimpleDateFormat("h:mm a", Locale.getDefault()).format(Date(updatedAt))
                views.setTextViewText(R.id.tv_updated, time)
            } else {
                views.setTextViewText(R.id.tv_updated, "")
            }
        } catch (_: Throwable) {
            views.setTextViewText(R.id.tv_date, formatTodayLabel())
            views.setTextViewText(R.id.tv_updated, "")
        }

        // ── Scrollable agenda list ─────────────────────────────────────────
        try {
            val serviceIntent = Intent(context, DayGlanceWidgetListService::class.java)
            views.setRemoteAdapter(R.id.lv_agenda, serviceIntent)
            views.setEmptyView(R.id.lv_agenda, android.R.id.empty)

            // Pending intent template — list items fire fill-in intents against this
            val listItemLaunchIntent = Intent(context, MainActivity::class.java)
            val listItemPi = android.app.PendingIntent.getActivity(
                context, 1, listItemLaunchIntent,
                android.app.PendingIntent.FLAG_UPDATE_CURRENT or android.app.PendingIntent.FLAG_IMMUTABLE,
            )
            views.setPendingIntentTemplate(R.id.lv_agenda, listItemPi)
        } catch (_: Throwable) { /* ListView stays empty — header still renders */ }

        // ── Tap-to-open ───────────────────────────────────────────────────
        try {
            val launchIntent = Intent(context, MainActivity::class.java)
            val pi = android.app.PendingIntent.getActivity(
                context, 0, launchIntent,
                android.app.PendingIntent.FLAG_UPDATE_CURRENT or android.app.PendingIntent.FLAG_IMMUTABLE,
            )
            views.setOnClickPendingIntent(R.id.widget_root, pi)
        } catch (_: Throwable) { }

        // ── Refresh button ────────────────────────────────────────────────
        try {
            val refreshIntent = Intent(ACTION_REFRESH).apply {
                component = ComponentName(context, DayGlanceWidget::class.java)
            }
            val refreshPi = android.app.PendingIntent.getBroadcast(
                context, 0, refreshIntent,
                android.app.PendingIntent.FLAG_UPDATE_CURRENT or android.app.PendingIntent.FLAG_IMMUTABLE,
            )
            views.setOnClickPendingIntent(R.id.btn_refresh, refreshPi)
        } catch (_: Throwable) { }

        appWidgetManager.updateAppWidget(appWidgetId, views)

        // Notify the list service that data may have changed so it calls onDataSetChanged
        try {
            appWidgetManager.notifyAppWidgetViewDataChanged(appWidgetId, R.id.lv_agenda)
        } catch (_: Throwable) { }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

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
        const val ACTION_REFRESH = "com.dayglance.app.widget.ACTION_REFRESH"
        /**
         * Sends a broadcast that causes all DayGlance widget instances to re-bind
         * their data from SharedDataStore. Call this after writing a new snapshot.
         */
        fun requestUpdate(context: Context) {
            try {
                val manager = AppWidgetManager.getInstance(context)
                val ids = manager.getAppWidgetIds(
                    ComponentName(context, DayGlanceWidget::class.java)
                )
                if (ids.isEmpty()) return
                val intent = Intent(AppWidgetManager.ACTION_APPWIDGET_UPDATE).apply {
                    component = ComponentName(context, DayGlanceWidget::class.java)
                    putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids)
                }
                context.sendBroadcast(intent)
            } catch (_: Throwable) { }
        }
    }
}
