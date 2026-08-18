import { describe, expect, it, vi } from "vitest";
import { MAX_TOKENS, RANK_INPUT_CAP, RANK_MODEL, TruncationError, rankArticles } from "../../src/lib/rank/bedrock.js";

const candidate = (n: number) => ({
  urlHash: String(n).padStart(64, "0"),
  title: `Title ${n}`, summary: "s", sourceName: "TechCrunch",
  category: "news", section: "ai", publishedAt: null, points: null,
});

/** Shaped like the streaming client: content[0] is a thinking block, exactly as spec §6 warns. */
const stub = (payload: unknown, stopReason = "end_turn", usage?: Record<string, unknown>) => {
  const finalMessage = vi.fn().mockResolvedValue({
    stop_reason: stopReason,
    content: [
      { type: "thinking", thinking: "..." },
      { type: "text", text: JSON.stringify(payload) },
    ],
    usage: usage ?? {
      input_tokens: 111, output_tokens: 222, output_tokens_details: { thinking_tokens: 33 },
    },
  });
  return { messages: { stream: vi.fn().mockReturnValue({ finalMessage }) } };
};

describe("rankArticles", () => {
  it("uses the global inference profile, not the regional one", async () => {
    const client = stub({ items: [] });
    await rankArticles([candidate(1)], { client });
    const args = client.messages.stream.mock.calls[0]![0] as Record<string, unknown>;
    expect(args.model).toBe(RANK_MODEL);
    expect(RANK_MODEL.startsWith("global.")).toBe(true);
    expect(args.max_tokens).toBe(MAX_TOKENS);
  });

  it("constrains the response with a schema and keeps effort off the high default", async () => {
    const client = stub({ items: [] });
    await rankArticles([candidate(1)], { client });
    const args = client.messages.stream.mock.calls[0]![0] as any;
    expect(args.output_config.format.type).toBe("json_schema");
    // `high` measured 150-500s on this task shape and multiplies the thinking-token bill.
    expect(args.output_config.effort).toBe("medium");
  });

  it("throws TruncationError on max_tokens instead of degrading silently", async () => {
    // The single most important assertion in this file. Without the branch, a truncated run
    // is billed for the full 32k cap, returns unusable JSON, and still reports llmStatus ok —
    // indistinguishable from a Bedrock outage, which is what spec §6 forbids.
    const client = stub({ items: [] }, "max_tokens");
    await expect(rankArticles([candidate(1)], { client })).rejects.toThrow(TruncationError);
  });

  it("reads the text block by type, never by position", async () => {
    // content[0] is a thinking block: `thinking.display` defaults to "summarized" on
    // Sonnet 4.6, so content[0].text is undefined.
    const client = stub({ items: [{ id: "a0", importance: 90, clusterId: "c", whyItMatters: "w" }] });
    const out = await rankArticles([candidate(1)], { client });
    expect((out.response as any).items[0].urlHash).toBe(candidate(1).urlHash);
  });

  it("caps the input and reports how many it left out", async () => {
    const client = stub({ items: [] });
    const many = Array.from({ length: RANK_INPUT_CAP + 17 }, (_, i) => candidate(i));
    const out = await rankArticles(many, { client });
    expect(out.inputHashes).toHaveLength(RANK_INPUT_CAP);
    expect(out.truncated).toBe(17);
  });

  it("makes no call at all when there is nothing to rank", async () => {
    const client = stub({ items: [] });
    const out = await rankArticles([], { client });
    expect(client.messages.stream).not.toHaveBeenCalled();
    expect(out.response).toEqual({ items: [] });
  });

  it("returns an empty reconcilable shape when the model returns no text block", async () => {
    const finalMessage = vi.fn().mockResolvedValue({ stop_reason: "end_turn", content: [{ type: "thinking" }] });
    const client = { messages: { stream: vi.fn().mockReturnValue({ finalMessage }) } };
    const out = await rankArticles([candidate(1)], { client });
    expect(out.response).toEqual({ items: [] });
  });

  it("returns an empty reconcilable shape when the text block is not valid JSON", async () => {
    // Structured outputs should make this unreachable, but if the schema and the model ever
    // diverge, this must degrade the same way a missing text block does — not throw and take
    // the whole day's run down with it.
    const finalMessage = vi.fn().mockResolvedValue({
      stop_reason: "end_turn",
      content: [
        { type: "thinking", thinking: "..." },
        { type: "text", text: "{not valid json" },
      ],
    });
    const client = { messages: { stream: vi.fn().mockReturnValue({ finalMessage }) } };
    const out = await rankArticles([candidate(1)], { client });
    expect(out.response).toEqual({ items: [] });
  });

  it("carries input, output and thinking token usage out of the call, for cost logging", async () => {
    // Fix 6 (final review, axis 5): thinking tokens are the entire difference between the $6
    // floor and the $16 ceiling for one call, and `usage.output_tokens_details.thinking_tokens`
    // was in the installed SDK's own types and never read anywhere in this codebase.
    const client = stub({ items: [] }, "end_turn", {
      input_tokens: 15_000, output_tokens: 8_000,
      output_tokens_details: { thinking_tokens: 5_000 },
    });
    const out = await rankArticles([candidate(1)], { client });
    // Mutation: hardcoding `usage: ZERO_USAGE` on this return path (or dropping the field
    // entirely, back to what shipped) makes this fail on all three numbers.
    expect(out.usage).toEqual({ inputTokens: 15_000, outputTokens: 8_000, thinkingTokens: 5_000 });
  });

  it("reports zero usage when there is nothing to rank, since no call is made", async () => {
    const client = stub({ items: [] });
    const out = await rankArticles([], { client });
    expect(out.usage).toEqual({ inputTokens: 0, outputTokens: 0, thinkingTokens: 0 });
  });

  it("attaches usage to a TruncationError, since a truncated call is billed the full cap", async () => {
    const client = stub({ items: [] }, "max_tokens", {
      input_tokens: 20_000, output_tokens: 32_000,
      output_tokens_details: { thinking_tokens: 28_000 },
    });
    await expect(rankArticles([candidate(1)], { client })).rejects.toMatchObject({
      name: "TruncationError",
      usage: { inputTokens: 20_000, outputTokens: 32_000, thinkingTokens: 28_000 },
    });
  });

  it("propagates an aborted call as its own error, not as TruncationError", async () => {
    // My brief already got the signal's placement wrong once (body vs. the stream() options
    // argument) — a regression there would silently defeat Task 8's abort/timeout safety
    // margin while every other test kept passing. Pinning that the signal actually reaches
    // the client, and that an abort surfaces as something other than TruncationError, is what
    // makes that regression visible.
    const controller = new AbortController();
    const abortError = Object.assign(new Error("Request was aborted."), {
      name: "APIUserAbortError",
    });
    const finalMessage = vi.fn().mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          controller.signal.addEventListener("abort", () => reject(abortError));
        }),
    );
    const streamFn = vi.fn().mockReturnValue({ finalMessage });
    const client = { messages: { stream: streamFn } };

    const promise = rankArticles([candidate(1)], { client, signal: controller.signal });
    controller.abort();

    await expect(promise).rejects.toBe(abortError);
    await expect(promise).rejects.not.toBeInstanceOf(TruncationError);
    expect(streamFn.mock.calls[0]![1]).toEqual({ signal: controller.signal });
  });
});
