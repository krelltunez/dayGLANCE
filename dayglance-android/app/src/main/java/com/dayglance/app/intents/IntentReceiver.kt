package com.dayglance.app.intents

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.dayglance.app.data.SharedDataStore
import org.json.JSONObject

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

        // Parse and re-serialize via JSONObject to prevent JSON injection. A crafted
        // payload like `{},"evil":{` would break the structure if embedded verbatim.
        val payloadObj = try {
            if (payloadExtra != null) JSONObject(payloadExtra) else JSONObject()
        } catch (e: Exception) {
            JSONObject()
        }
        val pendingJson = JSONObject().put("action", action).put("payload", payloadObj).toString()

        SharedDataStore(context).pendingIntentJson = pendingJson

        // Wake the foreground MainActivity (if running) so it can forward the intent
        // to JS without waiting for the user to switch apps.
        val wakeIntent = Intent("com.dayglance.app.INTENT_RECEIVED").apply {
            setPackage(context.packageName)
        }
        context.sendBroadcast(wakeIntent)
    }
}
