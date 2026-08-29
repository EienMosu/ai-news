package com.eienmosu.theslowwire.ui.section

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.eienmosu.theslowwire.model.Vertical
import com.eienmosu.theslowwire.ui.theme.Palette
import com.eienmosu.theslowwire.ui.theme.current
import com.eienmosu.theslowwire.ui.theme.display

/**
 * The departments bar: three named cells, hairline-divided, the current one
 * underscored in gold. The words are the affordance — "AI News", not an icon
 * and not a colour — which is exactly the fix the owner asked for on the web
 * when a purely typographic nav left readers unsure the sections existed.
 *
 * It sits at the bottom on this platform (thumb reach) where the site keeps it
 * under the masthead; same control, same grammar, placed where the hand is.
 */
@Composable
fun SectionSwitch(
    current: Vertical,
    onSelect: (Vertical) -> Unit,
    modifier: Modifier = Modifier,
) {
    val palette = Palette.current

    Column(modifier.background(palette.ground)) {
        Box(
            Modifier
                .fillMaxWidth()
                .height(1.dp)
                .background(palette.hair)
        )
        Row(Modifier.fillMaxWidth()) {
            Vertical.entries.forEachIndexed { index, vertical ->
                if (index > 0) {
                    Box(
                        Modifier
                            .width(1.dp)
                            .height(46.dp)
                            .background(palette.hairMid)
                    )
                }
                Cell(
                    vertical = vertical,
                    isCurrent = vertical == current,
                    onSelect = onSelect,
                    modifier = Modifier.weight(1f),
                )
            }
        }
    }
}

@Composable
private fun Cell(
    vertical: Vertical,
    isCurrent: Boolean,
    onSelect: (Vertical) -> Unit,
    modifier: Modifier = Modifier,
) {
    val palette = Palette.current

    Column(
        modifier
            .clickable { onSelect(vertical) }
            .padding(top = 12.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            text = vertical.navTitle,
            // The current department is stated by weight and by the gold rule
            // beneath it, never by colour alone.
            style = display(15, if (isCurrent) FontWeight.Bold else FontWeight.Medium),
            color = if (isCurrent) palette.ink else palette.muted,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(bottom = 10.dp),
        )
        Box(
            Modifier
                .fillMaxWidth()
                .height(2.dp)
                .background(if (isCurrent) palette.gold else Color.Transparent)
        )
    }
}
