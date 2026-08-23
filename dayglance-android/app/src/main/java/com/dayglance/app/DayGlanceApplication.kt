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
                    getString(R.string.channel_reminders),
                    NotificationManager.IMPORTANCE_HIGH
                ).apply { description = getString(R.string.channel_reminders_desc) },

                NotificationChannel(
                    CHANNEL_FOCUS,
                    getString(R.string.channel_focus),
                    NotificationManager.IMPORTANCE_DEFAULT
                ).apply { description = getString(R.string.channel_focus_desc) },

                NotificationChannel(
                    CHANNEL_EVENTS,
                    getString(R.string.channel_events),
                    NotificationManager.IMPORTANCE_DEFAULT
                ).apply { description = getString(R.string.channel_events_desc) },

                NotificationChannel(
                    CHANNEL_UP_NEXT,
                    getString(R.string.channel_up_next),
                    NotificationManager.IMPORTANCE_LOW
                ).apply { description = getString(R.string.channel_up_next_desc) },
            )
        )
    }

    companion object {
        const val CHANNEL_REMINDERS = "reminders"
        const val CHANNEL_FOCUS = "focus_mode"
        const val CHANNEL_EVENTS = "events"
        const val CHANNEL_UP_NEXT = "up_next"
    }
}
