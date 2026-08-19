import { DynamoDBDocumentClient, GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __setDocClient } from "../../src/lib/store/client.js";
import {
  getArchive, getArticle, getDay, getFeed, getRunStatus,
} from "../../src/lib/feed/read.js";

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

describe("getFeed", () => {
  it("queries the day getLatestCompleteDay names, never a computed date", async () => {
    // The mocked pointer names 2020-01-01, nowhere near "today" -- if getFeed ever computed
    // its own date instead of following the pointer, this assertion catches it regardless
    // of what day the test happens to run on.
    ddb.on(QueryCommand).resolves({ Items: [dayMetaItem()] });
    ddb.on(QueryCommand, { IndexName: "feed-by-day" }).resolves({ Items: [] });

    await getFeed("ai");

    const dayQuery = ddb.commandCalls(QueryCommand)
      .find((c) => c.args[0].input.IndexName === "feed-by-day")!;
    expect(dayQuery.args[0].input.ExpressionAttributeValues![":d"]).toBe("DAY#2020-01-01");
  });

  it("returns a partial day's status and day-wide counts rather than swallowing them", async () => {
    ddb.on(QueryCommand).resolves({
      Items: [dayMetaItem({ status: "partial", llmRanked: 2, truncated: 3 })],
    });
    ddb.on(QueryCommand, { IndexName: "feed-by-day" }).resolves({ Items: [] });

    const result = await getFeed("ai");

    expect(result.status).toBe("partial");
    expect(result.day).toBe("2020-01-01");
    expect(result.llmRankedInDay).toBe(2);
    expect(result.truncatedInDay).toBe(3);
  });

  it("filters to the requested section via bySection, not by returning everything", async () => {
    ddb.on(QueryCommand).resolves({ Items: [dayMetaItem()] });
    ddb.on(QueryCommand, { IndexName: "feed-by-day" }).resolves({
      Items: [
        rawArticle({ pk: `ART#${"a".repeat(64)}`, section: "ai" }),
        rawArticle({ pk: `ART#${"c".repeat(64)}`, section: "design" }),
      ],
    });

    const result = await getFeed("design");

    expect(result.articles).toHaveLength(1);
    expect(result.articles[0]!.urlHash).toBe("c".repeat(64));
  });

  it("returns an empty result rather than throwing when no day has ranked yet", async () => {
    ddb.on(QueryCommand).resolves({ Items: [] });

    const result = await getFeed("ai");

    expect(result).toEqual({
      articles: [], day: null, status: null, llmRankedInDay: null, truncatedInDay: null,
    });
  });

  it("returns a fresh object each call, not a shared singleton a caller can corrupt", async () => {
    ddb.on(QueryCommand).resolves({ Items: [] });

    const first = await getFeed("ai");
    first.articles.push({} as never);
    const second = await getFeed("ai");

    expect(second.articles).toHaveLength(0);
  });

  it("throws a clear error naming TABLE_NAME when it is not set", async () => {
    delete process.env.TABLE_NAME;
    await expect(getFeed("ai")).rejects.toThrow(/TABLE_NAME/);
  });
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
