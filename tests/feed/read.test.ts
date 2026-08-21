import { DynamoDBDocumentClient, GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __setDocClient } from "../../src/lib/store/client.js";
import {
  getArchive, getArticle, getDay, getRecentDays, getRunStatus,
} from "../../src/lib/feed/read.js";
import { MAX_ARCHIVE_DAYS } from "../../src/lib/feed/days.js";

const HASH = "b".repeat(64);

const dayMetaItem = (over: Record<string, unknown> = {}) => ({
  day: "2020-01-01", status: "complete", articleCount: 1,
  llmRanked: 1, truncated: 0, llmStatus: "ok", runId: "r1", completedAt: "2020-01-01T00:00:00.000Z",
  ...over,
});

const rawArticle = (over: Record<string, unknown> = {}) => ({
  pk: `ART#${HASH}`, sk: "A", title: "T", summary: "s", imageUrl: null,
  url: "https://e.com/p", source: "techcrunch", sourceName: "TechCrunch",
  category: "news", section: "ai", publishedAt: "2020-01-01T09:00:00.000Z",
  clusterId: null, corroborationToday: null, whyItMatters: null, score: 500,
  scoreVersion: "v1", points: null, pointsImputed: true, llmImportance: null,
  firstSeenAt: "2020-01-01T10:00:00.000Z",
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
});

describe("getArticle", () => {
  it("reads the base table with GetCommand and never issues a Query against the index", async () => {
    ddb.on(GetCommand).resolves({ Item: rawArticle() });

    await getArticle(HASH);

    const call = ddb.commandCalls(GetCommand)[0]!.args[0].input;
    expect(call.TableName).toBe("the-table");
    expect(call.Key).toEqual({ pk: `ART#${HASH}`, sk: "A" });
    expect(ddb.commandCalls(GetCommand)).toHaveLength(1);
    expect(ddb.commandCalls(QueryCommand)).toHaveLength(0);
  });

  it("returns ingestDay and publishedAtSource, which the feed-by-day index never projects", async () => {
    ddb.on(GetCommand).resolves({
      Item: rawArticle({ ingestDay: "2020-01-01", publishedAtSource: "fallback" }),
    });

    const article = await getArticle(HASH);

    expect(article?.urlHash).toBe(HASH);
    expect(article?.ingestDay).toBe("2020-01-01");
    expect(article?.publishedAtSource).toBe("fallback");
  });

  it("returns null, never throws, for a missing article", async () => {
    ddb.on(GetCommand).resolves({});
    expect(await getArticle(HASH)).toBeNull();
  });
});

describe("getDay", () => {
  it("looks up META#DAY by the exact date given", async () => {
    ddb.on(QueryCommand, { IndexName: "feed-by-day" }).resolves({ Items: [] });
    ddb.on(GetCommand).resolves({ Item: dayMetaItem({ day: "2019-03-04", status: "complete" }) });

    await getDay("2019-03-04");

    const call = ddb.commandCalls(GetCommand)[0]!.args[0].input;
    expect(call.Key).toEqual({ pk: "META#DAY", sk: "2019-03-04" });
  });

  it("returns status null when articles exist but no META#DAY record does", async () => {
    ddb.on(QueryCommand, { IndexName: "feed-by-day" }).resolves({ Items: [rawArticle()] });
    ddb.on(GetCommand).resolves({});

    const result = await getDay("2026-08-01");

    expect(result.day).toBe("2026-08-01");
    expect(result.status).toBeNull();
    expect(result.llmRankedInDay).toBeNull();
    expect(result.truncatedInDay).toBeNull();
    expect(result.articles).toHaveLength(1);
  });

  it("carries the found DayMeta's status through when a record exists", async () => {
    ddb.on(QueryCommand, { IndexName: "feed-by-day" }).resolves({ Items: [] });
    ddb.on(GetCommand).resolves({
      Item: dayMetaItem({ day: "2026-08-01", status: "partial", llmRanked: 4, truncated: 1 }),
    });

    const result = await getDay("2026-08-01");

    expect(result.status).toBe("partial");
    expect(result.llmRankedInDay).toBe(4);
    expect(result.truncatedInDay).toBe(1);
  });

  it("returns status null rather than trusting an unrecognised DayMeta.status value", async () => {
    ddb.on(QueryCommand, { IndexName: "feed-by-day" }).resolves({ Items: [] });
    ddb.on(GetCommand).resolves({ Item: dayMetaItem({ status: "bogus" }) });

    const result = await getDay("2020-01-01");

    expect(result.status).toBeNull();
  });

  it("degrades to status null, keeping the articles, when the META#DAY read rejects", async () => {
    ddb.on(QueryCommand, { IndexName: "feed-by-day" }).resolves({ Items: [rawArticle()] });
    ddb.on(GetCommand).rejects(new Error("throttled"));

    const result = await getDay("2026-08-01");

    expect(result.status).toBeNull();
    expect(result.articles).toHaveLength(1);
  });
});

describe("getRecentDays", () => {
  it("asks listDays for `count` days when within MAX_ARCHIVE_DAYS, not a larger fixed number", async () => {
    ddb.on(QueryCommand).resolves({ Items: [dayMetaItem({ day: "2020-01-01" })] });
    ddb.on(QueryCommand, { IndexName: "feed-by-day" }).resolves({ Items: [] });

    await getRecentDays("ai", 3);

    const listDaysCall = ddb.commandCalls(QueryCommand)
      .find((c) => c.args[0].input.IndexName === undefined)!;
    expect(listDaysCall.args[0].input.Limit).toBe(3);
  });

  it("clamps `count` to at most MAX_ARCHIVE_DAYS before calling listDays -- fix round 1, Q2/Q5", async () => {
    // Mirrors getArchive's own internal clamp: unlike getArchive's unclamped case (one Query
    // with a large Limit -- a merely partial page), an unclamped count here fans out into
    // `count` full-partition queryDay Queries fired simultaneously with no concurrency limit --
    // a real cost/latency incident, not a cheap wrong answer. parseDaysParam is a separate,
    // already-tested boundary at the page level; this is the backstop for every other caller.
    ddb.on(QueryCommand).resolves({ Items: [dayMetaItem({ day: "2020-01-01" })] });
    ddb.on(QueryCommand, { IndexName: "feed-by-day" }).resolves({ Items: [] });

    await getRecentDays("ai", 1000);

    const listDaysCall = ddb.commandCalls(QueryCommand)
      .find((c) => c.args[0].input.IndexName === undefined)!;
    expect(listDaysCall.args[0].input.Limit).toBe(MAX_ARCHIVE_DAYS);
  });

  it("returns no results and no failures, and issues no day queries, when no day has ever ranked", async () => {
    ddb.on(QueryCommand).resolves({ Items: [] });

    const outcome = await getRecentDays("ai", 7);

    expect(outcome).toEqual({ results: [], failedDays: 0 });
    expect(ddb.commandCalls(QueryCommand).filter((c) => c.args[0].input.IndexName === "feed-by-day"))
      .toHaveLength(0);
  });

  it("never issues a GetCommand per day -- reuses each day's own DayMeta from listDays, not getDay", async () => {
    ddb.on(QueryCommand).resolves({
      Items: [dayMetaItem({ day: "2020-01-02" }), dayMetaItem({ day: "2020-01-01" })],
    });
    ddb.on(QueryCommand, { IndexName: "feed-by-day" }).resolves({ Items: [] });

    await getRecentDays("ai", 2);

    expect(ddb.commandCalls(GetCommand)).toHaveLength(0);
  });

  it("filters each day's articles to the requested section via bySection, not by returning everything", async () => {
    ddb.on(QueryCommand).resolves({ Items: [dayMetaItem({ day: "2020-01-01" })] });
    ddb.on(QueryCommand, { IndexName: "feed-by-day" }).resolves({
      Items: [
        rawArticle({ pk: `ART#${"a".repeat(64)}`, section: "ai" }),
        rawArticle({ pk: `ART#${"c".repeat(64)}`, section: "design" }),
      ],
    });

    const { results } = await getRecentDays("design", 1);

    expect(results).toHaveLength(1);
    expect(results[0]!.articles).toHaveLength(1);
    expect(results[0]!.articles[0]!.urlHash).toBe("c".repeat(64));
  });

  it("carries each day's own status/llmRanked/truncated through, from listDays' own record", async () => {
    ddb.on(QueryCommand).resolves({
      Items: [dayMetaItem({ day: "2020-01-01", status: "partial", llmRanked: 9, truncated: 2 })],
    });
    ddb.on(QueryCommand, { IndexName: "feed-by-day" }).resolves({ Items: [] });

    const { results } = await getRecentDays("ai", 1);

    expect(results).toEqual([
      { day: "2020-01-01", articles: [], status: "partial", llmRankedInDay: 9, truncatedInDay: 2 },
    ]);
  });

  describe("coercing listDays' own unchecked cast -- final review, M4", () => {
    // `listDays` (src/lib/store/query.ts) casts DynamoDB's raw Items straight to `DayMeta[]` with
    // no field coercion at all. `getDay` already runs `status`/`llmRanked`/`truncated` through
    // `memberOrNull`/`asNumberOrNull` for the exact same reason; before this fix, `getRecentDays`
    // trusted `listDays`' cast verbatim, so a record missing `llmRanked` (or carrying an
    // unrecognised `status`) reached `FeedResult` as `undefined`/the raw string, which is not
    // `null` -- `FeedView`'s `llmRankedInDay !== null` guard let `undefined` straight through and
    // rendered the literal string "undefined stories ranked across all sections."
    it("returns llmRankedInDay/truncatedInDay null, never undefined, for a record missing those fields", async () => {
      const { day: _day, llmRanked: _llmRanked, truncated: _truncated, ...rest } = dayMetaItem({ day: "2020-01-01" });
      ddb.on(QueryCommand).resolves({ Items: [{ ...rest, day: "2020-01-01" }] });
      ddb.on(QueryCommand, { IndexName: "feed-by-day" }).resolves({ Items: [] });

      const { results } = await getRecentDays("ai", 1);

      expect(results[0]!.llmRankedInDay).toBeNull();
      expect(results[0]!.truncatedInDay).toBeNull();
    });

    it("returns status null rather than trusting an unrecognised DayMeta.status value", async () => {
      ddb.on(QueryCommand).resolves({ Items: [dayMetaItem({ day: "2020-01-01", status: "COMPLETE" })] });
      ddb.on(QueryCommand, { IndexName: "feed-by-day" }).resolves({ Items: [] });

      const { results } = await getRecentDays("ai", 1);

      expect(results[0]!.status).toBeNull();
    });
  });

  it("keeps listDays' own newest-first order, regardless of which day's query resolves first", async () => {
    ddb.on(QueryCommand).resolves({
      Items: [
        dayMetaItem({ day: "2020-01-03" }),
        dayMetaItem({ day: "2020-01-02" }),
        dayMetaItem({ day: "2020-01-01" }),
      ],
    });

    let releaseNewest = () => {};
    const gate = new Promise<void>((resolve) => { releaseNewest = resolve; });

    ddb.on(QueryCommand, { IndexName: "feed-by-day" }).callsFake(
      async (input: { ExpressionAttributeValues: Record<string, string> }) => {
        // The NEWEST day is the one that resolves LAST -- if the implementation ever assembled
        // its result array in completion order (e.g. pushing into an array as each promise
        // settles) rather than relying on `Promise.allSettled`'s positional guarantee, this would
        // put 2020-01-03 at the end instead of the start.
        if (input.ExpressionAttributeValues[":d"] === "DAY#2020-01-03") await gate;
        return { Items: [] };
      },
    );

    const promise = getRecentDays("ai", 3);
    await new Promise((r) => setTimeout(r, 10));
    releaseNewest();

    const { results } = await promise;
    expect(results.map((d) => d.day)).toEqual(["2020-01-03", "2020-01-02", "2020-01-01"]);
  });

  it("issues its per-day queries concurrently, not one after another", async () => {
    ddb.on(QueryCommand).resolves({
      Items: [
        dayMetaItem({ day: "2020-01-03" }),
        dayMetaItem({ day: "2020-01-02" }),
        dayMetaItem({ day: "2020-01-01" }),
      ],
    });

    const invoked: string[] = [];
    let release = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });

    ddb.on(QueryCommand, { IndexName: "feed-by-day" }).callsFake(
      async (input: { ExpressionAttributeValues: Record<string, string> }) => {
        const day = input.ExpressionAttributeValues[":d"]!;
        invoked.push(day);
        // Only the NEWEST day's query ever hangs. A sequential implementation (a `for` loop
        // awaiting each `queryDay` before starting the next) would never issue the other two
        // days' queries until this one resolves -- so `invoked` would still hold only one entry
        // at the checkpoint below. A concurrent `Promise.allSettled` issues all three `send()`
        // calls synchronously, before any of them can resolve.
        if (day === "DAY#2020-01-03") await gate;
        return { Items: [] };
      },
    );

    const promise = getRecentDays("ai", 3);
    await new Promise((r) => setTimeout(r, 10));

    expect(invoked.sort()).toEqual(["DAY#2020-01-01", "DAY#2020-01-02", "DAY#2020-01-03"]);

    release();
    await promise;
  });

  describe("a rejected queryDay -- final review, M2", () => {
    // `getDay` already wrote this rule down for its own two-read fan-out: a failed secondary read
    // must not discard data that came back fine. Before this fix, `getRecentDays` used
    // `Promise.all`, so a single throttled day's `queryDay` rejected the WHOLE call and blanked
    // the entire home feed, discarding every other day's data that had already come back.
    it("does not reject the whole call when one day's queryDay throws", async () => {
      ddb.on(QueryCommand).resolves({ Items: [dayMetaItem({ day: "2020-01-01" })] });
      ddb.on(QueryCommand, { IndexName: "feed-by-day" }).rejects(new Error("throttled"));

      await expect(getRecentDays("ai", 1)).resolves.toBeDefined();
    });

    it("keeps the days that resolved and counts the one that failed, preserving newest-first order", async () => {
      ddb.on(QueryCommand).resolves({
        Items: [
          dayMetaItem({ day: "2020-01-03" }),
          dayMetaItem({ day: "2020-01-02" }),
          dayMetaItem({ day: "2020-01-01" }),
        ],
      });
      ddb.on(QueryCommand, { IndexName: "feed-by-day" }).callsFake(
        (input: { ExpressionAttributeValues: Record<string, string> }) => {
          if (input.ExpressionAttributeValues[":d"] === "DAY#2020-01-02") {
            throw new Error("throttled");
          }
          return { Items: [] };
        },
      );

      const outcome = await getRecentDays("ai", 3);

      expect(outcome.failedDays).toBe(1);
      expect(outcome.results.map((d) => d.day)).toEqual(["2020-01-03", "2020-01-01"]);
    });

    it("reports failedDays: 0 when nothing fails -- the count is exact, not just truthy", async () => {
      ddb.on(QueryCommand).resolves({
        Items: [dayMetaItem({ day: "2020-01-02" }), dayMetaItem({ day: "2020-01-01" })],
      });
      ddb.on(QueryCommand, { IndexName: "feed-by-day" }).resolves({ Items: [] });

      const outcome = await getRecentDays("ai", 2);

      expect(outcome.failedDays).toBe(0);
    });

    it("counts every failed day when all of them reject", async () => {
      ddb.on(QueryCommand).resolves({
        Items: [dayMetaItem({ day: "2020-01-02" }), dayMetaItem({ day: "2020-01-01" })],
      });
      ddb.on(QueryCommand, { IndexName: "feed-by-day" }).rejects(new Error("throttled"));

      const outcome = await getRecentDays("ai", 2);

      expect(outcome.failedDays).toBe(2);
      expect(outcome.results).toEqual([]);
    });
  });

  it("throws a clear error naming TABLE_NAME when it is not set", async () => {
    delete process.env.TABLE_NAME;
    await expect(getRecentDays("ai", 7)).rejects.toThrow(/TABLE_NAME/);
  });
});

describe("getArchive", () => {
  it("wraps listDays, passing the limit through and returning its days unchanged", async () => {
    ddb.on(QueryCommand).resolves({ Items: [dayMetaItem()] });

    const days = await getArchive(5);

    expect(days).toEqual([dayMetaItem()]);
    expect(ddb.commandCalls(QueryCommand)[0]!.args[0].input.Limit).toBe(5);
  });

  it("clamps a caller-supplied limit above the archive's 60-day bound", async () => {
    ddb.on(QueryCommand).resolves({ Items: [] });

    await getArchive(500);

    expect(ddb.commandCalls(QueryCommand)[0]!.args[0].input.Limit).toBe(60);
  });
});

describe("getRunStatus", () => {
  const lastRunItem = {
    pk: "META#lastRun", sk: "A", startedAt: "2026-08-01T00:00:00.000Z", durationMs: 100,
    perSourceCounts: {}, filtered: {}, quarantined: {}, llmStatus: "ok",
    itemsWritten: 10, itemsFailed: 0, errors: [],
  };

  it("reads META#lastRun / A and maps the item", async () => {
    ddb.on(GetCommand).resolves({ Item: lastRunItem });

    const status = await getRunStatus();

    expect(ddb.commandCalls(GetCommand)[0]!.args[0].input.Key).toEqual({ pk: "META#lastRun", sk: "A" });
    expect(status?.startedAt).toBe("2026-08-01T00:00:00.000Z");
    expect(status?.itemsWritten).toBe(10);
  });

  it("returns null rather than throwing when the pipeline has never run", async () => {
    ddb.on(GetCommand).resolves({});
    expect(await getRunStatus()).toBeNull();
  });

  it("coerces the counters the header iterates, instead of letting them reach the component", async () => {
    // Spec section 8's header walks perSourceCounts / filtered / quarantined / errors. A
    // malformed write reaching a component throws there, far from the boundary that could
    // have caught it -- and takes the whole health surface down with it.
    ddb.on(GetCommand).resolves({ Item: {
      ...lastRunItem,
      // NaN is typeof "number" -- DynamoDB decimal overflow can produce one on unmarshal, and
      // it would render as garbage rather than crash, which is the harder kind to notice.
      perSourceCounts: { hn: 3, bad: "not-a-number", overflowed: Number.NaN },
      filtered: "not-an-object",
      quarantined: null,
      // The last two entries discriminate the two checks separately: drop the source check and
      // the bad-source entry survives; drop the message check and the bad-message one does.
      errors: [
        { source: "hn", message: "boom" },
        "junk",
        { source: "ok-source", message: 42 },
        { source: 42, message: "ok-message" },
      ],
    } });

    const status = await getRunStatus();

    expect(status?.perSourceCounts).toEqual({ hn: 3 });
    expect(status?.filtered).toEqual({});
    expect(status?.quarantined).toEqual({});
    expect(status?.errors).toEqual([{ source: "hn", message: "boom" }]);
  });

  it("keeps the record but nulls llmStatus when the stored value is unrecognised", async () => {
    // Discarding the whole record here would make "capture wrote a status we do not
    // understand" indistinguishable from "capture has never run" -- the health page would go
    // blank at exactly the moment something unusual is in the data. Every other counter in
    // the record is still true, so the record survives and only the bad field is nulled.
    ddb.on(GetCommand).resolves({ Item: { ...lastRunItem, llmStatus: "bogus" } });

    const status = await getRunStatus();

    expect(status).not.toBeNull();
    expect(status?.llmStatus).toBeNull();
    expect(status?.itemsWritten).toBe(10);
  });
});
