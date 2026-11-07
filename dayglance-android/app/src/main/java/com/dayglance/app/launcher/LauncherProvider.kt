package com.dayglance.app.launcher

import android.Manifest
import android.content.ContentProvider
import android.content.ContentValues
import android.content.UriMatcher
import android.content.pm.PackageManager
import android.database.ContentObserver
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.provider.CalendarContract
import com.dayglance.app.data.CalendarRepository
import com.dayglance.app.data.SharedDataStore
import java.time.LocalDate

/**
 * The read-only face of the launcher snapshot (docs/launcher-integration.md):
 * `content://com.dayglance.app.launcher/<collection>` serves the rows
 * [LauncherSnapshotRows] maps out of the JSON the web layer pushed
 * ([com.dayglance.app.bridge.NativeBridge.updateLauncherSnapshot]). Every push
 * notifies the authority, so a ContentObserver on any collection URI sees
 * every change without polling.
 *
 * The `tasks` collection's device-calendar rows are not the snapshot's: each
 * query reads the calendar itself over the snapshot's window, with its filter
 * and the user's edits ([LauncherDeviceEvents]), so an event added in another
 * app reaches the launcher while the app is closed. A change to the calendar
 * notifies the authority too, for as long as this process lives. Without the
 * calendar permission, or before the app has pushed a snapshot that says how
 * to read it, the snapshot's own rows are served.
 *
 * Guarded in the manifest by `com.dayglance.permission.LAUNCHER`
 * (`signature|knownSigner`, the launcher's certificates). Nothing is ever
 * inserted, updated or deleted here: writes go through
 * [LauncherIntentReceiver].
 */
class LauncherProvider : ContentProvider() {

    private lateinit var store: SharedDataStore
    private lateinit var calendar: CalendarRepository
    private val main = Handler(Looper.getMainLooper())
    private val announce = Runnable { context?.contentResolver?.notifyChange(CONTENT_URI, null) }
    @Volatile private var calendarObserver: ContentObserver? = null
    private val matcher = UriMatcher(UriMatcher.NO_MATCH).apply {
        for (c in LauncherSnapshotRows.COLLECTIONS) addURI(LauncherSnapshotRows.AUTHORITY, c, 1)
    }

    override fun onCreate(): Boolean {
        val ctx = context ?: return false
        store = SharedDataStore(ctx)
        calendar = CalendarRepository(ctx)
        watchCalendar()
        return true
    }

    override fun query(uri: Uri, projection: Array<String>?, selection: String?, selectionArgs: Array<String>?, sortOrder: String?): Cursor? {
        if (matcher.match(uri) != 1) return null
        val collection = uri.lastPathSegment ?: return null
        val snapshot = if (collection == "tasks") withDeviceEvents(store.launcherSnapshot) else store.launcherSnapshot
        val rows = LauncherSnapshotRows.rows(
            snapshot, collection,
            heartbeatJson = store.launcherHeartbeat,
            refreshLogJson = store.launcherRefreshLog,
            rendererAlive = com.dayglance.app.MainActivity.rendererAlive,
            headlessRunning = LauncherRefreshWorker.running,
        ) ?: return null
        val cursor = MatrixCursor(LauncherSnapshotRows.COLUMNS, rows.size)
        rows.forEachIndexed { i, row -> cursor.addRow(arrayOf<Any?>(i, row.id, row.json)) }
        context?.let { cursor.setNotificationUri(it.contentResolver, CONTENT_URI) }
        return cursor
    }

    private fun canReadCalendar(): Boolean =
        context?.checkSelfPermission(Manifest.permission.READ_CALENDAR) == PackageManager.PERMISSION_GRANTED

    /** [snapshotJson] with its device-calendar rows read now, when the permission allows. */
    private fun withDeviceEvents(snapshotJson: String?): String? {
        if (snapshotJson.isNullOrEmpty() || !canReadCalendar()) return snapshotJson
        watchCalendar()
        return LauncherDeviceEvents.withLiveEvents(snapshotJson, LocalDate.now()) { from, to -> calendar.getEventsBetween(from, to) }
    }

    /**
     * Announce calendar changes on the launcher authority, once a burst settles
     * (a calendar sync touches many rows): the launcher re-reads, and the read
     * above picks the change up. Registered once the permission is granted.
     */
    @Synchronized
    private fun watchCalendar() {
        if (calendarObserver != null || !canReadCalendar()) return
        val observer = object : ContentObserver(main) {
            override fun onChange(selfChange: Boolean) {
                main.removeCallbacks(announce)
                main.postDelayed(announce, CALENDAR_SETTLE_MS)
            }
        }
        try {
            context?.contentResolver?.registerContentObserver(CalendarContract.CONTENT_URI, true, observer) ?: return
            calendarObserver = observer
        } catch (_: Exception) {
            // No calendar provider on this device: the snapshot's rows stand.
        }
    }

    override fun getType(uri: Uri): String? =
        if (matcher.match(uri) == 1) "vnd.android.cursor.dir/vnd.dayglance.${uri.lastPathSegment}" else null

    override fun insert(uri: Uri, values: ContentValues?): Uri? = throw UnsupportedOperationException("read-only")
    override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<String>?): Int = throw UnsupportedOperationException("read-only")
    override fun delete(uri: Uri, selection: String?, selectionArgs: Array<String>?): Int = throw UnsupportedOperationException("read-only")

    companion object {
        /** The authority URI: observers register here and every push notifies it. */
        val CONTENT_URI: Uri = Uri.parse("content://${LauncherSnapshotRows.AUTHORITY}")
        private const val CALENDAR_SETTLE_MS = 1500L
        fun collectionUri(collection: String): Uri = Uri.withAppendedPath(CONTENT_URI, collection)
    }
}
