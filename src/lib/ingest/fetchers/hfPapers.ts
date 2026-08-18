import type { FeedItem } from "./rss.js";

/**
 * Parses HuggingFace Daily Papers API response. Expects a top-level array of
 * paper objects. Handles malformed input by returning an empty array. Extracts
 * title, constructs a link to the paper page, and truncates summary to 600 chars.
 */
export function parseHfPapers(json: unknown): FeedItem[] {
  if (!Array.isArray(json)) return [];

  return json
    .filter((e: any) => e?.paper?.title)
    .map((e: any) => ({
      title: String(e.paper.title),
      link: `https://huggingface.co/papers/${e.paper.id}`,
      summary: String(e.paper.summary ?? "").slice(0, 600),
      imageUrl: null,
      publishedAt: e.publishedAt ? new Date(e.publishedAt).toISOString() : null,
    }));
}
