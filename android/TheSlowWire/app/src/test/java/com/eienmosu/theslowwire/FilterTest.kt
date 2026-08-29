package com.eienmosu.theslowwire

import com.eienmosu.theslowwire.model.FeedArticle
import com.eienmosu.theslowwire.model.FilterDef
import com.eienmosu.theslowwire.model.Vertical
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

// The narrowing rules, pinned to the same behaviour as src/lib/feed/filter.ts
// and the iOS FilterDef — all three surfaces must narrow to the same set.
class FilterTest {

    private fun article(
        title: String = "T",
        summary: String = "s",
        sourceName: String = "Hacker News",
    ) = FeedArticle(
        urlHash = "a",
        url = "https://e.com/a",
        title = title,
        summary = summary,
        source = "hn",
        sourceName = sourceName,
        score = 1.0,
        scoreVersion = "v1",
        pointsImputed = false,
        firstSeenAt = "2026-08-30T10:00:00.000Z",
    )

    private fun chip(vertical: Vertical, id: String) =
        FilterDef.chips(vertical).first { it.id == id }

    @Test
    fun `every section carries exactly its five named chips`() {
        for (vertical in Vertical.entries) {
            assertEquals(5, FilterDef.chips(vertical).size)
        }
    }

    @Test
    fun `a substring synonym matches anywhere, case-insensitively`() {
        val anthropic = chip(Vertical.AI, "anthropic")
        assertTrue(anthropic.matches(article(title = "ANTHROPIC ships a model")))
        assertTrue(anthropic.matches(article(summary = "built on claude")))
    }

    @Test
    fun `a word synonym refuses to match inside a longer word`() {
        // The whole reason \b exists in the site's spec: "meta" must not fire
        // on "metadata", and "aws" must not fire on "awsome".
        val meta = chip(Vertical.AI, "meta")
        assertFalse(meta.matches(article(title = "New metadata format")))
        assertTrue(meta.matches(article(title = "Meta releases something")))

        val aws = chip(Vertical.CLOUD, "aws")
        assertFalse(aws.matches(article(title = "An awsome launch")))
        assertTrue(aws.matches(article(title = "AWS adds a region")))
    }

    @Test
    fun `the source name is part of the haystack, like the site's`() {
        val figma = chip(Vertical.DESIGN, "figma")
        assertTrue(figma.matches(article(title = "A post", sourceName = "Figma Blog")))
    }

    @Test
    fun `gpt keeps its hyphen so it cannot match inside an unrelated word`() {
        val openai = chip(Vertical.AI, "openai")
        assertFalse(openai.matches(article(title = "Introducing widgetgpt")))
        assertTrue(openai.matches(article(title = "The gpt-5 release")))
    }

    @Test
    fun `free text is a filter, and blank input is no filter at all`() {
        assertNull(FilterDef.freeText("   "))
        val nvidia = FilterDef.freeText("  Nvidia ")
        assertTrue(nvidia!!.matches(article(title = "nvidia buys a company")))
        // The label keeps what the reader typed, trimmed, in their own case.
        assertEquals("Nvidia", nvidia.label)
    }
}
