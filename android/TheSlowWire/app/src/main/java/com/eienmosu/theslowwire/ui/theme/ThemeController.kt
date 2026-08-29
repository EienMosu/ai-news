package com.eienmosu.theslowwire.ui.theme

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.content.edit

/**
 * The reader's appearance choice, remembered across launches.
 *
 * Three states, same as the site and the iOS app: DARK, LIGHT, or SYSTEM. The
 * DEFAULT here is DARK rather than SYSTEM (owner, 2026-08-30) — a wire read at
 * night should open dark unless the reader says otherwise, and the ivory page
 * is the choice, not the fallback.
 *
 * Backed by SharedPreferences, Android's small key-value store: the same job
 * UserDefaults does behind SwiftUI's @AppStorage. The read is synchronous and
 * happens once at startup, which is exactly the point — a theme decided one
 * frame late is a visible flash of the wrong ground.
 */
enum class Appearance { SYSTEM, LIGHT, DARK }

class ThemeController(context: Context) {
    private val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    /** A Compose state, so writing it recomposes the whole tree under the theme. */
    var appearance by mutableStateOf(read())
        private set

    /** Flips to the opposite of what is ON SCREEN, which is what the toggle's
     *  label promises. The caller passes the resolved value because SYSTEM has
     *  no fixed answer — only the composition knows which way it resolved. */
    fun toggle(currentlyDark: Boolean) {
        write(if (currentlyDark) Appearance.LIGHT else Appearance.DARK)
    }

    private fun read(): Appearance =
        runCatching { Appearance.valueOf(prefs.getString(KEY, null) ?: DEFAULT.name) }
            .getOrDefault(DEFAULT)

    private fun write(next: Appearance) {
        appearance = next
        prefs.edit { putString(KEY, next.name) }
    }

    private companion object {
        const val PREFS = "the-slow-wire"
        const val KEY = "appearance"
        val DEFAULT = Appearance.DARK
    }
}
