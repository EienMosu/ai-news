import SwiftUI

struct ArticleRow: View {
    let article: FeedArticle
    let accent: Color
    var otherSources: Int = 0

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(article.title)
                .font(.headline)
                .foregroundStyle(Color.ink)

            if let why = article.whyItMatters, !why.isEmpty {
                Text(why)
                    .font(.subheadline)
                    .foregroundStyle(Color.ink.opacity(0.7))
                    .lineLimit(2)
            }

            HStack(spacing: 6) {
                Text(article.sourceName)
                if let points = article.points {
                    Text("·")
                    Text("\(points) points")
                }
                if otherSources > 0 {
                    Text("·")
                    Text("+\(otherSources) more")
                }
            }
            .font(.caption)
            .foregroundStyle(accent)
        }
        .padding(.vertical, 2)
    }
}

#Preview {
    List {
        ArticleRow(
            article: FeedArticle(
                urlHash: "abc",
                url: "https://example.com",
                title: "A sample story title that wraps to a second line",
                summary: "",
                imageUrl: nil,
                source: "hn",
                sourceName: "Hacker News",
                category: "community",
                section: "ai",
                publishedAt: nil,
                clusterId: nil,
                corroborationToday: 3,
                whyItMatters: "One sentence on why this story matters today.",
                score: 42,
                scoreVersion: "v1",
                points: 703,
                pointsImputed: false,
                llmImportance: 70,
                firstSeenAt: "2026-08-21T12:00:00.000Z"
            ),
            accent: .worldAI
        )
    }
}
