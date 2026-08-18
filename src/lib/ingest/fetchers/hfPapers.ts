import type { FeedItem } from "./rss.js";
import { toIso, truncate } from "./rss.js";

/**
 * Parses HuggingFace Daily Papers API response. Expects a top-level array of
 * paper objects. Handles malformed input by returning an empty array. Extracts
 * title, constructs a link to the paper page, and safely truncates summary
 * by code point (not UTF-16 unit). Safely handles malformed timestamps.
 */
export function parseHfPapers(json: unknown): FeedItem[] {
  if (!Array.isArray(json)) return [];

  return json
    .filter((e: any) => e?.paper?.title)
    .map((e: any) => ({
      title: String(e.paper.title),
      link: `https://huggingface.co/papers/${e.paper.id}`,
      summary: truncate(String(e.paper.summary ?? ""), 600),
      imageUrl: null,
      publishedAt: toIso(e.publishedAt),
    }));
}
