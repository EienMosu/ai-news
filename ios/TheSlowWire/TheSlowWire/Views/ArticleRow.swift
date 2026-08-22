import SwiftUI

// One entry on a day sheet. Every entry keeps one type size (rank must read
// as position, never as scale); the day's lead leaves the paper instead —
// the inversion grammar from DESIGN.md.
struct ArticleRow: View {
    let story: Story
    let number: Int
    let vertical: Vertical

    private var isLead: Bool { number == 1 }
    private var article: FeedArticle { story.lead }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Apparatus(String(format: "%02d", number), size: 12, medium: true)
                .foregroundStyle(isLead ? vertical.onField.opacity(0.8) : Color.ink.opacity(0.45))
                .padding(.top, 4)

            VStack(alignment: .leading, spacing: 6) {
                Text(article.title)
                    .font(.display(16))
                    .foregroundStyle(isLead ? vertical.onField : Color.ink)
                    .fixedSize(horizontal: false, vertical: true)

                if let why = article.whyItMatters, !why.isEmpty {
                    Text(why)
                        .font(.prose(13.5))
                        .foregroundStyle((isLead ? vertical.onField : Color.ink).opacity(0.75))
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Apparatus(metaLine, size: 10.5)
                    .foregroundStyle(isLead ? vertical.onField.opacity(0.75) : vertical.color)
            }

            Spacer(minLength: 0)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 13)
        .background(isLead ? vertical.color : .clear)
        .contentShape(Rectangle())
    }

    private var metaLine: String {
        var parts = [article.sourceName]
        if let points = article.points { parts.append("\(points) pts") }
        if story.otherSources > 0 { parts.append("+\(story.otherSources) more") }
        return parts.joined(separator: " · ")
    }
}

#Preview {
    let lead = FeedArticle(
        urlHash: "abc", url: "https://example.com",
        title: "The day's lead story leaves the paper entirely",
        summary: "", imageUrl: nil, source: "hn", sourceName: "Hacker News",
        category: "community", section: "ai", publishedAt: nil,
        clusterId: "2026-08-22#lead", corroborationToday: 3,
        whyItMatters: "One sentence on why this story matters today.",
        score: 90, scoreVersion: "v1", points: 703, pointsImputed: false,
        llmImportance: 70, firstSeenAt: "2026-08-22T12:00:00.000Z"
    )
    let second = FeedArticle(
        urlHash: "def", url: "https://example.com",
        title: "An ordinary entry stays on the paper at the same size",
        summary: "", imageUrl: nil, source: "hn", sourceName: "Hacker News",
        category: "community", section: "ai", publishedAt: nil,
        clusterId: "2026-08-22#second", corroborationToday: nil,
        whyItMatters: "Position, not scale, is the rank.",
        score: 60, scoreVersion: "v1", points: 240, pointsImputed: false,
        llmImportance: 55, firstSeenAt: "2026-08-22T12:00:00.000Z"
    )
    return VStack(spacing: 0) {
        ArticleRow(story: Story(lead: lead, others: [second], rank: 1), number: 1, vertical: .ai)
        ArticleRow(story: Story(lead: second, others: [], rank: 2), number: 2, vertical: .ai)
    }
    .background(Color.paper)
    .padding()
    .background(Color.worldAI)
}
