package com.dayglance.app.data

import android.content.ContentUris
import android.content.ContentValues
import android.content.Context
import android.provider.CalendarContract
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException

class CalendarRepository(private val context: Context) {

    data class CalEvent(
        val id: String,
        val title: String,
        val start: String,       // ISO local datetime ("2026-03-08T09:00:00") or date ("2026-03-08") for all-day
        val end: String,
        val allDay: Boolean,
        val notes: String,
        val calendarId: String,
        val calendarName: String,
        val color: String,       // "#RRGGBB"
    )

    // ── Read ─────────────────────────────────────────────────────────────────

    fun getEvents(date: LocalDate): List<CalEvent> {
        val zone = ZoneId.systemDefault()
        val startMs = date.atStartOfDay(zone).toInstant().toEpochMilli()
        val endMs = date.plusDays(1).atStartOfDay(zone).toInstant().toEpochMilli()

        val uri = CalendarContract.Instances.CONTENT_URI.buildUpon()
            .appendPath(startMs.toString())
            .appendPath(endMs.toString())
            .build()

        val projection = arrayOf(
            CalendarContract.Instances.EVENT_ID,
            CalendarContract.Instances.TITLE,
            CalendarContract.Instances.BEGIN,
            CalendarContract.Instances.END,
            CalendarContract.Instances.ALL_DAY,
            CalendarContract.Instances.DESCRIPTION,
            CalendarContract.Instances.CALENDAR_ID,
            CalendarContract.Instances.CALENDAR_DISPLAY_NAME,
            CalendarContract.Instances.EVENT_COLOR,
            CalendarContract.Instances.CALENDAR_COLOR,
        )

        val events = mutableListOf<CalEvent>()
        try {
            context.contentResolver.query(
                uri, projection, null, null,
                "${CalendarContract.Instances.BEGIN} ASC"
            )?.use { cursor ->
                val idIdx       = cursor.getColumnIndex(CalendarContract.Instances.EVENT_ID)
                val titleIdx    = cursor.getColumnIndex(CalendarContract.Instances.TITLE)
                val beginIdx    = cursor.getColumnIndex(CalendarContract.Instances.BEGIN)
                val endIdx      = cursor.getColumnIndex(CalendarContract.Instances.END)
                val allDayIdx   = cursor.getColumnIndex(CalendarContract.Instances.ALL_DAY)
                val descIdx     = cursor.getColumnIndex(CalendarContract.Instances.DESCRIPTION)
                val calIdIdx    = cursor.getColumnIndex(CalendarContract.Instances.CALENDAR_ID)
                val calNameIdx  = cursor.getColumnIndex(CalendarContract.Instances.CALENDAR_DISPLAY_NAME)
                val evColorIdx  = cursor.getColumnIndex(CalendarContract.Instances.EVENT_COLOR)
                val calColorIdx = cursor.getColumnIndex(CalendarContract.Instances.CALENDAR_COLOR)

                while (cursor.moveToNext()) {
                    val allDay  = cursor.getInt(allDayIdx) != 0
                    val beginMs = cursor.getLong(beginIdx)
                    val endMs2  = cursor.getLong(endIdx)

                    // Prefer the per-event color; fall back to the calendar's color
                    val colorInt = if (!cursor.isNull(evColorIdx))
                        cursor.getInt(evColorIdx)
                    else
                        cursor.getInt(calColorIdx)

                    val startStr = if (allDay) date.toString()
                    else milliToLocalDT(beginMs, zone)

                    val endStr = if (allDay) date.toString()
                    else milliToLocalDT(endMs2, zone)

                    events += CalEvent(
                        id           = cursor.getLong(idIdx).toString(),
                        title        = cursor.getString(titleIdx) ?: "",
                        start        = startStr,
                        end          = endStr,
                        allDay       = allDay,
                        notes        = cursor.getString(descIdx) ?: "",
                        calendarId   = cursor.getLong(calIdIdx).toString(),
                        calendarName = cursor.getString(calNameIdx) ?: "",
                        color        = "#%06X".format(colorInt and 0xFFFFFF),
                    )
                }
            }
        } catch (_: SecurityException) {
            // READ_CALENDAR permission not yet granted — return empty list
        }
        return events
    }

    // ── Write ────────────────────────────────────────────────────────────────

    fun createEvent(
        title: String,
        start: String,
        end: String,
        allDay: Boolean,
        notes: String,
        calendarId: String?,
    ): String? {
        val zone  = ZoneId.systemDefault()
        val calId = calendarId?.toLongOrNull() ?: primaryCalendarId() ?: return null
        val startMs = parseToMillis(start, allDay, zone) ?: return null
        val endMs   = parseToMillis(end, allDay, zone) ?: (startMs + 3_600_000L)

        val values = ContentValues().apply {
            put(CalendarContract.Events.TITLE,          title)
            put(CalendarContract.Events.DTSTART,        startMs)
            put(CalendarContract.Events.DTEND,          endMs)
            put(CalendarContract.Events.ALL_DAY,        if (allDay) 1 else 0)
            put(CalendarContract.Events.DESCRIPTION,    notes)
            put(CalendarContract.Events.CALENDAR_ID,    calId)
            put(CalendarContract.Events.EVENT_TIMEZONE, zone.id)
        }
        return try {
            context.contentResolver.insert(CalendarContract.Events.CONTENT_URI, values)
                ?.lastPathSegment
        } catch (_: Exception) { null }
    }

    fun updateEvent(
        id: String,
        title: String,
        start: String,
        end: String,
        allDay: Boolean,
        notes: String,
    ): Boolean {
        val zone    = ZoneId.systemDefault()
        val startMs = parseToMillis(start, allDay, zone) ?: return false
        val endMs   = parseToMillis(end, allDay, zone) ?: (startMs + 3_600_000L)

        val values = ContentValues().apply {
            put(CalendarContract.Events.TITLE,          title)
            put(CalendarContract.Events.DTSTART,        startMs)
            put(CalendarContract.Events.DTEND,          endMs)
            put(CalendarContract.Events.ALL_DAY,        if (allDay) 1 else 0)
            put(CalendarContract.Events.DESCRIPTION,    notes)
            put(CalendarContract.Events.EVENT_TIMEZONE, zone.id)
        }
        return try {
            val uri = ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI, id.toLong())
            context.contentResolver.update(uri, values, null, null) > 0
        } catch (_: Exception) { false }
    }

    fun deleteEvent(id: String): Boolean = try {
        val uri = ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI, id.toLong())
        context.contentResolver.delete(uri, null, null) > 0
    } catch (_: Exception) { false }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private fun primaryCalendarId(): Long? {
        val projection = arrayOf(CalendarContract.Calendars._ID)
        val selection  = "${CalendarContract.Calendars.IS_PRIMARY} = 1"
        return try {
            context.contentResolver.query(
                CalendarContract.Calendars.CONTENT_URI, projection, selection, null, null
            )?.use { cursor ->
                if (cursor.moveToFirst()) cursor.getLong(0) else null
            }
        } catch (_: Exception) { null }
    }

    private fun milliToLocalDT(ms: Long, zone: ZoneId): String =
        LocalDateTime.ofInstant(Instant.ofEpochMilli(ms), zone)
            .format(DateTimeFormatter.ISO_LOCAL_DATE_TIME)

    private fun parseToMillis(dt: String, allDay: Boolean, zone: ZoneId): Long? = try {
        if (allDay) {
            LocalDate.parse(dt.take(10))
                .atStartOfDay(zone).toInstant().toEpochMilli()
        } else {
            LocalDateTime.parse(dt, DateTimeFormatter.ISO_LOCAL_DATE_TIME)
                .atZone(zone).toInstant().toEpochMilli()
        }
    } catch (_: DateTimeParseException) { null }
}
