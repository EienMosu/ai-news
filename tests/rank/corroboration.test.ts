import { describe, expect, it } from "vitest";
import { countCorroboration } from "../../src/lib/rank/corroboration.js";

describe("countCorroboration", () => {
  const item = (h: string, clusterId?: string) => ({ pk: `ART#${h}`, clusterId });

  it("counts how many articles share each article's cluster", () => {
    const counts = countCorroboration([
      item("h1", "2026-08-18#gpt6"),
      item("h2", "2026-08-18#gpt6"),
      item("h3", "2026-08-18#other"),
    ]);
    expect(counts.get("h1")).toBe(2);
    expect(counts.get("h2")).toBe(2);
    expect(counts.get("h3")).toBe(1);
  });

  it("gives a __self__ singleton a corroboration of exactly 1", () => {
    // Spec §4: __self__: is a reserved non-cluster. Treating it as a real cluster would merge
    // every unclustered article into one and fabricate corroboration.
    const counts = countCorroboration([item("h1", "__self__:h1"), item("h2", "__self__:h2")]);
    expect(counts.get("h1")).toBe(1);
    expect(counts.get("h2")).toBe(1);
  });

  it("gives an article with no cluster at all a corroboration of 1, not 0", () => {
    // A degraded run writes no clusterId. 0 would be a corroboration the scoring formula
    // never expects to see; 1 means "only this article covers it", which is the truth.
    expect(countCorroboration([item("h1")]).get("h1")).toBe(1);
  });

  it("is idempotent: recomputing from stored state gives the same answer twice", () => {
    // Spec §5 requires this. It is what makes a repeated manual trigger safe.
    const day = [item("h1", "2026-08-18#gpt6"), item("h2", "2026-08-18#gpt6")];
    expect([...countCorroboration(day)]).toEqual([...countCorroboration(day)]);
  });

  it("keeps two articles that collide on the same __self__ id from inflating each other", () => {
    // Review finding: deleting the entire `__self__`/no-cluster special case left the OTHER
    // three tests above green, because in their fixtures a unique __self__ id already sizes
    // to 1 via the generic cluster-size fallback -- the special case was unreachable by them.
    // Two articles sharing one __self__ id (which should never happen, since each is supposed
    // to embed its own hash) is what actually exercises the branch: with it, both are still
    // singletons; without it, they'd fall through to the generic path and size as a real
    // 2-member cluster, since the first pass counts __self__ ids exactly like any other.
    const counts = countCorroboration([item("h1", "__self__:dup"), item("h2", "__self__:dup")]);
    expect(counts.get("h1")).toBe(1);
    expect(counts.get("h2")).toBe(1);
  });
});
