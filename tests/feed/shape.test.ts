import { describe, expect, it } from "vitest";
import {
  bySection,
  clusterSiblings,
  deduplicateStories,
  hasCorroboration,
  isUnranked,
  toFeedArticle,
} from "../../src/lib/feed/shape.js";

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

  describe("url/imageUrl -- final review, L9", () => {
    // `category`/`section` above are re-validated with the stated rationale that "an unchecked
    // cast would let a bad write silently mislabel an article" -- `url` and `imageUrl` used to
    // get a bare `asString`/`asStringOrNull` coercion instead, even though they become an
    // `<a href>`/`<img src>` a browser will act on, which is a worse outcome than a mislabelled
    // category. `NormalizedArticleSchema` constrains both with `z.httpUrl()` on the write side
    // (src/types/article.ts) -- these pin the same http(s)-only rule at the read boundary, which
    // is the only check either field gets on `fetchArchiveDay`'s path (unauthenticated NDJSON,
    // never validated by that schema at all).
    it("keeps a valid https url unchanged", () => {
      expect(toFeedArticle(raw({ url: "https://example.com/story" })).url).toBe(
        "https://example.com/story",
      );
    });

    it("keeps a valid http imageUrl unchanged", () => {
      expect(toFeedArticle(raw({ imageUrl: "http://example.com/hero.png" })).imageUrl).toBe(
        "http://example.com/hero.png",
      );
    });

    it("coerces url to the empty string, never passing a javascript: scheme through, for a non-http(s) url", () => {
      expect(toFeedArticle(raw({ url: "javascript:alert(1)" })).url).toBe("");
    });

    it("coerces url to the empty string for an unparseable string", () => {
      expect(toFeedArticle(raw({ url: "not a url" })).url).toBe("");
    });

    it("coerces imageUrl to null, never passing a javascript: scheme through, for a non-http(s) imageUrl", () => {
      expect(toFeedArticle(raw({ imageUrl: "javascript:alert(1)" })).imageUrl).toBeNull();
    });

    it("coerces imageUrl to null for a data: URI, which z.httpUrl() would also reject on the write side", () => {
      expect(toFeedArticle(raw({ imageUrl: "data:text/html,hi" })).imageUrl).toBeNull();
    });
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

describe("deduplicateStories", () => {
  it("keeps only the highest-ranked article from a real story cluster", () => {
    const items = [
      raw({ title: "Primary coverage", score: 900, pk: `ART#${"a".repeat(64)}` }),
      raw({ title: "Duplicate coverage", score: 800, pk: `ART#${"b".repeat(64)}` }),
      raw({
        title: "Different story",
        score: 700,
        clusterId: "2026-08-18#other",
        pk: `ART#${"c".repeat(64)}`,
      }),
    ].map(toFeedArticle);

    expect(deduplicateStories(items).map((article) => article.title)).toEqual([
      "Primary coverage",
      "Different story",
    ]);
  });

  it("never collapses missing or __self__ cluster ids", () => {
    const items = [
      raw({ title: "Unranked A", clusterId: undefined, pk: `ART#${"a".repeat(64)}` }),
      raw({ title: "Unranked B", clusterId: undefined, pk: `ART#${"b".repeat(64)}` }),
      raw({ title: "Singleton A", clusterId: "__self__:shared", pk: `ART#${"c".repeat(64)}` }),
      raw({ title: "Singleton B", clusterId: "__self__:shared", pk: `ART#${"d".repeat(64)}` }),
    ].map(toFeedArticle);

    expect(deduplicateStories(items)).toHaveLength(4);
  });

  it("fuzzy-collapses near-identical unclustered titles from different sources", () => {
    const items = [
      raw({
        title: "OpenAI launches GPT-6 model for developers",
        clusterId: null,
        source: "techcrunch",
        pk: `ART#${"a".repeat(64)}`,
      }),
      raw({
        title: "OpenAI launches GPT 6 model for developers!",
        clusterId: "__self__:b",
        source: "verge",
        pk: `ART#${"b".repeat(64)}`,
      }),
    ].map(toFeedArticle);

    expect(deduplicateStories(items).map((article) => article.title)).toEqual([
      "OpenAI launches GPT-6 model for developers",
    ]);
  });

  it("does not fuzzy-collapse different model numbers", () => {
    const items = [
      raw({
        title: "OpenAI launches GPT-6 model for developers",
        clusterId: null,
        source: "techcrunch",
      }),
      raw({
        title: "OpenAI launches GPT-7 model for developers",
        clusterId: null,
        source: "verge",
        pk: `ART#${"b".repeat(64)}`,
      }),
    ].map(toFeedArticle);

    expect(deduplicateStories(items)).toHaveLength(2);
  });

  it("does not fuzzy-collapse a one-token product-name change", () => {
    const items = [
      raw({
        title: "Google launches Gemini Nano model for Android developers",
        clusterId: null,
        source: "techcrunch",
      }),
      raw({
        title: "Google launches Gemma Nano model for Android developers",
        clusterId: null,
        source: "verge",
        pk: `ART#${"b".repeat(64)}`,
      }),
    ].map(toFeedArticle);

    expect(deduplicateStories(items)).toHaveLength(2);
  });

  it("does not fuzzy-collapse same-source, cross-section, stale, or short generic titles", () => {
    const base = {
      title: "OpenAI launches GPT-6 model for developers",
      clusterId: null,
      source: "techcrunch",
    };
    const variants = [
      raw({ ...base, pk: `ART#${"a".repeat(64)}` }),
      raw({ ...base, pk: `ART#${"b".repeat(64)}` }),
      raw({ ...base, source: "verge", section: "design", pk: `ART#${"c".repeat(64)}` }),
      raw({
        ...base,
        source: "verge",
        publishedAt: "2026-08-10T09:00:00.000Z",
        pk: `ART#${"d".repeat(64)}`,
      }),
      raw({
        title: "OpenAI model update",
        clusterId: null,
        source: "verge",
        pk: `ART#${"e".repeat(64)}`,
      }),
    ].map(toFeedArticle);

    expect(deduplicateStories(variants)).toHaveLength(5);
  });
});

describe("hasCorroboration", () => {
  it("is true for a real cluster shared by more than one article", () => {
    const a = toFeedArticle(raw({ clusterId: "2026-08-18#gpt6", corroborationToday: 2 }));
    expect(hasCorroboration(a)).toBe(true);
  });

  it("is false when corroborationToday is 1, even for a real clusterId", () => {
    const a = toFeedArticle(raw({ clusterId: "2026-08-18#gpt6", corroborationToday: 1 }));
    expect(hasCorroboration(a)).toBe(false);
  });

  it("is false for a __self__ id, even when corroborationToday is (wrongly) inflated", () => {
    const a = toFeedArticle(raw({ clusterId: "__self__:shared", corroborationToday: 5 }));
    expect(hasCorroboration(a)).toBe(false);
  });

  it("is false when clusterId is null (a degraded day, clustering never ran)", () => {
    const a = toFeedArticle(raw({ clusterId: undefined, corroborationToday: 5 }));
    expect(hasCorroboration(a)).toBe(false);
  });

  it("is false when corroborationToday itself is null", () => {
    const a = toFeedArticle(raw({ clusterId: "2026-08-18#gpt6", corroborationToday: undefined }));
    expect(hasCorroboration(a)).toBe(false);
  });
});
