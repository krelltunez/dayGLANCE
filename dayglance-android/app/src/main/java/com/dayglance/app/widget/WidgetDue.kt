package com.dayglance.app.widget

import android.content.Context
import com.dayglance.app.R
import org.json.JSONObject
import java.time.LocalDate
import java.time.temporal.ChronoUnit

/**
 * Target dates on the widgets: the Goal widget's and the Project widget's due
 * badge, and the day widget's "due today" rows (goals, and projects with their
 * own target date, #2160). Pure, so the JVM tests hold it to the payload the
 * JS side builds (dayglance-ios/TestFixtures/widgetSnapshot.live.json).
 */
object WidgetDueRules {

    /**
     * Days from [today] to [targetDate], computed at RENDER time so the badge
     * is right on the pushed day and on a projected one. [fallback] (the
     * push-time `daysUntilDue`) is used only when the date does not parse.
     */
    fun daysUntil(targetDate: String, fallback: Int?, today: LocalDate): Int? =
        WidgetFreshnessRules.parseDay(targetDate)
            ?.let { ChronoUnit.DAYS.between(today, it).toInt() }
            ?: fallback

    /** Whether a project row of the payload is on hold (the app's `status: "on-hold"`). */
    fun isOnHold(project: JSONObject): Boolean = project.optString("status") == "on-hold"

    /**
     * Whether a project's target date is drawn as a due badge: not on a
     * completed project, whose date is history, nor on one on hold, which the
     * app keeps from asking for attention (it shows "On hold" instead).
     */
    fun showsDueDate(project: JSONObject): Boolean =
        project.optString("status") != "completed" && !isOnHold(project)

    /** The push-time `daysUntilDue`, or null when absent or null. */
    fun pushedDays(item: JSONObject): Int? =
        if (item.isNull("daysUntilDue")) null else item.optInt("daysUntilDue")

    /** One "due today" row of the day widget. [progressPct] null: nothing to measure, no bar. */
    data class DueRow(
        val id: String,
        val title: String,
        val progressPct: Int?,
        val totalTasks: Int,
        val completedTasks: Int,
    )

    /**
     * The rows under [key] of a day's fields: `goals`, or `projectsDue` (the
     * projects with their own target date that day). An absent list is no
     * rows, as from a payload written before projects had target dates. A
     * missing `progressPct` reads 0, as goal rows always did; an explicit null
     * means the project has nothing to measure.
     */
    fun rows(fields: JSONObject, key: String): List<DueRow> {
        val array = fields.optJSONArray(key) ?: return emptyList()
        return (0 until array.length()).mapNotNull { i ->
            val o = array.optJSONObject(i) ?: return@mapNotNull null
            DueRow(
                id = o.optString("id", ""),
                title = o.optString("title", ""),
                progressPct = if (o.has("progressPct") && o.isNull("progressPct")) null
                    else o.optInt("progressPct", 0).coerceIn(0, 100),
                totalTasks = o.optInt("totalTasks", 0),
                completedTasks = o.optInt("completedTasks", 0),
            )
        }
    }
}

/** "3d overdue" / "Due today" / "5d left", the Goal and Project widgets' badge. */
internal fun dueLabel(context: Context, days: Int): String = when {
    days < 0 -> context.getString(R.string.widget_due_overdue, -days)
    days == 0 -> context.getString(R.string.widget_due_today)
    else -> context.getString(R.string.widget_due_left, days)
}
