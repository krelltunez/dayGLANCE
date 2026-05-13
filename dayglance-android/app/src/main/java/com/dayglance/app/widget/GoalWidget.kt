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
import java.time.format.DateTimeFormatter

/**
 * Goal widget — shows a pinned goal card plus its child projects.
 *
 * The user selects which goal to pin via [GoalWidgetConfigureActivity], which stores
 * the goal's ID in SharedPreferences keyed by widget instance ID. On each update the
 * widget reads "allGoals" from the latest snapshot and finds the matching goal.
 *
 * Layout: goal title, colored left bar, threshold-coloured progress bar, task stats,
 * then up to 4 child project rows with mini progress bars, plus an overflow label.
 */
class GoalWidget : AppWidgetProvider() {

    override fun onUpdate(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray,
    ) {
        for (id in appWidgetIds) {
            try { updateWidget(context, appWidgetManager, id) } catch (_: Throwable) { }
        }
    }

    override fun onDeleted(context: Context, appWidgetIds: IntArray) {
        val prefs = context.getSharedPreferences(WIDGET_PREFS, Context.MODE_PRIVATE)
        prefs.edit().apply {
            appWidgetIds.forEach { remove(prefKey(it)) }
            apply()
        }
    }

    override fun onEnabled(context: Context) {
        super.onEnabled(context)
        try { WidgetUpdateWorker.schedule(context) } catch (_: Throwable) { }
    }

    // ── Widget rendering ──────────────────────────────────────────────────────

    private fun updateWidget(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetId: Int,
    ) {
        val views = RemoteViews(context.packageName, R.layout.widget_goal)
        val dataStore = SharedDataStore(context)
        val snapshot = dataStore.widgetSnapshot?.let { runCatching { JSONObject(it) }.getOrNull() }

        // Header date
        val dateLabel = snapshot?.optString("dateLabel") ?: formatTodayLabel()
        views.setTextViewText(R.id.tv_goal_widget_date, dateLabel)

        // Tap root to open app
        val launchPi = PendingIntent.getActivity(
            context, appWidgetId + LAUNCH_OFFSET,
            Intent(context, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        views.setOnClickPendingIntent(R.id.goal_widget_root, launchPi)

        // Refresh button
        val refreshPi = PendingIntent.getBroadcast(
            context, appWidgetId + REFRESH_OFFSET,
            Intent(ACTION_REFRESH).apply { component = ComponentName(context, GoalWidget::class.java) },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        views.setOnClickPendingIntent(R.id.btn_goal_widget_refresh, refreshPi)

        // Load the selected goal ID for this widget instance
        val prefs = context.getSharedPreferences(WIDGET_PREFS, Context.MODE_PRIVATE)
        val selectedGoalId = prefs.getString(prefKey(appWidgetId), null)

        if (selectedGoalId == null) {
            showEmpty(views, "Long-press widget to reconfigure")
        } else {
            val goal = findGoal(snapshot, selectedGoalId)
            if (goal == null) {
                showEmpty(views, "It may have been deleted or completed")
            } else {
                bindGoalViews(views, goal, context)
            }
        }

        appWidgetManager.updateAppWidget(appWidgetId, views)
    }

    private fun showEmpty(views: RemoteViews, subtitle: String) {
        views.setViewVisibility(R.id.layout_goal_content, View.GONE)
        views.setViewVisibility(R.id.layout_goal_empty, View.VISIBLE)
        views.setTextViewText(R.id.tv_goal_empty_sub, subtitle)
    }

    private fun findGoal(snapshot: JSONObject?, goalId: String): JSONObject? {
        val allGoals = snapshot?.optJSONArray("allGoals") ?: return null
        for (i in 0 until allGoals.length()) {
            val g = allGoals.optJSONObject(i) ?: continue
            if (g.optString("id") == goalId) return g
        }
        return null
    }

    private fun bindGoalViews(views: RemoteViews, goal: JSONObject, context: Context) {
        views.setViewVisibility(R.id.layout_goal_content, View.VISIBLE)
        views.setViewVisibility(R.id.layout_goal_empty, View.GONE)

        // Color bar
        val colorHex = goal.optString("colorHex", "#3b82f6")
        try { views.setInt(R.id.goal_widget_color_bar, "setBackgroundColor", Color.parseColor(colorHex)) }
        catch (_: Throwable) { }

        // Title
        views.setTextViewText(R.id.tv_goal_widget_title, goal.optString("title", "Untitled"))

        // Due date badge
        val daysUntilDue = if (goal.isNull("daysUntilDue")) null else goal.optInt("daysUntilDue")
        val targetDate = goal.optString("targetDate", "")
        if (daysUntilDue != null && targetDate.isNotEmpty()) {
            val dueLabel = when {
                daysUntilDue < 0  -> "${-daysUntilDue}d overdue"
                daysUntilDue == 0 -> "Due today"
                daysUntilDue == 1 -> "1d left"
                else              -> "${daysUntilDue}d left"
            }
            views.setTextViewText(R.id.tv_goal_widget_due, dueLabel)
            views.setViewVisibility(R.id.tv_goal_widget_due, View.VISIBLE)
        } else {
            views.setViewVisibility(R.id.tv_goal_widget_due, View.GONE)
        }

        // Progress bar (threshold-coloured) + stats
        val pct = goal.optInt("progressPct", 0)
        val total = goal.optInt("totalTasks", 0)
        val done = goal.optInt("completedTasks", 0)
        bindThresholdProgress(
            views, pct,
            R.id.pb_goal_widget_red, R.id.pb_goal_widget_amber, R.id.pb_goal_widget_green,
        )
        views.setTextViewText(
            R.id.tv_goal_widget_stats,
            if (total > 0) "$pct%  ·  $done/$total" else "$pct%",
        )

        // Project rows — active and completed are rendered in separate sections.
        val projects = goal.optJSONArray("projects")
        val allProjects = (0 until (projects?.length() ?: 0)).mapNotNull { projects?.optJSONObject(it) }
        val activeProjects   = allProjects.filter { it.optString("status") != "completed" }
        val completedProjects = allProjects.filter { it.optString("status") == "completed" }

        // Show the top-of-section divider whenever any projects exist.
        views.setViewVisibility(
            R.id.tv_goal_projects_divider,
            if (allProjects.isNotEmpty()) View.VISIBLE else View.GONE,
        )

        // Rows 1–3: active slots. Rows 4–6: completed slots.
        // Exception: if ALL projects are completed, fill rows 1–6 (no separator needed).
        val activeRows = listOf(
            ProjectRow(R.id.row_wp1, R.id.bar_wp1, R.id.tv_wp1_title, R.id.tv_wp1_stats, R.id.pb_wp1),
            ProjectRow(R.id.row_wp2, R.id.bar_wp2, R.id.tv_wp2_title, R.id.tv_wp2_stats, R.id.pb_wp2),
            ProjectRow(R.id.row_wp3, R.id.bar_wp3, R.id.tv_wp3_title, R.id.tv_wp3_stats, R.id.pb_wp3),
        )
        val completedRows = listOf(
            ProjectRow(R.id.row_wp4, R.id.bar_wp4, R.id.tv_wp4_title, R.id.tv_wp4_stats, R.id.pb_wp4),
            ProjectRow(R.id.row_wp5, R.id.bar_wp5, R.id.tv_wp5_title, R.id.tv_wp5_stats, R.id.pb_wp5),
            ProjectRow(R.id.row_wp6, R.id.bar_wp6, R.id.tv_wp6_title, R.id.tv_wp6_stats, R.id.pb_wp6),
        )

        // Determine slot assignments.
        val slot1to3: List<Pair<JSONObject, Boolean>>   // (project, isCompleted)
        val slot4to6: List<Pair<JSONObject, Boolean>>
        val showSeparator: Boolean
        val totalOverflow: Int

        when {
            activeProjects.isEmpty() -> {
                // All projects are completed — use all 6 slots, no separator.
                slot1to3 = completedProjects.take(3).map { it to true }
                slot4to6 = completedProjects.drop(3).take(3).map { it to true }
                showSeparator = false
                totalOverflow = maxOf(0, completedProjects.size - 6)
            }
            completedProjects.isEmpty() -> {
                // All projects are active — use slots 1–3 only.
                slot1to3 = activeProjects.take(3).map { it to false }
                slot4to6 = emptyList()
                showSeparator = false
                totalOverflow = maxOf(0, activeProjects.size - 3)
            }
            else -> {
                // Mixed: active in slots 1–3, completed in slots 4–6, separator between.
                slot1to3 = activeProjects.take(3).map { it to false }
                slot4to6 = completedProjects.take(3).map { it to true }
                showSeparator = true
                totalOverflow = maxOf(0, activeProjects.size - 3) + maxOf(0, completedProjects.size - 3)
            }
        }

        views.setViewVisibility(R.id.tv_goal_completed_sep, if (showSeparator) View.VISIBLE else View.GONE)

        for ((idx, row) in activeRows.withIndex()) {
            val slot = slot1to3.getOrNull(idx)
            if (slot != null) {
                views.setViewVisibility(row.rowId, View.VISIBLE)
                bindProjectRow(views, row, slot.first, colorHex, slot.second, context)
            } else {
                views.setViewVisibility(row.rowId, View.GONE)
            }
        }
        for ((idx, row) in completedRows.withIndex()) {
            val slot = slot4to6.getOrNull(idx)
            if (slot != null) {
                views.setViewVisibility(row.rowId, View.VISIBLE)
                bindProjectRow(views, row, slot.first, colorHex, slot.second, context)
            } else {
                views.setViewVisibility(row.rowId, View.GONE)
            }
        }

        // Overflow
        if (totalOverflow > 0) {
            views.setTextViewText(R.id.tv_goal_widget_more, "+$totalOverflow more project${if (totalOverflow != 1) "s" else ""}")
            views.setViewVisibility(R.id.tv_goal_widget_more, View.VISIBLE)
        } else {
            views.setViewVisibility(R.id.tv_goal_widget_more, View.GONE)
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private data class ProjectRow(
        val rowId: Int, val barId: Int, val titleId: Int,
        val statsId: Int, val progressId: Int,
    )

    private fun bindProjectRow(
        views: RemoteViews,
        row: ProjectRow,
        p: JSONObject,
        goalColorHex: String,
        isCompleted: Boolean,
        context: Context,
    ) {
        val barColor = if (isCompleted) 0xFF22C55E.toInt() else
            try { Color.parseColor(goalColorHex) } catch (_: Throwable) { 0xFF3B82F6.toInt() }
        try { views.setInt(row.barId, "setBackgroundColor", barColor) } catch (_: Throwable) { }

        views.setTextViewText(row.titleId, p.optString("title", ""))

        if (isCompleted) {
            // Hide progress bar; show a green "✓ Done" badge.
            views.setViewVisibility(row.progressId, View.GONE)
            views.setTextViewText(row.statsId, "✓ Done")
            views.setTextColor(row.statsId, 0xFF22C55E.toInt())
        } else {
            // Active project — blue progress bar, secondary-coloured task count.
            views.setViewVisibility(row.progressId, View.VISIBLE)
            val pTotal = p.optInt("totalTasks", 0)
            val pDone  = p.optInt("completedTasks", 0)
            views.setTextViewText(row.statsId, if (pTotal > 0) "$pDone/$pTotal" else "")
            views.setTextColor(row.statsId, context.getColor(R.color.widget_text_secondary))
            views.setInt(row.progressId, "setProgress", p.optInt("progressPct", 0))
        }
    }

    /**
     * Shows exactly one of the three threshold ProgressBars based on [pct].
     * red < 40%, amber 40–79%, green ≥ 80%.
     */
    private fun bindThresholdProgress(
        views: RemoteViews, pct: Int, redId: Int, amberId: Int, greenId: Int,
    ) {
        val (visRed, visAmber, visGreen) = when {
            pct >= 80 -> Triple(View.GONE,    View.GONE,    View.VISIBLE)
            pct >= 40 -> Triple(View.GONE,    View.VISIBLE, View.GONE)
            else      -> Triple(View.VISIBLE, View.GONE,    View.GONE)
        }
        views.setViewVisibility(redId,   visRed)
        views.setViewVisibility(amberId, visAmber)
        views.setViewVisibility(greenId, visGreen)
        // Set progress on the visible one
        val activeId = when { pct >= 80 -> greenId; pct >= 40 -> amberId; else -> redId }
        views.setInt(activeId, "setProgress", pct)
    }

    private fun formatTodayLabel(): String = try {
        LocalDate.now().format(DateTimeFormatter.ofPattern("EEE, MMM d"))
    } catch (_: Throwable) { "Today" }

    // ── Broadcast + refresh ───────────────────────────────────────────────────

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == ACTION_REFRESH) {
            try { WidgetUpdateWorker.scheduleImmediate(context) } catch (_: Throwable) { }
            requestUpdate(context)
        } else {
            super.onReceive(context, intent)
        }
    }

    companion object {
        const val ACTION_REFRESH = "com.dayglance.app.widget.GOAL_REFRESH"
        internal const val WIDGET_PREFS = "dayglance_goal_widget"
        private const val LAUNCH_OFFSET  = 3000
        private const val REFRESH_OFFSET = 3100

        fun prefKey(appWidgetId: Int) = "goal_id_$appWidgetId"

        fun requestUpdate(context: Context) {
            try {
                val manager = AppWidgetManager.getInstance(context)
                val ids = manager.getAppWidgetIds(ComponentName(context, GoalWidget::class.java))
                if (ids.isEmpty()) return
                context.sendBroadcast(Intent(AppWidgetManager.ACTION_APPWIDGET_UPDATE).apply {
                    component = ComponentName(context, GoalWidget::class.java)
                    putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids)
                })
            } catch (_: Throwable) { }
        }
    }
}
