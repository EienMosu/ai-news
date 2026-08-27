import SwiftUI

// One entry in the day's journal: folio numeral, headline, the product's own
// why-line, and one apparatus meta line. Every entry keeps one type size;
// rank shows as position and as the lead's full-gold numeral, never as scale.
struct ArticleRow: View {
    let story: Story
    let number: Int
    let isLead: Bool

    private var article: FeedArticle { story.lead }

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            Text("\(number)")
                .font(.displayItalicish(isLead ? 30 : 20))
                .italic()
                .foregroundStyle(isLead ? Color.gold : Color.goldSoft.opacity(0.55))
                .frame(width: 34, alignment: .trailing)
                .padding(.top, isLead ? 0 : 2)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 6) {
                Text(article.title)
                    .font(.display(17))
                    .foregroundStyle(Color.ink)
                    .fixedSize(horizontal: false, vertical: true)

                if let why = article.whyItMatters, !why.isEmpty {
                    Text(why)
                        .font(.prose(13.5))
                        .italic()
                        .foregroundStyle(Color.inkSoft)
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                }

                metaLine
            }

            Spacer(minLength: 0)
        }
        .padding(.vertical, 13)
        .contentShape(Rectangle())
    }

    @ViewBuilder private var metaLine: some View {
        let points = article.points
        HStack(spacing: 6) {
            if !article.sourceName.isEmpty {
                Apparatus(article.sourceName, size: 10.5, medium: true)
                    .foregroundStyle(Color.ink)
            }
            if let points {
                Apparatus("· \(points) points", size: 10.5)
                    .foregroundStyle(Color.muted)
            }
            if story.otherSources > 0 {
                Apparatus("· +\(story.otherSources) more", size: 10.5)
                    .foregroundStyle(Color.muted)
            }
        }
        .padding(.top, 2)
    }
}

#Preview {
    let lead = FeedArticle(
        urlHash: "abc", url: "https://example.com",
        title: "The day's lead story under its gold announcement",
        summary: "", imageUrl: nil, source: "hn", sourceName: "Hacker News",
        category: "community", section: "ai", publishedAt: nil,
        clusterId: "2026-08-28#lead", corroborationToday: 3,
        whyItMatters: "One sentence on why this story matters today.",
        score: 90, scoreVersion: "v1", points: 703, pointsImputed: false,
        llmImportance: 70, firstSeenAt: "2026-08-28T12:00:00.000Z"
    )
    let second = FeedArticle(
        urlHash: "def", url: "https://example.com",
        title: "An ordinary entry stays at the same size",
        summary: "", imageUrl: nil, source: "hn", sourceName: "Hacker News",
        category: "community", section: "ai", publishedAt: nil,
        clusterId: "2026-08-28#second", corroborationToday: nil,
        whyItMatters: "Position, not scale, is the rank.",
        score: 60, scoreVersion: "v1", points: 240, pointsImputed: false,
        llmImportance: 55, firstSeenAt: "2026-08-28T12:00:00.000Z"
    )
    return VStack(spacing: 0) {
        ArticleRow(story: Story(lead: lead, others: [second], rank: 1), number: 1, isLead: true)
        Rectangle().fill(Color.hairSoft).frame(height: 0.5)
        ArticleRow(story: Story(lead: second, others: [], rank: 2), number: 2, isLead: false)
    }
    .padding(.horizontal, 20)
    .background(Color.ground)
}
