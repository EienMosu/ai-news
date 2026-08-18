import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { NormalizedArticleSchema } from "../../src/types/article.js";
import { parseHnResponse } from "../../src/lib/ingest/fetchers/hn.js";

const hn = JSON.parse(readFileSync(new URL("../fixtures/hn.json", import.meta.url), "utf8"));

describe("parseHnResponse", () => {
  it("extracts title, link and points", () => {
    const items = parseHnResponse(hn);
    expect(items.length).toBeGreaterThan(0);
    expect(typeof items[0]!.points).toBe("number");
    expect(items[0]!.title).toBeTruthy();
  });

  it("falls back to the HN discussion URL when a story has no external link", () => {
    const items = parseHnResponse({
      hits: [{ objectID: "123", title: "Ask HN: something", url: null, points: 80, created_at: "2026-08-18T00:00:00Z" }],
    });
    expect(items[0]!.link).toBe("https://news.ycombinator.com/item?id=123");
  });

  it("returns an empty array for a malformed payload", () => {
    expect(parseHnResponse({})).toEqual([]);
    expect(parseHnResponse(null)).toEqual([]);
  });

  it("outputs pass schema validation after adding required fields", () => {
    const items = parseHnResponse(hn);
    expect(items.length).toBeGreaterThan(0);

    for (const item of items) {
      const normalized = {
        urlHash: "a".repeat(64),
        url: item.link,
        title: item.title,
        summary: item.summary,
        imageUrl: item.imageUrl,
        source: "hn",
        sourceName: "Hacker News",
        category: "community" as const,
        section: "ai" as const,
        publishedAt: item.publishedAt,
        publishedAtSource: "feed" as const,
        points: item.points,
      };
      const result = NormalizedArticleSchema.safeParse(normalized);
      expect(result.success).toBe(true);
    }
  });

  it("does not throw on malformed created_at and preserves siblings", () => {
    const items = parseHnResponse({
      hits: [
        { objectID: "1", title: "Good article", url: "https://example.com", points: 100, created_at: "2026-08-18T00:00:00Z" },
        { objectID: "2", title: "Bad date article", url: "https://example.com/2", points: 50, created_at: "not-a-real-date" },
        { objectID: "3", title: "Another good article", url: "https://example.com/3", points: 75, created_at: "2026-08-18T12:00:00Z" },
      ],
    });
    expect(items.length).toBe(3);
    expect(items[0]!.publishedAt).not.toBeNull();
    expect(items[1]!.publishedAt).toBeNull();
    expect(items[2]!.publishedAt).not.toBeNull();
  });

  it("normalizes points: fractional, negative, and non-numeric values", () => {
    const items = parseHnResponse({
      hits: [
        { objectID: "1", title: "Fractional", points: 3.7, created_at: "2026-08-18T00:00:00Z" },
        { objectID: "2", title: "Negative", points: -5, created_at: "2026-08-18T00:00:00Z" },
        { objectID: "3", title: "Non-numeric", points: "abc", created_at: "2026-08-18T00:00:00Z" },
        { objectID: "4", title: "NaN", points: NaN, created_at: "2026-08-18T00:00:00Z" },
      ],
    });
    expect(items[0]!.points).toBe(3); // truncated
    expect(items[1]!.points).toBe(0); // clamped to 0
    expect(items[2]!.points).toBe(0); // NaN becomes 0
    expect(items[3]!.points).toBe(0); // NaN stays 0
  });

  it("falls back to HN permalink for empty string URLs", () => {
    const items = parseHnResponse({
      hits: [{ objectID: "999", title: "Empty URL", url: "", points: 42, created_at: "2026-08-18T00:00:00Z" }],
    });
    expect(items[0]!.link).toBe("https://news.ycombinator.com/item?id=999");
  });

  it("falls back to HN permalink for non-http(s) URLs", () => {
    const items = parseHnResponse({
      hits: [{ objectID: "888", title: "FTP URL", url: "ftp://example.com", points: 42, created_at: "2026-08-18T00:00:00Z" }],
    });
    expect(items[0]!.link).toBe("https://news.ycombinator.com/item?id=888");
  });
});
