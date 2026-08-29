package com.eienmosu.theslowwire.ui.section

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.eienmosu.theslowwire.data.FeedClient
import com.eienmosu.theslowwire.model.FeedResult
import com.eienmosu.theslowwire.model.Story
import com.eienmosu.theslowwire.model.Vertical
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
 * Holds every section's feed across configuration changes.
 *
 * This is the one piece of Android with no SwiftUI counterpart worth glossing
 * over: rotating the phone DESTROYS and recreates the Activity, so state kept
 * in a composable's `remember` would die with it and the app would refetch on
 * every turn. A ViewModel outlives that recreation.
 *
 * All three verticals live in one map rather than one ViewModel each, which is
 * what keeps a section switch free after the first visit — the same thing the
 * iOS TabView gets by keeping every tab alive.
 *
 * `viewModelScope` ties every request to this object's life: when the screen
 * goes for good, an in-flight fetch is cancelled with it — the same guarantee
 * SwiftUI's `.task` gives when a view disappears.
 */
class FeedViewModel(
    private val client: FeedClient = FeedClient(),
) : ViewModel() {

    private val _states = MutableStateFlow<Map<Vertical, LoadState>>(emptyMap())
    val states: StateFlow<Map<Vertical, LoadState>> = _states.asStateFlow()

    fun state(vertical: Vertical): LoadState = _states.value[vertical] ?: LoadState.Loading

    /** Loads a section once. Returning to an already-loaded department costs
     *  nothing; a failed one is retried on the next visit. */
    fun load(vertical: Vertical) {
        // Already read, or already being read: either way, nothing to do.
        if (_states.value[vertical] is LoadState.Loaded) return
        if (!loading.add(vertical)) return

        put(vertical, LoadState.Loading)
        viewModelScope.launch {
            val next = try {
                LoadState.Loaded(sheets(client.fetchFeed(vertical.id).results))
            } catch (error: Exception) {
                // The message is for a reader, not a log.
                LoadState.Failed(error.message ?: "The feed could not be reached.")
            }
            loading.remove(vertical)
            put(vertical, next)
        }
    }

    fun retry(vertical: Vertical) {
        _states.value = _states.value - vertical
        load(vertical)
    }

    /**
     * The story behind a urlHash: the one already folded into a loaded feed
     * when there is one, otherwise fetched from /api/article. The cache hit is
     * the normal path (the reader tapped a row that is on screen); the fetch is
     * the cold-start path a deep link or a process restart takes.
     */
    suspend fun story(urlHash: String): Story? {
        val loaded = _states.value.values
            .filterIsInstance<LoadState.Loaded>()
            .flatMap { it.days }
            .flatMap { it.stories }
            .firstOrNull { it.lead.urlHash == urlHash }
        if (loaded != null) return loaded
        return runCatching { client.fetchStory(urlHash) }.getOrNull()
    }

    /** Sections with a request in flight, so a recomposition cannot start a
     *  second fetch for one already running. */
    private val loading = mutableSetOf<Vertical>()

    private fun put(vertical: Vertical, state: LoadState) {
        _states.value = _states.value + (vertical to state)
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
