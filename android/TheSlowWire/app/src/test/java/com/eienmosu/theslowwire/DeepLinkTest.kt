package com.eienmosu.theslowwire

import com.eienmosu.theslowwire.model.DeepLinkTarget
import com.eienmosu.theslowwire.model.Vertical
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Deep-link parsing, on the JVM.
 *
 * android.net.Uri cannot be constructed or subclassed off-device, which is why
 * the rule is a pure function over (scheme, host, segments) with the Uri
 * unwrapped at the edge — the split that makes these tests possible at all.
 * `link()` does the unwrapping a Uri would, so the strings under test are the
 * real ones a shared link carries.
 */
class DeepLinkTest {

    private fun link(raw: String): DeepLinkTarget? {
        val scheme = raw.substringBefore(":", "").ifEmpty { null }
        val rest = raw.substringAfter("://", "")
        val host = if (rest.isEmpty()) null else rest.substringBefore("/").ifEmpty { null }
        val segments =
            if (rest.isEmpty()) emptyList()
            else rest.substringAfter("/", "").split("/").filter { it.isNotEmpty() }
        return DeepLinkTarget.parse(scheme, host, segments)
    }

    @Test
    fun `app scheme with a section resolves to that department`() {
        assertEquals(
            DeepLinkTarget(Vertical.CLOUD, "abc123"),
            link("theslowwire://article/cloud/abc123"),
        )
    }

    @Test
    fun `web link opens the same story`() {
        assertEquals(
            DeepLinkTarget(Vertical.DESIGN, "def456"),
            link("https://ai-news-ten-bice.vercel.app/article/design/def456"),
        )
    }

    @Test
    fun `legacy sectionless link still opens, defaulting to AI`() {
        // The site redirects /article/<hash>; old shares carry it, and dropping
        // them on the floor would be worse than opening in the wrong department.
        assertEquals(
            DeepLinkTarget(Vertical.AI, "ghi789"),
            link("https://ai-news-ten-bice.vercel.app/article/ghi789"),
        )
    }

    @Test
    fun `an unknown section falls back to AI rather than failing`() {
        assertEquals(
            DeepLinkTarget(Vertical.AI, "hash"),
            link("theslowwire://article/quantum/hash"),
        )
    }

    @Test
    fun `links that are not stories are refused`() {
        assertNull(DeepLinkTarget.parse(null))
        assertNull(link(""))
        assertNull(link("theslowwire://settings/ai/hash"))
        assertNull(link("https://ai-news-ten-bice.vercel.app/design"))
        assertNull(link("mailto:someone@example.com"))
        // Too many segments is a route this app does not have.
        assertNull(link("theslowwire://article/ai/hash/extra"))
    }
}
