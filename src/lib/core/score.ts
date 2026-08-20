import { SOURCE_WEIGHTS, type Category } from "../../types/article.js";

/** Spec §5. Must sum to 1. */
export const WEIGHTS = {
  llmImportance: 0.3,
  sourceWeight: 0.3,
  corroborationToday: 0.15,
  engagement: 0.15,
  recency: 0.1,
} as const;

export const SCORE_VERSION = "v1";
export const DEGRADED_SCORE_VERSION = "v1-degraded";

const POINTS_CEILING = 500;
const CORROBORATION_CEILING = 5;
const RECENCY_HALF_LIFE_HOURS = 24;

export interface ScoreInput {
  llmImportance: number | null;
  category: Category;
  corroborationToday: number | null;
  points: number | null;
  publishedAt: string | null;
  ingestedAt: string;
  now: Date;
}

export interface ScoreResult {
  score: number;
  scoreVersion: string;
  pointsImputed: boolean;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * The recency term alone (Spec §5, weight 0.10): a half-life decay from the article's
 * effective time -- `publishedAt` when it parses, `ingestedAt` otherwise -- resolved exactly
 * as `computeScore` resolves it below. Extracted (Task 6 fix round 1, finding F1) so a caller
 * outside the scoring pipeline can show the same term `computeScore` uses instead of a second,
 * drifting copy of this formula: `app/article/[urlHash]/page.tsx`'s `ScoreSignals` panel is
 * that caller.
 *
 * Passing the current instant as `now` recomputes the term LIVE, against the moment of the
 * call -- it is not the frozen value that fed the stored `score`, which was computed once, at
 * whatever `now` the last capture-or-rank run used, and does not change again until the next
 * run. The story page labels this as a live estimate for exactly that reason: shown unlabelled,
 * it would look like the frozen historical contribution when it is actually a fresh number
 * that keeps decaying between runs.
 *
 * Never `NaN`/non-finite -- an unparseable `publishedAt` AND `ingestedAt` (both malformed)
 * clamps to 0, "as old as it gets", the same silent-but-safe floor `computeScore` applied
 * inline before this was extracted.
 */
export function computeRecency(publishedAt: string | null, ingestedAt: string, now: Date): number {
  const publishedMs = publishedAt ? Date.parse(publishedAt) : NaN;
  const effectiveMs = Number.isNaN(publishedMs) ? Date.parse(ingestedAt) : publishedMs;
  const ageHours = Math.max(0, (now.getTime() - effectiveMs) / 3_600_000);
  const recency = 0.5 ** (ageHours / RECENCY_HALF_LIFE_HOURS);
  return Number.isFinite(recency) ? recency : 0;
}

export function computeScore(input: ScoreInput): ScoreResult {
  const degraded = input.llmImportance === null || input.corroborationToday === null;

  // Degraded mode imputes neutral values and keeps the weights fixed.
  // Renormalizing would inflate whichever signals survive — and `points` is
  // null on every RSS source, so it would hand the feed to Hacker News.
  const importance = clamp(input.llmImportance ?? 50, 0, 100) / 100;
  const corroboration =
    clamp(input.corroborationToday ?? 1, 0, CORROBORATION_CEILING) / CORROBORATION_CEILING;

  // Absent engagement data means "unknown", not "nobody cared". Lab
  // announcements structurally never carry points.
  const pointsImputed = input.points === null;
  const engagement = pointsImputed
    ? 0.5
    : Math.log10(1 + clamp(input.points!, 0, POINTS_CEILING)) / Math.log10(1 + POINTS_CEILING);

  const recency = computeRecency(input.publishedAt, input.ingestedAt, input.now);

  const raw =
    WEIGHTS.llmImportance * importance +
    WEIGHTS.sourceWeight * SOURCE_WEIGHTS[input.category] +
    WEIGHTS.corroborationToday * corroboration +
    WEIGHTS.engagement * engagement +
    WEIGHTS.recency * recency;

  return {
    score: clamp(1000 * raw, 0, 1000),
    scoreVersion: degraded ? DEGRADED_SCORE_VERSION : SCORE_VERSION,
    pointsImputed,
  };
}
