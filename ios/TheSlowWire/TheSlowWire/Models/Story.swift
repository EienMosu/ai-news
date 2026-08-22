import Foundation

// One story = one cluster of articles. The rank pipeline clusters same-event
// coverage under a shared clusterId ("<day>#<slug>"); an article the model
// left alone gets "__self__:<urlHash>" (already unique) and a degraded day
// ships null, so the urlHash fallback keeps those rows independent.
struct Story: Identifiable {
    let lead: FeedArticle
    let otherSources: Int

    var id: String { lead.id }
}

extension Story {
    // The feed arrives score-ranked, so within a cluster the first article
    // seen is the lead; the rest only add to the source count.
    static func group(_ articles: [FeedArticle]) -> [Story] {
        var order: [String] = []
        var members: [String: Int] = [:]
        var leads: [String: FeedArticle] = [:]

        for article in articles {
            let key = article.clusterId ?? article.urlHash
            if leads[key] == nil {
                leads[key] = article
                order.append(key)
            }
            members[key, default: 0] += 1
        }

        return order.compactMap { key in
            guard let lead = leads[key] else { return nil }
            return Story(lead: lead, otherSources: members[key, default: 1] - 1)
        }
    }
}
