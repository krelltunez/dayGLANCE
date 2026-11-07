package com.dayglance.app.keyboard

import android.app.Activity
import android.graphics.Rect
import android.graphics.drawable.ColorDrawable
import android.view.Gravity
import android.view.View
import android.view.ViewTreeObserver
import android.view.WindowManager
import android.widget.PopupWindow

/**
 * Measures the soft keyboard where the window's IME insets do not (#2272).
 *
 * MainActivity's window is adjustNothing, and some systems then never report
 * the keyboard at all (see [KeyboardInset]). This is the long-standing
 * workaround: a zero-width, full-height popup that is NOT adjustNothing. It
 * is laid out behind the input method and resized by it like any adjustResize
 * window, so the bottom of its visible frame is the keyboard's top edge.
 *
 * It takes no touches and no focus, draws nothing, and is zero pixels wide,
 * so it is invisible and cannot intercept input. [onVisibleBottom] receives
 * the visible frame's bottom in screen coordinates on every layout of the
 * popup, on the main thread.
 */
class KeyboardHeightProbe(
    activity: Activity,
    private val onVisibleBottom: (Int) -> Unit,
) : PopupWindow(activity) {

    private val probeView = View(activity)
    private val frame = Rect()

    private val layoutListener = ViewTreeObserver.OnGlobalLayoutListener {
        probeView.getWindowVisibleDisplayFrame(frame)
        onVisibleBottom(frame.bottom)
    }

    init {
        contentView = probeView
        width = 0
        height = WindowManager.LayoutParams.MATCH_PARENT
        setBackgroundDrawable(ColorDrawable(0))
        isTouchable = false
        isFocusable = false
        isOutsideTouchable = false
        // Placed behind the input method (not FLAG_ALT_FOCUSABLE_IM), and
        // resized by it: the two settings that make the frame follow the
        // keyboard. The state is left alone, so showing the probe never
        // opens or closes a keyboard.
        inputMethodMode = INPUT_METHOD_NEEDED
        softInputMode = WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE or
            WindowManager.LayoutParams.SOFT_INPUT_STATE_UNCHANGED
    }

    /**
     * Shows the probe over [anchor]'s window. Needs the window attached: call
     * it from a post() on the activity's root. A second call is a no-op.
     */
    fun start(anchor: View) {
        if (isShowing || anchor.windowToken == null) return
        probeView.viewTreeObserver.addOnGlobalLayoutListener(layoutListener)
        showAtLocation(anchor, Gravity.NO_GRAVITY, 0, 0)
    }

    /** Removes the probe. Call from onDestroy, or the window leaks. */
    fun stop() {
        if (probeView.viewTreeObserver.isAlive) {
            probeView.viewTreeObserver.removeOnGlobalLayoutListener(layoutListener)
        }
        if (isShowing) dismiss()
    }
}
