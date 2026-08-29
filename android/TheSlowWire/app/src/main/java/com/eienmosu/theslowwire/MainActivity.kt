package com.eienmosu.theslowwire

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.ui.Modifier
import com.eienmosu.theslowwire.ui.section.SectionScreen
import com.eienmosu.theslowwire.ui.theme.TheSlowWireTheme

/**
 * The app's one Activity — Android's window, roughly what a UIWindowScene is on
 * iOS. Everything above `setContent` is the platform handing us a surface;
 * below it the app is one tree of @Composable functions, exactly like the
 * SwiftUI app is one tree of Views.
 *
 * `enableEdgeToEdge` lets the ivory ground reach the screen edges;
 * `safeDrawingPadding` then insets the CONTENT back out of the system bars'
 * way — the two halves of SwiftUI's ignoresSafeArea plus safe-area insets.
 */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            TheSlowWireTheme {
                SectionScreen(modifier = Modifier.safeDrawingPadding())
            }
        }
    }
}
