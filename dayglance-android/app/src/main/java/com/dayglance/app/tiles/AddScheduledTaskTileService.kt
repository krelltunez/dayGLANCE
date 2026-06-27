package com.dayglance.app.tiles

import com.dayglance.app.MainActivity

/** Quick Settings tile: add a scheduled task (mirrors the "Scheduled Task" launcher shortcut). */
class AddScheduledTaskTileService : TaskTileService() {
    override val action = MainActivity.ACTION_ADD_TASK
}
