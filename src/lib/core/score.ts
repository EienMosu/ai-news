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

  const publishedMs = input.publishedAt ? Date.parse(input.publishedAt) : NaN;
  const effectiveMs = Number.isNaN(publishedMs) ? Date.parse(input.ingestedAt) : publishedMs;
  const ageHours = Math.max(0, (input.now.getTime() - effectiveMs) / 3_600_000);
  const recency = 0.5 ** (ageHours / RECENCY_HALF_LIFE_HOURS);

  const raw =
    WEIGHTS.llmImportance * importance +
    WEIGHTS.sourceWeight * SOURCE_WEIGHTS[input.category] +
    WEIGHTS.corroborationToday * corroboration +
    WEIGHTS.engagement * engagement +
    WEIGHTS.recency * (Number.isFinite(recency) ? recency : 0);

  return {
    score: clamp(1000 * raw, 0, 1000),
    scoreVersion: degraded ? DEGRADED_SCORE_VERSION : SCORE_VERSION,
    pointsImputed,
  };
}
