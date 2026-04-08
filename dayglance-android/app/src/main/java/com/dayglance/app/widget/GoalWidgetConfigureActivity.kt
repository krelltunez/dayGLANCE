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
import com.dayglance.app.R
import com.dayglance.app.data.SharedDataStore
import org.json.JSONArray

/**
 * Configuration activity for [GoalWidget].
 *
 * Launched automatically by the launcher when the user adds the Goal widget.
 * Reads active goals from the widget snapshot and presents a scrollable list so
 * the user can pick which goal to pin. The choice is stored in SharedPreferences
 * keyed by the widget instance ID, then the widget is updated immediately.
 *
 * If no snapshot is available the user is prompted to open dayGLANCE first.
 */
class GoalWidgetConfigureActivity : AppCompatActivity() {

    private var appWidgetId = AppWidgetManager.INVALID_APPWIDGET_ID

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Default result = CANCELLED so backing out doesn't add the widget
        setResult(RESULT_CANCELED)

        appWidgetId = intent.extras?.getInt(
            AppWidgetManager.EXTRA_APPWIDGET_ID,
            AppWidgetManager.INVALID_APPWIDGET_ID,
        ) ?: AppWidgetManager.INVALID_APPWIDGET_ID

        if (appWidgetId == AppWidgetManager.INVALID_APPWIDGET_ID) { finish(); return }

        val snapshot = SharedDataStore(this).widgetSnapshot
        val allGoals: JSONArray? = snapshot?.let {
            runCatching { org.json.JSONObject(it).optJSONArray("allGoals") }.getOrNull()
        }

        setContentView(buildContentView(allGoals))
    }

    // ── UI building ───────────────────────────────────────────────────────────

    private fun buildContentView(allGoals: JSONArray?): View {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val dp16 = dp(16)
            setPadding(dp16, dp16, dp16, dp16)
        }

        // Title
        root.addView(TextView(this).apply {
            text = "Select a Goal"
            textSize = 18f
            setTextColor(resolveAttrColor(android.R.attr.textColorPrimary))
            setPadding(0, 0, 0, dp(4))
        })

        // Subtitle
        root.addView(TextView(this).apply {
            text = "Choose which goal to display on your widget."
            textSize = 13f
            setTextColor(resolveAttrColor(android.R.attr.textColorSecondary))
            setPadding(0, 0, 0, dp(16))
        })

        if (allGoals == null || allGoals.length() == 0) {
            root.addView(TextView(this).apply {
                text = "No active goals found.\n\nOpen dayGLANCE to sync your data, then try adding the widget again."
                textSize = 14f
                setTextColor(resolveAttrColor(android.R.attr.textColorSecondary))
            })
            return ScrollView(this).apply { addView(root) }
        }

        for (i in 0 until allGoals.length()) {
            val goal = allGoals.optJSONObject(i) ?: continue
            val goalId    = goal.optString("id", "")
            val title     = goal.optString("title", "Untitled")
            val colorHex  = goal.optString("colorHex", "#3b82f6")
            val pct       = goal.optInt("progressPct", 0)
            val total     = goal.optInt("totalTasks", 0)
            val done      = goal.optInt("completedTasks", 0)
            val projCount = goal.optJSONArray("projects")?.length() ?: 0

            val subtitle = buildString {
                if (total > 0) append("$done/$total tasks")
                if (projCount > 0) {
                    if (isNotEmpty()) append("  ·  ")
                    append("$projCount project${if (projCount != 1) "s" else ""}")
                }
                if (isNotEmpty()) append("  ·  ")
                append("$pct%")
            }

            root.addView(buildGoalRow(goalId, title, colorHex, pct, subtitle))
        }

        return ScrollView(this).apply { addView(root) }
    }

    private fun buildGoalRow(
        goalId: String,
        title: String,
        colorHex: String,
        pct: Int,
        subtitle: String,
    ): View {
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            val dp8 = dp(8)
            val dp12 = dp(12)
            setPadding(0, dp8, 0, dp8)
            isClickable = true
            isFocusable = true
            background = getAttrDrawable(android.R.attr.selectableItemBackground)
            setOnClickListener { onGoalSelected(goalId) }
        }

        // Color bar
        val barColor = runCatching { Color.parseColor(colorHex) }.getOrElse { Color.parseColor("#3b82f6") }
        row.addView(View(this).apply {
            background = ColorDrawable(barColor)
            layoutParams = LinearLayout.LayoutParams(dp(4), dp(48)).apply {
                marginEnd = dp(12)
            }
        })

        // Text column
        val textCol = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        }
        textCol.addView(TextView(this).apply {
            text = title
            textSize = 15f
            setTextColor(resolveAttrColor(android.R.attr.textColorPrimary))
        })
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

    private fun onGoalSelected(goalId: String) {
        // Store the selection for this widget instance
        getSharedPreferences(GoalWidget.WIDGET_PREFS, Context.MODE_PRIVATE)
            .edit().putString(GoalWidget.prefKey(appWidgetId), goalId).apply()

        // Trigger the widget to render
        GoalWidget.requestUpdate(this)

        // Return OK so the launcher places the widget
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
