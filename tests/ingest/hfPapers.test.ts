import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { NormalizedArticleSchema } from "../../src/types/article.js";
import { parseHfPapers } from "../../src/lib/ingest/fetchers/hfPapers.js";

const hf = JSON.parse(readFileSync(new URL("../fixtures/hf-papers.json", import.meta.url), "utf8"));

describe("parseHfPapers", () => {
  it("extracts title and a paper link", () => {
    const items = parseHfPapers(hf);
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]!.title).toBeTruthy();
    expect(items[0]!.link).toMatch(/^https:\/\/huggingface\.co\/papers\//);
  });

  it("returns an empty array for a malformed payload", () => {
    expect(parseHfPapers({})).toEqual([]);
    expect(parseHfPapers(null)).toEqual([]);
  });

  it("outputs pass schema validation after adding required fields", () => {
    const items = parseHfPapers(hf);
    expect(items.length).toBeGreaterThan(0);

    for (const item of items) {
      const normalized = {
        urlHash: "a".repeat(64),
        url: item.link,
        title: item.title,
        summary: item.summary,
        imageUrl: item.imageUrl,
        source: "hf-papers",
        sourceName: "HuggingFace Daily Papers",
        category: "research" as const,
        publishedAt: item.publishedAt,
        publishedAtSource: "feed" as const,
        points: null,
      };
      const result = NormalizedArticleSchema.safeParse(normalized);
      expect(result.success).toBe(true);
    }
  });

  it("does not throw on malformed publishedAt and preserves siblings", () => {
    const items = parseHfPapers([
      { paper: { id: "1", title: "Good paper", summary: "A summary" }, publishedAt: "2026-08-18T00:00:00Z" },
      { paper: { id: "2", title: "Bad date paper", summary: "Another summary" }, publishedAt: "not-a-real-date" },
      { paper: { id: "3", title: "Another good paper", summary: "Third summary" }, publishedAt: "2026-08-18T12:00:00Z" },
    ]);
    expect(items.length).toBe(3);
    expect(items[0]!.publishedAt).not.toBeNull();
    expect(items[1]!.publishedAt).toBeNull();
    expect(items[2]!.publishedAt).not.toBeNull();
  });

  it("truncates summary by code point (not UTF-16 unit)", () => {
    const longSummary = "a".repeat(700);
    const items = parseHfPapers([
      { paper: { id: "1", title: "Long summary", summary: longSummary }, publishedAt: "2026-08-18T00:00:00Z" },
    ]);
    expect(items[0]!.summary.length).toBe(600);
    expect(items[0]!.summary).toBe("a".repeat(600));
  });

  it("handles empty summaries gracefully", () => {
    const items = parseHfPapers([
      { paper: { id: "1", title: "No summary", summary: "" }, publishedAt: "2026-08-18T00:00:00Z" },
      { paper: { id: "2", title: "Null summary", summary: null }, publishedAt: "2026-08-18T00:00:00Z" },
    ]);
    expect(items[0]!.summary).toBe("");
    expect(items[1]!.summary).toBe("");
  });
});
