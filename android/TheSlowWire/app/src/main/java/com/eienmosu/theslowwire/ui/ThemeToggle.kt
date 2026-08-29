package com.eienmosu.theslowwire.ui

import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.drawscope.Fill
import androidx.compose.foundation.Canvas
import androidx.compose.ui.unit.dp
import com.eienmosu.theslowwire.ui.theme.Palette
import com.eienmosu.theslowwire.ui.theme.current

/**
 * The site's top-right theme control, same grammar: a hairline capsule naming
 * the mode a tap switches TO — moon · DARK on the ivory page, sun · LIGHT on
 * the night one. The mark is drawn, not borrowed from an icon set, for the
 * same reason Back and Share are words.
 */
@Composable
fun ThemeToggle(
    isDark: Boolean,
    onToggle: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val palette = Palette.current

    Row(
        modifier
            .clip(CircleShape)
            .border(1.dp, palette.hair, CircleShape)
            .clickable(onClick = onToggle)
            .padding(horizontal = 12.dp, vertical = 7.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Box(Modifier.width(11.dp).height(11.dp)) {
            if (isDark) Sun(palette.ink) else Moon(palette.ink)
        }
        Apparatus(if (isDark) "Light" else "Dark", size = 10, medium = true, color = palette.ink)
    }
}

/** A disc with eight rays. */
@Composable
private fun Sun(color: Color) {
    Canvas(Modifier.width(11.dp).height(11.dp)) {
        val r = size.minDimension / 2
        drawCircle(color, radius = r * 0.46f, style = Fill)
        repeat(8) { i ->
            val angle = Math.toRadians((i * 45).toDouble())
            val inner = r * 0.68f
            val outer = r * 0.98f
            drawLine(
                color = color,
                start = center + Offset(
                    (Math.cos(angle) * inner).toFloat(),
                    (Math.sin(angle) * inner).toFloat(),
                ),
                end = center + Offset(
                    (Math.cos(angle) * outer).toFloat(),
                    (Math.sin(angle) * outer).toFloat(),
                ),
                strokeWidth = 1.2.dp.toPx(),
            )
        }
    }
}

/** A disc with a second disc punched out of it — a crescent in one pass. */
@Composable
private fun Moon(color: Color) {
    Canvas(Modifier.width(11.dp).height(11.dp)) {
        val r = size.minDimension / 2
        // The punch needs its own layer, or BlendMode.Clear would erase the
        // page behind the icon instead of just the disc under it.
        drawContext.canvas.saveLayer(
            androidx.compose.ui.geometry.Rect(Offset.Zero, size),
            androidx.compose.ui.graphics.Paint(),
        )
        drawCircle(color, radius = r * 0.92f)
        drawCircle(
            color = Color.Black,
            radius = r * 0.80f,
            center = center + Offset(r * 0.52f, -r * 0.34f),
            blendMode = BlendMode.Clear,
        )
        drawContext.canvas.restore()
    }
}
