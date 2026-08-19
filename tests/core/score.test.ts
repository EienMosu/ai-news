import { describe, expect, it } from "vitest";
import { computeRecency, computeScore, WEIGHTS } from "../../src/lib/core/score.js";

const NOW = new Date("2026-08-18T12:00:00.000Z");

const base = {
  llmImportance: 80,
  category: "news" as const,
  corroborationToday: 3,
  points: null,
  publishedAt: "2026-08-18T04:00:00.000Z", // 8h old
  ingestedAt: NOW.toISOString(),
  now: NOW,
};

describe("WEIGHTS", () => {
  it("sums to exactly 1", () => {
    const total = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 10);
  });

  // The sum alone can't catch a redistribution: inflating `engagement` at
  // `sourceWeight`'s expense keeps the total at 1 while inverting the feed —
  // the exact failure the inversion tests below exist to prevent.
  it("pins each weight, not just the total", () => {
    expect(WEIGHTS.llmImportance).toBe(0.3);
    expect(WEIGHTS.sourceWeight).toBe(0.3);
    expect(WEIGHTS.corroborationToday).toBe(0.15);
    expect(WEIGHTS.engagement).toBe(0.15);
    expect(WEIGHTS.recency).toBe(0.1);
  });
});

describe("computeScore", () => {
  it("returns a score within [0, 1000]", () => {
    const { score } = computeScore(base);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1000);
  });

  it("imputes a neutral pnorm when points are absent rather than scoring zero", () => {
    const withoutPoints = computeScore({ ...base, points: null });
    const withZeroPoints = computeScore({ ...base, points: 0 });
    expect(withoutPoints.score).toBeGreaterThan(withZeroPoints.score);
    expect(withoutPoints.pointsImputed).toBe(true);
    expect(withZeroPoints.pointsImputed).toBe(false);
  });

  // The inversion the review found: a lab announcement has no engagement data
  // by construction, so treating null as zero hands the top of the feed to HN.
  it("keeps a lab announcement above a high-scoring community post", () => {
    const lab = computeScore({ ...base, category: "lab", points: null });
    const hn = computeScore({ ...base, category: "community", points: 500 });
    expect(lab.score).toBeGreaterThan(hn.score);
  });

  // A fallback that defaulted age to 0, or used `now` directly instead of
  // `ingestedAt`, would pass a bare Number.isFinite check unchanged — this
  // pins that the recency term actually tracks ingestedAt.
  it("uses ingestedAt for recency when publishedAt is missing", () => {
    const fresh = computeScore({
      ...base,
      publishedAt: null,
      ingestedAt: NOW.toISOString(),
    });
    const stale = computeScore({
      ...base,
      publishedAt: null,
      ingestedAt: new Date(NOW.getTime() - 72 * 3_600_000).toISOString(),
    });
    expect(fresh.score).toBeGreaterThan(stale.score);
  });

  it("never lets a future publishedAt exceed the recency ceiling", () => {
    const future = computeScore({
      ...base,
      publishedAt: "2026-08-20T12:00:00.000Z",
    });
    const fresh = computeScore({ ...base, publishedAt: NOW.toISOString() });
    expect(future.score).toBeLessThanOrEqual(fresh.score);
    expect(future.score).toBeLessThanOrEqual(1000);
  });

  it("clamps an out-of-range llmImportance", () => {
    const over = computeScore({ ...base, llmImportance: 150 });
    const max = computeScore({ ...base, llmImportance: 100 });
    expect(over.score).toBe(max.score);
  });

  it("imputes neutral values in degraded mode instead of renormalizing", () => {
    const degraded = computeScore({
      ...base,
      llmImportance: null,
      corroborationToday: null,
    });
    expect(degraded.scoreVersion).toBe("v1-degraded");
    expect(degraded.score).toBeGreaterThan(0);
  });

  // Renormalizing would triple the weight of points, which is null on every RSS
  // source, so any modest HN post would outrank the day's biggest lab news.
  it("keeps a lab announcement above a mid-tier HN post even when degraded", () => {
    const lab = computeScore({
      ...base,
      category: "lab",
      points: null,
      llmImportance: null,
      corroborationToday: null,
    });
    const hn = computeScore({
      ...base,
      category: "community",
      points: 20,
      llmImportance: null,
      corroborationToday: null,
    });
    expect(lab.score).toBeGreaterThan(hn.score);
  });

  it("caps the corroboration contribution at five sources", () => {
    const five = computeScore({ ...base, corroborationToday: 5 });
    const fifty = computeScore({ ...base, corroborationToday: 50 });
    expect(five.score).toBe(fifty.score);
  });

  // Changing the imputed pnorm from 0.5 to, say, 0.1 or 0.6 would still pass
  // every other test here — the inversion margin just quietly erodes. Pin the
  // exact neutral value: log10(1+p)/log10(501) === 0.5 iff 1+p === sqrt(501).
  it("pins the imputed pnorm at exactly 0.5", () => {
    const neutralPoints = Math.sqrt(501) - 1;
    const withoutPoints = computeScore({ ...base, points: null });
    const withNeutralPoints = computeScore({ ...base, points: neutralPoints });
    expect(withoutPoints.score).toBe(withNeutralPoints.score);
  });

  // Mixed degraded cases: only the missing signal should be imputed, the
  // present one must keep its real value, and scoreVersion still flips.
  it("imputes only llmImportance when corroboration is present in degraded mode", () => {
    const mixed = computeScore({ ...base, llmImportance: null, corroborationToday: 3 });
    const equivalent = computeScore({ ...base, llmImportance: 50, corroborationToday: 3 });
    expect(mixed.scoreVersion).toBe("v1-degraded");
    expect(mixed.score).toBe(equivalent.score);
  });

  it("imputes only corroborationToday when llmImportance is present in degraded mode", () => {
    const mixed = computeScore({ ...base, llmImportance: 80, corroborationToday: null });
    const equivalent = computeScore({ ...base, llmImportance: 80, corroborationToday: 1 });
    expect(mixed.scoreVersion).toBe("v1-degraded");
    expect(mixed.score).toBe(equivalent.score);
  });
});

// Extracted (Task 6 fix round 1, finding F1) so the story page's ScoreSignals panel can show
// the same recency term computeScore uses, rather than a second copy of this formula. These
// pin the function's own behaviour directly; computeScore's tests above already prove the
// refactor left computeScore's own results unchanged.
describe("computeRecency", () => {
  it("is exactly 1 at age zero", () => {
    expect(computeRecency(NOW.toISOString(), NOW.toISOString(), NOW)).toBe(1);
  });

  it("halves at exactly one half-life (24h)", () => {
    const publishedAt = new Date(NOW.getTime() - 24 * 3_600_000).toISOString();
    expect(computeRecency(publishedAt, NOW.toISOString(), NOW)).toBeCloseTo(0.5, 10);
  });

  it("falls back to ingestedAt when publishedAt is null", () => {
    const ingestedAt = new Date(NOW.getTime() - 24 * 3_600_000).toISOString();
    expect(computeRecency(null, ingestedAt, NOW)).toBeCloseTo(0.5, 10);
  });

  it("falls back to ingestedAt when publishedAt does not parse", () => {
    const ingestedAt = new Date(NOW.getTime() - 24 * 3_600_000).toISOString();
    expect(computeRecency("not a date", ingestedAt, NOW)).toBeCloseTo(0.5, 10);
  });

  it("clamps a future publishedAt to age zero rather than a value above 1", () => {
    const future = new Date(NOW.getTime() + 48 * 3_600_000).toISOString();
    expect(computeRecency(future, NOW.toISOString(), NOW)).toBe(1);
  });

  it("returns 0, not NaN, when neither timestamp parses", () => {
    expect(computeRecency("not a date", "also not a date", NOW)).toBe(0);
  });
});
