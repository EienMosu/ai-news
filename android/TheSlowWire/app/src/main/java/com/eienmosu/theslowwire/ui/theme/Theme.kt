package com.eienmosu.theslowwire.ui.theme

import android.app.Activity
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat

/**
 * The design's one entry point. Wraps the app in the Modern Classic palette and
 * hands Material3 just enough of it that the components we do borrow (text
 * fields, ripples, the system bars) speak the same language.
 *
 * `dark` is nullable on purpose: null means "follow the system", which is what
 * the app does until the reader touches the theme toggle — the same three-state
 * model as the site (light / dark / unset) and the iOS app's AppStorage key.
 */
@Composable
fun TheSlowWireTheme(
    dark: Boolean? = null,
    content: @Composable () -> Unit,
) {
    val isDark = dark ?: isSystemInDarkTheme()
    val palette = if (isDark) DarkPalette else LightPalette

    // Material3 still paints a few surfaces we do not draw ourselves (the text
    // cursor, selection handles, ripples). Pointing its handful of load-bearing
    // roles at our tokens keeps those from arriving in Material's default
    // purple. Everything the design owns reads Palette.current instead.
    val colorScheme = if (isDark) {
        darkColorScheme(
            primary = palette.ink,
            background = palette.ground,
            surface = palette.ground,
            onPrimary = palette.ground,
            onBackground = palette.ink,
            onSurface = palette.ink,
        )
    } else {
        lightColorScheme(
            primary = palette.ink,
            background = palette.ground,
            surface = palette.ground,
            onPrimary = palette.ground,
            onBackground = palette.ink,
            onSurface = palette.ink,
        )
    }

    val view = LocalView.current
    if (!view.isInEditMode) {
        // The status-bar icons: dark glyphs on the ivory page, light on the
        // night one. Without this the clock and battery vanish into the ground.
        val window = (view.context as Activity).window
        WindowCompat.getInsetsController(window, view).isAppearanceLightStatusBars = !isDark
    }

    CompositionLocalProvider(LocalPalette provides palette) {
        MaterialTheme(colorScheme = colorScheme, content = content)
    }
}
