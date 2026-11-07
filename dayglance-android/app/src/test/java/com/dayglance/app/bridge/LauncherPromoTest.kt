package com.dayglance.app.bridge

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The shape src/utils/launcherPromo.js (readLauncherPromoInfo) parses: a number,
 * a boolean and a string, each under its own name, an empty URL kept as "".
 */
class LauncherPromoTest {

    @Test
    fun `describe reports the sdk, whether installed and the url`() {
        val json = JSONObject(
            LauncherPromo.describe(34, false, "https://github.com/krelltunez/GLANCElauncher/releases/latest"),
        )
        assertEquals(34, json.getInt("sdk"))
        assertFalse(json.getBoolean("installed"))
        assertEquals("https://github.com/krelltunez/GLANCElauncher/releases/latest", json.getString("url"))
    }

    @Test
    fun `an empty url stays an empty string`() {
        val json = JSONObject(LauncherPromo.describe(31, true, ""))
        assertTrue(json.has("url"))
        assertEquals("", json.getString("url"))
        assertTrue(json.getBoolean("installed"))
    }

    @Test
    fun `the package is GLANCElauncher's`() {
        assertEquals("app.glance.launcher", LauncherPromo.LAUNCHER_PACKAGE)
    }
}
