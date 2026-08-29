package com.eienmosu.theslowwire.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.eienmosu.theslowwire.ui.theme.Palette
import com.eienmosu.theslowwire.ui.theme.apparatus
import com.eienmosu.theslowwire.ui.theme.current
import com.eienmosu.theslowwire.ui.theme.stamp

// The design's shared parts, ported from the iOS app's Theme.swift: the
// apparatus voice, the stamp, and the gold double-rule. Each is a plain
// @Composable function — Compose's unit of UI, the same idea as a SwiftUI View
// struct or a React function component, except it returns nothing and instead
// EMITS into the tree it is called from.

/** Uppercase mono, letterspaced. The uppercasing lives here so no call site
 *  has to remember it, mirroring the web's `text-transform: uppercase`. */
@Composable
fun Apparatus(
    text: String,
    modifier: Modifier = Modifier,
    size: Int = 11,
    medium: Boolean = false,
    color: Color = Palette.current.muted,
) {
    Text(
        text = text.uppercase(),
        modifier = modifier,
        style = apparatus(size, if (medium) FontWeight.Medium else FontWeight.Normal),
        color = color,
    )
}

/** One form for every state the reader must not miss: a boxed, letterspaced
 *  word. State never depends on hue — the word itself is the signal. */
@Composable
fun Stamp(
    text: String,
    modifier: Modifier = Modifier,
    color: Color = Palette.current.ink,
) {
    Text(
        text = text.uppercase(),
        modifier = modifier
            .border(1.dp, color, RoundedCornerShape(2.dp))
            .padding(horizontal = 5.dp, vertical = 2.dp),
        style = stamp(),
        color = color,
    )
}

/** The day's announcement: two gold hairlines with a sliver of ground between,
 *  the mark that opens every day sheet on all three surfaces. */
@Composable
fun GoldRule(modifier: Modifier = Modifier) {
    val gold = Palette.current.goldSoft
    Column(modifier.fillMaxWidth()) {
        Divider(gold)
        Column(Modifier.height(3.dp)) {}
        Divider(gold)
    }
}

@Composable
private fun Divider(color: Color) {
    Column(
        Modifier
            .fillMaxWidth()
            .height(1.dp)
            .background(color)
    ) {}
}
