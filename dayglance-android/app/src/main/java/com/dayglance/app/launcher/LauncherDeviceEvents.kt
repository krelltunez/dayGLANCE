package com.dayglance.app.launcher

import com.dayglance.app.data.CalendarRepository.CalEvent
import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.format.DateTimeParseException
import java.time.temporal.ChronoUnit
import java.util.Locale

/**
 * The device calendar read by the provider itself, on every launcher query,
 * so an event added in another app reaches the launcher while dayGLANCE is
 * closed. The snapshot (utils/launcherSnapshot.js) says which calendars are
 * shown, the user's edits to device events and the window
 * (`deviceCalendar`); this turns the calendar's events into exactly the task
 * rows the snapshot builds from the same events (nativeEventToTask,
 * nativeResultsToTasks and taskRow in the web layer), and puts them in place
 * of the snapshot's own `native` rows.
 *
 * One event must be one row whichever side read it:
 * dayglance-ios/TestFixtures/launcherDeviceEvents.vectors.json is generated
 * from the web layer and [LauncherDeviceEventsTest] holds this to it. Pure
 * apart from the [read] it is handed.
 */
object LauncherDeviceEvents {

    /** The snapshot's `deviceCalendar`: calendars shown (empty: all), edits by event id, the window. */
    data class Config(
        val filter: List<String>,
        val overrides: Map<String, JSONObject>,
        val daysBefore: Int,
        val daysAfter: Int,
    )

    /** utils/energyAxis.js RESTORE_KEYWORDS; the fixture's `restoreKeywords` holds the two equal. */
    val RESTORE_KEYWORDS: Set<String> = setOf(
        "health", "gym", "workout", "exercise", "run", "running", "walk", "yoga",
        "meditate", "meditation", "breakfast", "lunch", "dinner", "meal", "eat",
        "break", "rest", "nap", "sleep", "recharge", "recovery",
        "relax", "relaxation", "unwind", "chill",
    )

    private val NON_LETTERS = Regex("[^\\p{L}]+")

    fun config(root: JSONObject): Config? {
        val block = root.optJSONObject("deviceCalendar") ?: return null
        val filter = block.optJSONArray("filter")?.let { arr -> (0 until arr.length()).map { arr.optString(it) } } ?: emptyList()
        val overrides = HashMap<String, JSONObject>()
        block.optJSONObject("overrides")?.let { o -> for (k in o.keys()) o.optJSONObject(k)?.let { overrides[k] = it } }
        return Config(filter, overrides, block.optInt("daysBefore", 1), block.optInt("daysAfter", 6))
    }

    /** The window's dates, oldest first. */
    fun windowDates(today: LocalDate, config: Config): List<LocalDate> =
        (-config.daysBefore..config.daysAfter).map { today.plusDays(it.toLong()) }

    /**
     * [snapshotJson] with its `native` task rows replaced by a fresh read of the
     * window around [today], or unchanged when it carries no `deviceCalendar` or
     * cannot be parsed. [read] is CalendarRepository.getEvents.
     */
    fun withLiveEvents(snapshotJson: String, today: LocalDate, read: (LocalDate) -> List<CalEvent>): String {
        return try {
            val root = JSONObject(snapshotJson)
            val config = config(root) ?: return snapshotJson
            val dates = windowDates(today, config)
            val live = rows(dates.map { it to read(it) }, config)
            val tasks = root.optJSONArray("tasks") ?: JSONArray()
            val next = JSONArray()
            for (i in 0 until tasks.length()) {
                val t = tasks.optJSONObject(i) ?: continue
                if (!t.optBoolean("native", false)) next.put(t)
            }
            for (row in live) next.put(row)
            root.put("tasks", next).toString()
        } catch (e: Exception) {
            snapshotJson
        }
    }

    /**
     * The task rows for one read: [results] is each window date with its events,
     * in order. Events are filtered, converted, deduplicated by occurrence id and
     * edited as nativeResultsToTasks does, then listed by date over the window
     * (an event dated outside it, such as one that began the evening before,
     * belongs to a day the launcher is not shown).
     */
    fun rows(results: List<Pair<LocalDate, List<CalEvent>>>, config: Config): List<JSONObject> {
        val shown = config.filter.takeIf { it.isNotEmpty() }?.toSet()
        val seen = HashSet<String>()
        val tasks = ArrayList<JSONObject>()
        for ((date, events) in results) {
            for (e in events) {
                if (shown != null && e.calendarId !in shown) continue
                val row = row(e, date.toString())
                if (!seen.add(row.getString("id"))) continue
                tasks.add(applyOverride(row, config.overrides[e.id], e.color))
            }
        }
        val out = ArrayList<JSONObject>()
        for ((date, _) in results) {
            val d = date.toString()
            for (t in tasks) if (t.optString("date") == d) out.add(t)
        }
        return out
    }

    /** nativeEventToTask then taskRow, for an event fetched for [queryDate]. */
    private fun row(e: CalEvent, queryDate: String): JSONObject {
        // CalendarRepository sends an all-day event's days as plain dates, already
        // inclusive; the web layer's UTC re-reading applies only to other sources.
        val startDate = e.start.take(10)
        val endDate = if (e.end.isNotEmpty()) e.end.take(10) else startDate
        val multiDay = e.allDay && endDate > startDate
        val date = if (multiDay) maxOf(startDate, minOf(endDate, queryDate)) else startDate
        val startTime = if (e.allDay) null else e.start.substring(11, 16)
        val duration = if (e.allDay) 60 else eventDuration(e.start, e.end)
        return JSONObject()
            .put("id", "native-cal-${e.id}-$date")
            .put("title", e.title)
            .put("date", date)
            .put("startTime", startTime ?: JSONObject.NULL)
            .put("duration", duration)
            .put("isAllDay", e.allDay)
            .put("completed", false)
            .put("completedAt", JSONObject.NULL)
            .put("colorHex", e.color.ifEmpty { DEFAULT_COLOR })
            .put("priority", 0)
            .put("notes", e.notes)
            .put("projectId", JSONObject.NULL)
            .put("deadline", JSONObject.NULL)
            // A VTODO from the calendar provider is a task, not an event.
            .put("source", if (e.id.startsWith("task-")) "dayglance" else "calendar")
            .put("energy", energy(e.title))
            .put("clientId", JSONObject.NULL)
            .put("recurringId", JSONObject.NULL)
            .put("native", true)
    }

    /** The user's edits, as nativeResultsToTasks applies them; the event's own colour still wins. */
    private fun applyOverride(row: JSONObject, o: JSONObject?, eventColor: String): JSONObject {
        if (o == null) return row
        if (o.has("date")) row.put("date", o.opt("date").takeIf { it is String && it.isNotEmpty() } ?: JSONObject.NULL)
        if (o.has("startTime")) {
            row.put("isAllDay", false)
            row.put("startTime", o.opt("startTime").takeIf { it is String && it.isNotEmpty() } ?: JSONObject.NULL)
        }
        if (o.has("duration")) row.put("duration", (o.opt("duration") as? Number)?.takeIf { it.toDouble().isFinite() } ?: 0)
        if (o.has("title")) {
            val title = o.opt("title") as? String ?: ""
            row.put("title", title)
            row.put("energy", energy(title))
        }
        if (o.has("notes")) row.put("notes", o.opt("notes") as? String ?: "")
        if (eventColor.isEmpty() && o.has("colorHex")) row.put("colorHex", o.optString("colorHex", DEFAULT_COLOR))
        return row
    }

    /** deriveBlockEnergy for a row with no explicit energy: a restore keyword among the title's words. */
    fun energy(title: String): String =
        if (title.lowercase(Locale.ROOT).split(NON_LETTERS).any { it in RESTORE_KEYWORDS }) "restore" else "effort"

    /**
     * A timed event's duration, nativeEventDuration in utils/nativeCalendar.js
     * (#2278): from its full start to its full end, so one that runs past
     * midnight is as long as it really is, at least 15 minutes and at most a
     * whole day; 60 when there is no readable end. The strings are local wall
     * times and LocalDateTime has no zone, so across a DST change the span is
     * the wall-clock one, as the timeline draws it.
     */
    fun eventDuration(start: String, end: String): Int {
        val from = civil(start) ?: return 60
        val to = civil(end) ?: return 60
        return ChronoUnit.MINUTES.between(from, to).coerceIn(15L, MAX_DURATION_MINUTES.toLong()).toInt()
    }

    /** "YYYY-MM-DDTHH:MM" (seconds ignored), or null. */
    private fun civil(str: String): LocalDateTime? =
        if (str.length < 16) null
        else try { LocalDateTime.parse(str.substring(0, 16)) } catch (_: DateTimeParseException) { null }

    /** utils/taskDuration.js MAX_DURATION_MINUTES: no block is longer than a whole day. */
    const val MAX_DURATION_MINUTES = 24 * 60

    private const val DEFAULT_COLOR = "#3b82f6"
}
