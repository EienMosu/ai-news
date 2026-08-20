import { describe, expect, it } from "vitest";
import { buildDayMetaPut, buildIngestCounterIncrement, buildLastRunPut } from "../../src/lib/store/meta.js";
import type { DayMeta } from "../../src/lib/store/meta.js";
import { INGEST_DAILY_CAP } from "../../src/lib/store/keys.js";

describe("buildDayMetaPut", () => {
  it("sorts days lexicographically by using the ISO date as the sort key", () => {
    const item = buildDayMetaPut("t", {
      day: "2026-08-18", status: "complete", articleCount: 97,
      llmRanked: 97, truncated: 0, llmStatus: "ok",
      runId: "r1", completedAt: "2026-08-18T03:05:00.000Z",
    }).Item!;
    expect(item.pk).toBe("META#DAY");
    expect(item.sk).toBe("2026-08-18");
    expect(item.status).toBe("complete");
  });

  it("records how much of the day the model actually saw", () => {
    // These three are REQUIRED on DayMeta, not optional, and this is why: a day where 450 of
    // 650 articles never reached Bedrock would otherwise persist as plain "complete" and the
    // gap would exist only in a log line nobody reads. Making them optional lets the rank
    // handler omit them and reopens exactly that hole.
    const item = buildDayMetaPut("t", {
      day: "2026-08-18", status: "partial", articleCount: 650,
      llmRanked: 200, truncated: 450, llmStatus: "ok",
      runId: "r1", completedAt: "2026-08-18T03:05:00.000Z",
    }).Item!;
    expect(item.llmRanked).toBe(200);
    expect(item.truncated).toBe(450);
    expect(item.status).toBe("partial");
  });

  it("requires the fields that make a partly-ranked day visible", () => {
    // @ts-expect-error — llmRanked, truncated and llmStatus are REQUIRED. A day where most
    // articles never reached the model must not be constructible as though it were fully
    // ranked. If someone makes them optional, this @ts-expect-error has nothing to suppress
    // and `tsc` fails — which is the point.
    const incomplete: DayMeta = {
      day: "2026-08-18", status: "complete", articleCount: 97,
      runId: "r1", completedAt: "2026-08-18T03:05:00.000Z",
    };
    expect(incomplete.day).toBe("2026-08-18");
  });
});

describe("buildLastRunPut", () => {
  it("carries all three per-source counters, which is what makes a dead source detectable", () => {
    const item = buildLastRunPut("t", {
      startedAt: "2026-08-18T03:00:00.000Z", durationMs: 4200,
      perSourceCounts: { verge: 10, venturebeat: 0 },
      filtered: { venturebeat: 7 },
      quarantined: {},
      llmStatus: "ok", itemsWritten: 10, itemsFailed: 0, errors: [],
    }).Item!;
    // venturebeat produced 0 but filtered 7 -> quiet, not dead. Spec §8.
    expect(item.perSourceCounts.venturebeat).toBe(0);
    expect(item.filtered.venturebeat).toBe(7);
    expect(item.quarantined).toEqual({});
  });
});

describe("buildIngestCounterIncrement", () => {
  it("keys the counter as META#INGEST / <ingestDay>, its own item apart from META#lastRun", () => {
    const cmd = buildIngestCounterIncrement("t", "2026-08-20");
    expect(cmd.Key).toEqual({ pk: "META#INGEST", sk: "2026-08-20" });
  });

  it("uses an atomic ADD, not a read-then-write increment", () => {
    const cmd = buildIngestCounterIncrement("t", "2026-08-20");
    expect(cmd.UpdateExpression).toBe("ADD #count :one");
    expect(cmd.ExpressionAttributeValues).toMatchObject({ ":one": 1 });
  });

  it("conditions the increment on the stored count against INGEST_DAILY_CAP, or its absence", () => {
    // This is the atomic ceiling itself -- spec §9. Two simultaneous callers that both pass the
    // route's own advisory read still only let INGEST_DAILY_CAP of them through here, because
    // DynamoDB evaluates this condition against the item's CURRENT value before the ADD lands.
    const cmd = buildIngestCounterIncrement("t", "2026-08-20");
    expect(cmd.ConditionExpression).toBe("attribute_not_exists(#count) OR #count < :cap");
    expect(cmd.ExpressionAttributeValues).toMatchObject({ ":cap": INGEST_DAILY_CAP });
    expect(cmd.ExpressionAttributeNames).toEqual({ "#count": "count" });
  });

  it("pins the cap at 20 -- spec §9's chosen number, not an arbitrary placeholder that could drift", () => {
    // Not a money guard -- capture is idempotent and costs fractions of a cent -- purely a
    // bound on nuisance from a leaked /api/ingest secret. Every other test in this describe
    // block asserts against the INGEST_DAILY_CAP symbol, so a change to its value would sail
    // through them unnoticed; this is the one place the literal number itself is pinned.
    expect(INGEST_DAILY_CAP).toBe(20);
  });
});
