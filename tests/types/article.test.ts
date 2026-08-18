import { describe, expect, it } from "vitest";
import { NormalizedArticleSchema, SOURCE_WEIGHTS } from "../../src/types/article.js";

const valid = {
  urlHash: "a".repeat(64),
  url: "https://techcrunch.com/post",
  title: "OpenAI ships GPT-6",
  summary: "The model is available today.",
  imageUrl: null,
  source: "techcrunch",
  sourceName: "TechCrunch",
  category: "news" as const,
  publishedAt: "2026-08-18T09:00:00.000Z",
  publishedAtSource: "feed" as const,
  points: null,
};

describe("NormalizedArticleSchema", () => {
  it("accepts a well-formed article", () => {
    expect(NormalizedArticleSchema.parse(valid)).toMatchObject({ title: valid.title });
  });

  it("rejects an empty title", () => {
    expect(() => NormalizedArticleSchema.parse({ ...valid, title: "  " })).toThrow();
  });

  it("rejects a malformed urlHash", () => {
    expect(() => NormalizedArticleSchema.parse({ ...valid, urlHash: "short" })).toThrow();
  });

  it("rejects an unknown category", () => {
    expect(() => NormalizedArticleSchema.parse({ ...valid, category: "sports" })).toThrow();
  });

  it("rejects a non-ISO publishedAt", () => {
    expect(() => NormalizedArticleSchema.parse({ ...valid, publishedAt: "yesterday" })).toThrow();
  });

  it("allows a null publishedAt with a fallback marker", () => {
    const parsed = NormalizedArticleSchema.parse({
      ...valid,
      publishedAt: null,
      publishedAtSource: "fallback",
    });
    expect(parsed.publishedAt).toBeNull();
  });
});

describe("SOURCE_WEIGHTS", () => {
  it("ranks labs above news above research above community", () => {
    expect(SOURCE_WEIGHTS.lab).toBeGreaterThan(SOURCE_WEIGHTS.news);
    expect(SOURCE_WEIGHTS.news).toBeGreaterThan(SOURCE_WEIGHTS.research);
    expect(SOURCE_WEIGHTS.research).toBeGreaterThan(SOURCE_WEIGHTS.community);
  });
});
