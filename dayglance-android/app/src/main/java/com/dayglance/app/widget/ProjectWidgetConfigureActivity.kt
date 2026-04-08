package com.dayglance.app.widget

import android.appwidget.AppWidgetManager
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import com.dayglance.app.data.SharedDataStore
import org.json.JSONArray
import org.json.JSONObject

/**
 * Configuration activity for [ProjectWidget].
 *
 * Reads all active projects from the widget snapshot (including goal context) and
 * presents them in a scrollable list grouped by goal. The user taps a project to
 * pin it; the choice is stored in SharedPreferences keyed by widget instance ID.
 *
 * If no snapshot is available the user is prompted to open dayGLANCE first.
 */
class ProjectWidgetConfigureActivity : AppCompatActivity() {

    private var appWidgetId = AppWidgetManager.INVALID_APPWIDGET_ID

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setResult(RESULT_CANCELED)

        appWidgetId = intent.extras?.getInt(
            AppWidgetManager.EXTRA_APPWIDGET_ID,
            AppWidgetManager.INVALID_APPWIDGET_ID,
        ) ?: AppWidgetManager.INVALID_APPWIDGET_ID

        if (appWidgetId == AppWidgetManager.INVALID_APPWIDGET_ID) { finish(); return }

        val snapshot = SharedDataStore(this).widgetSnapshot?.let {
            runCatching { JSONObject(it) }.getOrNull()
        }
        val allProjects: JSONArray? = snapshot?.optJSONArray("allProjects")

        setContentView(buildContentView(allProjects))
    }

    // ── UI building ───────────────────────────────────────────────────────────

    private fun buildContentView(allProjects: JSONArray?): View {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val dp16 = dp(16)
            setPadding(dp16, dp16, dp16, dp16)
        }

        root.addView(TextView(this).apply {
            text = "Select a Project"
            textSize = 18f
            setTextColor(resolveAttrColor(android.R.attr.textColorPrimary))
            setPadding(0, 0, 0, dp(4))
        })
        root.addView(TextView(this).apply {
            text = "Choose which project to display on your widget."
            textSize = 13f
            setTextColor(resolveAttrColor(android.R.attr.textColorSecondary))
            setPadding(0, 0, 0, dp(16))
        })

        if (allProjects == null || allProjects.length() == 0) {
            root.addView(TextView(this).apply {
                text = "No active projects found.\n\nOpen dayGLANCE to sync your data, then try adding the widget again."
                textSize = 14f
                setTextColor(resolveAttrColor(android.R.attr.textColorSecondary))
            })
            return ScrollView(this).apply { addView(root) }
        }

        // Group by goal for display. Collect goal-linked projects first, then standalone.
        data class ProjectEntry(val id: String, val title: String, val goalTitle: String,
            val goalColorHex: String, val pct: Int, val done: Int, val total: Int)

        val entries = mutableListOf<ProjectEntry>()
        for (i in 0 until allProjects.length()) {
            val p = allProjects.optJSONObject(i) ?: continue
            entries += ProjectEntry(
                id           = p.optString("id", ""),
                title        = p.optString("title", "Untitled"),
                goalTitle    = p.optString("goalTitle", ""),
                goalColorHex = p.optString("goalColorHex", ""),
                pct          = p.optInt("progressPct", 0),
                done         = p.optInt("completedTasks", 0),
                total        = p.optInt("totalTasks", 0),
            )
        }

        // Sort: goal-linked first (alphabetical by goal title), then standalone
        val sorted = entries.sortedWith(compareBy(
            { it.goalTitle.isEmpty() },  // goal-linked first
            { it.goalTitle },
            { it.title },
        ))

        var lastGoalTitle = "\u0000" // sentinel
        for (entry in sorted) {
            // Goal section header
            val sectionLabel = entry.goalTitle.ifEmpty { "Standalone" }
            if (sectionLabel != lastGoalTitle) {
                lastGoalTitle = sectionLabel
                root.addView(TextView(this).apply {
                    text = sectionLabel.uppercase()
                    textSize = 11f
                    letterSpacing = 0.08f
                    setTextColor(resolveAttrColor(android.R.attr.textColorSecondary))
                    setPadding(0, dp(12), 0, dp(4))
                })
            }
            root.addView(buildProjectRow(entry.id, entry.title, entry.goalColorHex,
                entry.pct, entry.done, entry.total))
        }

        return ScrollView(this).apply { addView(root) }
    }

    private fun buildProjectRow(
        projectId: String, title: String, colorHex: String,
        pct: Int, done: Int, total: Int,
    ): View {
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(0, dp(8), 0, dp(8))
            isClickable = true
            isFocusable = true
            background = getAttrDrawable(android.R.attr.selectableItemBackground)
            setOnClickListener { onProjectSelected(projectId) }
        }

        val barColor = runCatching { Color.parseColor(colorHex.ifEmpty { "#3b82f6" }) }
            .getOrElse { Color.parseColor("#3b82f6") }
        row.addView(View(this).apply {
            background = ColorDrawable(barColor)
            layoutParams = LinearLayout.LayoutParams(dp(4), dp(44)).apply { marginEnd = dp(12) }
        })

        val textCol = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        }
        textCol.addView(TextView(this).apply {
            text = title
            textSize = 15f
            setTextColor(resolveAttrColor(android.R.attr.textColorPrimary))
        })
        val subtitle = if (total > 0) "$done/$total tasks  ·  $pct%" else "$pct%"
        textCol.addView(TextView(this).apply {
            text = subtitle
            textSize = 12f
            setTextColor(resolveAttrColor(android.R.attr.textColorSecondary))
            setPadding(0, dp(2), 0, dp(4))
        })
        textCol.addView(ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
            max = 100
            progress = pct
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(4))
        })
        row.addView(textCol)
        return row
    }

    private fun onProjectSelected(projectId: String) {
        getSharedPreferences(ProjectWidget.WIDGET_PREFS, Context.MODE_PRIVATE)
            .edit().putString(ProjectWidget.prefKey(appWidgetId), projectId).apply()
        ProjectWidget.requestUpdate(this)
        setResult(RESULT_OK, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId))
        finish()
    }

    // ── Utilities ─────────────────────────────────────────────────────────────

    private fun dp(value: Int): Int =
        (value * resources.displayMetrics.density).toInt()

    private fun resolveAttrColor(attr: Int): Int {
        val ta = obtainStyledAttributes(intArrayOf(attr))
        val color = ta.getColor(0, Color.BLACK)
        ta.recycle()
        return color
    }

    private fun getAttrDrawable(attr: Int): android.graphics.drawable.Drawable? {
        val ta = obtainStyledAttributes(intArrayOf(attr))
        val d = ta.getDrawable(0)
        ta.recycle()
        return d
    }
}
