import { describe, expect, it } from "vitest";
import { metadata } from "../../app/layout.js";  // ESM .js specifier per global constraint

describe("page metadata", () => {
  it("has the correct title", () => {
    expect(metadata.title).toBe("The Slow Wire");
  });

  it("has the correct description with proper apostrophe", () => {
    // U+2019 (right single quotation mark), not ASCII U+0027 -- pins the branch-review fix
    // that unified the tagline glyph across app/layout.tsx, README.md, and PRODUCT.md.
    expect(metadata.description).toBe("Each day’s news, ranked by importance, not recency.");
  });
});
