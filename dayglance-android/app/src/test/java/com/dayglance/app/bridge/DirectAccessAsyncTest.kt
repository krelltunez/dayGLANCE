package com.dayglance.app.bridge

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DirectAccessAsyncTest {
    @Test
    fun acceptsTheIdsTheWebAdapterMakes() {
        assertTrue(DirectAccessAsync.validCallbackId("da_1"))
        assertTrue(DirectAccessAsync.validCallbackId("da_12345678901234567890123456789"))
    }

    @Test
    fun refusesAnythingThatCouldBreakOutOfTheScript() {
        assertFalse(DirectAccessAsync.validCallbackId(null))
        assertFalse(DirectAccessAsync.validCallbackId(""))
        assertFalse(DirectAccessAsync.validCallbackId("a');alert(1);('"))
        assertFalse(DirectAccessAsync.validCallbackId("DA_1"))
        assertFalse(DirectAccessAsync.validCallbackId("a".repeat(33)))
    }
}
