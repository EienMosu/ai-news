import { describe, expect, it } from "vitest";
import { bySection, clusterSiblings, isUnranked, toFeedArticle } from "../../src/lib/feed/shape.js";

const raw = (over: Record<string, unknown> = {}) => ({
  pk: `ART#${"a".repeat(64)}`, sk: "A",
  title: "T", summary: "s", imageUrl: null, url: "https://e.com/p",
  source: "techcrunch", sourceName: "TechCrunch", category: "news", section: "ai",
  publishedAt: "2026-08-18T09:00:00.000Z", clusterId: "2026-08-18#gpt6",
  corroborationToday: 2, whyItMatters: "Because.", score: 812, scoreVersion: "v1",
  points: null, pointsImputed: true, llmImportance: 88, firstSeenAt: "2026-08-18T10:00:00.000Z",
  ...over,
});

describe("toFeedArticle", () => {
  it("recovers urlHash from the key rather than expecting an attribute", () => {
    // urlHash is not a projected attribute. It is recoverable from `pk`, which DynamoDB
    // projects into every index regardless of projection type.
    expect(toFeedArticle(raw()).urlHash).toBe("a".repeat(64));
  });

  it("survives an item missing every optional attribute", () => {
    // A degraded day has no whyItMatters, no llmImportance and no clusterId. Most sources
    // never carry points or an image. A card that needs them is a card that breaks daily.
    const a = toFeedArticle(raw({ whyItMatters: undefined, llmImportance: undefined,
      clusterId: undefined, imageUrl: undefined, points: undefined }));
    expect(a.whyItMatters).toBeNull();
    expect(a.imageUrl).toBeNull();
    expect(a.title).toBe("T");
  });
});

describe("isUnranked", () => {
  it("is true exactly when the model never scored the article", () => {
    expect(isUnranked(toFeedArticle(raw({ scoreVersion: "v1-degraded" })))).toBe(true);
    expect(isUnranked(toFeedArticle(raw({ scoreVersion: "v1" })))).toBe(false);
  });
});

describe("bySection", () => {
  it("filters to one vertical and preserves the ranked order", () => {
    const items = [raw({ score: 900 }), raw({ section: "design", score: 800 }), raw({ score: 700 })]
      .map(toFeedArticle);
    const ai = bySection(items, "ai");
    expect(ai).toHaveLength(2);
    expect(ai.map((a) => a.score)).toEqual([900, 700]);
  });
});

describe("clusterSiblings", () => {
  it("finds the other articles covering the same story", () => {
    const items = [raw({ title: "A" }), raw({ title: "B" }),
      raw({ title: "C", clusterId: "2026-08-18#other" })].map(toFeedArticle);
    expect(clusterSiblings(items, items[0]!).map((a) => a.title)).toEqual(["B"]);
  });

  it("returns nothing for a __self__ id, which is not a cluster", () => {
    // reconcile assigns `__self__:<hash>` when the model gave no cluster. Treating it as one
    // would group every unclustered article of the day into a single fake story.
    const items = [raw({ clusterId: "__self__:h1" }), raw({ clusterId: "__self__:h2" })]
      .map(toFeedArticle);
    expect(clusterSiblings(items, items[0]!)).toHaveLength(0);
  });

  it("never returns the article itself", () => {
    const items = [raw()].map(toFeedArticle);
    expect(clusterSiblings(items, items[0]!)).toHaveLength(0);
  });
});
