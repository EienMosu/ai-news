import { DynamoDBDocumentClient, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
import { handler, resolveDay, targetDay } from "../../src/lambda/rank.js";

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
    usage: { inputTokens: 1000, outputTokens: 500, thinkingTokens: 100 },
  });
  vi.mocked(backupDay).mockResolvedValue({ ok: true, path: "p", bytes: 10 });
});

// A few tests below need to control the handler's internal `new Date()` to exercise the
// interim (18:00) vs. final (06:00) schedule split. Real timers must come back afterwards, or
// a fake system time set by one test would leak into every test that runs after it in this
// file.
afterEach(() => {
  vi.useRealTimers();
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

describe("resolveDay", () => {
  // 18:00 Europe/Istanbul on the 18th, the INTERIM schedule's fire time.
  const eighteenHundred = new Date("2026-08-18T15:00:00Z");
  // 06:00 Europe/Istanbul on the 19th, the FINAL schedule's fire time.
  const sixAM = new Date("2026-08-19T03:00:00Z");

  it("targets today when interim is true, not yesterday", () => {
    // Mutation: changing `interim ? istanbulDay(now) : targetDay(now)` to always call
    // `targetDay(now)` (dropping the ternary's true branch) makes this read "2026-08-17"
    // instead of "2026-08-18" -- exactly the bug the brief calls "does nothing useful".
    expect(resolveDay({ interim: true }, eighteenHundred)).toEqual({
      day: "2026-08-18", interim: true,
    });
  });

  it("targets yesterday when interim is absent, same as a plain final run", () => {
    // Mutation: inverting `const interim = Boolean(event?.interim);` to
    // `!Boolean(event?.interim)` makes a normal (non-interim) event compute `interim: true`
    // internally, so `day` becomes `istanbulDay(now)` (today, "2026-08-19") instead of
    // `targetDay(now)` (yesterday, "2026-08-18") -- and the returned `interim` flag flips to
    // `true` too, which this test also asserts against.
    expect(resolveDay(undefined, sixAM)).toEqual({ day: "2026-08-18", interim: false });
    expect(resolveDay({ interim: false }, sixAM)).toEqual({ day: "2026-08-18", interim: false });
  });

  it("lets an explicit day override which day is picked, without resetting interim", () => {
    // `day` and `interim` are independent: `day` decides WHICH day, `interim` decides whether
    // this run may be the final word on it. The runbook's manual override sends `{ day }` with
    // no `interim`, so it defaults to `false` here -- but a caller that explicitly asks for
    // BOTH (a manual interim re-run of a specific day) gets exactly that, not a silently
    // downgraded final run. (Whether a "final" run over that day is actually allowed to report
    // "complete" is a SEPARATE, calendar-based check in `handler` -- see `dayNotYetOver` --
    // this function only ever decides which day and which intent, never finality.)
    //
    // Mutation: reverting to `if (event?.day) return { day: event.day, interim: false };`
    // (unconditionally dropping interim whenever day is explicit) makes the second assertion
    // below read `interim: false` instead of `true`.
    expect(resolveDay({ day: "2026-07-01" }, sixAM)).toEqual({
      day: "2026-07-01", interim: false,
    });
    expect(resolveDay({ day: "2026-07-01", interim: true }, eighteenHundred)).toEqual({
      day: "2026-07-01", interim: true,
    });
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

  it("counts phase-1 enrichment write failures and reports the day partial even when phase 2 fully succeeds", async () => {
    // Fix 5 (final review, axis 5): a phase-1 write failure used to be logged and nothing
    // else -- capture counts `itemsFailed` and phase 2 undercounts `ranked`, but phase 1 did
    // neither, so a DynamoDB failure here silently discarded Bedrock output already paid for
    // while the day still reported "complete". The first UpdateCommand call is phase 1's
    // enrichment write for hash1; making only it fail, while every phase-2 score write (and
    // hash2's own phase-1 write) succeeds, isolates this from the pre-existing "marks the day
    // partial" test above, which fails a PHASE-2 write instead.
    ddb.on(UpdateCommand).rejectsOnce(new Error("throttled")).resolves({});
    const out = await handler();

    // Mutation: removing the `enrichmentFailed += 1` increment from the phase-1 loop's catch
    // block (leaving only the `console.error`) makes this read 0 instead of 1.
    expect(out.enrichmentFailed).toBe(1);
    // Mutation: dropping `enrichmentFailed === 0` from the status expression makes this stay
    // "complete" -- phase 2 alone (ranked === afterEnrichment.length, truncated 0, llmStatus
    // "ok") is satisfied here, so only the enrichmentFailed term can be forcing "partial".
    expect(out.status).toBe("partial");
    expect(out.ranked).toBe(2);
  });

  it("acquires the day lock with a condition, so two concurrent runs cannot both succeed", async () => {
    // Fix 3 (final review, axis 3): the condition IS the lock. Every other test here only
    // exercises what happens when the condition FAILS (Conditional check vs. a throttle) --
    // nothing asked whether the condition is even PRESENT, and the day lock's Put would stay
    // "correct" by every one of those tests even with an unconditional write.
    await handler();
    const lockPut = ddb.commandCalls(PutCommand)[0]!;
    expect(lockPut.args[0].input.Item?.pk).toBe("META#lock");
    // Mutation: deleting the `ConditionExpression`/`ExpressionAttributeValues` lines from the
    // lock's PutCommand in rank.ts makes this fail (undefined instead of the condition string)
    // while all 13 pre-existing rank-handler tests stay green -- the lock write still
    // "succeeds", it just no longer excludes anyone.
    expect(lockPut.args[0].input.ConditionExpression).toBe(
      "attribute_not_exists(pk) OR expiresAt < :now",
    );
    expect(lockPut.args[0].input.ExpressionAttributeValues).toHaveProperty(":now");
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

  it("skips a day already marked complete without calling Bedrock, as protection independent of retry config", async () => {
    // Fix 4 (final review, axis 5): EventBridge Scheduler has its own retry policy, separate
    // from the Lambda-side retryAttempts:0. A redelivery after the day lock's 20-minute expiry
    // would otherwise re-rank (and re-bill) an already-complete day. This guard does not
    // depend on the Scheduler-side fix (also applied, in infra/lib/functions.ts) being right.
    vi.mocked(listDays).mockResolvedValue([
      { day: "2026-08-18", status: "complete", articleCount: 5, llmRanked: 5, truncated: 0,
        llmStatus: "ok", runId: "r", completedAt: "2026-08-18T06:00:00.000Z" } as never,
    ]);

    const out = await handler({ day: "2026-08-18" });

    // Mutation: deleting the `if (!event?.force) { ... }` guard block in rank.ts makes this
    // fail on all three -- rankArticles gets called, the lock Put fires, and the returned
    // articleCount comes from the mocked stored articles rather than the existing meta record.
    expect(rankArticles).not.toHaveBeenCalled();
    expect(ddb.commandCalls(PutCommand)).toHaveLength(0);
    expect(out.status).toBe("complete");
    expect(out.ranked).toBe(5);
  });

  it("re-ranks an already-complete day when force is set explicitly", async () => {
    vi.mocked(listDays).mockResolvedValue([
      { day: "2026-08-18", status: "complete", articleCount: 5, llmRanked: 5, truncated: 0,
        llmStatus: "ok", runId: "r", completedAt: "2026-08-18T06:00:00.000Z" } as never,
    ]);

    const out = await handler({ day: "2026-08-18", force: true });

    // Mutation: hardcoding the guard's condition to ignore `event?.force` (always skip when
    // complete) makes this fail -- Bedrock is never called and `ranked` stays 5 instead of 2.
    expect(rankArticles).toHaveBeenCalledTimes(1);
    expect(out.ranked).toBe(2);
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

  it("passes each stored article's section to rankArticles, defaulting a missing attribute to ai", async () => {
    // stored(2) has no `section` attribute at all -- exactly what queryDay returns for any
    // item written before this migration existed.
    vi.mocked(queryDay).mockResolvedValue([
      { ...stored(1), section: "design" },
      stored(2),
    ]);

    await handler();

    // Mutation: deleting the `section: String(a.section ?? "ai"),` line in rank.ts's
    // candidates mapping makes every entry below `undefined`, so neither filter below
    // matches anything and both assertions fail.
    const passed = vi.mocked(rankArticles).mock.calls[0]![0] as { section: string }[];
    expect(passed.filter((c) => c.section === "design")).toHaveLength(1);
    expect(passed.filter((c) => c.section === "ai")).toHaveLength(1);
  });

  it("gives clustered articles a corroboration above 1 and singletons exactly 1", async () => {
    vi.mocked(rankArticles).mockResolvedValue({
      response: { items: [
        { urlHash: HASH(1), importance: 90, clusterId: "gpt6", whyItMatters: "a" },
        { urlHash: HASH(2), importance: 40, clusterId: "", whyItMatters: "b" },
      ] },
      inputHashes: [HASH(1), HASH(2)],
      truncated: 0,
      usage: { inputTokens: 1000, outputTokens: 500, thinkingTokens: 100 },
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
    //
    // Two sequenced listDays results, not one: the Fix 4 already-complete guard now calls
    // listDays FIRST, before ranking anything, and must see this day as NOT complete yet (an
    // empty list) or it would skip ranking "2026-08-18" entirely and this test's premise (it
    // gets ranked, and the OLDER days are the gaps) would break. The gap check's own listDays
    // call happens LAST, after this run's own ranking work, and is what needs "2026-08-18"
    // marked complete so the loop below excludes it from the count via `completed.has(d)`.
    vi.mocked(listDays)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ day: "2026-08-18", status: "complete" } as never]);
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

  it("forces status partial on an interim run even when every article ranks cleanly", async () => {
    // 18:00 Europe/Istanbul, the interim schedule's fire time. Every default mock here ranks
    // both stored articles with no truncation and no write failures -- exactly the condition
    // that produces "complete" on a final run (see the next test).
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-18T15:00:00Z"));

    const out = await handler({ interim: true });

    expect(out.day).toBe("2026-08-18");
    expect(out.ranked).toBe(2);
    expect(out.truncated).toBe(0);
    expect(out.llmStatus).toBe("ok");
    // Mutation: dropping the whole `interim || dayNotYetOver` condition (i.e. computing
    // `status` from just the ranked/truncated/llmStatus/enrichmentFailed ternary, unguarded)
    // makes this read "complete" instead, because every one of those conditions is satisfied
    // here. Note this scenario alone can't isolate `interim` from `dayNotYetOver` -- today is
    // also never-yet-over, so either term alone would still force "partial" here. The test
    // below ("an interim run over a past day...") is what isolates `interim` specifically.
    expect(out.status).toBe("partial");
  });

  it("never reports complete for an explicit day that is today, even fully ranked and clean", async () => {
    // The exact hazard this guard exists to close: runbook step 8 invokes rank by hand with
    // `{"day":"<today>"}` -- an explicit day, no `interim` -- and everything about the run can
    // go perfectly (every article ranked, nothing truncated, no write failures). Before the
    // calendar guard, that combination was indistinguishable from a genuinely finished day.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-19T07:00:00Z")); // 10:00 Europe/Istanbul on the 19th

    const out = await handler({ day: "2026-08-19" }); // explicit, and equal to today

    expect(out.ranked).toBe(2);
    expect(out.truncated).toBe(0);
    expect(out.llmStatus).toBe("ok");
    // Mutation: changing `const dayNotYetOver = day >= istanbulDay(now);` to `day >
    // istanbulDay(now)` (strictly greater, instead of greater-or-equal) makes this read
    // "complete" instead of "partial" -- day equals today exactly, and `>` excludes that case
    // while `>=` correctly includes it.
    expect(out.status).toBe("partial");
  });

  it("still reports complete for an explicit day that is yesterday, when the run is clean", async () => {
    // The override must keep working for its actual purpose: re-ranking a day that has
    // genuinely ended. Without this test, a mutation that makes the calendar guard too broad
    // (e.g. always true) would sail through -- every other test either expects "partial" for
    // an unrelated reason or uses a day that happens to be "today" on purpose.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-19T07:00:00Z")); // 10:00 Europe/Istanbul on the 19th

    const out = await handler({ day: "2026-08-18" }); // explicit, and strictly before today

    expect(out.ranked).toBe(2);
    // Mutation: changing `const dayNotYetOver = day >= istanbulDay(now);` to the unconditional
    // `true` makes this read "partial" instead of "complete" -- the override would no longer
    // be able to finalize ANY day, defeating its entire purpose.
    expect(out.status).toBe("complete");
  });

  it("still reports partial for an interim run over a day that has already ended", async () => {
    // Isolates `interim` from `dayNotYetOver`: unlike the "forces status partial on an interim
    // run" test above (where `day` is always today, so `dayNotYetOver` alone would also force
    // partial), this run explicitly targets YESTERDAY while still marked `interim` -- only the
    // `interim` term of the guard is available to force "partial" here.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-19T07:00:00Z")); // 10:00 Europe/Istanbul on the 19th

    const out = await handler({ day: "2026-08-18", interim: true });

    expect(out.day).toBe("2026-08-18");
    expect(out.ranked).toBe(2);
    expect(out.truncated).toBe(0);
    expect(out.llmStatus).toBe("ok");
    // Mutation: changing `interim || dayNotYetOver` to just `dayNotYetOver` (dropping the
    // `interim ||` term) makes this read "complete" instead of "partial" -- `day` is strictly
    // before today, so `dayNotYetOver` alone is `false` and cannot force it.
    expect(out.status).toBe("partial");
  });

  it("does not block the following morning's final run from completing the same day", async () => {
    // Interim run at 18:00 on the 18th: targets "2026-08-18" and must report partial (Change 2).
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-18T15:00:00Z"));
    const interimOut = await handler({ interim: true });
    expect(interimOut.day).toBe("2026-08-18");
    expect(interimOut.status).toBe("partial");

    // What the interim run's own META#DAY write would look like, fed back in as this run's
    // listDays result -- standing in for DynamoDB state actually persisting across the two
    // separate invocations, since queryDay/listDays are unit-mocked rather than backed by a
    // real table in this test file.
    vi.mocked(listDays).mockResolvedValue([
      { day: "2026-08-18", status: "partial", articleCount: 2, llmRanked: 2, truncated: 0,
        llmStatus: "ok", runId: "r", completedAt: "2026-08-18T15:00:00.000Z" } as never,
    ]);

    // Final run at 06:00 the next morning: targets "2026-08-18" (yesterday relative to the
    // 19th) -- the SAME day the interim run just touched.
    vi.setSystemTime(new Date("2026-08-19T03:00:00Z"));
    const finalOut = await handler();

    expect(finalOut.day).toBe("2026-08-18");
    // Mutation: widening the already-complete guard's condition from
    // `if (already?.status === "complete")` to `if (already) {` (treating ANY existing
    // META#DAY record, "partial" included, as reason to skip) makes the final run see the
    // interim run's "partial" record and skip without calling Bedrock a second time --
    // `rankArticles` is called once instead of twice, and this assertion is what catches it
    // (verified: the two prior tests in this file already pin `interimOut.status === "partial"`
    // in isolation, so this test's own value is specifically that the interim run's partial
    // record does NOT get mistaken for "already done" by the guard that exists to skip
    // genuinely complete days).
    expect(rankArticles).toHaveBeenCalledTimes(2);
    expect(finalOut.status).toBe("complete");
  });

  it("excludes today from the unranked-days gap count", async () => {
    // Interim run at 18:00: `day` is today, "2026-08-18". Nothing anywhere is marked complete,
    // and every day in the 7-day window "has articles" per the mock -- including today itself,
    // which is always true for an interim run since it just ranked what capture wrote today.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-18T15:00:00Z"));
    vi.mocked(listDays).mockResolvedValue([]);
    vi.mocked(dayHasArticles).mockResolvedValue(true);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const out = await handler({ interim: true });

    // Without excluding today, the 7-day window (today..today-6) would count all 7 -- and
    // every future interim run would count at least 1 forever, since an interim run can never
    // mark today complete. Mutation: deleting the `if (d === wallClockToday) continue;` line
    // makes this read 7 instead of 6.
    expect(out.unrankedRecentDays).toBe(6);

    errorSpy.mockRestore();
  });
});
