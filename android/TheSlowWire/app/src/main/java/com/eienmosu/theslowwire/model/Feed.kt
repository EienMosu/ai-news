package com.eienmosu.theslowwire.model

import kotlinx.serialization.Serializable

// Mirrors the site's JSON contract: FeedArticle from src/lib/feed/shape.ts,
// FeedResult from src/lib/feed/read.ts, the envelope from app/api/feed/route.ts.
// Contract rule (v1): fields may be added upstream, never renamed — which is
// why the client decodes with ignoreUnknownKeys and every optional field here
// is nullable rather than defaulted to a value the server never sent.
//
// @Serializable is Codable's counterpart: the compiler plugin writes the
// parser at build time from the property names, so a typo is a build error,
// not a runtime surprise. Same trade as Swift's synthesised init(from:).

@Serializable
data class FeedArticle(
    val urlHash: String,
    val url: String,
    val title: String,
    val summary: String,
    val imageUrl: String? = null,
    val source: String,
    val sourceName: String,
    val category: String? = null,
    val section: String? = null,
    /** ISO 8601, usually with fractional seconds ("2026-08-21T10:05:46.000Z"). */
    val publishedAt: String? = null,
    val clusterId: String? = null,
    val corroborationToday: Int? = null,
    val whyItMatters: String? = null,
    val score: Double,
    val scoreVersion: String,
    val points: Int? = null,
    val pointsImputed: Boolean,
    val llmImportance: Int? = null,
    val firstSeenAt: String,
)

/** True exactly when the model never scored this article and capture's degraded
 *  score stood in — the same rule as the site's isUnranked (shape.ts). The feed
 *  says so out loud rather than letting a guessed rank pass as a measured one. */
val FeedArticle.isUnranked: Boolean
    get() = scoreVersion == "v1-degraded"

@Serializable
data class FeedResult(
    val articles: List<FeedArticle>,
    val day: String? = null,
    /** "complete" | "partial" upstream; kept as a raw string so a new status
     *  added by the site degrades gracefully instead of failing the decode. */
    val status: String? = null,
    val llmRankedInDay: Int? = null,
    val truncatedInDay: Int? = null,
)

@Serializable
data class FeedResponse(
    val section: String,
    val days: Int,
    val failedDays: Int,
    val results: List<FeedResult>,
)

@Serializable
data class ArticleResponse(
    val article: FeedArticle,
    val siblings: List<FeedArticle> = emptyList(),
)
