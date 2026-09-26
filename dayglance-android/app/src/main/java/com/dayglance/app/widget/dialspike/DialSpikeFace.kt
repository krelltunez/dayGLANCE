package com.dayglance.app.widget.dialspike

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Typeface
import kotlin.math.cos
import kotlin.math.sin

// ─────────────────────────────────────────────────────────────────────────────
// THROWAWAY (Day Dial spike). A stand-in face on the widget spec's canvas
// (DialSpec: 364×382, centre 182,189, 24-hour, midnight at the top,
// clockwise): the block track with two sample blocks, the sky ring, 24 major
// ticks, the four cardinal labels, and a thin GHOST needle at the minute the
// face was drawn. The real needle (a separate layer) should sit exactly on the
// ghost right after a full update and move off it tick by tick: that is the
// alignment check. It is not the real face — only its cost and geometry are
// representative.
// ─────────────────────────────────────────────────────────────────────────────

object DialSpikeFace {
    const val CANVAS_W = 364f
    const val CANVAS_H = 382f
    private const val CX = 182f
    private const val CY = 189f

    /** A bitmap of exactly the canvas aspect, [scale] pixels per spec point,
     *  so it maps onto the needle layer (same aspect, same fitCenter). */
    fun draw(scale: Float, nowMinute: Float): Bitmap {
        val w = (CANVAS_W * scale).toInt().coerceAtLeast(1)
        val h = (CANVAS_H * scale).toInt().coerceAtLeast(1)
        val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        val c = Canvas(bmp)
        c.scale(w / CANVAS_W, h / CANVAS_H)
        c.drawColor(Color.parseColor("#0b0b0e"))

        val p = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE }

        // Block track (white 4.5 %) and two sample blocks, 09:00–12:00 and 14:00–17:30.
        p.strokeWidth = 22f
        p.color = Color.argb((0.045f * 255).toInt(), 255, 255, 255)
        c.drawCircle(CX, CY, 140f, p)
        val band = RectF(CX - 140f, CY - 140f, CX + 140f, CY + 140f)
        p.strokeCap = Paint.Cap.BUTT
        p.color = Color.parseColor("#3b82f6")
        c.drawArc(band, sweepStart(9 * 60f), 3 * 60 * DEG_PER_MIN, false, p)
        p.color = Color.parseColor("#10b981")
        c.drawArc(band, sweepStart(14 * 60f), 3.5f * 60 * DEG_PER_MIN, false, p)

        // Sky ring: a simple day/night split stands in for the hourly gradient.
        p.strokeWidth = 6f
        p.color = Color.parseColor("#1e293b")
        c.drawCircle(CX, CY, 119f, p)
        p.color = Color.parseColor("#7dd3fc")
        c.drawArc(RectF(CX - 119f, CY - 119f, CX + 119f, CY + 119f), sweepStart(6.5f * 60), 13 * 60 * DEG_PER_MIN, false, p)

        // 24 major ticks, 155–166 at 1.5pt, white 30 %.
        p.strokeWidth = 1.5f
        p.strokeCap = Paint.Cap.ROUND
        p.color = Color.argb((0.30f * 255).toInt(), 255, 255, 255)
        for (hour in 0 until 24) {
            val m = hour * 60f
            c.drawLine(x(155f, m), y(155f, m), x(166f, m), y(166f, m), p)
        }

        // Cardinal labels at 172, 10.5pt, white 44 %.
        val text = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.argb((0.44f * 255).toInt(), 255, 255, 255)
            textSize = 10.5f
            typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
            textAlign = Paint.Align.CENTER
        }
        for ((hour, label) in listOf(0 to "00", 6 to "06", 12 to "12", 18 to "18")) {
            val m = hour * 60f
            c.drawText(label, x(178f, m), y(178f, m) + 3.6f, text)
        }

        // The ghost: where the needle was when this face was drawn.
        p.strokeWidth = 1f
        p.color = Color.argb(140, 255, 255, 255)
        c.drawLine(x(126f, nowMinute), y(126f, nowMinute), x(159f, nowMinute), y(159f, nowMinute), p)
        return bmp
    }

    private const val DEG_PER_MIN = 360f / 1440f

    /** Canvas arcs start at 3 o'clock; the dial's minute 0 is at 12. */
    private fun sweepStart(minute: Float) = minute * DEG_PER_MIN - 90f

    private fun angle(minute: Float) = Math.toRadians((minute / 1440f * 360f).toDouble())
    private fun x(r: Float, minute: Float) = (CX + r * sin(angle(minute))).toFloat()
    private fun y(r: Float, minute: Float) = (CY - r * cos(angle(minute))).toFloat()
}
