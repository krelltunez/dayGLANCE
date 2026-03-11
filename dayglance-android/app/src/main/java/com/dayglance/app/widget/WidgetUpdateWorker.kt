package com.dayglance.app.widget

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.dayglance.app.data.CalendarRepository
import com.dayglance.app.data.HealthRepository
import com.dayglance.app.data.SharedDataStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.concurrent.TimeUnit

/**
 * Phase 6: WorkManager periodic worker that refreshes the home screen widget.
 *
 * Runs every 15 minutes, queries fresh data from Health Connect and the
 * Calendar Provider, writes a snapshot to SharedDataStore, then triggers a
 * widget update via broadcast.
 */
class WidgetUpdateWorker(
    private val context: Context,
    workerParams: WorkerParameters
) : CoroutineWorker(context, workerParams) {

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val today = LocalDate.now()
        val dataStore = SharedDataStore(context)

        // 1. Fetch steps from HealthRepository
        val healthRepo = HealthRepository(context)
        val steps = try { healthRepo.getSteps(today) } catch (_: Exception) { -1 }

        // 2. Fetch today's events from CalendarRepository
        val calRepo = CalendarRepository(context)
        val events = try { calRepo.getEvents(today) } catch (_: Exception) { emptyList() }

        // 3. Build and write snapshot JSON to SharedDataStore
        val snapshot = buildSnapshot(today, steps, events)
        dataStore.widgetSnapshot = snapshot.toString()
        dataStore.widgetSnapshotUpdatedAt = System.currentTimeMillis()

        // 4. Trigger widget update
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

        Result.success()
    }

    private fun buildSnapshot(
        date: LocalDate,
        steps: Int,
        events: List<CalendarRepository.CalEvent>
    ): JSONObject {
        val now = LocalDateTime.now()
        val dateLabel = date.format(DateTimeFormatter.ofPattern("EEE, MMM d"))

        // Find the current or next timed event
        val nextEvent = events
            .filter { !it.allDay }
            .firstOrNull { ev ->
                try {
                    val end = LocalDateTime.parse(ev.end)
                    end.isAfter(now)
                } catch (_: Exception) { false }
            }

        val eventsArray = JSONArray()
        events.take(5).forEach { ev ->
            eventsArray.put(JSONObject().apply {
                put("id", ev.id)
                put("title", ev.title)
                put("start", ev.start)
                put("end", ev.end)
                put("allDay", ev.allDay)
                put("color", ev.color)
            })
        }

        return JSONObject().apply {
            put("date", date.toString())
            put("dateLabel", dateLabel)
            put("steps", steps)
            put("nextEvent", nextEvent?.let { ev ->
                JSONObject().apply {
                    put("title", ev.title)
                    put("start", ev.start)
                    put("end", ev.end)
                    put("color", ev.color)
                }
            } ?: JSONObject.NULL)
            put("allDayCount", events.count { it.allDay })
            put("events", eventsArray)
            put("updatedAt", System.currentTimeMillis())
        }
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
