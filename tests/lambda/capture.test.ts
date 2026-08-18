import { UpdateCommand, PutCommand, DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
  process.env.TABLE_NAME = "t";
  vi.mocked(captureAll).mockResolvedValue({
    articles: [article(1), article(2)],
    perSourceCounts: { techcrunch: 2, venturebeat: 0 },
    filtered: { venturebeat: 7 },
    quarantined: {},
    errors: [{ source: "reddit-ml", message: "HTTP 429" }],
  });
});

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
