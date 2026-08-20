import { UpdateCommand, PutCommand, DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ddb = mockClient(DynamoDBDocumentClient);

vi.mock("../../src/lib/ingest/capture.js", () => ({
  captureAll: vi.fn(),
}));

import { captureAll } from "../../src/lib/ingest/capture.js";
import { handler, fetchText } from "../../src/lambda/capture.js";

const article = (n: number) => ({
  urlHash: String(n).padStart(64, "0"),
  url: `https://example.com/${n}`, title: `T${n}`, summary: "s", imageUrl: null,
  source: "techcrunch", sourceName: "TechCrunch", category: "news" as const, section: "ai" as const,
  publishedAt: "2026-08-18T09:00:00.000Z", publishedAtSource: "feed" as const, points: null,
});

beforeEach(() => {
  ddb.reset();
  // Needed from here on: the new tests below assert on captureAll's OWN call count (e.g. "never
  // called"), and vi.fn() call history is not cleared automatically between tests in this file
  // -- it would otherwise keep accumulating across every earlier test's handler() calls.
  vi.clearAllMocks();
  process.env.TABLE_NAME = "t";
  vi.mocked(captureAll).mockResolvedValue({
    articles: [article(1), article(2)],
    perSourceCounts: { techcrunch: 2, venturebeat: 0 },
    filtered: { venturebeat: 7 },
    quarantined: {},
    errors: [{ source: "reddit-ml", message: "HTTP 429" }],
  });
});

// A couple of tests below fake the clock to pin `istanbulDay` to a known value, so a
// META#INGEST assertion can name the exact sort key rather than pattern-matching it. Real
// timers must come back afterwards or a fake system time leaks into every later test in this
// file -- same discipline tests/lambda/rank.test.ts uses for the same reason.
afterEach(() => {
  vi.useRealTimers();
});

/** True for any UpdateCommand call whose Key targets the spec §9 ingest counter, never an
 *  article write (`ART#...`). Filtering on the real call's Key, not on a mock-library input
 *  matcher, so these assertions don't depend on aws-sdk-client-mock's own partial-match rules. */
const isIngestCounterCall = (c: { args: [{ input: { Key?: unknown } }] }) =>
  (c.args[0].input.Key as { pk?: string } | undefined)?.pk === "META#INGEST";

describe("capture handler", () => {
  it("writes every captured article", async () => {
    await handler();
    expect(ddb.commandCalls(UpdateCommand)).toHaveLength(2);
  });

  it("scores in degraded mode, so a captured article is never invisible in the feed", async () => {
    // Ranking has not run for these yet. They must still land in the day partition with a
    // real sort key, otherwise a day with no ranking run shows an empty feed.
    await handler();
    const values = ddb.commandCalls(UpdateCommand)[0]!.args[0].input.ExpressionAttributeValues!;
    expect(Object.values(values)).toContain("v1-degraded");
    expect(Object.values(values).some((v) => typeof v === "string" && /^\d{4}#/.test(v))).toBe(true);
  });

  it("records all three counters and the errors in META#lastRun", async () => {
    await handler();
    const item = ddb.commandCalls(PutCommand)[0]!.args[0].input.Item!;
    expect(item.pk).toBe("META#lastRun");
    expect(item.perSourceCounts.venturebeat).toBe(0);
    expect(item.filtered.venturebeat).toBe(7);
    expect(item.errors[0].source).toBe("reddit-ml");
    expect(item.itemsWritten).toBe(2);
  });

  it("still writes META#lastRun when an individual article write fails", async () => {
    ddb.on(UpdateCommand).rejectsOnce(new Error("throttled")).resolves({});
    const out = await handler();
    expect(out.itemsFailed).toBe(1);
    expect(out.itemsWritten).toBe(1);
    expect(ddb.commandCalls(PutCommand)).toHaveLength(1);
  });

  it("never calls Bedrock", async () => {
    // Spec §2: /api/ingest triggers this handler, so a stuck refresh button must not be able
    // to spend the credit balance.
    const mod = await import("../../src/lambda/capture.js");
    expect(JSON.stringify(Object.keys(mod))).not.toContain("rank");
  });

  it("still returns a summary when the META#lastRun write itself fails", async () => {
    // The one write that must never disappear silently -- but its own failure must not
    // erase the record of what already succeeded, and must not throw out of the handler.
    ddb.on(PutCommand).rejects(new Error("provisioned throughput exceeded"));
    const out = await handler();
    expect(out.itemsWritten).toBe(2);
    expect(out.itemsFailed).toBe(0);
  });

  // Spec §9's per-day /api/ingest cap. This first test is the single most important one in
  // the whole change: EventBridge's hourly schedule invokes capture with no payload at all (or
  // an empty `{}`), never `{ manual: true }`. If that path were ever miscounted against the
  // cap, 20 scheduled runs would exhaust it and silently stop hourly capture for the rest of
  // the day -- RSS has no history endpoint, so a missed window is permanent data loss.
  it("the scheduled path -- no event, and an event without `manual` -- never touches META#INGEST and captures normally", async () => {
    await handler();
    await handler({});

    const ingestCalls = ddb.commandCalls(UpdateCommand).filter(isIngestCounterCall);
    expect(ingestCalls).toHaveLength(0);

    // Both calls still ran the real capture pipeline -- 2 articles written per call.
    expect(vi.mocked(captureAll)).toHaveBeenCalledTimes(2);
    expect(ddb.commandCalls(UpdateCommand)).toHaveLength(4);
    expect(ddb.commandCalls(PutCommand)).toHaveLength(2);
  });

  it("a manual trigger under the cap reserves a slot with an atomic ADD and still captures normally", async () => {
    const out = await handler({ manual: true });

    const ingestCalls = ddb.commandCalls(UpdateCommand).filter(isIngestCounterCall);
    expect(ingestCalls).toHaveLength(1);
    expect(ingestCalls[0]!.args[0].input.UpdateExpression).toBe("ADD #count :one");

    expect(vi.mocked(captureAll)).toHaveBeenCalledTimes(1);
    expect(out.itemsWritten).toBe(2);
  });

  it("a manual trigger already at the day's cap skips capture entirely -- no fetch, no article writes, no META#lastRun", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-20T12:00:00Z")); // 15:00 Europe/Istanbul -> ingestDay 2026-08-20

    const err = new Error("The conditional request failed");
    err.name = "ConditionalCheckFailedException";
    ddb.on(UpdateCommand, { Key: { pk: "META#INGEST", sk: "2026-08-20" } }).rejects(err);

    const out = await handler({ manual: true });

    expect(out.itemsWritten).toBe(0);
    expect(out.itemsFailed).toBe(0);
    // captureAll never ran at all -- this is the real ceiling, not a write that happens and is
    // then discarded.
    expect(vi.mocked(captureAll)).not.toHaveBeenCalled();
    expect(ddb.commandCalls(UpdateCommand).filter((c) => !isIngestCounterCall(c))).toHaveLength(0);
    expect(ddb.commandCalls(PutCommand)).toHaveLength(0);
  });
});

describe("fetchText", () => {
  it("names the status without leaking the URL", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("", { status: 404, statusText: "Not Found" }));
    const message: string = await fetchText(
      "https://example.com/feed?token=super-secret",
    ).catch((e: Error) => e.message);
    expect(message).toMatch(/^HTTP 404$/);
    expect(message).not.toContain("example.com");
    expect(message).not.toContain("super-secret");
    spy.mockRestore();
  });

  it("passes a real AbortSignal, not a bare number that nothing reads", async () => {
    let capturedSignal: unknown;
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      capturedSignal = (init as RequestInit)?.signal;
      return new Response("ok", { status: 200 });
    });
    await fetchText("https://example.com/feed");
    expect(capturedSignal).toBeInstanceOf(AbortSignal);
    spy.mockRestore();
  });
});
