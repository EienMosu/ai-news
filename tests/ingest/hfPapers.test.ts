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
        section: "ai" as const,
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
    // "a".repeat(700) can't distinguish code points from UTF-16 units —
    // ASCII characters are always one of each. An astral character (each
    // emoji here is one code point but two UTF-16 units) makes the
    // assertion actually discriminate: a UTF-16-unit-based truncation would
    // cut mid-codepoint and leave a lone surrogate.
    const longSummary = "\u{1F600}".repeat(700);
    const items = parseHfPapers([
      { paper: { id: "1", title: "Long summary", summary: longSummary }, publishedAt: "2026-08-18T00:00:00Z" },
    ]);
    const summary = items[0]!.summary;
    expect(Array.from(summary).length).toBe(600);
    expect(summary).toBe("\u{1F600}".repeat(600));
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(summary)).toBe(false);
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
