package com.eienmosu.theslowwire.ui.theme

import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color

// MODERN CLASSIC — the day's wire, set like a luxury journal (DESIGN.md, owner
// redesign 2026-08-27/28). One ivory page, ink type, gold as the single accent.
// The web (app/globals.css) is the source of truth; iOS Theme.swift and this
// file are its two mirrors. Change the palette there first, then here.
//
// These are NOT Material colours. Material3's ColorScheme names (primary,
// surfaceVariant, onTertiaryContainer...) describe a system this design does
// not use, so mapping our nine tokens onto them would lose their meaning. They
// travel in their own Palette instead, handed down the tree by a
// CompositionLocal — Compose's answer to React context / SwiftUI's
// @Environment. Reading one is `Palette.current.ink` anywhere below the theme.

data class Palette(
    /** The page itself. */
    val ground: Color,
    /** Type, rules, the pressed fill. */
    val ink: Color,
    /** Secondary prose. */
    val inkSoft: Color,
    /** Apparatus and metadata. */
    val muted: Color,
    /** Gold that carries TEXT — deep enough for the 4.5:1 floor on ivory. */
    val gold: Color,
    /** Gold that carries RULES — the mock's brighter tone. */
    val goldSoft: Color,
    val hair: Color,
    val hairMid: Color,
    val hairSoft: Color,
) {
    /** Empty by design: it exists only so `Palette.current` has a receiver. */
    companion object
}

val LightPalette = Palette(
    ground = Color(0xFFF6F1E6),
    ink = Color(0xFF191512),
    inkSoft = Color(0xFF575043),
    muted = Color(0xFF766C5B),
    gold = Color(0xFF7D600E),
    goldSoft = Color(0xFFA6811F),
    hair = Color(0xFFC9BC9C),
    hairMid = Color(0xFFD8CDB4),
    hairSoft = Color(0xFFE2D8C2),
)

val DarkPalette = Palette(
    ground = Color(0xFF17130D),
    ink = Color(0xFFECE3CE),
    inkSoft = Color(0xFFCDC1A6),
    muted = Color(0xFFA79C85),
    gold = Color(0xFFD8AC52),
    goldSoft = Color(0xFFD8AC52),
    hair = Color(0xFF4A4230),
    hairMid = Color(0xFF40392A),
    hairSoft = Color(0xFF2E2819),
)

/** The channel the palette travels down. Defaults to light so a stray preview
 *  outside the theme still renders in the design's voice rather than crashing. */
val LocalPalette = staticCompositionLocalOf { LightPalette }

/** `Palette.current` — the read site everywhere in the UI. */
val Palette.Companion.current: Palette
    @Composable @ReadOnlyComposable get() = LocalPalette.current
