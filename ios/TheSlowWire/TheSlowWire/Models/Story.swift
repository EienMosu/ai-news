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
    // The identity a story keeps ACROSS days: the slug behind the day-namespaced
    // clusterId ("2026-08-21#lfm" and "2026-08-20#lfm" are the same story told
    // twice). "__self__:<hash>" and a null clusterId fall back to self-unique
    // keys, so a degraded day can never fold two distinct articles together.
    // Mirrors the site's storyKey (src/lib/feed/dedupe.ts).
    static func key(for article: FeedArticle) -> String {
        guard let cid = article.clusterId else { return article.urlHash }
        guard let sep = cid.firstIndex(of: "#") else { return cid }
        return String(cid[cid.index(after: sep)...])
    }

    // The feed arrives score-ranked, so within a cluster the first article
    // seen is the lead; the rest only add to the source count.
    static func group(_ articles: [FeedArticle]) -> [Story] {
        var order: [String] = []
        var members: [String: Int] = [:]
        var leads: [String: FeedArticle] = [:]

        for article in articles {
            let key = key(for: article)
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

    // Days arrive newest first; a story already shown in a newer day is folded
    // out of the older ones, mirroring the site's archive view. Returns one
    // story array per input day, index-aligned with `results`.
    static func groupDays(_ results: [FeedResult]) -> [[Story]] {
        var seenInNewerDays = Set<String>()
        return results.map { result in
            let stories = group(result.articles).filter { story in
                !seenInNewerDays.contains(key(for: story.lead))
            }
            for story in stories {
                seenInNewerDays.insert(key(for: story.lead))
            }
            return stories
        }
    }
}
