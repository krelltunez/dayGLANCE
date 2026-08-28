package com.dayglance.app.data

/**
 * Crash-safe file replacement for SAF vault writes: TEMP, DELETE, RENAME.
 *
 * SAF has no atomic replace — openOutputStream(uri, "wt") truncates the LIVE
 * document in place, so a crash, process kill, or power loss mid-write leaves
 * the note truncated at whatever the buffer had flushed (this path has
 * produced zero-byte notes before). renameDocument cannot rename over an
 * existing name, so a true swap is impossible; the chosen scheme is:
 *
 *     1. write the FULL new content to a hidden temp in the same directory
 *     2. delete the original
 *     3. rename the temp to the original name
 *
 * preferred over backup-then-write because its crash window leaves TWO files
 * rather than NONE: every interruption leaves the content recoverable on
 * disk, where backup-then-write's window can still lose the content outright.
 *
 * CRASH WINDOWS AND THE RECOVERY RULE (deterministic, no timestamps):
 *   • crash during step 1  → temp (possibly PARTIAL) + original intact
 *   • crash before step 2  → temp (complete)         + original intact
 *   • crash between 2 and 3 → temp (complete)        + NO original
 * The first two are indistinguishable from each other (a partial temp cannot
 * be told from a complete one) but share a resolution: the write never
 * reached its commit point, the app was never told "success", so the ORIGINAL
 * is the truth — discard the temp. The third is unambiguous: the delete is
 * only ever issued AFTER the temp was fully written and closed, so a temp
 * with no original is COMPLETE by construction — restore it. For this
 * inference to hold, a brand-new file (no original) must never use the temp
 * dance: there is no content to protect, and a direct write keeps
 * "temp without original" meaning exactly one thing.
 *
 * "Stale" needs no age heuristic: bridge writes are serialized (synchronous
 * @JavascriptInterface calls from the single JS thread), so any temp
 * encountered at resolution time is by construction the residue of a crashed
 * write, never a write in progress.
 *
 * TEMP NAMING: `.<fileName>.dgtmp` — dot-prefixed so Obsidian's indexer,
 * Obsidian Sync, and this repository's own listings (which all skip hidden
 * files) never see it; same directory as the target because SAF rename only
 * works within a directory (and it keeps the temp on the same volume).
 *
 * Pure logic over the [Dir] seam so every crash window is unit-testable on
 * the JVM; ObsidianRepository binds it to DocumentFile.
 */
object SafeReplace {

    private const val PREFIX = "."
    private const val SUFFIX = ".dgtmp"

    fun tempNameFor(fileName: String): String = "$PREFIX$fileName$SUFFIX"
    fun isTempName(name: String): Boolean =
        name.length > PREFIX.length + SUFFIX.length && name.startsWith(PREFIX) && name.endsWith(SUFFIX)
    fun originalNameOf(tempName: String): String =
        tempName.removePrefix(PREFIX).removeSuffix(SUFFIX)

    /** Minimal operations over one directory; names are display names within it. */
    interface Dir {
        fun exists(name: String): Boolean
        /** Create [name] (must not exist) and write [text] to it. False on any failure. */
        fun createAndWrite(name: String, text: String): Boolean
        fun delete(name: String): Boolean
        fun rename(from: String, to: String): Boolean
        /** Full content of [name], or null when unreadable/absent. */
        fun read(name: String): String?
    }

    enum class Recovery { NONE, DISCARDED_STALE_TEMP, RESTORED_FROM_TEMP, RESTORE_FAILED }

    /**
     * Resolve any crashed-write residue for [fileName] before it is read or
     * rewritten. Original present → pre-commit crash, the temp may be partial,
     * the original is the truth: discard the temp. Original absent → the
     * post-delete window: the temp is complete by construction, restore it
     * (by rename; by copy where the provider cannot rename).
     */
    fun recover(dir: Dir, fileName: String): Recovery {
        val temp = tempNameFor(fileName)
        if (!dir.exists(temp)) return Recovery.NONE
        if (dir.exists(fileName)) {
            dir.delete(temp)
            return Recovery.DISCARDED_STALE_TEMP
        }
        if (dir.rename(temp, fileName)) return Recovery.RESTORED_FROM_TEMP
        // Rename-less provider: restore by copy, deleting the temp only once
        // the copy has fully landed.
        val text = dir.read(temp) ?: return Recovery.RESTORE_FAILED
        if (!dir.createAndWrite(fileName, text)) return Recovery.RESTORE_FAILED
        dir.delete(temp)
        return Recovery.RESTORED_FROM_TEMP
    }

    /**
     * Replace [fileName]'s content with [text], crash-safely. Returns true
     * only when the content verifiably reached its final name — the same
     * confirmed-write contract the JS side gates commits on.
     */
    fun replace(dir: Dir, fileName: String, text: String): Boolean {
        recover(dir, fileName)
        if (!dir.exists(fileName)) {
            // Brand-new file: nothing to protect, and skipping the dance is
            // what keeps "temp without original" unambiguous (see header).
            return dir.createAndWrite(fileName, text)
        }
        val temp = tempNameFor(fileName)
        if (!dir.createAndWrite(temp, text)) {
            dir.delete(temp)
            return false
        }
        // COMMIT POINT: the temp is complete and closed; from here on the
        // content survives any crash (recover restores it).
        if (!dir.delete(fileName)) {
            dir.delete(temp)
            return false
        }
        if (dir.rename(temp, fileName)) return true
        // Rename-less provider: roll forward by copy. Residual window — a
        // crash mid-copy leaves a PARTIAL original beside the complete temp,
        // which recover() then resolves in the original's favor. Accepted:
        // this branch is unreachable on ExternalStorageProvider (every real
        // vault), which supports rename.
        if (!dir.createAndWrite(fileName, text)) return false // temp stays as recovery material
        dir.delete(temp)
        return true
    }
}
