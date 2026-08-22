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

extension FeedArticle {
    // publishedAt arrives as ISO 8601, usually with fractional seconds
    // ("2026-08-21T10:05:46.000Z") but not guaranteed — try both shapes.
    var publishedDate: Date? {
        guard let publishedAt else { return nil }
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = withFraction.date(from: publishedAt) { return date }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: publishedAt)
    }
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
