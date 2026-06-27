package com.dayglance.app.tiles

import android.app.PendingIntent
import android.content.Intent
import android.os.Build
import android.service.quicksettings.TileService
import com.dayglance.app.MainActivity

/**
 * Base Quick Settings tile that launches MainActivity with a specific action.
 *
 * These tiles mirror the static launcher shortcuts (see res/xml/shortcuts.xml):
 * tapping a tile drops the user straight into voice input, the inbox add-task
 * modal, or the scheduled add-task modal. The action is delivered to
 * MainActivity, which stores a pending flag in SharedDataStore that the JS layer
 * reads on the next visibilitychange — the exact same path the shortcuts use.
 *
 * Subclasses supply the action string (one of MainActivity.ACTION_*).
 */
abstract class TaskTileService : TileService() {

    /** One of MainActivity.ACTION_VOICE_INPUT / ACTION_ADD_INBOX_TASK / ACTION_ADD_TASK. */
    protected abstract val action: String

    override fun onClick() {
        super.onClick()

        val intent = Intent(action).apply {
            setClassName(packageName, MainActivity::class.java.name)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        }

        // startActivityAndCollapse(Intent) was deprecated in API 34 and now throws
        // UnsupportedOperationException — it requires a PendingIntent there. Older
        // platforms only accept the Intent overload.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            val pending = PendingIntent.getActivity(
                this,
                0,
                intent,
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
            )
            // unlockAndRun ensures the activity launches even from the locked QS panel.
            unlockAndRun { startActivityAndCollapse(pending) }
        } else {
            @Suppress("DEPRECATION", "StartActivityAndCollapseDeprecated")
            unlockAndRun { startActivityAndCollapse(intent) }
        }
    }
}
