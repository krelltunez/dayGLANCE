package com.dayglance.app.widget

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

/**
 * Phase 6: WorkManager periodic worker that refreshes the home screen widget.
 *
 * Runs every 15–30 minutes, queries fresh data from Health Connect and the
 * Calendar Provider, writes a snapshot to SharedDataStore, then triggers a
 * widget update.
 *
 * TODO Phase 6: implement data fetching and snapshot writing
 */
class WidgetUpdateWorker(
    private val context: Context,
    workerParams: WorkerParameters
) : CoroutineWorker(context, workerParams) {

    override suspend fun doWork(): Result {
        // TODO Phase 6:
        //   1. Fetch steps from HealthRepository
        //   2. Fetch today's events from CalendarRepository
        //   3. Write snapshot to SharedDataStore
        //   4. Trigger widget update

        val appWidgetManager = AppWidgetManager.getInstance(context)
        val widgetIds = appWidgetManager.getAppWidgetIds(
            ComponentName(context, DayGlanceWidget::class.java)
        )
        if (widgetIds.isNotEmpty()) {
            val intent = android.content.Intent(
                android.appwidget.AppWidgetManager.ACTION_APPWIDGET_UPDATE
            ).apply {
                putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, widgetIds)
                setPackage(context.packageName)
            }
            context.sendBroadcast(intent)
        }

        return Result.success()
    }

    companion object {
        private const val WORK_NAME = "widget_update"

        fun schedule(context: Context) {
            val request = PeriodicWorkRequestBuilder<WidgetUpdateWorker>(
                15, TimeUnit.MINUTES
            ).build()

            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                WORK_NAME,
                ExistingPeriodicWorkPolicy.KEEP,
                request
            )
        }
    }
}
