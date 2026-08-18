import { describe, expect, it, vi } from "vitest";
import { MAX_TOKENS, RANK_INPUT_CAP, RANK_MODEL, TruncationError, rankArticles } from "../../src/lib/rank/bedrock.js";

const candidate = (n: number) => ({
  urlHash: String(n).padStart(64, "0"),
  title: `Title ${n}`, summary: "s", sourceName: "TechCrunch",
  category: "news", publishedAt: null, points: null,
});

/** Shaped like the streaming client: content[0] is a thinking block, exactly as spec §6 warns. */
const stub = (payload: unknown, stopReason = "end_turn") => {
  const finalMessage = vi.fn().mockResolvedValue({
    stop_reason: stopReason,
    content: [
      { type: "thinking", thinking: "..." },
      { type: "text", text: JSON.stringify(payload) },
    ],
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
});
