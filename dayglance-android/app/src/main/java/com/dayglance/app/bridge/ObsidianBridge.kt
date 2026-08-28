package com.dayglance.app.bridge

import android.app.NotificationManager
import android.app.PendingIntent
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.webkit.JavascriptInterface
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.dayglance.app.DayGlanceApplication
import com.dayglance.app.R
import com.dayglance.app.data.LaunchOnWritePolicy
import com.dayglance.app.data.ObsidianRepository

/**
 * Phase 4: Obsidian vault bridge.
 *
 * Exposes vault file I/O to the WebView via window.DayGlanceObsidian. The vault
 * root URI and daily note settings are configured in SettingsActivity.
 *
 * All methods run synchronously on the JavascriptInterface background thread —
 * SAF I/O is acceptable here since it's typically fast for local storage.
 */
class ObsidianBridge(private val context: Context, private val webView: android.webkit.WebView? = null) {

    companion object {
        // Fixed id so re-posting UPDATES rather than stacks. Reminder ids are
        // taskId hashes, so no constant is provably disjoint from them — a
        // collision merely replaces one notification and is vanishingly rare.
        private const val LAUNCH_NOTIFICATION_ID = 990_001
        private const val LAUNCH_NOTIFICATION_TIMEOUT_MS = 15L * 60 * 1000
    }

    private val repository = ObsidianRepository(context)

    // Launch-on-write (Obsidian build-out Phase 1): vault writes ARM the
    // launcher; leaving the app FIRES it (see MainActivity's exit hooks and
    // the rationale in LaunchOnWritePolicy — deliberately no timer: a timer
    // firing in-app interrupts the user's flow, and one firing after they
    // left is blocked by Android's background-activity-launch restriction).
    // Disabled until the web frontend pushes the device-local toggle via
    // setLaunchOnWrite (Android default: off).
    private val launchPolicy = LaunchOnWritePolicy()

    init {
        repository.onVaultWrite = { noteName -> launchPolicy.onWrite(noteName) }
        // Crash-recovery outcomes → the web app's surfacing listener
        // (useObsidianSync registers window.__dgVaultRestoreEvent). 'failed'
        // means a note is missing and its temp couldn't be restored — the one
        // recovery state a user may need to act on; 'restored' clears it.
        // The outcome string is our own constant; the file name is escaped
        // for the JS single-quoted literal.
        repository.onRestoreEvent = { outcome, fileName ->
            val safeName = fileName
                .replace("\\", "\\\\")
                .replace("'", "\\'")
                .replace("\n", " ")
            webView?.post {
                webView.evaluateJavascript(
                    "window.__dgVaultRestoreEvent && window.__dgVaultRestoreEvent('$outcome','$safeName')",
                    null
                )
            }
        }
    }

    /**
     * Pushed by the web frontend (device-local toggle) at startup and on every
     * change. The launch itself reuses [openNote], which already degrades the
     * way the write path requires: no vault name or no Obsidian installed is
     * silently ignored — the vault write succeeded, only the wake didn't, so
     * no error surfaces and sync status is untouched.
     */
    @JavascriptInterface
    fun setLaunchOnWrite(enabled: Boolean) = launchPolicy.setEnabled(enabled)

    /**
     * Fires the armed launch directly. Called by MainActivity from the
     * back-exit branch of its back callback — the one exit where a direct
     * activity start is actually permitted: the app is the foreground actor
     * performing a legitimate app switch, so neither the Home-press
     * stopAppSwitches suppression nor the background-activity-launch
     * restriction applies. Consumes the armed state (delivery is confirmed)
     * and retires any fallback notification from an earlier Home exit.
     * NOT a @JavascriptInterface: the WebView has no business firing it.
     */
    fun flushPendingLaunch() {
        launchPolicy.takePending()?.let {
            openNote(it)
            cancelLaunchNotification()
        }
    }

    /**
     * Home/Recents fallback. A direct start from onUserLeaveHint is dropped by
     * the platform (the Home press triggers stopAppSwitches — the mechanism
     * that stops apps hijacking the Home button — and the deferred start then
     * fails the background-activity-launch check), so the sanctioned channel
     * is a notification whose tap PendingIntent targets Obsidian directly.
     * Android 12+ forbids notification trampolines, so the tap cannot be
     * routed through us and cannot be observed — therefore the armed state is
     * only PEEKED, never consumed: an ignored notification must not lose the
     * wake, and a later back-exit still direct-launches. A constant id means
     * at most one such notification exists; it times out on its own, and
     * [onAppResumed] resolves the offer when the app comes back. Failure
     * stays silent throughout, per the launch-on-write contract.
     */
    fun notifyPendingLaunch() {
        val noteName = launchPolicy.peekPending() ?: return
        val vaultName = repository.getVaultName() ?: return
        val nm = NotificationManagerCompat.from(context)
        if (!nm.areNotificationsEnabled()) return

        val tapIntent = PendingIntent.getActivity(
            context, LAUNCH_NOTIFICATION_ID,
            Intent(Intent.ACTION_VIEW, buildOpenNoteUri(vaultName, noteName)).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val notification = NotificationCompat.Builder(context, DayGlanceApplication.CHANNEL_OBSIDIAN_SYNC)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(context.getString(R.string.notif_obsidian_sync_title))
            .setContentText(context.getString(R.string.notif_obsidian_sync_body))
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setContentIntent(tapIntent)
            .setAutoCancel(true)
            // Stale "tap to sync" prompts are noise — let the shade clean up.
            .setTimeoutAfter(LAUNCH_NOTIFICATION_TIMEOUT_MS)
            .build()
        try {
            nm.notify(LAUNCH_NOTIFICATION_ID, notification)
            // Only a posted offer may be resolved on resume; see onAppResumed.
            launchPolicy.onOfferPosted()
        } catch (_: SecurityException) {
            // POST_NOTIFICATIONS revoked between the check and the post — silent.
        }
    }

    /** Retires the tap-to-sync notification (delivery confirmed, or app resumed). */
    fun cancelLaunchNotification() {
        NotificationManagerCompat.from(context).cancel(LAUNCH_NOTIFICATION_ID)
    }

    /**
     * Resolves an outstanding tap-to-open offer when the app returns to the
     * foreground. Called from MainActivity.onStart — the moment that closes
     * the redundant-launch gap, since the user cannot back-exit dayGLANCE
     * without first coming back to it.
     *
     * The notification's tap is unobservable (no trampolines on 12+), but its
     * ABSENCE from the shade is not: gone means tapped, swiped, or timed out,
     * all of which spend the offer, so the policy consumes the arm and no
     * later back-exit re-launches Obsidian. Still showing means merely
     * ignored — the arm survives and we just retire the notification, which
     * is noise while the user is in the app.
     */
    fun onAppResumed() {
        if (launchPolicy.onAppResumed(isLaunchNotificationShowing())) {
            cancelLaunchNotification()
        }
    }

    /**
     * Whether our tap-to-sync notification is still in the shade.
     * Deliberately CONSERVATIVE on failure: reporting "still showing" keeps
     * the arm, degrading to the previous behaviour (at worst one redundant
     * launch) rather than risking a dropped wake.
     */
    private fun isLaunchNotificationShowing(): Boolean = try {
        context.getSystemService(NotificationManager::class.java)
            ?.activeNotifications
            ?.any { it.id == LAUNCH_NOTIFICATION_ID } ?: true
    } catch (_: Exception) {
        true
    }

    /**
     * Returns the raw markdown content of the daily note for [date] (ISO: yyyy-MM-dd).
     * "" means determinately absent-or-empty; NULL means the answer could not
     * be determined (vault unconfigured, folder unnavigable, read failure) —
     * JS must treat null as a FAILED read, never as an empty note (see
     * ObsidianRepository.getDailyNote's read contract).
     */
    @JavascriptInterface
    fun getDailyNote(date: String): String? = repository.getDailyNote(date)

    /**
     * Returns a JSON array of note paths (relative to vault root) in [folder].
     * Returns "[]" if vault isn't configured or the folder doesn't exist.
     */
    @JavascriptInterface
    fun listNotes(folder: String): String = repository.listNotes(folder)

    /**
     * Appends [content] to the note at [path] (relative to vault root).
     * Creates the file and any missing parent directories if needed.
     * Returns false if the vault isn't configured or a write error occurs.
     */
    @JavascriptInterface
    fun appendToNote(path: String, content: String): Boolean =
        repository.appendToNote(path, content)

    /**
     * Returns a JSON array of all daily notes in [folder] on or after [cutoff] (yyyy-MM-dd).
     * Each entry: { "date": "yyyy-MM-dd", "text": "<markdown>" }.
     * Pass an empty string for [cutoff] to return all notes.
     *
     * Preferred over repeated getDailyNote calls: a single native round trip avoids
     * blocking the JS thread N times during vault sync.
     */
    @JavascriptInterface
    fun getAllDailyNotes(folder: String, cutoff: String): String =
        repository.getAllDailyNotes(folder, cutoff)

    /**
     * Non-blocking version of getAllDailyNotes. Returns immediately and dispatches the
     * result (or error) back to JS via window.__obsidianDispatch(callbackId, json, error).
     *
     * [callbackId] must be alphanumeric + underscore, max 32 chars — validated before use.
     */
    @JavascriptInterface
    fun getAllDailyNotesAsync(folder: String, cutoff: String, callbackId: String) {
        // Validate callbackId to prevent JS injection via the interpolated eval string.
        if (callbackId.length > 32 || !callbackId.matches(Regex("[a-z0-9_]+"))) {
            return
        }
        Thread {
            try {
                val json = repository.getAllDailyNotes(folder, cutoff)
                // Escape backslashes and backticks that could break the JS template literal.
                // The result is a JSON string so only ` and \ need escaping before eval.
                val safe = json.replace("\\", "\\\\").replace("`", "\\`")
                webView?.post {
                    webView.evaluateJavascript(
                        "window.__obsidianDispatch('$callbackId',`$safe`,null)",
                        null
                    )
                }
            } catch (e: Exception) {
                val msg = (e.message ?: "error").replace("'", "\\'")
                webView?.post {
                    webView.evaluateJavascript(
                        "window.__obsidianDispatch('$callbackId',null,'$msg')",
                        null
                    )
                }
            }
        }.start()
    }

    /**
     * Parses GFM task items from the note at [path] (relative to vault root).
     * Returns a JSON array: [{ "text": "...", "completed": false, "line": 1 }, ...]
     */
    @JavascriptInterface
    fun getTasksFromNote(path: String): String = repository.getTasksFromNote(path)

    /** Returns true if the vault root URI has been configured via SettingsActivity. */
    @JavascriptInterface
    fun isVaultConfigured(): Boolean = repository.isVaultConfigured()

    /**
     * Opens [noteName] (e.g. "My Note" or "folder/My Note") in the Obsidian app
     * using the obsidian:// URI scheme. The vault name is derived from the configured
     * vault root folder. Silently does nothing if Obsidian isn't installed.
     */
    @JavascriptInterface
    fun openNote(noteName: String) {
        val vaultName = repository.getVaultName() ?: return
        val intent = Intent(Intent.ACTION_VIEW, buildOpenNoteUri(vaultName, noteName)).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        try {
            context.startActivity(intent)
        } catch (_: ActivityNotFoundException) {
            // Obsidian not installed — silently ignore
        }
    }

    private fun buildOpenNoteUri(vaultName: String, noteName: String): Uri = Uri.Builder()
        .scheme("obsidian")
        .authority("open")
        .appendQueryParameter("vault", vaultName)
        .appendQueryParameter("file", noteName)
        .build()

    /**
     * Returns JSON: { configured: Boolean, folder: String, pattern: String }.
     * Called by the web frontend on Android startup to detect vault state and
     * learn which daily-note sub-folder has been set natively.
     */
    @JavascriptInterface
    fun getVaultConfig(): String = repository.getVaultConfig()

    /**
     * Creates or overwrites the daily note for [date] (ISO: yyyy-MM-dd) with [content].
     * Returns false if the vault isn't configured or a write error occurs.
     */
    @JavascriptInterface
    fun writeDailyNote(date: String, content: String): Boolean =
        repository.writeDailyNote(date, content)

    /**
     * Returns the content and last-modified timestamp of the note at [path]
     * (relative to vault root, without .md extension).
     *
     * Bare names (e.g. "My Note") are resolved by searching the vault recursively,
     * mirroring Obsidian's own wikilink resolution. Explicit paths (e.g. "Folder/My Note")
     * are navigated directly.
     *
     * Returns JSON: { "text": "<markdown>", "lastModified": "<ISO-8601>" }
     * Returns "" if vault isn't configured or the note doesn't exist.
     */
    @JavascriptInterface
    fun getNote(path: String): String = repository.getNote(path)

    /**
     * Creates or overwrites the note at [path] (relative to vault root, without .md extension)
     * with [content]. For bare names the vault is searched first; if not found the file is
     * created at the vault root.
     * Returns false if the vault isn't configured or a write error occurs.
     */
    @JavascriptInterface
    fun writeNote(path: String, content: String): Boolean = repository.writeNote(path, content)

    /**
     * Builds (or rebuilds) the in-memory note URI index by scanning the vault tree.
     * After this returns, bare-name getNote() calls are O(1).
     * Automatically called at the end of getAllDailyNotes(); call explicitly when
     * the vault has changed outside of a normal sync cycle.
     */
    @JavascriptInterface
    fun buildNoteIndex() = repository.buildNoteIndex()

    /**
     * Clears the stored vault URI so the integration returns to unconfigured state.
     * Does NOT revoke the SAF permission — the user can re-select the same folder.
     * Also drops any pending launch-on-write (the pending note belongs to the
     * vault being swapped away from) while keeping the user's toggle intact.
     */
    @JavascriptInterface
    fun clearVault() {
        launchPolicy.cancelPending()
        repository.clearVault()
    }
}
