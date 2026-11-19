package com.dayglance.app.data

/**
 * Persisted SAF grants are held per tree URI and shared by every feature that
 * stored that URI: Direct Access sync (directAccessPath) and the Obsidian vault
 * (vaultPath) each take one with their own picker, and Android keeps a single
 * grant when both pick the same folder. A feature that forgets its folder may
 * release the grant only when no other feature still points at that tree.
 */
internal object GrantSharing {
    /** True when [releasing] is still the stored tree of another feature. */
    fun stillInUse(releasing: String, vararg others: String?): Boolean =
        others.any { it != null && it == releasing }
}
