package com.eienmosu.theslowwire

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.eienmosu.theslowwire.ui.Apparatus
import com.eienmosu.theslowwire.ui.GoldRule
import com.eienmosu.theslowwire.ui.theme.Palette
import com.eienmosu.theslowwire.ui.theme.TheSlowWireTheme
import com.eienmosu.theslowwire.ui.theme.current
import com.eienmosu.theslowwire.ui.theme.display

/**
 * The app's one Activity — Android's window, roughly what a UIWindowScene is on
 * iOS. Everything above `setContent` is the platform handing us a surface;
 * everything below is Compose, and from there down the app is one tree of
 * @Composable functions, exactly like the SwiftUI app is one tree of Views.
 *
 * `enableEdgeToEdge` lets the page run under the status and navigation bars
 * (the ivory ground should reach the screen edges); `safeDrawingPadding` then
 * insets the CONTENT back out of their way — the two halves of SwiftUI's
 * `.ignoresSafeArea` plus safe-area insets, spelled out.
 */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            TheSlowWireTheme {
                Masthead()
            }
        }
    }
}

/**
 * The journal's opening, the same three lines as the site and the iOS app: the
 * product's claim, the Playfair wordmark, and the day's own line. The date is
 * hard-coded for now — session 2 gives it a real feed to read from.
 */
@Composable
fun Masthead() {
    val palette = Palette.current
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(palette.ground)
            .safeDrawingPadding()
            .padding(horizontal = 20.dp, vertical = 16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Apparatus(
            "Ranked by importance",
            size = 10,
            modifier = Modifier.fillMaxWidth(),
        )
        Text(
            text = "The Slow Wire",
            style = display(34, FontWeight.ExtraBold),
            color = palette.ink,
            textAlign = TextAlign.Center,
        )
        Apparatus("30.08.2026 · 95 stories", size = 10)
        GoldRule(Modifier.padding(top = 8.dp))
    }
}

@Preview(showBackground = true)
@Composable
fun MastheadPreview() {
    TheSlowWireTheme {
        Masthead()
    }
}
