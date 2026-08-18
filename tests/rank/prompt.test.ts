import { describe, expect, it } from "vitest";
import { RANKING_SCHEMA, buildRankPrompt, translateIds } from "../../src/lib/rank/prompt.js";

const candidate = (n: number) => ({
  urlHash: String(n).padStart(64, "0"),
  title: `Title ${n}`,
  summary: "x".repeat(900),
  sourceName: "TechCrunch",
  category: "news" as const,
  section: "ai",
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

  it("truncates summaries to exactly 300 characters, not fewer and not more", () => {
    // Hardcoded, not derived from SUMMARY_CHARS_FOR_RANKING: this pins the actual budget, so
    // a change to the constant (e.g. 300 -> 350, 17% more input tokens on the one call that
    // costs money) is caught here rather than passing silently.
    const { text } = buildRankPrompt([candidate(1)]);
    expect(text).toContain("x".repeat(300));
    expect(text).not.toContain("x".repeat(301));
  });

  it("truncates by code point, not UTF-16 code unit, so an emoji at the boundary is never split", () => {
    const LONE_SURROGATE_RE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/;
    const c = { ...candidate(1), summary: "a".repeat(299) + "\u{1F600}" + "b".repeat(10) };
    const { text } = buildRankPrompt([c]);
    expect(LONE_SURROGATE_RE.test(text)).toBe(false);
  });

  it("treats a missing points attribute the same as an explicit null", () => {
    // Task 2 drops null attributes on write, so queryDay returns `points` as an absent key
    // (undefined) for every non-HN article, not as `null`. Both must render as no points.
    const withNull = buildRankPrompt([{ ...candidate(1), points: null }]).text;
    const withUndefined = buildRankPrompt([{ ...candidate(1), points: undefined }]).text;
    expect(withNull).not.toContain("points");
    expect(withUndefined).not.toContain("points");
  });

  it("pins the response shape reconcile() reads", () => {
    // reconcile() looks for `items`. A rename here silently reconciles every article as
    // `missing`, which is indistinguishable from the model failing.
    expect(RANKING_SCHEMA.required).toContain("items");
    expect(RANKING_SCHEMA.properties.items.items.required).toContain("id");
  });

  it("tells the model each article's section, and a design article's own section, not just ai's", () => {
    // Mutation: dropping `${c.section} |` from the per-article line in buildRankPrompt makes
    // this fail -- the model would see design articles with no cue that they belong to a
    // different vertical than the ai ones next to them.
    const designArticle = { ...candidate(1), section: "design" };
    const { text } = buildRankPrompt([candidate(1), designArticle]);
    expect(text).toContain("a0 | ai |");
    expect(text).toContain("a1 | design |");
  });

  it("tells the model to score importance within an article's own section, not across sections", () => {
    // Mutation: reverting the `importance` description to a single AI-only rubric (dropping
    // "within the article's own section") makes this fail -- a significant CSS release and a
    // significant model release should both be able to score highly.
    const description = RANKING_SCHEMA.properties.items.items.properties.importance.description;
    expect(description).toContain("within the article's own section");
    expect(description).not.toMatch(/^0-100\. 90\+ is a major model or capability release/);
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
