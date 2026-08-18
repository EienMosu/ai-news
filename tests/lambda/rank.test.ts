import { DynamoDBDocumentClient, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ddb = mockClient(DynamoDBDocumentClient);

vi.mock("../../src/lib/store/query.js", () => ({
  queryDay: vi.fn(), listDays: vi.fn(), dayHasArticles: vi.fn(),
}));
// Preserves the real TruncationError export via importActual: rank.ts imports it directly
// from this module for a live `instanceof` check, and a factory that returns only
// `{ rankArticles: vi.fn() }` would make every OTHER export (TruncationError included)
// resolve to undefined for every importer, not just this test file. `e instanceof undefined`
// throws, so without this every test that drives rankArticles into its catch branch would
// fail with a TypeError instead of exercising the "failed" vs "truncated" branch.
vi.mock("../../src/lib/rank/bedrock.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/lib/rank/bedrock.js")>(
    "../../src/lib/rank/bedrock.js",
  );
  return { ...actual, rankArticles: vi.fn() };
});
vi.mock("../../src/lib/rank/backup.js", () => ({ backupDay: vi.fn() }));

import { dayHasArticles, listDays, queryDay } from "../../src/lib/store/query.js";
import { rankArticles, TruncationError } from "../../src/lib/rank/bedrock.js";
import { backupDay } from "../../src/lib/rank/backup.js";
import { handler, targetDay } from "../../src/lambda/rank.js";

const HASH = (n: number) => String(n).padStart(64, "0");

const stored = (n: number) => ({
  pk: `ART#${HASH(n)}`, sk: "A", title: `T${n}`, summary: "s", sourceName: "TechCrunch",
  category: "news", publishedAt: "2026-08-18T09:00:00.000Z", points: null,
  firstSeenAt: "2026-08-18T10:00:00.000Z",
});

beforeEach(() => {
  ddb.reset();
  vi.clearAllMocks();
  process.env.TABLE_NAME = "t";
  delete process.env.GITHUB_TOKEN_PARAM;
  delete process.env.BACKUP_REPO;
  vi.mocked(queryDay).mockResolvedValue([stored(1), stored(2)]);
  // Default: no other days are missing a complete ranking, so the gap check (Fix 3) stays
  // quiet unless a test deliberately exercises it.
  vi.mocked(listDays).mockResolvedValue([]);
  vi.mocked(dayHasArticles).mockResolvedValue(false);
  vi.mocked(rankArticles).mockResolvedValue({
    response: { items: [
      { urlHash: HASH(1), importance: 90, clusterId: "gpt6", whyItMatters: "Big." },
      { urlHash: HASH(2), importance: 40, clusterId: "gpt6", whyItMatters: "Also." },
    ] },
    inputHashes: [HASH(1), HASH(2)],
    truncated: 0,
  });
  vi.mocked(backupDay).mockResolvedValue({ ok: true, path: "p", bytes: 10 });
});

describe("targetDay", () => {
  it("ranks the previous day, not today", () => {
    // The schedule fires at 06:00 Europe/Istanbul, which is 03:00 UTC (constant UTC+3).
    expect(targetDay(new Date("2026-08-19T03:00:00Z"))).toBe("2026-08-18");
  });

  it("does not slip a day at the local midnight boundary", () => {
    // 00:30 Istanbul on the 19th is 21:30 UTC on the 18th. A naive UTC slice would answer
    // "2026-08-17" here and "2026-08-18" an hour later.
    expect(targetDay(new Date("2026-08-18T21:30:00Z"))).toBe("2026-08-18");
  });
});

describe("rank handler", () => {
  it("writes META#DAY last, after every article write", async () => {
    const order: string[] = [];
    ddb.on(UpdateCommand).callsFake(() => { order.push("update"); return {}; });
    ddb.on(PutCommand).callsFake(() => { order.push("put"); return {}; });

    await handler();

    // Spec §4: readers follow the META#DAY pointer, so a day must never become visible
    // before its articles are written. The FIRST put is the day lock (spec §9, acquired
    // before either write phase); the LAST is META#DAY, and it comes after both the
    // phase-1 enrichment writes and the phase-2 score writes for both articles.
    expect(order).toEqual(["put", "update", "update", "update", "update", "put"]);
    expect(order.at(-1)).toBe("put");
    expect(order.at(0)).toBe("put");
  });

  it("marks the day partial when an article write failed", async () => {
    // The first two UpdateCommand calls are phase 1's enrichment writes (both succeed);
    // the failure lands on the first phase-2 SCORE write, which is what `ranked` actually
    // counts.
    ddb.on(UpdateCommand)
      .resolvesOnce({})
      .resolvesOnce({})
      .rejectsOnce(new Error("throttled"))
      .resolves({});
    const out = await handler();
    expect(out.status).toBe("partial");
    expect(out.ranked).toBe(1);
    const metaPut = ddb.commandCalls(PutCommand).at(-1)!.args[0].input.Item!;
    expect(metaPut.pk).toBe("META#DAY");
    expect(metaPut.status).toBe("partial");
  });

  it("refuses to run when another rank run already holds the day lock", async () => {
    // Genuine contention: the condition was evaluated and lost. Nothing is wrong -- this is
    // the lock doing its job, so no article write of either kind should happen.
    const err = new Error("The conditional request failed");
    err.name = "ConditionalCheckFailedException";
    ddb.on(PutCommand).rejects(err);

    const out = await handler();
    expect(out.status).toBe("partial");
    expect(out.llmStatus).toBe("ok");
    expect(ddb.commandCalls(UpdateCommand)).toHaveLength(0);
  });

  it("does not proceed when the lock write itself fails, since it cannot tell if it holds the lock", async () => {
    // A throttle or network error means the condition was never evaluated -- unlike genuine
    // contention, this must NOT look like "nothing was wrong" (llmStatus stays "ok" for that
    // case above); it needs its own signal so a human doesn't mistake a stuck day for a busy one.
    const err = new Error("Throughput exceeded");
    err.name = "ProvisionedThroughputExceededException";
    ddb.on(PutCommand).rejects(err);

    const out = await handler();
    expect(out.status).toBe("partial");
    expect(out.llmStatus).toBe("failed");
    expect(ddb.commandCalls(UpdateCommand)).toHaveLength(0);
  });

  it("keeps degraded scores and writes no null enrichment when Bedrock throws", async () => {
    vi.mocked(rankArticles).mockRejectedValue(new Error("AccessDeniedException"));
    const out = await handler();

    expect(out.llmStatus).toBe("failed");
    expect(out.ranked).toBe(2);
    for (const call of ddb.commandCalls(UpdateCommand)) {
      const values = call.args[0].input.ExpressionAttributeValues!;
      // A degraded run must refresh the score without destroying enrichment a previous
      // successful run wrote. Omitting the attribute is what makes that true.
      expect(JSON.stringify(values)).not.toContain("null");
      expect(Object.values(values)).toContain("v1-degraded");
    }
  });

  it("reports truncated, not failed, when Bedrock hits max_tokens", async () => {
    // Spec §6 / the task brief: a TruncationError was billed for the full 32k cap and
    // returned unusable output; an outage was not billed and may succeed on retry. Folding
    // both into "failed" would make that distinction invisible to whoever is paged.
    vi.mocked(rankArticles).mockRejectedValue(new TruncationError());
    const out = await handler();
    expect(out.llmStatus).toBe("truncated");
  });

  it("writes no META#DAY at all when the day is empty", async () => {
    vi.mocked(queryDay).mockResolvedValue([]);
    const out = await handler();
    expect(ddb.commandCalls(PutCommand)).toHaveLength(0);
    expect(out.status).toBe("partial");
  });

  it("still writes META#DAY when the GitHub backup fails", async () => {
    process.env.GITHUB_TOKEN_PARAM = "/ai-news/github-token";
    process.env.BACKUP_REPO = "EienMosu/ai-news";
    vi.mocked(backupDay).mockResolvedValue({ ok: false, path: "p", bytes: 0, error: "GitHub responded 401" });

    const out = await handler();
    // The ranked day is already in DynamoDB. Losing it to a GitHub outage would be strictly
    // worse than having no off-AWS copy for one day.
    expect(out.backedUp).toBe(false);
    expect(out.status).toBe("complete");
    // One Put for the day lock, one for META#DAY.
    expect(ddb.commandCalls(PutCommand)).toHaveLength(2);
  });

  it("gives clustered articles a corroboration above 1 and singletons exactly 1", async () => {
    vi.mocked(rankArticles).mockResolvedValue({
      response: { items: [
        { urlHash: HASH(1), importance: 90, clusterId: "gpt6", whyItMatters: "a" },
        { urlHash: HASH(2), importance: 40, clusterId: "", whyItMatters: "b" },
      ] },
      inputHashes: [HASH(1), HASH(2)],
      truncated: 0,
    });
    await handler();
    const corrs = ddb.commandCalls(UpdateCommand).map((c) =>
      Object.values(c.args[0].input.ExpressionAttributeValues!).find((v) => v === 1 || v === 2));
    // HASH(2) got no cluster, so reconcile made it __self__: — a singleton, never merged
    // with HASH(1) and never inflating its own corroboration.
    expect(corrs).toContain(1);
  });

  it("counts and logs days with articles but no complete ranking in the last week, without ranking them", async () => {
    // Fix 3 (Task 7 review): no automatic catch-up -- freshness beats completeness, and every
    // make-up day would be another Bedrock call. This only verifies the gap is COUNTED and
    // LOGGED, never that anything gets ranked for it.
    vi.mocked(listDays).mockResolvedValue([{ day: "2026-08-18", status: "complete" } as never]);
    vi.mocked(dayHasArticles).mockResolvedValue(true);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const out = await handler({ day: "2026-08-18" });

    // "2026-08-18" itself is marked complete and excluded; the six days before it all "have
    // articles" per the mock and have no complete record, so all six count as gaps.
    expect(out.unrankedRecentDays).toBe(6);
    expect(errorSpy).toHaveBeenCalledWith(
      "days with articles but no complete ranking in the last 7",
      expect.objectContaining({ unrankedRecentDays: 6 }),
    );
    // The only Bedrock call is this run's own -- one call, for "2026-08-18", not seven.
    expect(rankArticles).toHaveBeenCalledTimes(1);

    errorSpy.mockRestore();
  });
});
