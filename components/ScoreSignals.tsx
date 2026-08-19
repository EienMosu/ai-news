import { SOURCE_WEIGHTS, type Category } from "../src/types/article.js";

export interface ScoreSignalsProps {
  /** `null` means the stored item's category was missing or unrecognised -- there is no
   *  fallback weight to show for that case (see the `category === null` branch below): a wrong
   *  guess would misreport the score's biggest single input (0.3 of the formula, per
   *  `WEIGHTS.sourceWeight` in src/lib/core/score.ts). */
  category: Category | null;
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
  /** True when the score's engagement input was never measured and `computeScore` (Step 2's
   *  decision, `src/lib/core/score.ts`) substituted a neutral 0.5 in its place. This is the
   *  one field this component exists to get right: rendering an imputed figure the same as a
   *  measured one presents a guess as a fact -- the exact dishonesty spec §5 corrected when it
   *  renamed `clusterSize` to `corroborationToday`. */
  pointsImputed: boolean;
}

/**
 * The score's inputs, laid out so a reader can see why an article ranked where it did.
 * Presentational and pure: no fetching, no `server-only`, no import from `read.ts` -- every
 * value it shows arrives as a prop, which is what makes it unit-testable without a DynamoDB
 * mock or a Next.js route context. The story page (`app/article/[urlHash]/page.tsx`) is the
 * only caller and supplies these straight from the `ArticleDetail` it already fetched.
 *
 * Deliberately shows only the three signals Task 6 names: source weight, corroboration today,
 * and engagement. `llmImportance` and recency are real inputs to the same score
 * (`src/lib/core/score.ts`) but are not part of this component's brief and are left out rather
 * than added on judgment call.
 */
export function ScoreSignals({
  category,
  corroborationToday,
  points,
  pointsImputed,
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
    </dl>
  );
}
