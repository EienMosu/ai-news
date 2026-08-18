import { describe, expect, it } from "vitest";
import { SOURCES } from "../../src/lib/ingest/sources.js";

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
