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

  it("guards a missing pk instead of producing a garbage urlHash", () => {
    // String(undefined).slice(4) is "fined" -- a plausible-looking string that is actually
    // garbage. `?? ""` makes the miss visible instead of disguising it as data.
    expect(toFeedArticle(raw({ pk: undefined })).urlHash).toBe("");
  });

  it("returns null, never a lying cast, for a missing or unrecognized category", () => {
    expect(toFeedArticle(raw({ category: undefined })).category).toBeNull();
    expect(toFeedArticle(raw({ category: "sports" })).category).toBeNull();
  });

  it("returns null, never a lying cast, for a missing or unrecognized section", () => {
    expect(toFeedArticle(raw({ section: undefined })).section).toBeNull();
    expect(toFeedArticle(raw({ section: "sports" })).section).toBeNull();
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
    // Distinct pks: self-exclusion now keys on urlHash (see finding 1 below), and no two real
    // articles ever share a urlHash, so the fixture must not either.
    const items = [
      raw({ title: "A", pk: `ART#${"a".repeat(64)}` }),
      raw({ title: "B", pk: `ART#${"b".repeat(64)}` }),
      raw({ title: "C", pk: `ART#${"c".repeat(64)}`, clusterId: "2026-08-18#other" }),
    ].map(toFeedArticle);
    expect(clusterSiblings(items, items[0]!).map((a) => a.title)).toEqual(["B"]);
  });

  it("returns nothing for a __self__ id, which is not a cluster", () => {
    // reconcile assigns `__self__:<hash>` when the model gave no cluster. Treating it as one
    // would group every unclustered article of the day into a single fake story. The two items
    // share the SAME __self__ id but have distinct urlHashes (distinct pk) -- that is the only
    // arrangement where the guard, not incidental string inequality, is what holds the result at
    // zero: with different urlHashes, urlHash-based self-exclusion would not remove the second
    // item on its own, so only the "__self__:" guard can.
    const items = [
      raw({ clusterId: "__self__:shared", pk: `ART#${"a".repeat(64)}` }),
      raw({ clusterId: "__self__:shared", pk: `ART#${"b".repeat(64)}` }),
    ].map(toFeedArticle);
    expect(clusterSiblings(items, items[0]!)).toHaveLength(0);
  });

  it("never returns the article itself", () => {
    const items = [raw()].map(toFeedArticle);
    expect(clusterSiblings(items, items[0]!)).toHaveLength(0);
  });

  it("excludes the subject even when it arrives as a separate object with the same urlHash", () => {
    // A story page fetches one article by urlHash, then the day's list separately -- two fetches,
    // two distinct objects for the same stored article. Self-exclusion must key on urlHash, not
    // object identity.
    const subjectRaw = raw();
    const items = [
      toFeedArticle(subjectRaw),
      toFeedArticle(raw({ title: "B", pk: `ART#${"b".repeat(64)}` })),
    ];
    const subject = toFeedArticle(subjectRaw); // same urlHash as items[0], distinct object
    expect(clusterSiblings(items, subject).map((a) => a.title)).toEqual(["B"]);
  });
});
