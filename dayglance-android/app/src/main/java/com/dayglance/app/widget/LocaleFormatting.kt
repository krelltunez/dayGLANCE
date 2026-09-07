package com.dayglance.app.widget

import android.content.Context
import android.text.format.DateFormat
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale

/** Locale conventions shared by the native home-screen widgets. */
internal fun formatWidgetDate(context: Context, date: LocalDate = LocalDate.now()): String {
    val locales = context.resources.configuration.locales
    val locale = if (locales.isEmpty) Locale.getDefault() else locales[0]
    val pattern = if (locale.language == Locale.CHINESE.language) "M月d日 EEE" else "EEE, MMM d"
    return date.format(DateTimeFormatter.ofPattern(pattern, locale))
}

/** Use a snapshot preference when present, otherwise follow Android's clock setting. */
internal fun widgetUses24HourClock(context: Context, snapshot: org.json.JSONObject?): Boolean =
    if (snapshot?.has("use24Hour") == true) {
        snapshot.optBoolean("use24Hour")
    } else {
        DateFormat.is24HourFormat(context)
    }
