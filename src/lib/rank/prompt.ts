import { truncate } from "../core/text.js";

export const SUMMARY_CHARS_FOR_RANKING = 300;

export interface RankCandidate {
  urlHash: string;
  title: string;
  summary: string;
  sourceName: string;
  category: string;
  /** The topic vertical ("ai" | "design"). Told to the model so it scores importance within
   *  the article's own field rather than against the other vertical. */
  section: string;
  publishedAt: string | null;
  /**
   * `null` is the value a caller sets deliberately. `undefined` is what actually comes back
   * from `queryDay` for the majority of the corpus: Task 2 drops null attributes on write
   * (spec §4), so a non-HN article's absent `points` attribute round-trips as a missing key,
   * not a `null` value. Both must be treated as "no points" here.
   */
  points: number | null | undefined;
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
              "0-100, scored within the article's own section (see each line's tag) -- " +
              "never compare an ai article against a design one. 90+ is a major release " +
              "or landmark result IN THAT FIELD, or changes what its practitioners do this " +
              "week. 50 is routine industry news. Below 20 is marketing, funding minutiae, " +
              "or rehashed coverage.",
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

/**
 * Names the sections actually present, generically -- the allocator in `allocate.ts` is
 * already N-section generic and well tested; this used to be the one place in the pipeline
 * that still assumed exactly two ("ai" and "design"), so a third section would have shipped
 * with a prompt lying to the model about how many verticals it was scoring across.
 */
function describeSections(sections: string[]): string {
  if (sections.length === 0) return "no sections";
  if (sections.length === 1) return `one section: ${sections[0]}`;
  return `${sections.length} sections: ${sections.join(", ")}`;
}

/** Ordinal ids keep 64-char hashes out of the token bill — see the cost table in the plan. */
export function buildRankPrompt(candidates: RankCandidate[]): {
  text: string;
  idToHash: Map<string, string>;
} {
  const idToHash = new Map<string, string>();
  const lines = candidates.map((c, i) => {
    const id = `a${i}`;
    idToHash.set(id, c.urlHash);
    const summary = truncate(c.summary, SUMMARY_CHARS_FOR_RANKING);
    const points = c.points == null ? "" : ` | ${c.points} points`;
    return `${id} | ${c.section} | ${c.sourceName} (${c.category})${points}\n  ${c.title}\n  ${summary}`;
  });

  const sections = [...new Set(candidates.map((c) => c.section))];
  const text =
    `Here are ${candidates.length} articles captured today, spanning ${describeSections(sections)}. ` +
    `Score each one's importance within its OWN section, never against the other, ` +
    `and group articles covering the same underlying story.\n\n` +
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
