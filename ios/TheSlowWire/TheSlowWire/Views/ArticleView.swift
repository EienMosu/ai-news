import SwiftUI

// The reading room, Modern Classic: the document opens under the gold
// double-rule on the page ground; whyItMatters (the one line the product
// wrote itself) leads the summary; the outbound link closes the page in the
// pressed grammar — ink fill, ground text.
struct ArticleView: View {
    let story: Story

    private var article: FeedArticle { story.lead }

    var body: some View {
        ZStack {
            Color.ground.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    GoldRule()

                    Apparatus(metaLine, size: 10.5)
                        .foregroundStyle(Color.muted)

                    Text(article.title)
                        .font(.displayHeavy(27))
                        .foregroundStyle(Color.ink)
                        .fixedSize(horizontal: false, vertical: true)

                    if let imageUrl = article.imageUrl, let url = URL(string: imageUrl) {
                        AsyncImage(url: url) { phase in
                            if case .success(let image) = phase {
                                image
                                    .resizable()
                                    .aspectRatio(contentMode: .fit)
                                    .clipShape(RoundedRectangle(cornerRadius: 4))
                            }
                            // Missing or failed image renders nothing, same as the site.
                        }
                    }

                    if let why = article.whyItMatters, !why.isEmpty {
                        HStack(alignment: .top, spacing: 12) {
                            Rectangle()
                                .fill(Color.goldSoft)
                                .frame(width: 2)
                            Text(why)
                                .font(.proseSemiBold(16))
                                .italic()
                                .foregroundStyle(Color.ink)
                                .lineSpacing(5)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }

                    if !article.summary.isEmpty {
                        Text(article.summary)
                            .font(.prose(16))
                            .foregroundStyle(Color.inkSoft)
                            .lineSpacing(6)
                            .fixedSize(horizontal: false, vertical: true)
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
                            .background(Color.ink)
                            .foregroundStyle(Color.ground)
                            .clipShape(RoundedRectangle(cornerRadius: 4))
                        }
                        .padding(.top, 4)
                    } else {
                        Apparatus("No outbound link", size: 10.5)
                            .foregroundStyle(Color.muted)
                    }

                    if !story.others.isEmpty {
                        alsoCoveredBy
                    }
                }
                .padding(.horizontal, 20)
                .padding(.top, 10)
                .padding(.bottom, 40)
            }
        }
        .navigationBarTitleDisplayMode(.inline)
        .tint(.ink)
        .toolbar(.hidden, for: .tabBar)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                ShareLink(item: shareURL)
            }
        }
    }

    private var metaLine: String {
        var parts = [article.sourceName]
        if let points = article.points { parts.append("\(points) points") }
        if let sources = article.corroborationToday, sources > 1 {
            parts.append("\(sources) sources today")
        }
        if let date = article.publishedDate {
            parts.append(date.formatted(.relative(presentation: .named)))
        }
        return parts.joined(separator: " · ")
    }

    // Shares the WEB address, openable by anyone.
    private var shareURL: URL {
        if let section = article.section {
            FeedClient.baseURL.appending(path: "article/\(section)/\(article.urlHash)")
        } else {
            FeedClient.baseURL.appending(path: "article/\(article.urlHash)")
        }
    }

    private var alsoCoveredBy: some View {
        VStack(alignment: .leading, spacing: 10) {
            Apparatus("Also covered by", size: 10.5, medium: true)
                .foregroundStyle(Color.muted)

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
            .foregroundStyle(Color.gold)

            Text(sibling.title)
                .font(.prose(13.5))
                .foregroundStyle(Color.inkSoft)
                .lineLimit(2)
                .multilineTextAlignment(.leading)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .overlay(
            RoundedRectangle(cornerRadius: 4)
                .strokeBorder(Color.hairMid, lineWidth: 1)
        )
    }

    private func siblingMeta(_ sibling: FeedArticle) -> String {
        if let points = sibling.points {
            "\(sibling.sourceName) · \(points) points"
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
        publishedAt: "2026-08-28T10:05:46.000Z",
        clusterId: "2026-08-28#sample",
        corroborationToday: 3,
        whyItMatters: "One sentence on why this story matters today.",
        score: 42,
        scoreVersion: "v1",
        points: 703,
        pointsImputed: false,
        llmImportance: 70,
        firstSeenAt: "2026-08-28T12:00:00.000Z"
    )
    let sibling = FeedArticle(
        urlHash: "def",
        url: "https://example.org",
        title: "The same event reported by a second source",
        summary: "",
        imageUrl: nil,
        source: "hn",
        sourceName: "r/LocalLLaMA",
        category: "community",
        section: "ai",
        publishedAt: nil,
        clusterId: "2026-08-28#sample",
        corroborationToday: 3,
        whyItMatters: nil,
        score: 30,
        scoreVersion: "v1",
        points: 240,
        pointsImputed: false,
        llmImportance: 60,
        firstSeenAt: "2026-08-28T13:00:00.000Z"
    )
    return NavigationStack {
        ArticleView(story: Story(lead: sample, others: [sibling], rank: 1))
    }
}
