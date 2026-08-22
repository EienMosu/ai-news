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
}
