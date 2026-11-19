package com.dayglance.app.data

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class GrantSharingTest {
    private val vault = "content://com.android.externalstorage.documents/tree/primary%3ADocuments%2FVault"

    @Test
    fun keepsTheGrantWhenTheVaultIsTheSameTree() {
        assertTrue(GrantSharing.stillInUse(vault, vault))
    }

    @Test
    fun releasesTheGrantWhenNoOtherFeatureUsesIt() {
        assertFalse(GrantSharing.stillInUse(vault, null))
        assertFalse(GrantSharing.stillInUse(vault, "content://com.android.externalstorage.documents/tree/primary%3ASync"))
    }
}
