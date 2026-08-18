import { describe, expect, it } from "vitest";
import { FEED_CARD_ATTRIBUTES } from "../../infra/lib/table.js";
import { computeScore } from "../../src/lib/core/score.js";

/**
 * Simulates what DynamoDB actually does to an item read back through a GSI Query: only the
 * attributes named in the index's projection survive. Everything else is silently ABSENT (not
 * `null`) in the result, exactly like `queryDay` in `src/lib/store/query.ts`.
 *
 * The existing rank-handler tests all mock `queryDay` directly and hand back whatever shape
 * they like, so the projection itself never participates in any of them -- which is exactly
 * how the missing `llmImportance`/`firstSeenAt` projection shipped unnoticed. This helper is
 * what makes the projection itself the thing under test.
 */
function projectThroughGsi(item: Record<string, unknown>): Record<string, unknown> {
  const projected: Record<string, unknown> = {};
  for (const attr of FEED_CARD_ATTRIBUTES) {
    if (attr in item) projected[attr] = item[attr];
  }
  return projected;
}

describe("FEED_CARD_ATTRIBUTES vs rank.ts phase 2's re-read", () => {
  it("keeps llmImportance and firstSeenAt alive through the GSI projection", () => {
    // Mirrors src/lambda/rank.ts:224-231 exactly: phase 2 reads llmImportance and firstSeenAt
    // off the item `queryDay` returned, not off a fresh base-table GetItem.
    const now = new Date("2026-08-18T09:00:00.000Z");
    const runId = now.toISOString(); // rank.ts's fallback when firstSeenAt is absent

    const stored = {
      category: "lab" as const,
      llmImportance: 95,
      publishedAt: null,
      points: null,
      firstSeenAt: "2026-08-08T09:00:00.000Z", // 10 days before `now`
      // Attributes a GSI item also carries that are irrelevant to this scoring path, included
      // to prove the projection filter is keying off FEED_CARD_ATTRIBUTES, not just passing
      // everything through.
      hashVersion: 1,
      v: 1,
    };

    const afterProjection = projectThroughGsi(stored);

    const { score, scoreVersion } = computeScore({
      llmImportance: (afterProjection.llmImportance as number | null) ?? null,
      category: afterProjection.category as never,
      corroborationToday: 2,
      points: (afterProjection.points as number | null) ?? null,
      publishedAt: (afterProjection.publishedAt as string | null) ?? null,
      ingestedAt: (afterProjection.firstSeenAt as string) ?? runId,
      now,
    });

    // Mutation: removing "llmImportance" from FEED_CARD_ATTRIBUTES makes afterProjection.
    // llmImportance undefined, computeScore sees `llmImportance: null`, and scoreVersion
    // degrades to "v1-degraded" -- this is the exact bug that shipped.
    expect(scoreVersion).toBe("v1");

    // Mutation: removing "firstSeenAt" from FEED_CARD_ATTRIBUTES makes afterProjection.
    // firstSeenAt undefined, so `ingestedAt` falls back to `runId` (= `now`) instead of the
    // real 10-day-old firstSeenAt -- the article looks brand new, the recency term jumps from
    // ~0.001 to 1, and the score jumps from ~720 to ~820. A real firstSeenAt keeps it well
    // under 800; the fallback does not.
    expect(score).toBeGreaterThan(700);
    expect(score).toBeLessThan(800);
  });
});
