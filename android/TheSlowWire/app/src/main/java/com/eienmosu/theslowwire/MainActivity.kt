package com.eienmosu.theslowwire

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import android.graphics.Color
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Modifier
import com.eienmosu.theslowwire.ui.theme.Palette
import com.eienmosu.theslowwire.ui.theme.current
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.remember
import com.eienmosu.theslowwire.ui.AppNav
import com.eienmosu.theslowwire.ui.theme.Appearance
import com.eienmosu.theslowwire.ui.theme.ThemeController
import com.eienmosu.theslowwire.ui.theme.TheSlowWireTheme

/**
 * The app's one Activity — Android's window, roughly what a UIWindowScene is on
 * iOS. Everything above `setContent` is the platform handing us a surface;
 * below it the app is one tree of @Composable functions, exactly like the
 * SwiftUI app is one tree of Views.
 *
 * `enableEdgeToEdge` lets the ground reach the screen edges; AppNav then insets
 * the CONTENT back out of the system bars' way.
 */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Transparent bars, both styles: the default `auto` picks its scrim
        // from the SYSTEM's light/dark setting, which is not this app's theme —
        // a dark app under a light system got a pale status-bar band with pale
        // icons drawn on it, and the clock became unreadable. With the bars
        // transparent, the page's own ground shows through and the icon colour
        // is set from the resolved theme (see TheSlowWireTheme).
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.auto(Color.TRANSPARENT, Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.auto(Color.TRANSPARENT, Color.TRANSPARENT),
        )
        setContent {
            // Read once and kept: the controller owns the persisted choice, so
            // recreating the Activity (a rotation) never re-reads the disk.
            val theme = remember { ThemeController(applicationContext) }
            val systemDark = isSystemInDarkTheme()
            val isDark = when (theme.appearance) {
                Appearance.DARK -> true
                Appearance.LIGHT -> false
                Appearance.SYSTEM -> systemDark
            }

            TheSlowWireTheme(appearance = theme.appearance) {
                // The ground is painted on the WHOLE window, behind the system
                // bars; AppNav insets only the content out of their way.
                Box(
                    Modifier
                        .fillMaxSize()
                        .background(Palette.current.ground)
                ) {
                    AppNav(
                        isDark = isDark,
                        onToggleTheme = { theme.toggle(isDark) },
                    )
                }
            }
        }
    }
}
