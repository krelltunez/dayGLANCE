package com.dayglance.app

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build

class DayGlanceApplication : Application() {

    override fun onCreate() {
        super.onCreate()
        createNotificationChannels()
    }

    private fun createNotificationChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return

        val nm = getSystemService(NotificationManager::class.java)

        nm.createNotificationChannels(
            listOf(
                NotificationChannel(
                    CHANNEL_REMINDERS,
                    "Reminders",
                    NotificationManager.IMPORTANCE_HIGH
                ).apply { description = "Task and event reminders" },

                NotificationChannel(
                    CHANNEL_FOCUS,
                    "Focus Mode",
                    NotificationManager.IMPORTANCE_DEFAULT
                ).apply { description = "Pomodoro and focus block alerts" },

                NotificationChannel(
                    CHANNEL_EVENTS,
                    "Events",
                    NotificationManager.IMPORTANCE_DEFAULT
                ).apply { description = "Upcoming calendar event notifications" },
            )
        )
    }

    companion object {
        const val CHANNEL_REMINDERS = "reminders"
        const val CHANNEL_FOCUS = "focus_mode"
        const val CHANNEL_EVENTS = "events"
    }
}
