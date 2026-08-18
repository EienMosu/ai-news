import { describe, expect, it } from "vitest";
import { buildSortKey } from "../../src/lib/core/sortKey.js";

const HASH = "a".repeat(64);

describe("buildSortKey", () => {
  it("rounds a float score rather than letting it widen the field", () => {
    expect(buildSortKey(814.4, HASH)).toBe(`0814#${HASH}`);
  });

  it("pads to exactly four digits", () => {
    expect(buildSortKey(7, HASH)).toBe(`0007#${HASH}`);
    expect(buildSortKey(1000, HASH)).toBe(`1000#${HASH}`);
  });

  it("clamps out-of-range scores", () => {
    expect(buildSortKey(-5, HASH)).toBe(`0000#${HASH}`);
    expect(buildSortKey(99999, HASH)).toBe(`9999#${HASH}`);
  });

  it("never emits a key whose score field is not four characters", () => {
    for (const s of [0, 0.4, 9.9, 99.5, 999.99, 1000, 12345, -1, NaN]) {
      expect(buildSortKey(s, HASH).split("#")[0]).toHaveLength(4);
    }
  });

  // The property that the whole ranking depends on.
  it("orders lexicographically exactly as it orders numerically", () => {
    const scores = [814.4, 93.6, 9.87, 744.1, 704.1, 604.1, 468.7, 1000, 0, 55.5];
    const byString = [...scores]
      .map((s) => ({ s, k: buildSortKey(s, HASH) }))
      .sort((a, b) => (a.k < b.k ? 1 : a.k > b.k ? -1 : 0))
      .map((x) => Math.round(x.s));
    const byNumber = [...scores].map(Math.round).sort((a, b) => b - a);
    expect(byString).toEqual(byNumber);
  });

  it("holds the ordering property over random scores", () => {
    for (let run = 0; run < 200; run++) {
      const scores = Array.from({ length: 25 }, () => Math.random() * 1000);
      const byString = [...scores]
        .map((s) => ({ s, k: buildSortKey(s, HASH) }))
        .sort((a, b) => (a.k < b.k ? 1 : a.k > b.k ? -1 : 0))
        .map((x) => Math.round(x.s));
      const byNumber = [...scores].map(Math.round).sort((a, b) => b - a);
      expect(byString).toEqual(byNumber);
    }
  });
});
