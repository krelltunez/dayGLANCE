package com.dayglance.app.tiles

import com.dayglance.app.MainActivity

/** Quick Settings tile: add an inbox task (mirrors the "Inbox Task" launcher shortcut). */
class AddInboxTaskTileService : TaskTileService() {
    override val action = MainActivity.ACTION_ADD_INBOX_TASK
}
