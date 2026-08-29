package com.eienmosu.theslowwire.model

// One story = one cluster of articles. The rank pipeline clusters same-event
// coverage under a shared clusterId ("<day>#<slug>"); an article the model left
// alone gets "__self__:<urlHash>" (already unique) and a degraded day ships
// null, so the urlHash fallback keeps those rows independent.
data class Story(
    val lead: FeedArticle,
    /** The folded cluster siblings, in score order; the reading room lists them
     *  as "Also covered by" rows with their own outbound links. */
    val others: List<FeedArticle>,
    /** The lead's VISIBLE position, 1-based, assigned after folding — the
     *  owner's 2026-08-28 call, matching the web: a gapped count reads as a bug.
     *  0 for a story fetched outside a day (deep links). */
    val rank: Int,
) {
    val id: String get() = lead.urlHash
    val otherSources: Int get() = others.size

    companion object {
        /** The identity a story keeps ACROSS days: the slug behind the
         *  day-namespaced clusterId ("2026-08-21#lfm" and "2026-08-20#lfm" are
         *  the same story told twice). A null clusterId falls back to the
         *  urlHash, so a degraded day can never fold two distinct articles
         *  together. Mirrors the site's storyKey (src/lib/feed/dedupe.ts). */
        fun key(article: FeedArticle): String {
            val cid = article.clusterId ?: return article.urlHash
            val sep = cid.indexOf('#')
            return if (sep < 0) cid else cid.substring(sep + 1)
        }

        /** The feed arrives score-ranked, so within a cluster the first article
         *  seen is the lead; the rest ride along as the story's other sources. */
        fun group(articles: List<FeedArticle>): List<Story> {
            // LinkedHashMap keeps insertion order, which IS score order here —
            // the reason this is one pass and not a group-then-sort.
            val members = LinkedHashMap<String, MutableList<FeedArticle>>()
            for (article in articles) {
                members.getOrPut(key(article)) { mutableListOf() }.add(article)
            }
            return members.values.mapIndexed { index, group ->
                Story(lead = group.first(), others = group.drop(1), rank = index + 1)
            }
        }

        /** Days arrive newest first; a story already shown in a newer day is
         *  folded out of the older ones, mirroring the site's archive view.
         *  Returns one story list per input day, index-aligned with `results`.
         *  Ranks are assigned AFTER that fold, so each day counts 1, 2, 3 with
         *  no gaps — the same rule the web's FeedView renumbers by. */
        fun groupDays(results: List<FeedResult>): List<List<Story>> {
            val seenInNewerDays = mutableSetOf<String>()
            return results.map { result ->
                val kept = group(result.articles)
                    .filter { seenInNewerDays.add(key(it.lead)) }
                    .mapIndexed { index, story -> story.copy(rank = index + 1) }
                kept
            }
        }
    }
}
