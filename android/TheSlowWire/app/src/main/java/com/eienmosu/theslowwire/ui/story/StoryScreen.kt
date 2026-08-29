package com.eienmosu.theslowwire.ui.story

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import android.content.Intent
import androidx.core.net.toUri
import coil.compose.AsyncImage
import com.eienmosu.theslowwire.data.FeedClient
import com.eienmosu.theslowwire.model.FeedArticle
import com.eienmosu.theslowwire.model.Story
import com.eienmosu.theslowwire.ui.Apparatus
import com.eienmosu.theslowwire.ui.GoldRule
import com.eienmosu.theslowwire.ui.section.FeedViewModel
import com.eienmosu.theslowwire.ui.theme.Palette
import com.eienmosu.theslowwire.ui.theme.current
import com.eienmosu.theslowwire.ui.theme.display
import com.eienmosu.theslowwire.ui.theme.prose

/**
 * The reading room: the document opens under the gold double-rule on the page
 * ground; the why-line (the one sentence the product wrote itself) leads, and
 * the outbound link closes the page in the pressed grammar — ink fill, ground
 * text. Same anatomy as ArticleView.swift and the web's story page.
 *
 * `produceState` runs a suspending lookup and exposes its result as state —
 * SwiftUI's `.task { }` writing into `@State`, in one expression.
 */
@Composable
fun StoryScreen(
    urlHash: String,
    onBack: () -> Unit,
    feedViewModel: FeedViewModel,
    modifier: Modifier = Modifier,
) {
    val palette = Palette.current
    val story by produceState<Story?>(initialValue = null, urlHash) {
        value = feedViewModel.story(urlHash)
    }

    Box(
        modifier
            .fillMaxSize()
            .background(palette.ground)
    ) {
        val current = story
        if (current == null) {
            // One line, not a spinner: the wait and a story that could not be
            // found look different to the reader on purpose.
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text("Opening the story", style = prose(15), color = palette.muted)
            }
            TopBar(onBack = onBack, story = null)
        } else {
            Document(current)
            TopBar(onBack = onBack, story = current)
        }
    }
}

/** Back and share, floating over the page rather than in a bar of their own —
 *  the design has no chrome, so the controls sit on the ground itself. Both are
 *  set in type rather than drawn as Material icons: this product's vocabulary
 *  is words and rules, and a borrowed icon set would be the one Material thing
 *  on the page. A word also needs no contentDescription: it already reads as
 *  itself to a screen reader. */
@Composable
private fun TopBar(onBack: () -> Unit, story: Story?) {
    val palette = Palette.current
    val context = LocalContext.current

    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        // A word, not a glyph: Playfair carries no arrow, so U+2190 fell back
        // to whatever font the system had and rendered as a stray mark. The
        // apparatus voice says it plainly and pairs with SHARE opposite it.
        Apparatus(
            "Back",
            size = 11,
            medium = true,
            color = palette.ink,
            modifier = Modifier
                .clip(RoundedCornerShape(50))
                .clickable(onClick = onBack)
                .padding(horizontal = 12.dp, vertical = 10.dp),
        )
        if (story != null) {
            Apparatus(
                "Share",
                size = 11,
                medium = true,
                color = palette.ink,
                modifier = Modifier
                    .clip(RoundedCornerShape(50))
                    .clickable {
                        // Shares the WEB address, openable by anyone — the same
                        // choice the iOS ShareLink makes.
                        val section = story.lead.section
                        val path = if (section != null) {
                            "article/$section/${story.lead.urlHash}"
                        } else {
                            "article/${story.lead.urlHash}"
                        }
                        val send = Intent(Intent.ACTION_SEND).apply {
                            type = "text/plain"
                            putExtra(Intent.EXTRA_TEXT, "${FeedClient.BASE_URL}/$path")
                        }
                        context.startActivity(Intent.createChooser(send, null))
                    }
                    .padding(horizontal = 12.dp, vertical = 10.dp),
            )
        }
    }
}

@Composable
private fun Document(story: Story) {
    val palette = Palette.current
    val article = story.lead
    val context = LocalContext.current

    LazyColumn(
        contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = 56.dp, bottom = 48.dp)
    ) {
        item {
            GoldRule()
            Spacer(Modifier.height(14.dp))
            Apparatus(metaLine(story), size = 10)
            Spacer(Modifier.height(12.dp))
            Text(article.title, style = display(27, FontWeight.ExtraBold), color = palette.ink)
        }

        article.imageUrl?.takeIf { it.isNotBlank() }?.let { url ->
            item {
                Spacer(Modifier.height(16.dp))
                AsyncImage(
                    model = url,
                    contentDescription = null,
                    contentScale = ContentScale.FillWidth,
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(4.dp)),
                )
            }
        }

        article.whyItMatters?.takeIf { it.isNotBlank() }?.let { why ->
            item {
                Spacer(Modifier.height(16.dp))
                // IntrinsicSize.Min measures the row's tallest child first,
                // so the gold bar can fillMaxHeight to exactly the text it
                // marks — Compose's answer to "as tall as my sibling".
                Row(Modifier.height(IntrinsicSize.Min)) {
                    Box(
                        Modifier
                            .width(2.dp)
                            .fillMaxHeight()
                            .background(palette.goldSoft)
                    )
                    Spacer(Modifier.width(12.dp))
                    Text(why, style = prose(16, FontWeight.SemiBold), color = palette.ink)
                }
            }
        }

        if (article.summary.isNotBlank()) {
            item {
                Spacer(Modifier.height(16.dp))
                Text(article.summary, style = prose(16), color = palette.inkSoft)
            }
        }

        item {
            Spacer(Modifier.height(24.dp))
            // Contract: url is "" when the stored value was not a safe http(s)
            // URL — the site shows an unlinked notice, so this does too.
            if (article.url.isNotBlank()) {
                Row(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(4.dp))
                        .background(palette.ink)
                        .clickable {
                            context.startActivity(Intent(Intent.ACTION_VIEW, article.url.toUri()))
                        }
                        .padding(horizontal = 16.dp, vertical = 14.dp),
                    horizontalArrangement = Arrangement.Center,
                ) {
                    Apparatus(
                        "Read at ${article.sourceName}",
                        size = 12,
                        medium = true,
                        color = palette.ground,
                    )
                }
            } else {
                Apparatus("No outbound link", size = 10)
            }
        }

        if (story.others.isNotEmpty()) {
            item {
                Spacer(Modifier.height(28.dp))
                Apparatus("Also covered by", size = 10, medium = true)
                Spacer(Modifier.height(10.dp))
            }
            items(story.others, key = { it.urlHash }) { sibling ->
                SiblingRow(sibling)
                Spacer(Modifier.height(8.dp))
            }
        }
    }
}

@Composable
private fun SiblingRow(sibling: FeedArticle) {
    val palette = Palette.current
    val context = LocalContext.current
    val meta = sibling.points?.let { "${sibling.sourceName} · $it points" } ?: sibling.sourceName

    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(4.dp))
            .border(1.dp, palette.hairMid, RoundedCornerShape(4.dp))
            .let { base ->
                if (sibling.url.isBlank()) base else base.clickable {
                    context.startActivity(Intent(Intent.ACTION_VIEW, sibling.url.toUri()))
                }
            }
            .padding(10.dp)
    ) {
        Apparatus(meta, size = 10, medium = true, color = palette.gold)
        Spacer(Modifier.height(3.dp))
        Text(
            sibling.title,
            style = prose(13),
            color = palette.inkSoft,
            textAlign = TextAlign.Start,
        )
    }
}

private fun metaLine(story: Story): String {
    val article = story.lead
    val parts = mutableListOf(article.sourceName)
    article.points?.let { parts.add("$it points") }
    article.corroborationToday?.takeIf { it > 1 }?.let { parts.add("$it sources today") }
    return parts.joinToString(" · ")
}
