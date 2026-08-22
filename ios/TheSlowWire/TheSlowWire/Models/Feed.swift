import Foundation

// Mirrors the site's JSON contract: FeedArticle from src/lib/feed/shape.ts,
// FeedResult from src/lib/feed/read.ts, the envelope from app/api/feed/route.ts.
// Contract rule (v1): fields may be added upstream, never renamed.

struct FeedArticle: Codable, Identifiable, Hashable {
    let urlHash: String
    let url: String
    let title: String
    let summary: String
    let imageUrl: String?
    let source: String
    let sourceName: String
    let category: String?
    let section: String?
    let publishedAt: String?
    let clusterId: String?
    let corroborationToday: Int?
    let whyItMatters: String?
    let score: Double
    let scoreVersion: String
    let points: Int?
    let pointsImputed: Bool
    let llmImportance: Int?
    let firstSeenAt: String

    var id: String { urlHash }
}

struct FeedResult: Codable {
    let articles: [FeedArticle]
    let day: String?
    // "complete" | "partial" upstream; kept as a raw string so a new status
    // added by the site degrades gracefully instead of failing the decode.
    let status: String?
    let llmRankedInDay: Int?
    let truncatedInDay: Int?
}

struct FeedResponse: Codable {
    let section: String
    let days: Int
    let failedDays: Int
    let results: [FeedResult]
}
