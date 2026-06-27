package com.dayglance.app.tiles

import com.dayglance.app.MainActivity

/** Quick Settings tile: open voice input (mirrors the "Voice Input" launcher shortcut). */
class VoiceInputTileService : TaskTileService() {
    override val action = MainActivity.ACTION_VOICE_INPUT
}
