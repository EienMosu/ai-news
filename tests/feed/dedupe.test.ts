import { describe, expect, it } from "vitest";
import { repeatedStoryHashes, storyKey } from "../../src/lib/feed/dedupe.js";
import type { FeedResult } from "../../src/lib/feed/read.js";
import type { FeedArticle } from "../../src/lib/feed/shape.js";

/** A minimal, fully-typed FeedArticle -- only urlHash/clusterId vary per test, since those two
 *  fields are the only ones the dedupe module reads. */
const article = (over: Partial<FeedArticle> = {}): FeedArticle => ({
  urlHash: "a".repeat(64),
  url: "https://example.com/p",
  title: "",
  summary: "",
  imageUrl: null,
  source: "example",
  sourceName: "",
  category: null,
  section: null,
  publishedAt: null,
  clusterId: null,
  corroborationToday: null,
  whyItMatters: null,
  score: 0,
  scoreVersion: "v1",
  points: null,
  pointsImputed: false,
  llmImportance: null,
  firstSeenAt: "2026-08-18T10:00:00.000Z",
  ...over,
});

const day = (day: string, articles: FeedArticle[]): FeedResult => ({
  articles,
  day,
  status: "complete",
  llmRankedInDay: articles.length,
  truncatedInDay: 0,
});

describe("storyKey", () => {
  it("is the slug behind the day namespace for a clustered article", () => {
    expect(storyKey(article({ clusterId: "2026-08-21#ai-destroys-rare-books" }))).toBe(
      "ai-destroys-rare-books",
    );
  });

  it("keeps the same slug across two days' namespaces", () => {
    const monday = storyKey(article({ clusterId: "2026-08-20#lfm25-dspark-inference" }));
    const tuesday = storyKey(article({ clusterId: "2026-08-21#lfm25-dspark-inference" }));
    expect(monday).toBe(tuesday);
  });

  it("is the whole clusterId for an unclustered __self__ article (already self-unique)", () => {
    expect(storyKey(article({ clusterId: `__self__:${"b".repeat(64)}` }))).toBe(
      `__self__:${"b".repeat(64)}`,
    );
  });

  it("falls back to the urlHash on a degraded day (null clusterId)", () => {
    expect(storyKey(article({ clusterId: null, urlHash: "c".repeat(64) }))).toBe("c".repeat(64));
  });
});

describe("repeatedStoryHashes", () => {
  it("folds a within-day cluster sibling, keeping the first (highest-scored) member", () => {
    const lead = article({ urlHash: "1".repeat(64), clusterId: "2026-08-21#books" });
    const sibling = article({ urlHash: "2".repeat(64), clusterId: "2026-08-21#books" });
    const repeats = repeatedStoryHashes([day("2026-08-21", [lead, sibling])]);
    expect(repeats.has(sibling.urlHash)).toBe(true);
    expect(repeats.has(lead.urlHash)).toBe(false);
  });

  it("folds an older day's repeat of a slug already shown in a newer day", () => {
    const newest = article({ urlHash: "1".repeat(64), clusterId: "2026-08-21#lfm" });
    const older = article({ urlHash: "2".repeat(64), clusterId: "2026-08-20#lfm" });
    const repeats = repeatedStoryHashes([
      day("2026-08-21", [newest]),
      day("2026-08-20", [older]),
    ]);
    expect(repeats.has(older.urlHash)).toBe(true);
    expect(repeats.has(newest.urlHash)).toBe(false);
  });

  it("never folds distinct stories, even with articles interleaved across days", () => {
    const results = [
      day("2026-08-21", [
        article({ urlHash: "1".repeat(64), clusterId: "2026-08-21#alpha" }),
        article({ urlHash: "2".repeat(64), clusterId: "2026-08-21#beta" }),
      ]),
      day("2026-08-20", [article({ urlHash: "3".repeat(64), clusterId: "2026-08-20#gamma" })]),
    ];
    expect(repeatedStoryHashes(results).size).toBe(0);
  });

  it("never folds two distinct articles on a degraded day (null clusterId falls back to urlHash)", () => {
    const results = [
      day("2026-08-21", [
        article({ urlHash: "1".repeat(64), clusterId: null }),
        article({ urlHash: "2".repeat(64), clusterId: null }),
      ]),
    ];
    expect(repeatedStoryHashes(results).size).toBe(0);
  });

  it("never folds two distinct __self__ singletons", () => {
    const results = [
      day("2026-08-21", [
        article({ urlHash: "1".repeat(64), clusterId: `__self__:${"1".repeat(64)}` }),
        article({ urlHash: "2".repeat(64), clusterId: `__self__:${"2".repeat(64)}` }),
      ]),
    ];
    expect(repeatedStoryHashes(results).size).toBe(0);
  });

  it("keeps only the newest of a slug ranked on three consecutive days", () => {
    const d21 = article({ urlHash: "1".repeat(64), clusterId: "2026-08-21#saga" });
    const d20 = article({ urlHash: "2".repeat(64), clusterId: "2026-08-20#saga" });
    const d19 = article({ urlHash: "3".repeat(64), clusterId: "2026-08-19#saga" });
    const repeats = repeatedStoryHashes([
      day("2026-08-21", [d21]),
      day("2026-08-20", [d20]),
      day("2026-08-19", [d19]),
    ]);
    expect(repeats.has(d21.urlHash)).toBe(false);
    expect(repeats.has(d20.urlHash)).toBe(true);
    expect(repeats.has(d19.urlHash)).toBe(true);
  });
});
