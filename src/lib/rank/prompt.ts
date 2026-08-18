export const SUMMARY_CHARS_FOR_RANKING = 300;

export interface RankCandidate {
  urlHash: string;
  title: string;
  summary: string;
  sourceName: string;
  category: string;
  publishedAt: string | null;
  points: number | null;
}

/**
 * Structured output schema, per spec §6.
 *
 * Spec §6 verified that the legacy `bedrock-runtime` path carries BOTH Sonnet 4.6 and
 * structured outputs (the Mantle endpoint carries neither), so `output_config.format` is the
 * documented path for this model and this client. The shape is pinned to what reconcile()
 * already parses — `{ items: [...] }` — so a change here without a matching change there
 * produces a run where every article reconciles as `missing`, which reads as a model failure.
 *
 * Fallback, if `output_config.format` is rejected by the installed SDK at implementation time:
 * a forced tool call (`tools: [{name, input_schema}]` + `tool_choice: {type:"tool", name}`)
 * carries the same schema and is supported on every Anthropic surface. Use it only if the
 * spec's path does not work, and record that in the task report — do not silently substitute.
 *
 * Note `maxItems` is deliberately absent: structured-output schemas do not support it, so the
 * model cannot be forced to return all 200 entries. That is exactly why reconcile() exists.
 */
export const RANKING_SCHEMA = {
  type: "object" as const,
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string", description: "The article id exactly as given, e.g. a7." },
          importance: {
            type: "number",
            description:
              "0-100. 90+ is a major model or capability release, a landmark result, or " +
              "a development that changes what practitioners do this week. 50 is routine " +
              "industry news. Below 20 is marketing, funding minutiae, or rehashed coverage.",
          },
          clusterId: {
            type: "string",
            description:
              "A short slug shared by every article covering the SAME underlying story, " +
              "e.g. gpt6-launch. Give an article its own unique slug if nothing else " +
              "covers the same story. Never reuse a slug across different stories.",
          },
          whyItMatters: {
            type: "string",
            description: "One sentence, under 200 characters, for a reader who has 5 seconds.",
          },
        },
        required: ["id", "importance", "clusterId", "whyItMatters"],
      },
    },
  },
  required: ["items"],
};

/** Ordinal ids keep 64-char hashes out of the token bill — see the cost table in the plan. */
export function buildRankPrompt(candidates: RankCandidate[]): {
  text: string;
  idToHash: Map<string, string>;
} {
  const idToHash = new Map<string, string>();
  const lines = candidates.map((c, i) => {
    const id = `a${i}`;
    idToHash.set(id, c.urlHash);
    const summary = c.summary.slice(0, SUMMARY_CHARS_FOR_RANKING);
    const points = c.points === null ? "" : ` | ${c.points} points`;
    return `${id} | ${c.sourceName} (${c.category})${points}\n  ${c.title}\n  ${summary}`;
  });

  const text =
    `Here are ${candidates.length} AI-related articles captured today. Score each one's ` +
    `importance to someone who follows AI closely, and group articles covering the same ` +
    `underlying story.\n\n` +
    `Return an entry for EVERY id below. Use the id exactly as written.\n\n` +
    lines.join("\n\n");

  return { text, idToHash };
}

/**
 * Rewrites the model's short ids back to url hashes, in the field name reconcile() reads.
 *
 * The model echoes the id under the schema's `id` field (spec §6); some callers — and the
 * degraded/legacy paths this also has to tolerate — echo it back under `urlHash` instead.
 * Checking `id` first, then falling back to `urlHash`, covers both without caring which one
 * a given response used.
 *
 * An id that resolves to nothing in the map is passed through unchanged rather than dropped:
 * reconcile() then counts it as `unknown`, which is how a hallucinating model becomes visible
 * in the run record. Dropping it here would make a broken run look clean.
 */
export function translateIds(response: unknown, idToHash: Map<string, string>): unknown {
  const items = (response as { items?: unknown })?.items;
  if (!Array.isArray(items)) return { items: [] };

  return {
    items: items.map((raw: Record<string, unknown>) => {
      const id =
        typeof raw?.id === "string" ? raw.id : typeof raw?.urlHash === "string" ? raw.urlHash : "";
      return { ...raw, urlHash: idToHash.get(id) ?? id };
    }),
  };
}
