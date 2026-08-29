package com.eienmosu.theslowwire.ui.section

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import com.eienmosu.theslowwire.model.Story
import com.eienmosu.theslowwire.ui.theme.Palette
import com.eienmosu.theslowwire.ui.theme.apparatus
import com.eienmosu.theslowwire.ui.theme.current
import com.eienmosu.theslowwire.ui.theme.display
import com.eienmosu.theslowwire.ui.theme.folio
import com.eienmosu.theslowwire.ui.theme.prose

/**
 * One entry in the day's journal — not a card, a row on the page: the folio
 * numeral, the headline, the product's own why-line, and one apparatus meta
 * line. The scraped summary and the thumbnail deliberately stay out of the
 * feed rows (they live in the reading room), matching the web and iOS exactly.
 *
 * The lead is announced by ground, never by scale: its numeral is full gold
 * where the others are soft, and every headline keeps one type size.
 */
@Composable
fun ArticleRow(
    story: Story,
    isLead: Boolean,
    modifier: Modifier = Modifier,
) {
    val palette = Palette.current
    val article = story.lead

    Row(modifier.padding(vertical = 16.dp)) {
        Text(
            text = story.rank.toString(),
            style = folio(if (isLead) 38 else 24),
            color = if (isLead) palette.gold else palette.goldSoft,
            textAlign = TextAlign.End,
            modifier = Modifier.width(44.dp),
        )
        Spacer(Modifier.width(14.dp))
        Column(Modifier.fillMaxWidth()) {
            Text(
                text = article.title,
                style = display(17, FontWeight.Bold),
                color = palette.ink,
            )
            article.whyItMatters?.takeIf { it.isNotBlank() }?.let { why ->
                Spacer(Modifier.height(6.dp))
                Text(text = why, style = prose(14), color = palette.inkSoft)
            }
            Spacer(Modifier.height(8.dp))
            MetaLine(story)
        }
    }
}

/**
 * source · N points · +K more. The source name is the bold part wherever it
 * sits, never "whichever part comes first" — a positional rule that was a real
 * bug on the web until an agent caught it.
 */
@Composable
private fun MetaLine(story: Story) {
    val palette = Palette.current
    val article = story.lead

    val text = buildAnnotatedString {
        withStyle(SpanStyle(color = palette.ink, fontWeight = FontWeight.Medium)) {
            append(article.sourceName.uppercase())
        }
        article.points?.let { append(" · ${it} POINTS") }
        if (story.otherSources > 0) append(" · +${story.otherSources} MORE")
    }
    Text(text = text, style = apparatus(11), color = palette.muted)
}
