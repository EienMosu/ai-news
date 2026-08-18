import type { FeedItem } from "./rss.js";

/**
 * A Hacker News item with points (upvotes). Extends FeedItem with the
 * numeric points field for scoring/ranking downstream.
 */
export type HnItem = FeedItem & { points: number };

/**
 * Parses Hacker News response from the Algolia API. Handles malformed input
 * by returning an empty array. Falls back to the HN discussion permalink
 * when a story has no external URL (common for "Ask HN" threads).
 */
export function parseHnResponse(json: unknown): HnItem[] {
  const hits = (json as any)?.hits;
  if (!Array.isArray(hits)) return [];

  return hits
    .filter((h: any) => h?.title)
    .map((h: any) => ({
      title: String(h.title),
      link: h.url ?? `https://news.ycombinator.com/item?id=${h.objectID}`,
      summary: "",
      imageUrl: null,
      publishedAt: h.created_at ? new Date(h.created_at).toISOString() : null,
      points: Number(h.points ?? 0),
    }));
}
