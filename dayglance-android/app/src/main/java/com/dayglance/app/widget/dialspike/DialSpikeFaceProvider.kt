package com.dayglance.app.widget.dialspike

import android.content.ContentProvider
import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.net.Uri
import android.os.ParcelFileDescriptor
import java.io.File
import java.io.FileNotFoundException

// ─────────────────────────────────────────────────────────────────────────────
// THROWAWAY (Day Dial spike). Serves the spike's face PNGs to the launcher,
// which loads a widget's setImageViewUri image in ITS process. Exported and
// read-only; it serves only files named face-<digits>.png from one private
// directory, so it cannot be walked to anything else. A real widget would
// decide between this and FileProvider + grantUriPermission to the home app.
// ─────────────────────────────────────────────────────────────────────────────

class DialSpikeFaceProvider : ContentProvider() {
    override fun onCreate(): Boolean = true

    override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor {
        if (mode != "r") throw SecurityException("read-only")
        val name = uri.lastPathSegment ?: throw FileNotFoundException()
        if (!NAME.matches(name)) throw FileNotFoundException(name)
        val file = File(dir(context ?: throw FileNotFoundException()), name)
        if (!file.exists()) throw FileNotFoundException(name)
        return ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
    }

    override fun getType(uri: Uri): String = "image/png"
    override fun query(uri: Uri, p: Array<out String>?, s: String?, a: Array<out String>?, o: String?): Cursor? = null
    override fun insert(uri: Uri, values: ContentValues?): Uri? = null
    override fun delete(uri: Uri, s: String?, a: Array<out String>?): Int = 0
    override fun update(uri: Uri, v: ContentValues?, s: String?, a: Array<out String>?): Int = 0

    companion object {
        private val NAME = Regex("face-\\d+\\.png")
        fun dir(context: Context): File = File(context.filesDir, "dialspike").apply { mkdirs() }
        fun authority(context: Context) = "${context.packageName}.dialspike"
    }
}
