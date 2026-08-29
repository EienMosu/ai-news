package com.eienmosu.theslowwire.ui

import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.eienmosu.theslowwire.model.Vertical
import com.eienmosu.theslowwire.ui.section.FeedViewModel
import com.eienmosu.theslowwire.ui.section.SectionScreen
import com.eienmosu.theslowwire.ui.story.StoryScreen

/**
 * The app's two destinations.
 *
 * Navigation Compose is route-based where SwiftUI's NavigationStack is
 * value-based: a destination is a URL-shaped string with typed arguments, not
 * a Story pushed onto a path. That is the platform's grammar, and it pays off
 * later — the same route table is what an incoming deep link resolves against.
 *
 * The FeedViewModel is created HERE, above the NavHost, so both screens share
 * one instance: tapping a row opens a story that is already in memory instead
 * of refetching it. (`viewModel()` inside each screen would give each its own.)
 */
@Composable
fun AppNav(modifier: Modifier = Modifier) {
    val navController = rememberNavController()
    val feedViewModel: FeedViewModel = viewModel()
    // rememberSaveable survives both rotation and process death (it is written
    // to the saved-instance bundle), so the reader comes back to the
    // department they were reading, not to AI.
    var vertical by rememberSaveable { mutableStateOf(Vertical.AI) }

    NavHost(
        navController = navController,
        startDestination = Routes.FEED,
        modifier = modifier.safeDrawingPadding(),
    ) {
        composable(Routes.FEED) {
            SectionScreen(
                vertical = vertical,
                onSelect = { vertical = it },
                viewModel = feedViewModel,
                onOpenStory = { urlHash -> navController.navigate(Routes.story(urlHash)) },
            )
        }
        composable(
            route = Routes.STORY,
            arguments = listOf(navArgument(Routes.ARG_URL_HASH) { type = NavType.StringType }),
        ) { entry ->
            StoryScreen(
                urlHash = entry.arguments?.getString(Routes.ARG_URL_HASH).orEmpty(),
                onBack = { navController.popBackStack() },
                feedViewModel = feedViewModel,
            )
        }
    }
}

object Routes {
    const val ARG_URL_HASH = "urlHash"
    const val FEED = "feed"
    const val STORY = "story/{$ARG_URL_HASH}"
    fun story(urlHash: String) = "story/$urlHash"
}
