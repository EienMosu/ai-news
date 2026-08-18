import { describe, expect, it } from "vitest";
import { RANKING_SCHEMA, buildRankPrompt, translateIds } from "../../src/lib/rank/prompt.js";

const candidate = (n: number) => ({
  urlHash: String(n).padStart(64, "0"),
  title: `Title ${n}`,
  summary: "x".repeat(900),
  sourceName: "TechCrunch",
  category: "news" as const,
  publishedAt: "2026-08-18T09:00:00.000Z",
  points: 12,
});

describe("buildRankPrompt", () => {
  it("addresses articles by a short ordinal id, not by their 64-char hash", () => {
    const { text, idToHash } = buildRankPrompt([candidate(1), candidate(2)]);
    expect(text).toContain("a0");
    expect(text).toContain("a1");
    expect(text).not.toContain(candidate(1).urlHash);
    expect(idToHash.get("a0")).toBe(candidate(1).urlHash);
  });

  it("truncates summaries so one long article cannot dominate the token budget", () => {
    const { text } = buildRankPrompt([candidate(1)]);
    expect(text).not.toContain("x".repeat(400));
  });

  it("pins the response shape reconcile() reads", () => {
    // reconcile() looks for `items`. A rename here silently reconciles every article as
    // `missing`, which is indistinguishable from the model failing.
    expect(RANKING_SCHEMA.required).toContain("items");
    expect(RANKING_SCHEMA.properties.items.items.required).toContain("id");
  });
});

describe("translateIds", () => {
  const idToHash = new Map([["a0", "h0"], ["a1", "h1"]]);

  it("maps short ids back to hashes", () => {
    const out = translateIds({ items: [{ urlHash: "a0", importance: 90 }] }, idToHash) as any;
    expect(out.items[0].urlHash).toBe("h0");
  });

  it("passes an unrecognised id through unchanged, so reconcile still counts it as unknown", () => {
    // Silently dropping it here would hide a hallucinating model behind a clean run record.
    const out = translateIds({ items: [{ urlHash: "zz", importance: 90 }] }, idToHash) as any;
    expect(out.items[0].urlHash).toBe("zz");
  });

  it("returns a shape reconcile can read even when the model returns nothing usable", () => {
    expect(translateIds(null, idToHash)).toEqual({ items: [] });
    expect(translateIds({ items: "not an array" }, idToHash)).toEqual({ items: [] });
  });
});
