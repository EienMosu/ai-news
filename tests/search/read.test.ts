import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __setDocClient } from "../../src/lib/store/client.js";

// `fetchArchiveDay` is the network boundary (src/lib/search/archive.ts, already covered on its
// own in archive.test.ts against a stubbed `fetch`); mocking the module here means
// `searchArchiveDays` is exercised with no `fetch` call anywhere in this file.
vi.mock("../../src/lib/search/archive.js", () => ({ fetchArchiveDay: vi.fn() }));

import { fetchArchiveDay } from "../../src/lib/search/archive.js";
import { searchArchiveDays, searchRecentDays } from "../../src/lib/search/read.js";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

const rawArticle = (over: Record<string, unknown> = {}) => ({
  pk: `ART#${HASH_A}`, sk: "A", title: "Claude ships an agent SDK", summary: "Anthropic released it.",
  imageUrl: null, url: "https://e.com/p", source: "techcrunch", sourceName: "TechCrunch",
  category: "news", section: "ai", publishedAt: "2026-08-18T09:00:00.000Z",
  clusterId: null, corroborationToday: null, whyItMatters: null, score: 500,
  scoreVersion: "v1", points: null, pointsImputed: true, llmImportance: null,
  firstSeenAt: "2026-08-18T10:00:00.000Z",
  ...over,
});

const ddb = mockClient(DynamoDBDocumentClient);

beforeEach(() => {
  ddb.reset();
  process.env.TABLE_NAME = "the-table";
  __setDocClient(ddb as unknown as DynamoDBDocumentClient);
});

afterEach(() => {
  delete process.env.TABLE_NAME;
  __setDocClient(undefined);
  vi.mocked(fetchArchiveDay).mockReset();
});

describe("searchRecentDays", () => {
  it("queries the feed-by-day GSI for each requested day", async () => {
    ddb.on(QueryCommand).resolves({ Items: [] });
    await searchRecentDays(["2026-08-18", "2026-08-17"], "ai", "claude");
    const indexNames = ddb.commandCalls(QueryCommand).map((c) => c.args[0].input.IndexName);
    expect(indexNames).toEqual(["feed-by-day", "feed-by-day"]);
  });

  it("throws naming TABLE_NAME when it is not set", async () => {
    delete process.env.TABLE_NAME;
    await expect(searchRecentDays(["2026-08-18"], "ai", "claude")).rejects.toThrow("TABLE_NAME");
  });

  it("keeps only articles matching the query, dropping non-matches from a day that still has a hit", async () => {
    // Distinct from "drops a day entirely when it has zero matches" below: this pins the
    // per-article filter itself, on a day that is NOT dropped, so a mutation that broke only
    // the whole-day drop (and not the per-article filter, or vice versa) cannot hide behind
    // the other test -- an earlier version of this test used a single non-matching article and
    // asserted `results` was `[]`, which is exactly the same assertion the "drops a day
    // entirely" test already makes.
    ddb.on(QueryCommand).resolves({
      Items: [
        rawArticle({ pk: `ART#${HASH_A}`, title: "Claude ships an agent SDK" }),
        rawArticle({ pk: `ART#${HASH_B}`, title: "Nothing relevant here" }),
      ],
    });
    const outcome = await searchRecentDays(["2026-08-18"], "ai", "claude");
    expect(outcome.days).toHaveLength(1);
    expect(outcome.days[0]!.articles).toHaveLength(1);
    expect(outcome.days[0]!.articles[0]!.urlHash).toBe(HASH_A);
  });

  it("returns a day with its matching articles when the query hits", async () => {
    ddb.on(QueryCommand).resolves({ Items: [rawArticle()] });
    const outcome = await searchRecentDays(["2026-08-18"], "ai", "claude");
    expect(outcome).toEqual({
      days: [{ day: "2026-08-18", articles: [expect.objectContaining({ urlHash: HASH_A })] }],
      failedDays: 0,
    });
  });

  it("filters by section when given a real Section, not 'both'", async () => {
    ddb.on(QueryCommand).resolves({
      Items: [
        rawArticle({ pk: `ART#${HASH_A}`, section: "ai" }),
        rawArticle({ pk: `ART#${HASH_B}`, section: "design" }),
      ],
    });
    const outcome = await searchRecentDays(["2026-08-18"], "ai", "claude");
    expect(outcome.days[0]!.articles).toHaveLength(1);
    expect(outcome.days[0]!.articles[0]!.urlHash).toBe(HASH_A);
  });

  it("does not filter by section when scope is 'both'", async () => {
    ddb.on(QueryCommand).resolves({
      Items: [
        rawArticle({ pk: `ART#${HASH_A}`, section: "ai" }),
        rawArticle({ pk: `ART#${HASH_B}`, section: "design" }),
      ],
    });
    const outcome = await searchRecentDays(["2026-08-18"], "both", "claude");
    expect(outcome.days[0]!.articles).toHaveLength(2);
  });

  it("drops a day entirely when it has zero matches, rather than returning an empty entry", async () => {
    ddb.on(QueryCommand).resolves({ Items: [rawArticle({ title: "Nothing relevant here" })] });
    const outcome = await searchRecentDays(["2026-08-18"], "ai", "claude");
    expect(outcome.days).toHaveLength(0);
  });

  describe("a rejected queryDay -- final review, M2", () => {
    // The mirror of searchArchiveDays' own "a rejected fetchArchiveDay" tests below: this
    // function used to use Promise.all, so a single day's queryDay rejecting (a throttled
    // partition, say) rejected the whole call and discarded every other day's matches that had
    // already resolved -- the inversion of the allSettled rule getDay (src/lib/feed/read.ts)
    // wrote down, applied here for the first time.
    it("does not reject the whole call when one day's queryDay throws", async () => {
      ddb.on(QueryCommand).rejects(new Error("throttled"));
      await expect(searchRecentDays(["2026-08-18"], "ai", "claude")).resolves.toBeDefined();
    });

    it("keeps the days that resolved and counts the one that failed", async () => {
      ddb.on(QueryCommand).callsFake((input: { ExpressionAttributeValues: Record<string, string> }) => {
        if (input.ExpressionAttributeValues[":d"] === "DAY#2026-08-17") {
          throw new Error("throttled");
        }
        return { Items: [rawArticle({ title: "Claude ships an agent SDK" })] };
      });

      const outcome = await searchRecentDays(
        ["2026-08-18", "2026-08-17", "2026-08-16"], "ai", "claude",
      );

      expect(outcome.failedDays).toBe(1);
      expect(outcome.days.map((d) => d.day)).toEqual(["2026-08-18", "2026-08-16"]);
    });

    it("reports failedDays: 0 when nothing fails -- the count is exact, not just truthy", async () => {
      ddb.on(QueryCommand).resolves({ Items: [] });
      const outcome = await searchRecentDays(["2026-08-18", "2026-08-17"], "ai", "claude");
      expect(outcome.failedDays).toBe(0);
    });

    it("counts every failed day when all of them reject", async () => {
      ddb.on(QueryCommand).rejects(new Error("throttled"));
      const outcome = await searchRecentDays(
        ["2026-08-18", "2026-08-17", "2026-08-16"], "ai", "claude",
      );
      expect(outcome.failedDays).toBe(3);
      expect(outcome.days).toEqual([]);
    });
  });
});

describe("searchArchiveDays", () => {
  it("calls fetchArchiveDay for each requested day, never queryDay", async () => {
    vi.mocked(fetchArchiveDay).mockResolvedValue([]);
    await searchArchiveDays(["2026-07-01", "2026-06-30"], "ai", "claude");
    expect(fetchArchiveDay).toHaveBeenCalledWith("2026-07-01");
    expect(fetchArchiveDay).toHaveBeenCalledWith("2026-06-30");
    expect(ddb.commandCalls(QueryCommand)).toHaveLength(0);
  });

  it("filters archive results the same way searchRecentDays does", async () => {
    vi.mocked(fetchArchiveDay).mockResolvedValue([rawArticle()]);
    const outcome = await searchArchiveDays(["2026-07-01"], "ai", "claude");
    expect(outcome).toEqual({
      days: [{ day: "2026-07-01", articles: [expect.objectContaining({ urlHash: HASH_A })] }],
      failedDays: 0,
    });
  });

  it("drops an archive day with zero matches", async () => {
    vi.mocked(fetchArchiveDay).mockResolvedValue([rawArticle({ title: "Nothing relevant here" })]);
    const outcome = await searchArchiveDays(["2026-07-01"], "ai", "claude");
    expect(outcome).toEqual({ days: [], failedDays: 0 });
  });

  describe("a rejected fetchArchiveDay -- fix round 1, finding 5", () => {
    it("does not reject the whole call when one day's fetchArchiveDay throws", async () => {
      vi.mocked(fetchArchiveDay).mockRejectedValue(new Error("archive fetch for X failed: HTTP 502"));
      await expect(searchArchiveDays(["2026-07-01"], "ai", "claude")).resolves.toBeDefined();
    });

    it("keeps the days that resolved and counts the one that failed", async () => {
      vi.mocked(fetchArchiveDay).mockImplementation(async (day: string) => {
        if (day === "2026-07-02") throw new Error("HTTP 502");
        return [rawArticle()];
      });

      const outcome = await searchArchiveDays(["2026-07-03", "2026-07-02", "2026-07-01"], "ai", "claude");

      expect(outcome.failedDays).toBe(1);
      expect(outcome.days.map((d) => d.day)).toEqual(["2026-07-03", "2026-07-01"]);
    });

    it("reports failedDays: 0 when nothing fails -- the count is exact, not just truthy", async () => {
      vi.mocked(fetchArchiveDay).mockResolvedValue([]);
      const outcome = await searchArchiveDays(["2026-07-01", "2026-07-02"], "ai", "claude");
      expect(outcome.failedDays).toBe(0);
    });

    it("counts every failed day when all of them reject", async () => {
      vi.mocked(fetchArchiveDay).mockRejectedValue(new Error("HTTP 500"));
      const outcome = await searchArchiveDays(["2026-07-01", "2026-07-02", "2026-07-03"], "ai", "claude");
      expect(outcome.failedDays).toBe(3);
      expect(outcome.days).toEqual([]);
    });
  });
});
