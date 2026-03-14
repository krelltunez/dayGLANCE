package com.dayglance.app.widget

import android.content.Context
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.view.View
import android.widget.RemoteViews
import android.widget.RemoteViewsService
import com.dayglance.app.R
import com.dayglance.app.data.SharedDataStore
import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalTime
import java.time.format.DateTimeFormatter

/**
 * Builds the scrollable agenda list inside the home screen widget.
 *
 * Reads the rich snapshot JSON pushed by the JS app (via NativeBridge.updateWidgetSnapshot)
 * and produces one RemoteViews per agenda item. Item types:
 *
 *   TYPE_HABITS        — horizontal row of up to 5 habit rings (Canvas-drawn bitmaps)
 *   TYPE_SECTION       — section header pill ("⚠ OVERDUE", "ALL DAY", etc.)
 *   TYPE_TASK          — task/event row with color bar (overdue, all-day, deadline, scheduled)
 *   TYPE_FRAME_HEADER  — GTD Frame block header (name, times, available minutes)
 *   TYPE_ROUTINE       — routine row with optional start time
 *   TYPE_EMPTY         — "All caught up!" placeholder
 */
class DayGlanceWidgetListFactory(
    private val context: Context,
) : RemoteViewsService.RemoteViewsFactory {

    // ── Item type constants ───────────────────────────────────────────────────

    companion object {
        const val TYPE_HABITS = 0
        const val TYPE_SECTION = 1
        const val TYPE_TASK = 2
        const val TYPE_FRAME_HEADER = 3
        const val TYPE_ROUTINE = 4
        const val TYPE_EMPTY = 5

        private val TWELVE_HR = DateTimeFormatter.ofPattern("h:mm a")
        private val TWELVE_HR_SHORT = DateTimeFormatter.ofPattern("h:mm")
    }

    // ── Agenda item data classes ──────────────────────────────────────────────

    private sealed class AgendaItem(val viewType: Int) {
        class Habits(val list: List<HabitData>) : AgendaItem(TYPE_HABITS)
        class Section(val label: String, val isOverdue: Boolean = false) : AgendaItem(TYPE_SECTION)
        class Task(
            val title: String,
            val colorHex: String,
            val badge: String,   // e.g. "ALL DAY", "DUE TODAY", "OVERDUE"
            val timeStr: String,
            val indent: Boolean = false,
        ) : AgendaItem(TYPE_TASK)
        class FrameHeader(
            val name: String,
            val colorHex: String,
            val start: String,
            val end: String,
            val availableMinutes: Int,
        ) : AgendaItem(TYPE_FRAME_HEADER)
        class Routine(val name: String, val startTime: String, val isAllDay: Boolean) : AgendaItem(TYPE_ROUTINE)
        object Empty : AgendaItem(TYPE_EMPTY)
    }

    data class HabitData(
        val name: String,
        val ringColorHex: String,
        val progress: Float,     // 0.0–1.0
        val isComplete: Boolean,
    )

    // ── State ────────────────────────────────────────────────────────────────

    private val items = mutableListOf<AgendaItem>()

    // ── RemoteViewsFactory lifecycle ─────────────────────────────────────────

    override fun onCreate() { /* no-op; loading is done in onDataSetChanged */ }

    override fun onDataSetChanged() {
        items.clear()
        val snapshotJson = SharedDataStore(context).widgetSnapshot ?: return
        try {
            buildItems(JSONObject(snapshotJson))
        } catch (_: Throwable) {
            items += AgendaItem.Empty
        }
    }

    override fun onDestroy() { items.clear() }

    override fun getCount(): Int = items.size.coerceAtLeast(1)
    override fun getViewTypeCount(): Int = 6
    override fun getItemId(position: Int): Long = position.toLong()
    override fun hasStableIds(): Boolean = false
    override fun getLoadingView(): RemoteViews? = null

    override fun getViewAt(position: Int): RemoteViews {
        val item = items.getOrNull(position) ?: AgendaItem.Empty
        return try { buildView(item) } catch (_: Throwable) { buildView(AgendaItem.Empty) }
    }

    // ── Snapshot parsing → AgendaItem list ──────────────────────────────────

    private fun buildItems(snapshot: JSONObject) {
        val isDark = isDarkMode()

        // 1. Habits
        val habitsArray = snapshot.optJSONArray("habits")
        if (habitsArray != null && habitsArray.length() > 0) {
            val habits = (0 until minOf(habitsArray.length(), 5)).mapNotNull { i ->
                val h = habitsArray.optJSONObject(i) ?: return@mapNotNull null
                HabitData(
                    name = h.optString("name", ""),
                    ringColorHex = h.optString("ringColorHex", "#3b82f6"),
                    progress = h.optDouble("progress", 0.0).toFloat().coerceIn(0f, 1f),
                    isComplete = h.optBoolean("complete", false),
                )
            }
            if (habits.isNotEmpty()) items += AgendaItem.Habits(habits)
        }

        // 2. Overdue tasks
        val overdueArray = snapshot.optJSONArray("overdue")
        if (overdueArray != null && overdueArray.length() > 0) {
            items += AgendaItem.Section("⚠ OVERDUE (${overdueArray.length()})", isOverdue = true)
            for (i in 0 until overdueArray.length()) {
                val t = overdueArray.optJSONObject(i) ?: continue
                val timeStr = t.optString("startTime", "")
                items += AgendaItem.Task(
                    title = t.optString("title", "Untitled"),
                    colorHex = t.optString("colorHex", "#ef4444"),
                    badge = "OVERDUE",
                    timeStr = timeStr,
                )
            }
        }

        // 3. All-day events
        val allDayArray = snapshot.optJSONArray("allDay")
        if (allDayArray != null && allDayArray.length() > 0) {
            items += AgendaItem.Section("ALL DAY")
            for (i in 0 until allDayArray.length()) {
                val t = allDayArray.optJSONObject(i) ?: continue
                items += AgendaItem.Task(
                    title = t.optString("title", "Untitled"),
                    colorHex = t.optString("colorHex", "#3b82f6"),
                    badge = "ALL DAY",
                    timeStr = "",
                )
            }
        }

        // 4. Deadline tasks ("Due Today")
        val deadlineArray = snapshot.optJSONArray("deadlines")
        if (deadlineArray != null && deadlineArray.length() > 0) {
            for (i in 0 until deadlineArray.length()) {
                val t = deadlineArray.optJSONObject(i) ?: continue
                items += AgendaItem.Task(
                    title = t.optString("title", "Untitled"),
                    colorHex = t.optString("colorHex", "#f97316"),
                    badge = "DUE TODAY",
                    timeStr = "",
                )
            }
        }

        // 5. Sections (frames + unframed scheduled tasks)
        val sectionsArray = snapshot.optJSONArray("sections")
        if (sectionsArray != null) {
            for (i in 0 until sectionsArray.length()) {
                val sec = sectionsArray.optJSONObject(i) ?: continue
                when (sec.optString("type")) {
                    "frame" -> {
                        items += AgendaItem.FrameHeader(
                            name = sec.optString("name", "Frame"),
                            colorHex = sec.optString("colorHex", "#3b82f6"),
                            start = sec.optString("start", ""),
                            end = sec.optString("end", ""),
                            availableMinutes = sec.optInt("availableMinutes", 0),
                        )
                        val tasks = sec.optJSONArray("tasks") ?: continue
                        for (j in 0 until tasks.length()) {
                            val t = tasks.optJSONObject(j) ?: continue
                            items += AgendaItem.Task(
                                title = t.optString("title", "Untitled"),
                                colorHex = t.optString("colorHex", "#3b82f6"),
                                badge = "",
                                timeStr = buildTimeStr(t),
                                indent = true,
                            )
                        }
                    }
                    "unframed" -> {
                        val tasks = sec.optJSONArray("tasks") ?: continue
                        for (j in 0 until tasks.length()) {
                            val t = tasks.optJSONObject(j) ?: continue
                            items += AgendaItem.Task(
                                title = t.optString("title", "Untitled"),
                                colorHex = t.optString("colorHex", "#3b82f6"),
                                badge = "",
                                timeStr = buildTimeStr(t),
                                indent = false,
                            )
                        }
                    }
                }
            }
        }

        // 6. Routines
        val routinesArray = snapshot.optJSONArray("routines")
        if (routinesArray != null && routinesArray.length() > 0) {
            items += AgendaItem.Section("ROUTINES")
            for (i in 0 until routinesArray.length()) {
                val r = routinesArray.optJSONObject(i) ?: continue
                items += AgendaItem.Routine(
                    name = r.optString("name", "Routine"),
                    startTime = r.optString("startTime", ""),
                    isAllDay = r.optBoolean("isAllDay", true),
                )
            }
        }

        if (items.isEmpty()) items += AgendaItem.Empty
    }

    /** Builds the "9:30 – 10:00" time string for a task JSON object. */
    private fun buildTimeStr(t: JSONObject): String {
        val start = t.optString("startTime", "")
        val duration = t.optInt("duration", 0)
        if (start.isEmpty()) return ""
        return try {
            val parts = start.split(":").map { it.toInt() }
            val startMin = parts[0] * 60 + (parts.getOrNull(1) ?: 0)
            val endMin = startMin + duration
            val s = LocalTime.of(parts[0], parts.getOrNull(1) ?: 0)
            val e = LocalTime.of(endMin / 60 % 24, endMin % 60)
            // Build tags suffix
            val tagsArr = t.optJSONArray("tags")
            val tags = if (tagsArr != null && tagsArr.length() > 0)
                (0 until tagsArr.length()).joinToString(" ") { "#${tagsArr.optString(it)}" }
            else ""
            val timeRange = if (duration > 0)
                "${s.format(TWELVE_HR_SHORT)} – ${e.format(TWELVE_HR)}"
            else
                s.format(TWELVE_HR)
            if (tags.isNotEmpty()) "$timeRange  $tags" else timeRange
        } catch (_: Throwable) { start }
    }

    // ── View building ────────────────────────────────────────────────────────

    private fun buildView(item: AgendaItem): RemoteViews = when (item) {
        is AgendaItem.Habits -> buildHabitsView(item)
        is AgendaItem.Section -> buildSectionView(item)
        is AgendaItem.Task -> buildTaskView(item)
        is AgendaItem.FrameHeader -> buildFrameHeaderView(item)
        is AgendaItem.Routine -> buildRoutineView(item)
        AgendaItem.Empty -> buildEmptyView()
    }

    private fun buildHabitsView(item: AgendaItem.Habits): RemoteViews {
        val rv = RemoteViews(context.packageName, R.layout.widget_item_habits)
        val isDark = isDarkMode()

        val slotIds = listOf(
            Triple(R.id.habit_slot_1, R.id.habit_ring_1, R.id.habit_name_1),
            Triple(R.id.habit_slot_2, R.id.habit_ring_2, R.id.habit_name_2),
            Triple(R.id.habit_slot_3, R.id.habit_ring_3, R.id.habit_name_3),
            Triple(R.id.habit_slot_4, R.id.habit_ring_4, R.id.habit_name_4),
            Triple(R.id.habit_slot_5, R.id.habit_ring_5, R.id.habit_name_5),
        )

        for ((index, slot) in slotIds.withIndex()) {
            val (slotId, ringId, nameId) = slot
            val habit = item.list.getOrNull(index)
            if (habit == null) {
                rv.setViewVisibility(slotId, View.GONE)
            } else {
                rv.setViewVisibility(slotId, View.VISIBLE)
                val ringBitmap = drawHabitRing(habit, isDark)
                rv.setImageViewBitmap(ringId, ringBitmap)
                rv.setTextViewText(nameId, habit.name)
            }
        }
        return rv
    }

    private fun buildSectionView(item: AgendaItem.Section): RemoteViews {
        val rv = RemoteViews(context.packageName, R.layout.widget_item_section)
        rv.setTextViewText(R.id.tv_section_label, item.label)
        if (item.isOverdue) {
            rv.setTextColor(R.id.tv_section_label, colorRes(R.color.widget_overdue_text))
        }
        return rv
    }

    private fun buildTaskView(item: AgendaItem.Task): RemoteViews {
        val rv = RemoteViews(context.packageName, R.layout.widget_item_task)
        rv.setTextViewText(R.id.tv_task_title, item.title)
        val color = safeParseColor(item.colorHex, "#3b82f6")
        rv.setInt(R.id.task_color_bar, "setBackgroundColor", color)

        // Indent frame-nested tasks and give them the same gray background as the frame header
        val startPad = if (item.indent) dpToPx(14) else 0
        rv.setViewPadding(R.id.task_item_root, startPad, dpToPx(4), 0, dpToPx(4))
        if (item.indent) {
            rv.setInt(R.id.task_item_root, "setBackgroundColor", colorRes(R.color.widget_frame_bg))
        }

        // Badge
        if (item.badge.isNotEmpty()) {
            rv.setTextViewText(R.id.tv_task_badge, item.badge)
            rv.setViewVisibility(R.id.tv_task_badge, View.VISIBLE)
            val badgeColor = when (item.badge) {
                "OVERDUE" -> colorRes(R.color.widget_overdue_text)
                "DUE TODAY" -> colorRes(R.color.widget_deadline_text)
                else -> colorRes(R.color.widget_text_secondary)
            }
            rv.setTextColor(R.id.tv_task_badge, badgeColor)
        } else {
            rv.setViewVisibility(R.id.tv_task_badge, View.GONE)
        }

        // Time / tag line
        if (item.timeStr.isNotEmpty()) {
            rv.setTextViewText(R.id.tv_task_time, item.timeStr)
            rv.setViewVisibility(R.id.tv_task_time, View.VISIBLE)
        } else {
            rv.setViewVisibility(R.id.tv_task_time, View.GONE)
        }

        return rv
    }

    private fun buildFrameHeaderView(item: AgendaItem.FrameHeader): RemoteViews {
        val rv = RemoteViews(context.packageName, R.layout.widget_item_frame_header)
        rv.setTextViewText(R.id.tv_frame_name, item.name)
        val color = safeParseColor(item.colorHex, "#3b82f6")
        rv.setInt(R.id.frame_color_bar, "setBackgroundColor", color)

        // Format times
        val timeRange = buildFrameTimeRange(item.start, item.end)
        rv.setTextViewText(R.id.tv_frame_times, timeRange)

        // Available time
        if (item.availableMinutes > 0) {
            val avail = formatMinutes(item.availableMinutes)
            rv.setTextViewText(R.id.tv_frame_avail, "$avail free")
            rv.setViewVisibility(R.id.tv_frame_avail, View.VISIBLE)
        } else {
            rv.setViewVisibility(R.id.tv_frame_avail, View.GONE)
        }
        return rv
    }

    private fun buildRoutineView(item: AgendaItem.Routine): RemoteViews {
        val rv = RemoteViews(context.packageName, R.layout.widget_item_routine)
        rv.setTextViewText(R.id.tv_routine_name, item.name)
        if (!item.isAllDay && item.startTime.isNotEmpty()) {
            val formatted = formatHhMm(item.startTime)
            rv.setTextViewText(R.id.tv_routine_time, formatted)
            rv.setViewVisibility(R.id.tv_routine_time, View.VISIBLE)
        } else {
            rv.setViewVisibility(R.id.tv_routine_time, View.GONE)
        }
        return rv
    }

    private fun buildEmptyView(): RemoteViews {
        // Reuse the section layout to show an "all caught up" message
        val rv = RemoteViews(context.packageName, R.layout.widget_item_section)
        rv.setTextViewText(R.id.tv_section_label, "All caught up ✓")
        return rv
    }

    // ── Habit ring bitmap drawing ─────────────────────────────────────────────

    /**
     * Draws a circular progress ring for a habit using [Canvas].
     *
     * RemoteViews cannot host custom views, so we bake the ring into a [Bitmap]
     * and set it on the slot's [android.widget.ImageView] via setImageViewBitmap.
     *
     * @param habit  the habit data (progress 0.0–1.0, ring colour hex, completion)
     * @param isDark whether the widget is in dark mode (affects the track colour)
     */
    private fun drawHabitRing(habit: HabitData, isDark: Boolean): Bitmap {
        val size = 80 // pixels — scaled to 36dp in the layout via scaleType=fitCenter
        val bmp = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bmp)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        val stroke = size * 0.13f
        val cx = size / 2f
        val cy = size / 2f
        val r = (size - stroke) / 2f
        val oval = RectF(stroke / 2, stroke / 2, size - stroke / 2, size - stroke / 2)

        // Track (background ring)
        paint.style = Paint.Style.STROKE
        paint.strokeWidth = stroke
        paint.color = if (isDark) Color.parseColor("#374151") else Color.parseColor("#e5e7eb")
        canvas.drawCircle(cx, cy, r, paint)

        // Progress arc
        val ringColor = safeParseColor(habit.ringColorHex, "#3b82f6")
        paint.color = ringColor
        paint.strokeCap = Paint.Cap.ROUND
        if (habit.isComplete) {
            // Full ring for completed habits
            canvas.drawCircle(cx, cy, r, paint)
        } else if (habit.progress > 0f) {
            canvas.drawArc(oval, -90f, 360f * habit.progress, false, paint)
        }

        // Check mark in centre for completed habits
        if (habit.isComplete) {
            paint.style = Paint.Style.FILL
            paint.color = Color.WHITE
            paint.strokeWidth = stroke * 0.7f
            paint.style = Paint.Style.STROKE
            paint.strokeCap = Paint.Cap.ROUND
            paint.strokeJoin = Paint.Join.ROUND
            val checkPath = android.graphics.Path()
            checkPath.moveTo(cx - size * 0.15f, cy)
            checkPath.lineTo(cx - size * 0.02f, cy + size * 0.13f)
            checkPath.lineTo(cx + size * 0.17f, cy - size * 0.12f)
            canvas.drawPath(checkPath, paint)
        }

        return bmp
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private fun isDarkMode(): Boolean =
        (context.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) ==
            Configuration.UI_MODE_NIGHT_YES

    private fun colorRes(resId: Int): Int =
        context.resources.getColor(resId, context.theme)

    private fun safeParseColor(hex: String, fallback: String): Int = try {
        Color.parseColor(if (hex.startsWith("#")) hex else "#$hex")
    } catch (_: Throwable) {
        Color.parseColor(fallback)
    }

    private fun dpToPx(dp: Int): Int =
        (dp * context.resources.displayMetrics.density).toInt()

    private fun formatMinutes(minutes: Int): String {
        val h = minutes / 60
        val m = minutes % 60
        return when {
            h > 0 && m > 0 -> "${h}h ${m}m"
            h > 0 -> "${h}h"
            else -> "${m}m"
        }
    }

    private fun formatHhMm(hhmm: String): String = try {
        val parts = hhmm.split(":").map { it.toInt() }
        val t = LocalTime.of(parts[0], parts.getOrNull(1) ?: 0)
        t.format(TWELVE_HR)
    } catch (_: Throwable) { hhmm }

    private fun buildFrameTimeRange(start: String, end: String): String {
        if (start.isEmpty() || end.isEmpty()) return ""
        return try {
            val s = parseHhMm(start)
            val e = parseHhMm(end)
            "${s.format(TWELVE_HR_SHORT)} – ${e.format(TWELVE_HR)}"
        } catch (_: Throwable) { "$start – $end" }
    }

    private fun parseHhMm(hhmm: String): LocalTime {
        val parts = hhmm.split(":").map { it.toInt() }
        return LocalTime.of(parts[0], parts.getOrNull(1) ?: 0)
    }
}
