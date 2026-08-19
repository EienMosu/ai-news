import type { FeedArticle } from "../feed/shape.js";

/**
 * Task 8 decision 6: matching is a case-insensitive substring over `title` and `summary` only
 * -- no stemming, no fuzzy matching, and no relevance ranking. Callers keep whatever order the
 * day query returned (score order); this function only decides membership, never order.
 *
 * An empty query is never expected to reach this function -- the search page renders the form
 * and nothing else instead of running a search for a blank submit (decision 7) -- but this
 * function has no way to enforce that itself, and does not try to: `"".toLowerCase()` is `""`,
 * and every string `includes("")`, so an empty query here would (correctly, in isolation) match
 * everything. The page, not this predicate, is what keeps that case from ever being reached.
 */
export function matchesQuery(article: FeedArticle, query: string): boolean {
  const q = query.toLowerCase();
  return article.title.toLowerCase().includes(q) || article.summary.toLowerCase().includes(q);
}
