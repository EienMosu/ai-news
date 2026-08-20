import { SOURCE_WEIGHTS, type Category } from "../src/types/article.js";

export interface ScoreSignalsProps {
  /** `null` means the stored item's category was missing or unrecognised -- there is no
   *  fallback weight to show for that case (see the `category === null` branch below): a wrong
   *  guess would misreport one of the score's two largest inputs (0.3 of the formula, per
   *  `WEIGHTS.sourceWeight` in src/lib/core/score.ts). */
  category: Category | null;
  /** The model's 0-100 importance rating -- the score's other largest input (`WEIGHTS
   *  .llmImportance`, also 0.3). `null` on a degraded article (`isUnranked`, `v1-degraded`):
   *  the model never scored it and `computeScore` imputed a neutral 50 in its place, the exact
   *  same class of substitution `pointsImputed` already guards for engagement -- see the
   *  `llmImportance === null` branch below, and the story page's separate degraded-ranking
   *  note next to this panel's heading. */
  llmImportance: number | null;
  /** `null` on a degraded day, when rank never ran and the signal was never computed. A real
   *  cluster or a singleton (`__self__:`/no cluster) both arrive as a definite number --
   *  `countCorroboration` in src/lib/rank/corroboration.ts counts a singleton as 1, not `null`
   *  -- so `null` here means exactly "not available", never "one source". */
  corroborationToday: number | null;
  /** The stored engagement figure -- an HN-style points count -- or `null` when the source
   *  reports none (every RSS/lab source, structurally). Read together with `pointsImputed`:
   *  when that is true this is expected to be `null`, but the two are read from independent
   *  attributes and are shown from what they actually are, not from an invariant assumed to
   *  hold. */
  points: number | null;
  /** True when the score's engagement input was never measured and `computeScore` substituted
   *  a neutral 0.5 in its place. This is the field this component first existed to get right:
   *  rendering an imputed figure the same as a measured one presents a guess as a fact -- the
   *  exact dishonesty spec §5 corrected when it renamed `clusterSize` to `corroborationToday`. */
  pointsImputed: boolean;
  /** `computeRecency`'s 0-1 half-life decay term (`WEIGHTS.recency`, 0.10), computed by the
   *  caller against the CURRENT instant -- see that function's doc comment in
   *  src/lib/core/score.ts. Always a definite, finite number (never `null`): every stored
   *  article has a `firstSeenAt` to fall back on, so there is no "not available" state to
   *  represent here the way there is for corroboration. It is, deliberately, a live estimate
   *  rather than the frozen value that actually fed the stored `score` -- the panel labels it
   *  as such rather than implying it is that frozen number. */
  recency: number;
}

/**
 * The score's inputs, laid out so a reader can see why an article ranked where it did. Shows
 * all five terms of the Spec §5 formula: source weight and LLM importance (0.30 each, the two
 * largest), corroboration today and engagement (0.15 each), and recency (0.10) -- the full
 * weight, not a subset, because a reader comparing two adjacent cards in the same day section
 * usually finds `llmImportance` is the ONLY one of the five that differs between them, and a
 * panel omitting it would render two very differently ranked articles' signals byte-identical.
 *
 * Presentational and pure: no fetching, no `server-only`, no import from `read.ts` -- every
 * value it shows arrives as a prop, which is what makes it unit-testable without a DynamoDB
 * mock or a Next.js route context. The story page (`app/article/[urlHash]/page.tsx`) is the
 * only caller and supplies these straight from the `ArticleDetail` it already fetched (plus
 * `recency`, which it derives via `computeRecency`).
 */
export function ScoreSignals({
  category,
  llmImportance,
  corroborationToday,
  points,
  pointsImputed,
  recency,
}: ScoreSignalsProps) {
  return (
    <dl data-testid="score-signals" className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1.5 text-sm">
      <dt className="text-neutral-500">Source weight</dt>
      <dd data-testid="source-weight" className="text-neutral-900">
        {category !== null ? (
          `${SOURCE_WEIGHTS[category]} (${category})`
        ) : (
          <span className="text-neutral-400">unknown source category</span>
        )}
      </dd>

      <dt className="text-neutral-500">LLM importance</dt>
      {/* `null` here is, in the current pipeline, exactly the degraded case (`isUnranked`):
       *  the model never scored this article and a neutral 50 was substituted into the score
       *  in its place. Worded as "not scored", not "unknown" or blank, so this row alone
       *  explains its own absence even if a reader never notices the separate degraded-ranking
       *  note the story page renders next to this panel's heading. */}
      <dd data-testid="llm-importance" className="text-neutral-900">
        {llmImportance !== null ? (
          `${llmImportance} / 100`
        ) : (
          <span className="text-neutral-400">not scored (ranking has not run for this article yet)</span>
        )}
      </dd>

      <dt className="text-neutral-500">Corroboration today</dt>
      <dd data-testid="corroboration-today" className="text-neutral-900">
        {corroborationToday !== null ? (
          `${corroborationToday} ${corroborationToday === 1 ? "source" : "sources"}`
        ) : (
          <span className="text-neutral-400">not available</span>
        )}
      </dd>

      <dt className="text-neutral-500">Engagement</dt>
      {/* The imputed branch is checked first and independently of `points`: `pointsImputed`
       *  is the fact that decides "measured or guessed", and must render distinctly from any
       *  measured value, including a genuine 0 -- see the module doc comment. */}
      <dd data-testid="engagement" className="text-neutral-900">
        {pointsImputed ? (
          <span data-testid="engagement-imputed" className="text-neutral-400">
            not measured (source reports no engagement data; treated as neutral)
          </span>
        ) : points !== null ? (
          `${points} points (measured)`
        ) : (
          <span className="text-neutral-400">unknown</span>
        )}
      </dd>

      <dt className="text-neutral-500">Recency</dt>
      {/* Never "not available" -- see the prop doc comment. The "(right now)" qualifier is not
       *  decoration: this number keeps decaying after the article was last ranked, so it is
       *  not the frozen figure that actually produced the stored score, and saying so is the
       *  same honesty rule applied to a signal that changes on its own rather than one that is
       *  simply missing. */}
      <dd data-testid="recency" className="text-neutral-900">
        {recency.toFixed(2)} <span className="text-neutral-400">(right now -- decays between rankings)</span>
      </dd>
    </dl>
  );
}
