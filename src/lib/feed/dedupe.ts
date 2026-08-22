import type { FeedResult } from "./read.js";
import type { FeedArticle } from "./shape.js";

/**
 * The identity a story keeps across days. `clusterId` is day-namespaced
 * (`${day}#${slug}`) precisely so two days' clusterings never collide in the store -- which
 * also means the raw id can never say "this is the same story as yesterday's". The slug behind
 * the `#` can and does: the rank model names a cluster after the event, and the same event
 * re-ranked on a later day gets the same slug. So the cross-day identity is the slug alone.
 *
 * The two shapes without a `#` fall back to something that can only ever match itself:
 * `__self__:<urlHash>` (the model assigned no cluster) already embeds the article's own hash,
 * and a `null` clusterId (a degraded day, rank never ran) uses the urlHash directly. Neither
 * may fold two distinct articles together -- on a degraded day there is no clustering signal
 * at all, and inventing one from titles here would be the rank pipeline's job done badly.
 */
export function storyKey(article: FeedArticle): string {
  const cid = article.clusterId;
  if (cid === null) return article.urlHash;
  const hash = cid.indexOf("#");
  return hash === -1 ? cid : cid.slice(hash + 1);
}

/**
 * The urlHashes the archive view folds away as repeats, walked over `results` exactly as the
 * page renders them: newest day first, each day's articles in score order.
 *
 * Two kinds of repeat, one rule -- the first appearance of a story keeps its card, every later
 * one is folded:
 *
 * - **Within a day**: cluster siblings (the same event from a second source). The lead is the
 *   highest-scored member (first in GSI order); the card's own "N sources today" corroboration
 *   signal (`ScoreSignals`) is the surviving evidence that the story had more than one source,
 *   so folding loses presentation, not information.
 * - **Across days**: the same slug ranked again on an older day below (a repost, or the same
 *   event's second wind). The newest day's card is the one kept -- the reader scrolls newest
 *   first, so "kept" means "the first one they meet".
 *
 * Returns a drop-set of urlHashes rather than rewritten `FeedResult`s on purpose: ranks are a
 * fact about the day (`DaySection`'s `RankedEntry` contract), so the narrowing must happen
 * AFTER `FeedView` assigns `rank = i + 1` off the full array -- the same seam `matchesFilter`
 * already narrows through. Rewriting `results` here would silently renumber every day.
 *
 * `/day/[date]` never calls this: that page is the day as it was judged, repeats and all.
 * The JSON API also stays complete -- a client that wants the siblings (the iOS app counts
 * them for its "+N more" note) still gets them; folding is this view's presentation choice.
 */
export function repeatedStoryHashes(results: FeedResult[]): Set<string> {
  const repeats = new Set<string>();
  const seenInNewerDays = new Set<string>();
  for (const result of results) {
    const seenThisDay = new Set<string>();
    for (const article of result.articles) {
      const key = storyKey(article);
      if (seenInNewerDays.has(key) || seenThisDay.has(key)) {
        repeats.add(article.urlHash);
      } else {
        seenThisDay.add(key);
      }
    }
    for (const key of seenThisDay) seenInNewerDays.add(key);
  }
  return repeats;
}
