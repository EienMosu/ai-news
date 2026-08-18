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
});
