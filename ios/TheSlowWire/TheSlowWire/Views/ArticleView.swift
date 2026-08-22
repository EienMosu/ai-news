import SwiftUI

// The "reading room": everything the feed knows about one story,
// with outbound doors to Safari for the lead and every folded sibling.
struct ArticleView: View {
    let story: Story
    let accent: Color

    private var article: FeedArticle { story.lead }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text(article.title)
                    .font(.system(.largeTitle, design: .serif, weight: .bold))
                    .foregroundStyle(Color.ink)

                HStack(spacing: 6) {
                    Text(article.sourceName)
                    if let points = article.points {
                        Text("·")
                        Text("\(points) points")
                    }
                    if let sources = article.corroborationToday, sources > 1 {
                        Text("·")
                        Text("\(sources) sources today")
                    }
                }
                .font(.subheadline)
                .foregroundStyle(accent)

                if let imageUrl = article.imageUrl, let url = URL(string: imageUrl) {
                    AsyncImage(url: url) { phase in
                        if case .success(let image) = phase {
                            image
                                .resizable()
                                .aspectRatio(contentMode: .fit)
                                .clipShape(RoundedRectangle(cornerRadius: 8))
                        }
                        // Missing or failed image renders nothing, same as the site.
                    }
                }

                if let why = article.whyItMatters, !why.isEmpty {
                    Text(why)
                        .font(.system(.body, design: .serif))
                        .foregroundStyle(Color.ink)
                        .padding(12)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(accent.opacity(0.08))
                        .overlay(alignment: .leading) {
                            Rectangle().fill(accent).frame(width: 3)
                        }
                }

                if !article.summary.isEmpty {
                    Text(article.summary)
                        .font(.system(.body, design: .serif))
                        .foregroundStyle(Color.ink.opacity(0.85))
                        .lineSpacing(4)
                }

                // Contract: url is "" when the stored value was not a safe
                // http(s) URL — the site shows an unlinked notice, so do we.
                if !article.url.isEmpty, let url = URL(string: article.url) {
                    Link(destination: url) {
                        HStack {
                            Text("Read at \(article.sourceName)")
                            Image(systemName: "arrow.up.right")
                        }
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .padding()
                        .background(accent)
                        .foregroundStyle(.white)
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                    }
                    .padding(.top, 8)
                } else {
                    Text("This story carries no outbound link.")
                        .font(.footnote)
                        .foregroundStyle(Color.ink.opacity(0.5))
                }

                if !story.others.isEmpty {
                    alsoCoveredBy
                }
            }
            .padding(20)
        }
        .background(Color.paper)
        .navigationBarTitleDisplayMode(.inline)
        .tint(accent)
    }

    private var alsoCoveredBy: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Also covered by")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Color.ink.opacity(0.6))
                .textCase(.uppercase)
                .font(.caption)

            ForEach(story.others) { sibling in
                if !sibling.url.isEmpty, let url = URL(string: sibling.url) {
                    Link(destination: url) {
                        siblingRow(sibling)
                    }
                } else {
                    siblingRow(sibling)
                }
            }
        }
        .padding(.top, 12)
    }

    private func siblingRow(_ sibling: FeedArticle) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 6) {
                Text(sibling.sourceName)
                    .font(.subheadline.weight(.medium))
                if let points = sibling.points {
                    Text("·")
                    Text("\(points) points")
                        .font(.caption)
                }
                Image(systemName: "arrow.up.right")
                    .font(.caption2)
            }
            .foregroundStyle(accent)

            Text(sibling.title)
                .font(.footnote)
                .foregroundStyle(Color.ink.opacity(0.7))
                .lineLimit(2)
                .multilineTextAlignment(.leading)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(Color.ink.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
    }
}

#Preview {
    let sample = FeedArticle(
        urlHash: "abc",
        url: "https://example.com",
        title: "A sample story title long enough to wrap in the reading room",
        summary: "A few sentences of summary text so the serif body style and line spacing are visible in the preview.",
        imageUrl: nil,
        source: "hn",
        sourceName: "Hacker News",
        category: "community",
        section: "ai",
        publishedAt: nil,
        clusterId: "2026-08-21#sample",
        corroborationToday: 3,
        whyItMatters: "One sentence on why this story matters today.",
        score: 42,
        scoreVersion: "v1",
        points: 703,
        pointsImputed: false,
        llmImportance: 70,
        firstSeenAt: "2026-08-21T12:00:00.000Z"
    )
    let sibling = FeedArticle(
        urlHash: "def",
        url: "https://example.org",
        title: "The same event reported by a second source, with its own headline",
        summary: "",
        imageUrl: nil,
        source: "hn",
        sourceName: "r/LocalLLaMA",
        category: "community",
        section: "ai",
        publishedAt: nil,
        clusterId: "2026-08-21#sample",
        corroborationToday: 3,
        whyItMatters: nil,
        score: 30,
        scoreVersion: "v1",
        points: 240,
        pointsImputed: false,
        llmImportance: 60,
        firstSeenAt: "2026-08-21T13:00:00.000Z"
    )
    return NavigationStack {
        ArticleView(story: Story(lead: sample, others: [sibling]), accent: .worldAI)
    }
}
