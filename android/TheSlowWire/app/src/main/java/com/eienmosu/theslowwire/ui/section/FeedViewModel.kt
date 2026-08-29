package com.eienmosu.theslowwire.ui.section

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.eienmosu.theslowwire.data.FeedClient
import com.eienmosu.theslowwire.model.FeedResult
import com.eienmosu.theslowwire.model.Story
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** One day, already folded into stories and paired with the day it belongs to. */
data class DaySheet(
    val day: String?,
    val stories: List<Story>,
    /** The day's own unfiltered size, so a narrowed sheet can still say K of N. */
    val totalInDay: Int,
)

/** The three states the screen must tell apart, exactly as on the other two
 *  surfaces: a wait, a page, or an honest failure. A sealed interface is
 *  Kotlin's enum-with-payloads — Swift's `enum LoadState { case loaded([Day]) }`. */
sealed interface LoadState {
    data object Loading : LoadState
    data class Loaded(val days: List<DaySheet>) : LoadState
    data class Failed(val message: String) : LoadState
}

/**
 * Holds the section's feed across configuration changes.
 *
 * This is the one piece of Android with no SwiftUI counterpart worth glossing
 * over: rotating the phone DESTROYS and recreates the Activity, so state kept
 * in a composable's `remember` would die with it and the app would refetch on
 * every rotation. A ViewModel outlives that recreation, which is why the load
 * lives here rather than in a LaunchedEffect inside the screen.
 *
 * `viewModelScope` is a coroutine scope tied to this object's life: when the
 * screen goes away for good, an in-flight request is cancelled with it — the
 * structured-concurrency guarantee, the same idea as SwiftUI's `.task` being
 * cancelled when the view disappears.
 */
class FeedViewModel(
    private val client: FeedClient = FeedClient(),
) : ViewModel() {

    private val _state = MutableStateFlow<LoadState>(LoadState.Loading)
    val state: StateFlow<LoadState> = _state.asStateFlow()

    private var loadedSection: String? = null

    /** Loads once per section; a second call for the same section is ignored so
     *  returning to an already-loaded tab costs nothing. */
    fun load(section: String) {
        if (loadedSection == section && _state.value !is LoadState.Failed) return
        loadedSection = section
        _state.value = LoadState.Loading
        viewModelScope.launch {
            _state.value = try {
                val response = client.fetchFeed(section)
                LoadState.Loaded(sheets(response.results))
            } catch (error: Exception) {
                // The message is for a reader, not a log: the site's own copy
                // for "we could not reach the wire", with the cause appended
                // for the one person who might act on it.
                LoadState.Failed(error.message ?: "The feed could not be reached.")
            }
        }
    }

    /**
     * The story behind a urlHash: the one already folded into the loaded feed
     * when there is one, otherwise fetched from /api/article. The cache hit is
     * the normal path (the reader tapped a row that is on screen); the fetch is
     * the cold-start path a deep link or a process restart takes, where no feed
     * is in hand yet.
     */
    suspend fun story(urlHash: String): Story? {
        val loaded = (_state.value as? LoadState.Loaded)?.days
            ?.flatMap { it.stories }
            ?.firstOrNull { it.lead.urlHash == urlHash }
        if (loaded != null) return loaded
        return runCatching { client.fetchStory(urlHash) }.getOrNull()
    }

    fun retry() {
        loadedSection?.let { section ->
            loadedSection = null
            load(section)
        }
    }

    /** Folds the raw days into story sheets, dropping the days left empty by
     *  the fold — an empty sheet is a repeat's shadow, not a day worth showing. */
    private fun sheets(results: List<FeedResult>): List<DaySheet> =
        Story.groupDays(results)
            .mapIndexed { index, stories ->
                DaySheet(
                    day = results[index].day,
                    stories = stories,
                    totalInDay = results[index].articles.size,
                )
            }
            .filter { it.stories.isNotEmpty() }
}
