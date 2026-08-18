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

  it("rejects javascript: as a url", () => {
    expect(() => NormalizedArticleSchema.parse({ ...valid, url: "javascript:alert(1)" })).toThrow();
  });

  it("rejects mailto: as a url", () => {
    expect(() => NormalizedArticleSchema.parse({ ...valid, url: "mailto:x@y.z" })).toThrow();
  });

  it("accepts a normal https:// url", () => {
    const parsed = NormalizedArticleSchema.parse({
      ...valid,
      url: "https://example.com/article",
    });
    expect(parsed.url).toBe("https://example.com/article");
  });

  it("rejects javascript: as an imageUrl", () => {
    expect(() =>
      NormalizedArticleSchema.parse({ ...valid, imageUrl: "javascript:alert(1)" })
    ).toThrow();
  });

  it("accepts null imageUrl", () => {
    const parsed = NormalizedArticleSchema.parse({
      ...valid,
      imageUrl: null,
    });
    expect(parsed.imageUrl).toBeNull();
  });

  it("rejects empty source", () => {
    expect(() => NormalizedArticleSchema.parse({ ...valid, source: "" })).toThrow();
  });

  it("rejects empty sourceName", () => {
    expect(() => NormalizedArticleSchema.parse({ ...valid, sourceName: "" })).toThrow();
  });

  it("rejects negative points", () => {
    expect(() => NormalizedArticleSchema.parse({ ...valid, points: -1 })).toThrow();
  });

  it("rejects fractional points", () => {
    expect(() => NormalizedArticleSchema.parse({ ...valid, points: 1.5 })).toThrow();
  });

  it("accepts null points", () => {
    const parsed = NormalizedArticleSchema.parse({
      ...valid,
      points: null,
    });
    expect(parsed.points).toBeNull();
  });

  it("rejects non-ISO publishedAt formats", () => {
    expect(() => NormalizedArticleSchema.parse({ ...valid, publishedAt: "08/18/2026" })).toThrow();
    expect(() => NormalizedArticleSchema.parse({ ...valid, publishedAt: "Aug 18 2026" })).toThrow();
  });

  it("accepts canonical ISO timestamps", () => {
    const parsed = NormalizedArticleSchema.parse({
      ...valid,
      publishedAt: "2026-08-18T09:00:00.000Z",
    });
    expect(parsed.publishedAt).toBe("2026-08-18T09:00:00.000Z");
  });
});

describe("SOURCE_WEIGHTS", () => {
  it("ranks labs above news above research above community", () => {
    expect(SOURCE_WEIGHTS.lab).toBeGreaterThan(SOURCE_WEIGHTS.news);
    expect(SOURCE_WEIGHTS.news).toBeGreaterThan(SOURCE_WEIGHTS.research);
    expect(SOURCE_WEIGHTS.research).toBeGreaterThan(SOURCE_WEIGHTS.community);
  });

  it("pins exact weight values", () => {
    expect(SOURCE_WEIGHTS.lab).toBe(1.0);
    expect(SOURCE_WEIGHTS.news).toBe(0.7);
    expect(SOURCE_WEIGHTS.research).toBe(0.6);
    expect(SOURCE_WEIGHTS.community).toBe(0.5);
  });
});
