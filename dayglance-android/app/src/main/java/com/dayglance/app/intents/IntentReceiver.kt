package com.dayglance.app.intents

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.dayglance.app.data.SharedDataStore

/**
 * BroadcastReceiver for the dayGLANCE intents transport.
 *
 * Receives CREATE, COMPLETE, OPEN, and QUERY broadcasts from Tasker or other
 * automation apps, stores them as pending intent JSON in SharedDataStore, then
 * sends an internal broadcast to wake the foreground MainActivity so JS picks
 * it up via the next visibilitychange event.
 *
 * The payload String extra must be a valid JSON object string.
 * The action comes from intent.action (e.g. "app.dayglance.CREATE").
 */
class IntentReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action ?: return
        val payloadExtra = intent.getStringExtra("payload")

        // Build the pending intent JSON using string manipulation (no JSON library needed).
        // Escape the action string (it's a well-known constant so no special chars expected,
        // but we escape backslash and double-quote defensively).
        val escapedAction = action.replace("\\", "\\\\").replace("\"", "\\\"")

        val pendingJson = if (payloadExtra != null) {
            // payloadExtra is already a JSON string — embed it verbatim as the payload value.
            """{"action":"$escapedAction","payload":$payloadExtra}"""
        } else {
            """{"action":"$escapedAction","payload":{}}"""
        }

        SharedDataStore(context).pendingIntentJson = pendingJson

        // Wake the foreground MainActivity (if running) so it can forward the intent
        // to JS without waiting for the user to switch apps.
        val wakeIntent = Intent("com.dayglance.app.INTENT_RECEIVED").apply {
            setPackage(context.packageName)
        }
        context.sendBroadcast(wakeIntent)
    }
}
