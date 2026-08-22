import SwiftUI

// The reading room (DESIGN.md): the document sits on a paper sheet laid on
// the field; whyItMatters, the only line the product wrote itself, sits
// above the borrowed summary; the outbound link closes the page and leaves
// the paper — the inversion grammar.
struct ArticleView: View {
    let story: Story
    let vertical: Vertical

    private var article: FeedArticle { story.lead }

    var body: some View {
        ZStack {
            vertical.color.ignoresSafeArea()
            ScrollView {
                sheet
                    .padding(.horizontal, 14)
                    .padding(.top, 8)
                    .padding(.bottom, 40)
            }
        }
        .navigationBarTitleDisplayMode(.inline)
        .tint(vertical.onField)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                ShareLink(item: shareURL)
            }
        }
    }

    private var sheet: some View {
        VStack(alignment: .leading, spacing: 16) {
            Apparatus(metaLine, size: 10.5)
                .foregroundStyle(vertical.color)

            Text(article.title)
                .font(.display(27))
                .foregroundStyle(Color.ink)
                .fixedSize(horizontal: false, vertical: true)

            if let imageUrl = article.imageUrl, let url = URL(string: imageUrl) {
                AsyncImage(url: url) { phase in
                    if case .success(let image) = phase {
                        image
                            .resizable()
                            .aspectRatio(contentMode: .fit)
                            .clipShape(RoundedRectangle(cornerRadius: 6))
                    }
                    // Missing or failed image renders nothing, same as the site.
                }
            }

            if let why = article.whyItMatters, !why.isEmpty {
                Text(why)
                    .font(.proseSemiBold(16))
                    .foregroundStyle(Color.ink)
                    .lineSpacing(5)
                    .padding(14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(vertical.color.opacity(0.08))
                    .overlay(alignment: .leading) {
                        Rectangle().fill(vertical.color).frame(width: 3)
                    }
            }

            if !article.summary.isEmpty {
                Text(article.summary)
                    .font(.prose(16))
                    .foregroundStyle(Color.ink.opacity(0.85))
                    .lineSpacing(6)
            }

            // Contract: url is "" when the stored value was not a safe
            // http(s) URL — the site shows an unlinked notice, so do we.
            if !article.url.isEmpty, let url = URL(string: article.url) {
                Link(destination: url) {
                    HStack {
                        Apparatus("Read at \(article.sourceName)", size: 12, medium: true)
                        Spacer()
                        Image(systemName: "arrow.up.right")
                            .font(.system(size: 13, weight: .semibold))
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 14)
                    .background(vertical.color)
                    .foregroundStyle(vertical.onField)
                    .clipShape(RoundedRectangle(cornerRadius: 6))
                }
                .padding(.top, 4)
            } else {
                Apparatus("No outbound link", size: 10.5)
                    .foregroundStyle(Color.ink.opacity(0.7))
            }

            if !story.others.isEmpty {
                alsoCoveredBy
            }
        }
        .padding(18)
        .background(Color.paper)
        .clipShape(RoundedRectangle(cornerRadius: 6))
        .shadow(color: .black.opacity(0.35), radius: 16, y: 10)
    }

    private var metaLine: String {
        var parts = [article.sourceName]
        if let points = article.points { parts.append("\(points) pts") }
        if let sources = article.corroborationToday, sources > 1 {
            parts.append("\(sources) sources today")
        }
        if let date = article.publishedDate {
            parts.append(date.formatted(.relative(presentation: .named)))
        }
        return parts.joined(separator: " · ")
    }

    // Shares the WEB address, openable by anyone; the theslowwire:// scheme
    // only resolves on a phone that has the app. Same shape as the site's
    // route: /article/<section>/<hash>, legacy hash-only when section is null
    // (the site redirects it).
    private var shareURL: URL {
        if let section = article.section {
            FeedClient.baseURL.appending(path: "article/\(section)/\(article.urlHash)")
        } else {
            FeedClient.baseURL.appending(path: "article/\(article.urlHash)")
        }
    }

    private var alsoCoveredBy: some View {
        VStack(alignment: .leading, spacing: 10) {
            Apparatus("Also covered by", size: 10.5)
                .foregroundStyle(Color.ink.opacity(0.7))

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
        .padding(.top, 8)
    }

    private func siblingRow(_ sibling: FeedArticle) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 6) {
                Apparatus(siblingMeta(sibling), size: 10.5, medium: true)
                Image(systemName: "arrow.up.right")
                    .font(.caption2)
            }
            .foregroundStyle(vertical.color)

            Text(sibling.title)
                .font(.prose(13.5))
                .foregroundStyle(Color.ink.opacity(0.75))
                .lineLimit(2)
                .multilineTextAlignment(.leading)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(Color.ink.opacity(0.04), in: RoundedRectangle(cornerRadius: 6))
    }

    private func siblingMeta(_ sibling: FeedArticle) -> String {
        if let points = sibling.points {
            "\(sibling.sourceName) · \(points) pts"
        } else {
            sibling.sourceName
        }
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
        publishedAt: "2026-08-21T10:05:46.000Z",
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
        ArticleView(story: Story(lead: sample, others: [sibling], rank: 1), vertical: .ai)
    }
}
