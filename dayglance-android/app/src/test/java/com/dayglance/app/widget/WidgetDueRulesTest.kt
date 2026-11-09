package com.dayglance.app.widget

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.json.JSONObject
import java.time.LocalDate

/**
 * Target dates on the widgets (#2160): the due badge's day count, and the day
 * widget's "due today" rows, held to the payload the JS side builds
 * (dayglance-ios/TestFixtures/widgetSnapshot.live.json, which carries two
 * projects due on its first projected day).
 */
class WidgetDueRulesTest {

    private val today = LocalDate.of(2026, 9, 21)

    // ── daysUntil ────────────────────────────────────────────────────────────

    @Test
    fun `counts days from today at render time`() {
        assertEquals(3, WidgetDueRules.daysUntil("2026-09-24", null, today))
        assertEquals(0, WidgetDueRules.daysUntil("2026-09-21", null, today))
        assertEquals(-2, WidgetDueRules.daysUntil("2026-09-19", null, today))
    }

    @Test
    fun `the date wins over the push-time count, which is only a fallback`() {
        assertEquals(3, WidgetDueRules.daysUntil("2026-09-24", 99, today))
        assertEquals(7, WidgetDueRules.daysUntil("not a date", 7, today))
        assertNull(WidgetDueRules.daysUntil("", null, today))
    }

    @Test
    fun `pushedDays reads the field, and null when it is null or absent`() {
        assertEquals(5, WidgetDueRules.pushedDays(JSONObject("""{"daysUntilDue":5}""")))
        assertNull(WidgetDueRules.pushedDays(JSONObject("""{"daysUntilDue":null}""")))
        assertNull(WidgetDueRules.pushedDays(JSONObject("{}")))
    }

    // ── on hold ──────────────────────────────────────────────────────────────

    @Test
    fun `a project on hold has no due badge and reads as on hold, a completed one has no badge either`() {
        val paused = JSONObject("""{"id":"p","status":"on-hold","targetDate":"2026-09-20","daysUntilDue":-1}""")
        val active = JSONObject("""{"id":"p","status":"active","targetDate":"2026-09-20"}""")
        val done = JSONObject("""{"id":"p","status":"completed","targetDate":"2026-09-20"}""")
        assertTrue(WidgetDueRules.isOnHold(paused))
        assertEquals(false, WidgetDueRules.showsDueDate(paused))
        assertEquals(false, WidgetDueRules.isOnHold(active))
        assertTrue(WidgetDueRules.showsDueDate(active))
        assertEquals(false, WidgetDueRules.showsDueDate(done))
        assertEquals(false, WidgetDueRules.isOnHold(JSONObject("{}")))
    }

    // ── rows ─────────────────────────────────────────────────────────────────

    private fun fixture(): JSONObject = JSONObject(
        WidgetDueRulesTest::class.java.getResourceAsStream("/widgetSnapshot.live.json")!!
            .bufferedReader().use { it.readText() },
    )

    @Test
    fun `reads the projects due on a projected day, as the app built them`() {
        val day = fixture().getJSONArray("days").getJSONObject(0)
        val rows = WidgetDueRules.rows(day, "projectsDue")
        assertEquals(
            listOf(
                WidgetDueRules.DueRow("roof", "Renovate the roof", 50, 2, 1),
                WidgetDueRules.DueRow("garden", "Plan the garden", null, 0, 0),
            ),
            rows,
        )
    }

    @Test
    fun `a day with none, or a payload from before the field, has no rows`() {
        val root = fixture()
        assertTrue(WidgetDueRules.rows(root, "projectsDue").isEmpty())
        assertTrue(WidgetDueRules.rows(JSONObject("{}"), "projectsDue").isEmpty())
    }

    @Test
    fun `a goal row without progressPct still reads 0, as goal rows always did`() {
        val rows = WidgetDueRules.rows(JSONObject("""{"goals":[{"id":"g","title":"Ship"}]}"""), "goals")
        assertEquals(listOf(WidgetDueRules.DueRow("g", "Ship", 0, 0, 0)), rows)
    }
}
