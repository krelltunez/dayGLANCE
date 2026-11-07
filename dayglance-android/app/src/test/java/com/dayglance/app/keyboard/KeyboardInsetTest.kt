package com.dayglance.app.keyboard

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The keyboard-overlap rules MainActivity reports to the web side (#2272).
 * Pixel figures are a 2412px-tall screen at density 2.55 (a nova 11 at
 * 408 dpi): a 132px navigation bar, so the WebView ends at 2280, and a
 * keyboard whose top edge is at 1500.
 */
class KeyboardInsetTest {

    private val webViewBottom = 2280
    private val keyboardTop = 1500
    private val navBar = 132

    @Test
    fun `the probe reads the WebView below the keyboard's top edge as covered`() {
        assertEquals(780, KeyboardInset.probeOverlapPx(webViewBottom, keyboardTop))
    }

    @Test
    fun `the probe reads nothing with the keyboard down`() {
        // The visible frame then ends at the navigation bar, below the WebView,
        // or exactly at its bottom.
        assertEquals(0, KeyboardInset.probeOverlapPx(webViewBottom, webViewBottom + navBar))
        assertEquals(0, KeyboardInset.probeOverlapPx(webViewBottom, webViewBottom))
    }

    @Test
    fun `the system's IME inset wins whenever it reports one`() {
        // Where insets work the two agree; if they ever disagree, the
        // documented source is trusted over the probe.
        assertEquals(780, KeyboardInset.combinedOverlapPx(imeOverlapPx = 780, probeOverlapPx = 780))
        assertEquals(780, KeyboardInset.combinedOverlapPx(imeOverlapPx = 780, probeOverlapPx = 900))
        assertEquals(780, KeyboardInset.combinedOverlapPx(imeOverlapPx = 780, probeOverlapPx = 0))
    }

    @Test
    fun `the probe stands in when the system reports no keyboard (the #2272 device)`() {
        assertEquals(780, KeyboardInset.combinedOverlapPx(imeOverlapPx = 0, probeOverlapPx = 780))
    }

    @Test
    fun `an IME inset smaller than the navigation bar counts as none`() {
        // MainActivity passes ime - navBar, which is negative while the IME
        // inset is 0 or still opening; that must not hide the probe's reading.
        assertEquals(780, KeyboardInset.combinedOverlapPx(imeOverlapPx = 0 - navBar, probeOverlapPx = 780))
        assertEquals(0, KeyboardInset.combinedOverlapPx(imeOverlapPx = 0 - navBar, probeOverlapPx = 0))
    }

    @Test
    fun `no keyboard from either reading is zero`() {
        assertEquals(0, KeyboardInset.combinedOverlapPx(imeOverlapPx = 0, probeOverlapPx = 0))
        assertEquals(0, KeyboardInset.combinedOverlapPx(imeOverlapPx = 0, probeOverlapPx = -40))
    }

    @Test
    fun `physical pixels become CSS pixels at the screen's density`() {
        assertEquals(306, KeyboardInset.toCssPx(780, 2.55f))
        assertEquals(0, KeyboardInset.toCssPx(-10, 2.55f))
        assertEquals(0, KeyboardInset.toCssPx(780, 0f))
    }
}
