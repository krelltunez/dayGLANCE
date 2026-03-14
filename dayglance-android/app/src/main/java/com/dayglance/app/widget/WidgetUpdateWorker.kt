package com.dayglance.app.widget

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
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
import java.time.format.DateTimeFormatter
import java.util.concurrent.TimeUnit

/**
 * WorkManager periodic worker that refreshes native-sourced fields in the widget snapshot.
 *
 * Runs every 15 minutes. When the DayGlance app is open, it pushes a rich snapshot
 * (tasks, habits, routines, frames, steps) via [com.dayglance.app.bridge.NativeBridge.updateWidgetSnapshot].
 * When the app is closed, this worker keeps the widget fresh by:
 *   1. Fetching the latest step count from Health Connect
 *   2. Fetching today's calendar events from the Android Calendar Provider
 *   3. Patching those fields into the existing JS-written snapshot (preserving task data)
 *   4. Broadcasting a widget update so the widget re-renders
 *
 * If no JS snapshot exists yet (first launch, freshly installed) the worker writes a
 * minimal calendar-only snapshot so the widget shows something useful immediately.
 */
class WidgetUpdateWorker(
    private val context: Context,
    workerParams: WorkerParameters,
) : CoroutineWorker(context, workerParams) {

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val today = LocalDate.now()
        val dataStore = SharedDataStore(context)

        // 1. Fetch fresh native data
        val steps = try { HealthRepository(context).getSteps(today) } catch (_: Throwable) { -1 }
        val calEvents = try { CalendarRepository(context).getEvents(today) } catch (_: Throwable) { emptyList() }

        // 2. Patch the existing snapshot (or build a new minimal one)
        val existing = dataStore.widgetSnapshot?.let { runCatching { JSONObject(it) }.getOrNull() }
        val patched = patchSnapshot(today, steps, calEvents, existing)
        dataStore.widgetSnapshot = patched.toString()
        dataStore.widgetSnapshotUpdatedAt = System.currentTimeMillis()

        // 3. Trigger widget update
        try {
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(ComponentName(context, DayGlanceWidget::class.java))
            if (ids.isNotEmpty()) {
                val intent = android.content.Intent(AppWidgetManager.ACTION_APPWIDGET_UPDATE).apply {
                    component = ComponentName(context, DayGlanceWidget::class.java)
                    putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids)
                }
                context.sendBroadcast(intent)
            }
        } catch (_: Throwable) { }

        Result.success()
    }

    /**
     * Patches native-sourced fields into [existing] (if present) or builds a new snapshot.
     *
     * Fields owned by native (always overwritten):
     *   steps, nativeCalEvents, dateLabel, date
     *
     * Fields owned by JS (preserved if present):
     *   overdue, habits, allDay, deadlines, sections, routines
     *
     * Calendar events from the Android Calendar Provider are placed in a separate
     * "nativeCalEvents" key so the widget can supplement (not replace) the JS-sourced
     * all-day / scheduled items. The factory prefers JS-sourced data when both exist.
     */
    private fun patchSnapshot(
        date: LocalDate,
        steps: Int,
        calEvents: List<CalendarRepository.CalEvent>,
        existing: JSONObject?,
    ): JSONObject {
        val snapshot = existing ?: JSONObject()

        snapshot.put("date", date.toString())
        snapshot.put("dateLabel", date.format(DateTimeFormatter.ofPattern("EEE, MMM d")))
        snapshot.put("steps", steps)
        snapshot.put("updatedAt", System.currentTimeMillis())

        // Write native calendar events into a separate key
        val eventsArray = JSONArray()
        calEvents.forEach { ev ->
            eventsArray.put(JSONObject().apply {
                put("id", ev.id)
                put("title", ev.title)
                put("start", ev.start)
                put("end", ev.end)
                put("allDay", ev.allDay)
                put("color", ev.color)
            })
        }
        snapshot.put("nativeCalEvents", eventsArray)

        // If no JS snapshot exists, also populate allDay and sections from calendar so
        // the widget shows something meaningful before the app is first opened.
        if (existing == null) {
            populateFromCalendar(snapshot, calEvents)
        }

        return snapshot
    }

    /**
     * Populates allDay + sections from native calendar events when no JS snapshot is available.
     * Provides a basic but useful first-render experience for freshly installed widgets.
     */
    private fun populateFromCalendar(
        snapshot: JSONObject,
        calEvents: List<CalendarRepository.CalEvent>,
    ) {
        val allDayArr = JSONArray()
        val scheduledSectionTasks = JSONArray()

        for (ev in calEvents) {
            val colorHex = ev.color.takeIf { it.startsWith("#") } ?: "#3b82f6"
            if (ev.allDay) {
                allDayArr.put(JSONObject().apply {
                    put("id", ev.id)
                    put("title", ev.title)
                    put("colorHex", colorHex)
                })
            } else {
                val startHhMm = ev.start.take(16).substring(11).take(5) // "HH:mm" from ISO
                scheduledSectionTasks.put(JSONObject().apply {
                    put("id", ev.id)
                    put("title", ev.title)
                    put("colorHex", colorHex)
                    put("startTime", startHhMm)
                    put("duration", 0)
                    put("tags", JSONArray())
                })
            }
        }

        snapshot.put("allDay", allDayArr)
        if (scheduledSectionTasks.length() > 0) {
            snapshot.put("sections", JSONArray().apply {
                put(JSONObject().apply {
                    put("type", "unframed")
                    put("tasks", scheduledSectionTasks)
                })
            })
        }
        snapshot.put("overdue", JSONArray())
        snapshot.put("deadlines", JSONArray())
        snapshot.put("habits", JSONArray())
        snapshot.put("routines", JSONArray())
    }

    companion object {
        internal const val WORK_NAME = "widget_update"
        private const val IMMEDIATE_WORK_NAME = "widget_update_immediate"

        fun schedule(context: Context) {
            val request = PeriodicWorkRequestBuilder<WidgetUpdateWorker>(
                15, TimeUnit.MINUTES
            ).build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                WORK_NAME,
                ExistingPeriodicWorkPolicy.KEEP,
                request,
            )
        }

        fun scheduleImmediate(context: Context) {
            val request = OneTimeWorkRequestBuilder<WidgetUpdateWorker>().build()
            WorkManager.getInstance(context).enqueueUniqueWork(
                IMMEDIATE_WORK_NAME,
                ExistingWorkPolicy.REPLACE,
                request,
            )
        }
    }
}
