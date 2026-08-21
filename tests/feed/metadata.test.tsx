import { describe, expect, it } from "vitest";
import { metadata } from "../../app/layout.js";  // ESM .js specifier per global constraint

describe("page metadata", () => {
  it("has the correct title", () => {
    expect(metadata.title).toBe("The Slow Wire");
  });

  it("has the correct description with proper apostrophe", () => {
    expect(metadata.description).toBe("Each day's news, ranked by importance, not recency.");
  });
});
