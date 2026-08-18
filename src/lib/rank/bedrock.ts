import AnthropicBedrock from "@anthropic-ai/bedrock-sdk";
import { MAX_TOKENS, RANK_INPUT_CAP, RANK_MODEL } from "./model.js";
import { RANKING_SCHEMA, buildRankPrompt, translateIds, type RankCandidate } from "./prompt.js";

export { MAX_TOKENS, RANK_INPUT_CAP, RANK_MODEL };

/**
 * Truncation is NOT an outage, and conflating them is the failure spec §6 calls out by name:
 * a `max_tokens` stop yields invalid or partial JSON which, caught as a generic Bedrock
 * failure, silently degrades the whole day while `llmStatus` still reports "ok". It also
 * means the full 32k cap was billed. It gets its own type so the caller can log it as its
 * own thing and so an alarm can distinguish "we asked for too much" from "Bedrock was down".
 */
export class TruncationError extends Error {
  constructor() {
    super("ranking response hit max_tokens; output is truncated and unusable");
    this.name = "TruncationError";
  }
}

/**
 * The client is a minimal shape, not the real `AnthropicBedrock` type, precisely so tests can
 * inject a stub without touching AWS. `signal` rides the second (options) argument — matching
 * where the real SDK's `messages.stream(body, options)` actually reads it — not the request
 * body; the request body has no `signal` field on the real client.
 */
export interface RankDeps {
  client?: {
    messages: {
      stream: (
        args: unknown,
        options?: { signal?: AbortSignal },
      ) => { finalMessage: () => Promise<unknown> };
    };
  };
  signal?: AbortSignal;
}

export interface RankOutcome {
  response: unknown;
  inputHashes: string[];
  truncated: number;
}

export async function rankArticles(
  candidates: RankCandidate[],
  deps: RankDeps = {},
): Promise<RankOutcome> {
  const selected = candidates.slice(0, RANK_INPUT_CAP);
  const truncated = candidates.length - selected.length;
  if (selected.length === 0) return { response: { items: [] }, inputHashes: [], truncated: 0 };

  const { text, idToHash } = buildRankPrompt(selected);
  const client =
    deps.client ??
    (new AnthropicBedrock({ awsRegion: process.env.AWS_REGION }) as unknown as NonNullable<
      RankDeps["client"]
    >);

  // Streamed, per spec §6. A multi-minute non-streaming request is what request timeouts
  // are for; streaming also lets the abort signal take effect mid-response.
  const stream = client.messages.stream(
    {
      model: RANK_MODEL,
      max_tokens: MAX_TOKENS,
      thinking: { type: "adaptive" },
      output_config: {
        // NOT the `high` default: spec §6 measured `high` at 150-500s on a 100-item clustering
        // task, which straddles the Lambda timeout and multiplies the thinking-token bill.
        effort: "medium",
        format: { type: "json_schema", schema: RANKING_SCHEMA },
      },
      messages: [{ role: "user", content: text }],
    },
    deps.signal ? { signal: deps.signal } : undefined,
  );

  const msg = (await stream.finalMessage()) as {
    stop_reason?: string;
    content?: { type: string; text?: string }[];
  };

  if (msg.stop_reason === "max_tokens") throw new TruncationError();

  // content[0] is a thinking block, not text — `thinking.display` defaults to "summarized"
  // on Sonnet 4.6, so indexing content[0] returns the wrong block. Spec §6.
  const raw = msg.content?.find((b) => b.type === "text")?.text;
  if (!raw) return { response: { items: [] }, inputHashes: selected.map((c) => c.urlHash), truncated };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Well-formed-but-unparseable is distinct from truncated: structured outputs should make
    // this unreachable, so if it happens the schema and the model have diverged.
    return { response: { items: [] }, inputHashes: selected.map((c) => c.urlHash), truncated };
  }

  return {
    response: translateIds(parsed, idToHash),
    inputHashes: selected.map((c) => c.urlHash),
    truncated,
  };
}
