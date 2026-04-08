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
 * Project widget — shows a pinned project with its task list.
 *
 * The user selects which project to pin via [ProjectWidgetConfigureActivity], which stores
 * the project's ID in SharedPreferences keyed by widget instance ID. On each update the
 * widget reads "allProjects" from the latest snapshot and finds the matching project.
 *
 * Layout: optional goal chip, project title, threshold-coloured progress bar, task stats,
 * then up to 6 task rows (incomplete first, completed greyed with ✓), plus overflow label.
 */
class ProjectWidget : AppWidgetProvider() {

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
        val views = RemoteViews(context.packageName, R.layout.widget_project)
        val dataStore = SharedDataStore(context)
        val snapshot = dataStore.widgetSnapshot?.let { runCatching { JSONObject(it) }.getOrNull() }

        // Tap root to open app
        val launchPi = PendingIntent.getActivity(
            context, appWidgetId + LAUNCH_OFFSET,
            Intent(context, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        views.setOnClickPendingIntent(R.id.project_widget_root, launchPi)

        // Refresh button
        val refreshPi = PendingIntent.getBroadcast(
            context, appWidgetId + REFRESH_OFFSET,
            Intent(ACTION_REFRESH).apply { component = ComponentName(context, ProjectWidget::class.java) },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        views.setOnClickPendingIntent(R.id.btn_project_widget_refresh, refreshPi)

        // Load the selected project ID
        val prefs = context.getSharedPreferences(WIDGET_PREFS, Context.MODE_PRIVATE)
        val selectedProjectId = prefs.getString(prefKey(appWidgetId), null)

        if (selectedProjectId == null) {
            showEmpty(views, "Long-press widget to reconfigure")
        } else {
            val project = findProject(snapshot, selectedProjectId)
            if (project == null) {
                showEmpty(views, "Project may have been deleted or archived")
            } else {
                bindProjectViews(views, project)
            }
        }

        appWidgetManager.updateAppWidget(appWidgetId, views)
    }

    private fun showEmpty(views: RemoteViews, subtitle: String) {
        views.setViewVisibility(R.id.layout_project_content, View.GONE)
        views.setViewVisibility(R.id.layout_project_empty, View.VISIBLE)
        views.setTextViewText(R.id.tv_project_empty_sub, subtitle)
    }

    private fun findProject(snapshot: JSONObject?, projectId: String): JSONObject? {
        val allProjects = snapshot?.optJSONArray("allProjects") ?: return null
        for (i in 0 until allProjects.length()) {
            val p = allProjects.optJSONObject(i) ?: continue
            if (p.optString("id") == projectId) return p
        }
        return null
    }

    private fun bindProjectViews(views: RemoteViews, project: JSONObject) {
        views.setViewVisibility(R.id.layout_project_content, View.VISIBLE)
        views.setViewVisibility(R.id.layout_project_empty, View.GONE)

        // Goal chip
        val goalTitle = project.optString("goalTitle", "")
        val goalColorHex = project.optString("goalColorHex", "")
        if (goalTitle.isNotEmpty()) {
            views.setTextViewText(R.id.tv_pw_goal_label, goalTitle)
            views.setViewVisibility(R.id.tv_pw_goal_label, View.VISIBLE)
        } else {
            views.setViewVisibility(R.id.tv_pw_goal_label, View.GONE)
        }

        // Color bar (goal color if linked, brand color if standalone)
        val colorHex = goalColorHex.ifEmpty { "#3b82f6" }
        try { views.setInt(R.id.project_widget_color_bar, "setBackgroundColor", Color.parseColor(colorHex)) }
        catch (_: Throwable) { }

        // Title
        views.setTextViewText(R.id.tv_pw_title, project.optString("title", "Untitled"))

        // Progress + stats
        val pct   = project.optInt("progressPct", 0)
        val total = project.optInt("totalTasks", 0)
        val done  = project.optInt("completedTasks", 0)

        // "Done" badge when fully complete
        if (pct >= 100 && total > 0) {
            views.setViewVisibility(R.id.tv_pw_done_badge, View.VISIBLE)
        } else {
            views.setViewVisibility(R.id.tv_pw_done_badge, View.GONE)
        }

        bindThresholdProgress(views, pct, R.id.pb_pw_red, R.id.pb_pw_amber, R.id.pb_pw_green)
        views.setTextViewText(
            R.id.tv_pw_stats,
            if (total > 0) "$done/$total  ·  $pct%" else "$pct%",
        )

        // Task rows
        val tasks = project.optJSONArray("tasks")
        val taskCount = tasks?.length() ?: 0

        val taskRows = listOf(
            Pair(R.id.row_wt1, Pair(R.id.tv_wt1_check, R.id.tv_wt1_title)),
            Pair(R.id.row_wt2, Pair(R.id.tv_wt2_check, R.id.tv_wt2_title)),
            Pair(R.id.row_wt3, Pair(R.id.tv_wt3_check, R.id.tv_wt3_title)),
            Pair(R.id.row_wt4, Pair(R.id.tv_wt4_check, R.id.tv_wt4_title)),
            Pair(R.id.row_wt5, Pair(R.id.tv_wt5_check, R.id.tv_wt5_title)),
            Pair(R.id.row_wt6, Pair(R.id.tv_wt6_check, R.id.tv_wt6_title)),
        )

        views.setViewVisibility(R.id.tv_pw_tasks_divider, if (taskCount > 0) View.VISIBLE else View.GONE)

        for ((idx, row) in taskRows.withIndex()) {
            val (rowId, checkTitle) = row
            val (checkId, titleId) = checkTitle
            val task = tasks?.optJSONObject(idx)
            if (task != null) {
                val completed = task.optBoolean("completed", false)
                views.setViewVisibility(rowId, View.VISIBLE)
                views.setTextViewText(checkId, if (completed) "✓" else "○")
                views.setTextViewText(titleId, task.optString("title", ""))
            } else {
                views.setViewVisibility(rowId, View.GONE)
            }
        }

        // Overflow
        val overflow = total - taskRows.size
        if (overflow > 0) {
            views.setTextViewText(R.id.tv_pw_more_tasks, "+$overflow more task${if (overflow != 1) "s" else ""}")
            views.setViewVisibility(R.id.tv_pw_more_tasks, View.VISIBLE)
        } else {
            views.setViewVisibility(R.id.tv_pw_more_tasks, View.GONE)
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

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
        val activeId = when { pct >= 80 -> greenId; pct >= 40 -> amberId; else -> redId }
        views.setInt(activeId, "setProgress", pct)
    }

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
        const val ACTION_REFRESH = "com.dayglance.app.widget.PROJECT_REFRESH"
        internal const val WIDGET_PREFS = "dayglance_project_widget"
        private const val LAUNCH_OFFSET  = 4000
        private const val REFRESH_OFFSET = 4100

        fun prefKey(appWidgetId: Int) = "project_id_$appWidgetId"

        fun requestUpdate(context: Context) {
            try {
                val manager = AppWidgetManager.getInstance(context)
                val ids = manager.getAppWidgetIds(ComponentName(context, ProjectWidget::class.java))
                if (ids.isEmpty()) return
                context.sendBroadcast(Intent(AppWidgetManager.ACTION_APPWIDGET_UPDATE).apply {
                    component = ComponentName(context, ProjectWidget::class.java)
                    putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids)
                })
            } catch (_: Throwable) { }
        }
    }
}
