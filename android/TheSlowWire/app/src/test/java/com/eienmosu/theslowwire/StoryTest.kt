package com.eienmosu.theslowwire

import com.eienmosu.theslowwire.model.FeedArticle
import com.eienmosu.theslowwire.model.FeedResult
import com.eienmosu.theslowwire.model.Story
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

// The clustering rules the whole app leans on, pinned here because they are
// pure functions over data — no emulator, no Compose, just JVM. Same contract
// the iOS app's Story.group/groupDays implements and the site's dedupe.ts owns.
class StoryTest {

    private fun article(
        hash: String,
        clusterId: String? = null,
        title: String = "T",
    ) = FeedArticle(
        urlHash = hash,
        url = "https://e.com/$hash",
        title = title,
        summary = "s",
        source = "hn",
        sourceName = "Hacker News",
        score = 1.0,
        scoreVersion = "v1",
        pointsImputed = false,
        firstSeenAt = "2026-08-30T10:00:00.000Z",
        clusterId = clusterId,
    )

    @Test
    fun `key strips the day namespace so the same story matches across days`() {
        assertEquals("lfm", Story.key(article("a", "2026-08-21#lfm")))
        assertEquals("lfm", Story.key(article("b", "2026-08-20#lfm")))
    }

    @Test
    fun `key falls back to the urlHash when the cluster is missing`() {
        // A degraded day ships a null clusterId for every article; folding on a
        // shared null would collapse the entire day into one story.
        assertEquals("a", Story.key(article("a", null)))
        assertEquals("b", Story.key(article("b", null)))
    }

    @Test
    fun `group folds cluster siblings under the first-seen lead`() {
        val stories = Story.group(
            listOf(
                article("a", "d#x", "Lead"),
                article("b", "d#x", "Same event, second source"),
                article("c", "d#y", "Another story"),
            )
        )
        assertEquals(2, stories.size)
        assertEquals("Lead", stories[0].lead.title)
        assertEquals(1, stories[0].otherSources)
        assertEquals("Another story", stories[1].lead.title)
    }

    @Test
    fun `groupDays hides a story already told on a newer day`() {
        val days = Story.groupDays(
            listOf(
                FeedResult(articles = listOf(article("a", "2026-08-30#x"))),
                FeedResult(
                    articles = listOf(
                        article("b", "2026-08-29#x"), // the same story, a day older
                        article("c", "2026-08-29#y"),
                    )
                ),
            )
        )
        assertEquals(1, days[0].size)
        assertEquals(1, days[1].size)
        assertEquals("c", days[1][0].lead.urlHash)
    }

    @Test
    fun `ranks count visible position, never leaving gaps after a fold`() {
        // Owner's call, 2026-08-28: the repeat folded out of day two must not
        // leave its number behind — the survivor is 1, not 2.
        val days = Story.groupDays(
            listOf(
                FeedResult(articles = listOf(article("a", "2026-08-30#x"))),
                FeedResult(
                    articles = listOf(
                        article("b", "2026-08-29#x"),
                        article("c", "2026-08-29#y"),
                        article("d", "2026-08-29#z"),
                    )
                ),
            )
        )
        assertEquals(listOf(1, 2), days[1].map { it.rank })
    }

    @Test
    fun `decoding tolerates unknown fields the site may add later`() {
        // Contract rule v1: fields may be added upstream, never renamed. A new
        // field must not break an installed app that cannot be updated.
        val json = Json { ignoreUnknownKeys = true }
        val decoded = json.decodeFromString<FeedArticle>(
            """
            {"urlHash":"a","url":"https://e.com/a","title":"T","summary":"s",
             "source":"hn","sourceName":"Hacker News","score":1.0,
             "scoreVersion":"v1","pointsImputed":false,
             "firstSeenAt":"2026-08-30T10:00:00.000Z",
             "somethingAddedNextYear":42}
            """
        )
        assertEquals("a", decoded.urlHash)
        assertTrue(decoded.imageUrl == null)
    }
}
