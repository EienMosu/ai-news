import { describe, expect, it } from "vitest";
import { SOURCES } from "../../src/lib/ingest/sources.js";

describe("section", () => {
  it("defaults every existing source to the ai vertical", () => {
    // Mutation: changing any single entry's `section: "ai"` to `"design"` (or omitting it,
    // once the compiler is out of the way) makes this fail on that one id -- red per-source,
    // not just in aggregate.
    expect(SOURCES).toHaveLength(13);
    for (const s of SOURCES) {
      expect(s.section, `${s.id} must be section "ai"`).toBe("ai");
    }
  });
});

describe("hashStrategy", () => {
  it("uses the title strategy for the Google News wrapped source", () => {
    const anthropic = SOURCES.find((s) => s.id === "anthropic");
    expect(anthropic?.hashStrategy).toBe("title");
    expect(anthropic?.publisherSuffix).toBe(true);
  });

  it("leaves every directly-fetched source on the url strategy", () => {
    for (const s of SOURCES.filter((s) => s.id !== "anthropic")) {
      expect(s.hashStrategy ?? "url").toBe("url");
      expect(s.publisherSuffix ?? false).toBe(false);
    }
  });
});
