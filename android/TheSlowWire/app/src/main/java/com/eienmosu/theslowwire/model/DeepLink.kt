package com.eienmosu.theslowwire.model

import android.net.Uri

/**
 * Two doorways into a story, both resolving to the same target:
 *
 *   theslowwire://article/<section>/<hash>   the app scheme, iOS's twin
 *   https://<site>/article/<section>/<hash>  a shared link, opened in the app
 *
 * The legacy sectionless form (/article/<hash>) is accepted too, since the site
 * still redirects it and old shares carry it; an unknown section falls back to
 * AI rather than dropping the link on the floor.
 *
 * Parsing lives here, in plain Kotlin over a Uri, so it can be tested on the
 * JVM without an Activity — the thing that makes deep links so easy to get
 * subtly wrong and so rarely covered.
 */
data class DeepLinkTarget(val section: Vertical, val urlHash: String) {
    companion object {
        const val SCHEME = "theslowwire"
        const val HOST = "article"

        /** The Android edge: unwraps a Uri into the three plain values the
         *  parser actually reads. Kept this thin because android.net.Uri cannot
         *  be constructed or subclassed off-device, so anything living inside
         *  it could only be tested on an emulator. */
        fun parse(uri: Uri?): DeepLinkTarget? {
            if (uri == null) return null
            return parse(uri.scheme, uri.host, uri.pathSegments.orEmpty())
        }

        /** The rule itself, pure and JVM-testable. */
        fun parse(scheme: String?, host: String?, pathSegments: List<String>): DeepLinkTarget? {
            val segments = when {
                // Custom scheme: theslowwire://article/ai/<hash> puts "article"
                // in the authority, so the path holds only what follows it.
                scheme == SCHEME -> {
                    if (host != HOST) return null
                    pathSegments
                }
                // Web link: the whole route is in the path, "article" included.
                scheme == "https" || scheme == "http" -> {
                    if (pathSegments.firstOrNull() != HOST) return null
                    pathSegments.drop(1)
                }
                else -> return null
            }.filter { it.isNotBlank() }

            return when (segments.size) {
                2 -> DeepLinkTarget(Vertical.from(segments[0]), segments[1])
                // Legacy: no section in the link, so the app opens the story in
                // the department it turns out to belong to — AI until the fetch
                // says otherwise, which is what the site's redirect does too.
                1 -> DeepLinkTarget(Vertical.AI, segments[0])
                else -> null
            }
        }
    }
}
