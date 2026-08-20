import { describe, expect, it } from "vitest";
import { toFeedArticle, type FeedArticle } from "../../src/lib/feed/shape.js";
import { matchesQuery } from "../../src/lib/search/match.js";

const article = (over: Partial<Pick<FeedArticle, "title" | "summary">> = {}): FeedArticle =>
  toFeedArticle({
    pk: `ART#${"a".repeat(64)}`, title: "Claude ships a new agent SDK", summary: "Anthropic released tooling.",
    ...over,
  });

describe("matchesQuery", () => {
  it("matches a query found in the title", () => {
    expect(matchesQuery(article(), "agent")).toBe(true);
  });

  it("matches a query found only in the summary, not the title", () => {
    expect(matchesQuery(article(), "anthropic")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(matchesQuery(article(), "CLAUDE")).toBe(true);
  });

  it("does not match a substring absent from both title and summary", () => {
    expect(matchesQuery(article(), "openai")).toBe(false);
  });

  it("matches only a true substring, not a scattered set of characters", () => {
    // "acdk" is not a contiguous substring of "agent SDK" -- a fuzzy matcher would find it,
    // decision 6 says this predicate must not.
    expect(matchesQuery(article(), "acdk")).toBe(false);
  });
});
