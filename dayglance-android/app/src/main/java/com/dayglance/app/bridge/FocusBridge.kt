package com.dayglance.app.bridge

import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.provider.Settings
import com.dayglance.app.data.SharedDataStore
import org.json.JSONArray

/**
 * Manages system-level locking for focus mode sessions.
 *
 * On entry:
 *   - Hides status bar and navigation bar (immersive sticky mode)
 *   - Cancels own scheduled reminder alarms so they don't fire mid-session
 *   - Enables Do Not Disturb (INTERRUPTION_FILTER_ALARMS) if the user has
 *     previously granted ACCESS_NOTIFICATION_POLICY
 *
 * On exit:
 *   - Restores the system bars
 *   - Restores the previous DND filter
 *   - Reschedules the reminder alarms that were paused
 */
class FocusBridge(
    private val context: Context,
    private val notificationBridge: NotificationBridge,
) {

    /** Saved DND filter before we changed it; INTERRUPTION_FILTER_UNKNOWN means untouched. */
    private var savedDndFilter = NotificationManager.INTERRUPTION_FILTER_UNKNOWN

    /** Locks down the UI for a focus mode session. Returns JSON: { "dndEnabled": bool } */
    fun enter(): String {
        applyImmersiveMode(true)
        cancelOwnAlarms()
        val dndEnabled = enableDnd()
        return """{"dndEnabled":$dndEnabled}"""
    }

    /** Restores normal UI after focus mode ends. */
    fun exit() {
        applyImmersiveMode(false)
        restoreDnd()
        rescheduleOwnAlarms()
    }

    fun isDndPermissionGranted(): Boolean =
        (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
            .isNotificationPolicyAccessGranted

    /** Opens the system Do Not Disturb access settings so the user can grant permission. */
    fun requestDndPermission() {
        val intent = Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        context.startActivity(intent)
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    private fun applyImmersiveMode(enter: Boolean) {
        (context as? android.app.Activity)?.runOnUiThread {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                val controller = context.window.insetsController ?: return@runOnUiThread
                if (enter) {
                    controller.hide(android.view.WindowInsets.Type.systemBars())
                    controller.systemBarsBehavior =
                        android.view.WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                } else {
                    controller.show(android.view.WindowInsets.Type.systemBars())
                }
            } else {
                @Suppress("DEPRECATION")
                context.window.decorView.systemUiVisibility = if (enter) {
                    (android.view.View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                        or android.view.View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        or android.view.View.SYSTEM_UI_FLAG_FULLSCREEN)
                } else {
                    android.view.View.SYSTEM_UI_FLAG_VISIBLE
                }
            }
        }
    }

    private fun cancelOwnAlarms() {
        val json = SharedDataStore(context).scheduledRemindersJson ?: return
        notificationBridge.cancelAlarmsFromJson(json)
    }

    private fun rescheduleOwnAlarms() {
        val json = SharedDataStore(context).scheduledRemindersJson ?: return
        runCatching {
            val arr = JSONArray(json)
            for (i in 0 until arr.length()) {
                notificationBridge.scheduleFromJson(arr.getJSONObject(i))
            }
        }
    }

    private fun enableDnd(): Boolean {
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (!nm.isNotificationPolicyAccessGranted) return false
        savedDndFilter = nm.currentInterruptionFilter
        // INTERRUPTION_FILTER_ALARMS: silences notifications, allows alarms/clocks/timers
        nm.setInterruptionFilter(NotificationManager.INTERRUPTION_FILTER_ALARMS)
        return true
    }

    private fun restoreDnd() {
        if (savedDndFilter == NotificationManager.INTERRUPTION_FILTER_UNKNOWN) return
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (nm.isNotificationPolicyAccessGranted) {
            nm.setInterruptionFilter(savedDndFilter)
        }
        savedDndFilter = NotificationManager.INTERRUPTION_FILTER_UNKNOWN
    }
}
