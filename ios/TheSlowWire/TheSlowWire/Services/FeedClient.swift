import Foundation

enum FeedClientError: LocalizedError {
    case badStatus(Int)

    var errorDescription: String? {
        switch self {
        case .badStatus(let code): "The feed responded with status \(code)."
        }
    }
}

struct FeedClient {
    static let baseURL = URL(string: "https://ai-news-ten-bice.vercel.app")!

    func fetchFeed(section: Vertical, days: Int = 5) async throws -> FeedResponse {
        var components = URLComponents(
            url: Self.baseURL.appending(path: "api/feed"),
            resolvingAgainstBaseURL: false
        )!
        components.queryItems = [
            URLQueryItem(name: "section", value: section.rawValue),
            URLQueryItem(name: "days", value: String(days)),
        ]

        let (data, response) = try await URLSession.shared.data(from: components.url!)
        if let http = response as? HTTPURLResponse, http.statusCode != 200 {
            throw FeedClientError.badStatus(http.statusCode)
        }
        return try JSONDecoder().decode(FeedResponse.self, from: data)
    }

    // GET /api/article/<urlHash>: the article plus its cluster siblings,
    // composed server-side exactly like the web story page. This is the
    // cold-start path for deep links, where no feed is in hand yet.
    func fetchStory(urlHash: String) async throws -> Story {
        struct ArticleResponse: Codable {
            let article: FeedArticle
            let siblings: [FeedArticle]
        }

        let url = Self.baseURL.appending(path: "api/article/\(urlHash)")
        let (data, response) = try await URLSession.shared.data(from: url)
        if let http = response as? HTTPURLResponse, http.statusCode != 200 {
            throw FeedClientError.badStatus(http.statusCode)
        }
        let decoded = try JSONDecoder().decode(ArticleResponse.self, from: data)
        return Story(lead: decoded.article, others: decoded.siblings)
    }
}
