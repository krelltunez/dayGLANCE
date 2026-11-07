package com.dayglance.app.keyboard

import kotlin.math.max
import kotlin.math.roundToInt

/**
 * How much of the WebView the soft keyboard covers, from the two readings
 * MainActivity has (#2272). Pure, so the rules are unit-tested.
 *
 * The window runs with windowSoftInputMode="adjustNothing", so the WebView is
 * never resized. The primary reading is the IME inset that WindowInsetsCompat
 * delivers, less the navigation bar the root's padding already keeps the
 * WebView above. Some systems never deliver it to an adjustNothing window:
 * stock Android before 11 does not, and a Huawei nova 11 on HarmonyOS with
 * the Sogou keyboard reported 0 while the keyboard covered half the editor.
 *
 * The fallback reading comes from [KeyboardHeightProbe], a hidden popup that
 * IS resized by the keyboard: the bottom of the area it is left with is the
 * keyboard's top edge, and whatever of the WebView lies below that edge is
 * covered.
 */
object KeyboardInset {

    /**
     * The probe's reading: the part of the WebView below the top of the
     * keyboard, in physical pixels, never negative. With the keyboard down the
     * visible area ends at the navigation bar, at or below the WebView's
     * bottom, so this is 0.
     */
    fun probeOverlapPx(webViewBottomOnScreen: Int, visibleFrameBottom: Int): Int =
        max(0, webViewBottomOnScreen - visibleFrameBottom)

    /**
     * The overlap to report. The system's IME inset wins whenever it reports
     * one: it is the documented source, and where it works the probe adds
     * nothing. Only when it says 0 does the probe's reading stand, so a
     * system that never delivers IME insets still lifts the editor.
     */
    fun combinedOverlapPx(imeOverlapPx: Int, probeOverlapPx: Int): Int =
        if (imeOverlapPx > 0) imeOverlapPx else max(0, probeOverlapPx)

    /** Physical pixels to the CSS pixels the web side works in. */
    fun toCssPx(overlapPx: Int, density: Float): Int =
        if (density > 0f) (max(0, overlapPx) / density).roundToInt() else 0
}
