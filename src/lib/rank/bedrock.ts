import AnthropicBedrock from "@anthropic-ai/bedrock-sdk";
import { MAX_TOKENS, RANK_INPUT_CAP, RANK_MODEL } from "./model.js";
import { RANKING_SCHEMA, buildRankPrompt, translateIds, type RankCandidate } from "./prompt.js";

export { MAX_TOKENS, RANK_INPUT_CAP, RANK_MODEL };

/**
 * What one call actually cost, read straight off the Bedrock response's `usage` field.
 * `thinkingTokens` is the whole reason a "typical" month and a "worst case" month can differ
 * by $10+: it is billed as output but invisible in `outputTokens - thinkingTokens` alone, and
 * before this it was in the installed SDK's own types and never read anywhere in this codebase.
 */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
}

const ZERO_USAGE: TokenUsage = { inputTokens: 0, outputTokens: 0, thinkingTokens: 0 };

/**
 * Truncation is NOT an outage, and conflating them is the failure spec §6 calls out by name:
 * a `max_tokens` stop yields invalid or partial JSON which, caught as a generic Bedrock
 * failure, silently degrades the whole day while `llmStatus` still reports "ok". It also
 * means the full 32k cap was billed. It gets its own type so the caller can log it as its
 * own thing and so an alarm can distinguish "we asked for too much" from "Bedrock was down".
 *
 * Carries `usage` too: a truncated call is billed for the full cap, which is precisely the
 * call whose cost most needs to reach a log line rather than vanish with the thrown error.
 */
export class TruncationError extends Error {
  readonly usage: TokenUsage;

  constructor(usage: TokenUsage = ZERO_USAGE) {
    super("ranking response hit max_tokens; output is truncated and unusable");
    this.name = "TruncationError";
    this.usage = usage;
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
  usage: TokenUsage;
}

export async function rankArticles(
  candidates: RankCandidate[],
  deps: RankDeps = {},
): Promise<RankOutcome> {
  const selected = candidates.slice(0, RANK_INPUT_CAP);
  const truncated = candidates.length - selected.length;
  if (selected.length === 0) {
    return { response: { items: [] }, inputHashes: [], truncated: 0, usage: ZERO_USAGE };
  }

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
    usage?: {
      input_tokens?: number | null;
      output_tokens?: number;
      output_tokens_details?: { thinking_tokens?: number } | null;
    };
  };

  // Read once, regardless of which branch below the response takes: a truncated call is
  // billed for the full 32k cap, which is exactly the call whose cost most needs to survive
  // into the caller's log line instead of vanishing along with the thrown error.
  const usage: TokenUsage = {
    inputTokens: msg.usage?.input_tokens ?? 0,
    outputTokens: msg.usage?.output_tokens ?? 0,
    thinkingTokens: msg.usage?.output_tokens_details?.thinking_tokens ?? 0,
  };

  if (msg.stop_reason === "max_tokens") throw new TruncationError(usage);

  // content[0] is a thinking block, not text — `thinking.display` defaults to "summarized"
  // on Sonnet 4.6, so indexing content[0] returns the wrong block. Spec §6.
  const raw = msg.content?.find((b) => b.type === "text")?.text;

  let parsed: unknown;
  try {
    // No text block and malformed JSON collapse to the same outcome deliberately: there is
    // nothing a caller could do differently for one versus the other, so one path handles
    // both rather than carrying a second branch nothing can tell apart from this one.
    // `JSON.parse(undefined)` stringifies to "undefined" and throws, landing in the catch
    // below exactly like a malformed response would.
    parsed = JSON.parse(raw as string);
  } catch {
    // Well-formed-but-unparseable is distinct from truncated: structured outputs should make
    // this unreachable, so if it happens the schema and the model have diverged.
    return {
      response: { items: [] }, inputHashes: selected.map((c) => c.urlHash), truncated, usage,
    };
  }

  return {
    response: translateIds(parsed, idToHash),
    inputHashes: selected.map((c) => c.urlHash),
    truncated,
    usage,
  };
}
