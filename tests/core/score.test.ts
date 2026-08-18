import { describe, expect, it } from "vitest";
import { computeScore, WEIGHTS } from "../../src/lib/core/score.js";

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

  it("falls back to ingestedAt when publishedAt is missing", () => {
    const { score } = computeScore({ ...base, publishedAt: null });
    expect(Number.isFinite(score)).toBe(true);
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
});
