package com.eienmosu.theslowwire.ui.theme

import androidx.compose.ui.text.ExperimentalTextApi
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextGeometricTransform
import androidx.compose.ui.unit.sp
import com.eienmosu.theslowwire.R

// Three faces, three jobs: Playfair Display (display: masthead, headlines,
// folio numerals), Literata (prose), JetBrains Mono (apparatus). The same three
// files the site and the iOS app ship, copied into res/font.
//
// All three are VARIABLE fonts, which bit us on iOS: there, asking for the
// family name silently gave whichever named instance came first in the file,
// so every weight had to be spelled out as a PostScript instance name
// ("PlayfairDisplayRoman-ExtraBold"). Android has no such trap as long as the
// weight axis is declared: FontVariation.Settings(weight) sets the wght axis
// explicitly, and the FontWeight beside it is what a caller asks for. One entry
// per weight we actually use — an undeclared weight would be faked by the
// renderer (synthetic bolding), which on a display serif looks like a smear.
@OptIn(ExperimentalTextApi::class)
private fun variable(resId: Int, weight: FontWeight) = Font(
    resId = resId,
    weight = weight,
    style = FontStyle.Normal,
    variationSettings = FontVariation.Settings(FontVariation.weight(weight.weight)),
)

val Display = FontFamily(
    variable(R.font.playfair_display, FontWeight.Medium),
    variable(R.font.playfair_display, FontWeight.Bold),
    variable(R.font.playfair_display, FontWeight.ExtraBold),
)

val Prose = FontFamily(
    variable(R.font.literata, FontWeight.Normal),
    variable(R.font.literata, FontWeight.SemiBold),
)

val Apparatus = FontFamily(
    variable(R.font.jetbrains_mono, FontWeight.Normal),
    variable(R.font.jetbrains_mono, FontWeight.Medium),
)

// The named styles the UI asks for by role, never by font name — the same
// vocabulary as iOS's Font.display/.prose/.apparatus and the web's utility
// classes. Sizes are in sp (scale-independent pixels): unlike iOS points, they
// grow with the reader's system font-size setting, which is why nothing here
// hard-codes a pixel height.

/** The masthead and headlines. */
fun display(size: Int, weight: FontWeight = FontWeight.Bold) = TextStyle(
    fontFamily = Display,
    fontWeight = weight,
    fontSize = size.sp,
)

/** Playfair carries no italic instances, so the folio numeral leans by a
 *  geometric skew — the same compromise the iOS app makes with .italic(). */
fun folio(size: Int) = TextStyle(
    fontFamily = Display,
    fontWeight = FontWeight.Medium,
    fontSize = size.sp,
    textGeometricTransform = TextGeometricTransform(skewX = -0.25f),
)

/** Running text: why-lines, summaries, the reading room. */
fun prose(size: Int, weight: FontWeight = FontWeight.Normal) = TextStyle(
    fontFamily = Prose,
    fontWeight = weight,
    fontSize = size.sp,
)

/** The apparatus voice: uppercase mono, letterspaced (web: 0.09em). Callers
 *  uppercase the string themselves, exactly as the web's text-transform does. */
fun apparatus(size: Int, weight: FontWeight = FontWeight.Normal) = TextStyle(
    fontFamily = Apparatus,
    fontWeight = weight,
    fontSize = size.sp,
    letterSpacing = (size * 0.09f).sp,
)

/** The stamp's own voice: smaller than the apparatus and letterspaced wider
 *  (web: 0.625rem / 0.14em), so a boxed word reads as pressed on, not typed. */
fun stamp(size: Int = 10) = TextStyle(
    fontFamily = Apparatus,
    fontWeight = FontWeight.Normal,
    fontSize = size.sp,
    letterSpacing = (size * 0.14f).sp,
)
