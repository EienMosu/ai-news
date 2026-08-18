import type { FeedItem } from "./rss.js";
import { toIso } from "./rss.js";

/**
 * A Hacker News item with points (upvotes). Extends FeedItem with the
 * numeric points field for scoring/ranking downstream.
 */
export type HnItem = FeedItem & { points: number };

const HTTP_URL_RE = /^https?:\/\//;

/**
 * Parses Hacker News response from the Algolia API. Handles malformed input
 * by returning an empty array. Falls back to the HN discussion permalink
 * when a story has no external URL (common for "Ask HN" threads).
 * Safely handles malformed timestamps and invalid point values — one bad record
 * does not crash the entire batch.
 */
export function parseHnResponse(json: unknown): HnItem[] {
  const hits = (json as any)?.hits;
  if (!Array.isArray(hits)) return [];

  return hits
    .filter((h: any) => h?.title)
    .map((h: any) => {
      // Determine link: use URL if it's a non-empty http(s) URL, else fall back to HN permalink
      let link: string;
      const url = h.url;
      if (typeof url === "string" && url && HTTP_URL_RE.test(url)) {
        link = url;
      } else {
        link = `https://news.ycombinator.com/item?id=${h.objectID}`;
      }

      // Normalize points: ensure it's a non-negative integer, NaN becomes 0
      const n = Number(h.points);
      const points = Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;

      return {
        title: String(h.title),
        link,
        summary: "",
        imageUrl: null,
        publishedAt: toIso(h.created_at),
        points,
      };
    });
}
