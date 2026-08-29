package com.eienmosu.theslowwire.data

import com.eienmosu.theslowwire.model.ArticleResponse
import com.eienmosu.theslowwire.model.FeedResponse
import com.eienmosu.theslowwire.model.Story
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.engine.okhttp.OkHttp
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.request.get
import io.ktor.client.request.parameter
import io.ktor.serialization.kotlinx.json.json
import kotlinx.serialization.json.Json

/**
 * The site's read API, the same two endpoints the iOS app calls.
 *
 * `suspend` is Kotlin's async/await: a suspend function can pause without
 * blocking its thread, and calling one requires being inside a coroutine, so
 * the compiler makes "this does IO" impossible to forget. Where Swift writes
 * `try await client.fetchFeed(...)`, Kotlin writes `client.fetchFeed(...)`
 * inside a coroutine and lets exceptions travel as exceptions.
 *
 * Ktor is the HTTP client (URLSession's counterpart) and does the JSON decode
 * inline through ContentNegotiation, so no call site touches a parser.
 */
class FeedClient(private val http: HttpClient = defaultClient()) {

    suspend fun fetchFeed(section: String, days: Int = 5): FeedResponse =
        http.get("$BASE_URL/api/feed") {
            parameter("section", section)
            parameter("days", days)
        }.body()

    /**
     * GET /api/article/<urlHash>: the article plus its cluster siblings,
     * composed server-side exactly like the web story page. This is the
     * cold-start path for deep links, where no feed is in hand yet.
     */
    suspend fun fetchStory(urlHash: String): Story {
        val response: ArticleResponse = http.get("$BASE_URL/api/article/$urlHash").body()
        return Story(lead = response.article, others = response.siblings, rank = 0)
    }

    companion object {
        const val BASE_URL = "https://ai-news-ten-bice.vercel.app"

        fun defaultClient() = HttpClient(OkHttp) {
            // A non-2xx status throws by default in Ktor 3, so the UI's
            // catch-all error state covers a 500 the same way it covers a
            // dropped connection — one failure path, not two.
            install(ContentNegotiation) {
                json(
                    Json {
                        // The contract's v1 rule: fields may be added upstream,
                        // never renamed. An installed app must survive the add.
                        ignoreUnknownKeys = true
                    }
                )
            }
        }
    }
}
