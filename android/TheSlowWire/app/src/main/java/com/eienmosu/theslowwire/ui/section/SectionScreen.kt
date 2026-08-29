package com.eienmosu.theslowwire.ui.section

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.pulltorefresh.PullToRefreshDefaults
import androidx.compose.material3.pulltorefresh.rememberPullToRefreshState
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.compose.ui.text.input.TextFieldValue
import com.eienmosu.theslowwire.model.FilterDef
import com.eienmosu.theslowwire.model.Vertical
import com.eienmosu.theslowwire.ui.Apparatus
import com.eienmosu.theslowwire.ui.GoldRule
import com.eienmosu.theslowwire.ui.ThemeToggle
import com.eienmosu.theslowwire.ui.theme.Palette
import com.eienmosu.theslowwire.ui.theme.current
import com.eienmosu.theslowwire.ui.theme.display
import com.eienmosu.theslowwire.ui.theme.leadTag
import com.eienmosu.theslowwire.ui.theme.prose

/**
 * A section's screen: the masthead, then the day sheets.
 *
 * `LazyColumn` is the list that only composes what is on screen — SwiftUI's
 * `List`/`LazyVStack`, RecyclerView's replacement. Everything above the first
 * day scrolls with the days rather than sitting in a fixed header, exactly as
 * the site's masthead does.
 */
@Composable
fun SectionScreen(
    vertical: Vertical,
    onSelect: (Vertical) -> Unit,
    isDark: Boolean,
    onToggleTheme: () -> Unit,
    modifier: Modifier = Modifier,
    viewModel: FeedViewModel = viewModel(),
    onOpenStory: (String) -> Unit = {},
) {
    val palette = Palette.current
    // collectAsStateWithLifecycle stops collecting while the app is in the
    // background — the lifecycle-aware read, and the reason the plain
    // collectAsState() is a lint warning on Android.
    val states by viewModel.states.collectAsStateWithLifecycle()
    val refreshing by viewModel.refreshing.collectAsStateWithLifecycle()
    val state = states[vertical] ?: LoadState.Loading

    // Per-department narrowing: switching to Design must not carry AI's chip
    // or search text with it, and coming back must not have lost them. Keyed
    // by vertical, saved across rotation.
    var activeChipId by rememberSaveable(vertical) { mutableStateOf<String?>(null) }
    var query by rememberSaveable(vertical, stateSaver = TextFieldValue.Saver) {
        mutableStateOf(TextFieldValue(""))
    }

    LaunchedEffect(vertical) { viewModel.load(vertical) }

    Column(
        modifier
            .fillMaxSize()
            .background(palette.ground)
    ) {
        // weight(1f) hands the list every pixel the departments bar does not
        // take — Compose's way of saying "fill the rest", and the reason the
        // bar never scrolls away with the days.
        Box(Modifier.weight(1f)) {
            when (val current = state) {
                is LoadState.Loading -> CenteredNote("Reading the wire")
                is LoadState.Failed -> FailureNote(
                    message = current.message,
                    onRetry = { viewModel.retry(vertical) },
                )
                is LoadState.Loaded -> {
                    val chips = FilterDef.chips(vertical)
                    val active = chips.firstOrNull { it.id == activeChipId }
                    val free = FilterDef.freeText(query.text)
                    val filters = listOfNotNull(active, free)

                    // Narrowing happens here, over the days already in hand —
                    // the same "these days, not the archive" contract the web's
                    // field states in its placeholder. remember(...) keeps the
                    // work off every unrelated recomposition.
                    val narrowed = remember(current.days, activeChipId, query.text) {
                        narrow(current.days, filters)
                    }
                    val counts = remember(current.days) { counts(current.days, chips) }

                    DayList(
                        days = narrowed,
                        onOpenStory = onOpenStory,
                        isDark = isDark,
                        onToggleTheme = onToggleTheme,
                        isRefreshing = vertical in refreshing,
                        onRefresh = { viewModel.refresh(vertical) },
                        header = {
                            FilterZone(
                                chips = chips,
                                counts = counts,
                                activeChipId = activeChipId,
                                onChipToggle = { id ->
                                    activeChipId = if (activeChipId == id) null else id
                                },
                                query = query,
                                onQueryChange = { query = it },
                            )
                        },
                        emptyNote = if (narrowed.isEmpty() && filters.isNotEmpty()) {
                            "No matches in these days."
                        } else {
                            null
                        },
                    )
                }
            }
        }
        SectionSwitch(current = vertical, onSelect = onSelect)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DayList(
    days: List<DaySheet>,
    onOpenStory: (String) -> Unit,
    isDark: Boolean,
    onToggleTheme: () -> Unit,
    isRefreshing: Boolean,
    onRefresh: () -> Unit,
    header: @Composable () -> Unit = {},
    emptyNote: String? = null,
    mastheadDays: List<DaySheet> = days,
) {
    // Pull to refresh: the one gesture every Android reader already knows, and
    // the app's only way to ask for a newer day short of killing it.
    //
    // The state is created HERE and handed to both the box and its indicator.
    // Calling rememberPullToRefreshState() inside the indicator lambda instead
    // creates a SECOND, unrelated state: the refresh still fires but the
    // indicator never follows the drag, which is exactly how it first shipped
    // and exactly what the on-device check caught.
    val pullState = rememberPullToRefreshState()
    PullToRefreshBox(
        isRefreshing = isRefreshing,
        onRefresh = onRefresh,
        state = pullState,
        indicator = {
            PullToRefreshDefaults.Indicator(
                state = pullState,
                isRefreshing = isRefreshing,
                modifier = Modifier.align(Alignment.TopCenter),
                containerColor = Palette.current.ground,
                color = Palette.current.gold,
            )
        },
    ) {
    LazyColumn(
        contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = 8.dp, bottom = 40.dp)
    ) {
        item { Masthead(mastheadDays, isDark, onToggleTheme) }
        item {
            header()
            Spacer(Modifier.height(20.dp))
        }
        if (emptyNote != null) {
            item {
                Text(
                    text = emptyNote,
                    style = prose(15),
                    color = Palette.current.muted,
                    modifier = Modifier.padding(vertical = 24.dp),
                )
            }
        }
        days.forEach { sheet ->
            item { DayHeader(sheet) }
            // `items` with a stable key lets Compose reuse rows across
            // recompositions instead of rebuilding the list — the same reason
            // SwiftUI's ForEach wants Identifiable.
            items(sheet.stories, key = { it.id }) { story ->
                val isLead = story === sheet.stories.first()
                if (!isLead) Hairline()
                ArticleRow(
                    story = story,
                    isLead = isLead,
                    modifier = Modifier.clickable { onOpenStory(story.lead.urlHash) },
                )
            }
        }
        }
    }
}

/** The journal's opening: the claim, the wordmark, and the newest day's line. */
@Composable
private fun Masthead(days: List<DaySheet>, isDark: Boolean, onToggleTheme: () -> Unit) {
    val palette = Palette.current
    val newest = days.firstOrNull()

    Column(
        Modifier
            .fillMaxWidth()
            .padding(bottom = 20.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        // The util row: the product's claim on the left, the theme control on
        // the right, exactly where the site puts it.
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Apparatus("Ranked by importance", size = 10, modifier = Modifier.weight(1f))
            ThemeToggle(isDark = isDark, onToggle = onToggleTheme)
        }
        Text(
            text = "The Slow Wire",
            style = display(34, FontWeight.ExtraBold),
            color = palette.ink,
            textAlign = TextAlign.Center,
        )
        newest?.day?.let { day ->
            Apparatus("${formatDay(day)} · ${newest.totalInDay} stories", size = 10)
        }
    }
}

/** A day opens on its date and its count, under the gold double-rule. */
@Composable
private fun DayHeader(sheet: DaySheet) {
    val palette = Palette.current
    val shown = sheet.stories.size
    val count = if (shown == sheet.totalInDay) {
        "$shown ${if (shown == 1) "story" else "stories"}"
    } else {
        "$shown of ${sheet.totalInDay} stories"
    }

    Column(Modifier.padding(top = 8.dp)) {
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.Bottom,
        ) {
            Text(
                text = sheet.day?.let(::formatDay) ?: "",
                style = display(22, FontWeight.Bold),
                color = palette.ink,
            )
            Apparatus(count, size = 11)
        }
        GoldRule(Modifier.padding(top = 10.dp))
        Text(
            text = "THE LEAD",
            style = leadTag(),
            color = palette.gold,
            modifier = Modifier.padding(top = 10.dp),
        )
    }
}

@Composable
private fun Hairline() {
    Box(
        Modifier
            .fillMaxWidth()
            .height(1.dp)
            .background(Palette.current.hairSoft)
    )
}

/** A failure states what happened AND offers the way out. The retry is the
 *  pressed grammar, ink on ground: the one thing on this screen to do. */
@Composable
private fun FailureNote(message: String, onRetry: () -> Unit) {
    val palette = Palette.current
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier.padding(horizontal = 40.dp),
        ) {
            Text(
                text = message,
                style = prose(15),
                color = palette.muted,
                textAlign = TextAlign.Center,
            )
            Spacer(Modifier.height(16.dp))
            Apparatus(
                "Try again",
                size = 11,
                medium = true,
                color = palette.ground,
                modifier = Modifier
                    .clip(RoundedCornerShape(4.dp))
                    .background(palette.ink)
                    .clickable(onClick = onRetry)
                    .padding(horizontal = 18.dp, vertical = 12.dp),
            )
        }
    }
}

/** The wait is a quiet line on the page, never a spinner over a blank screen. */
@Composable
private fun CenteredNote(text: String) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Text(
            text = text,
            style = prose(15),
            color = Palette.current.muted,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(horizontal = 40.dp),
        )
    }
}

/** Applies every active filter to every day, dropping days left with nothing —
 *  the app hides an empty sheet rather than showing an empty frame, matching
 *  the web's live search. `totalInDay` is untouched, so a narrowed sheet still
 *  says K of N honestly. */
private fun narrow(days: List<DaySheet>, filters: List<FilterDef>): List<DaySheet> {
    if (filters.isEmpty()) return days
    return days.mapNotNull { sheet ->
        val kept = sheet.stories
            .filter { story -> filters.all { it.matches(story.lead) } }
            // Visible position, renumbered after narrowing (owner, 2026-08-28):
            // 1, 2, 3, never a gap where a filtered-out story used to be.
            .mapIndexed { index, story -> story.copy(rank = index + 1) }
        if (kept.isEmpty()) null else sheet.copy(stories = kept)
    }
}

/** How many of the rendered stories each chip narrows to — the chip names its
 *  own effect before it is pressed. */
private fun counts(days: List<DaySheet>, chips: List<FilterDef>): Map<String, Int> {
    val leads = days.flatMap { it.stories }.map { it.lead }
    return chips.associate { chip -> chip.id to leads.count(chip::matches) }
}

/** "2026-08-30" reads as "30.08.2026" everywhere in this product. */
private fun formatDay(day: String): String {
    val parts = day.split("-")
    return if (parts.size == 3) "${parts[2]}.${parts[1]}.${parts[0]}" else day
}
