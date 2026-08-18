import { describe, expect, it } from "vitest";
import { truncate } from "../../src/lib/core/text.js";

const LONE_SURROGATE_RE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/;

describe("truncate", () => {
  it("returns the string unchanged when under the code point limit", () => {
    expect(truncate("hello", 10)).toBe("hello");
  });

  it("caps length at the given number of code points, not UTF-16 code units", () => {
    // "\u{1F600}" is a surrogate pair: one code point, two UTF-16 code units. A UTF-16-unit
    // slice would see this string as 11 units long and cut into the emoji; a code-point-safe
    // truncate sees exactly 10 code points and must not touch it.
    const s = "a".repeat(9) + "\u{1F600}";
    expect(Array.from(s).length).toBe(10);
    expect(truncate(s, 10)).toBe(s);
  });

  it("never leaves a lone high surrogate when the cut point lands on an emoji boundary", () => {
    // 9 a's + 1 emoji (2 code units) + 5 b's. A naive `s.slice(0, 10)` operates on UTF-16
    // units and would land inside the emoji's surrogate pair (9 a's + the emoji's lone high
    // surrogate), producing U+FFFD when re-encoded. truncate() must cut at code point 10 —
    // right after the whole emoji — instead.
    const s = "a".repeat(9) + "\u{1F600}" + "b".repeat(5);
    const out = truncate(s, 10);
    expect(LONE_SURROGATE_RE.test(out)).toBe(false);
    expect(out).toBe("a".repeat(9) + "\u{1F600}");
  });

  it("caps at 600 code points with no dangling surrogate, mirroring the RSS summary budget", () => {
    const long = "a".repeat(650) + "\u{1F600}".repeat(5);
    const out = truncate(long, 600);
    expect(Array.from(out).length).toBeLessThanOrEqual(600);
    expect(LONE_SURROGATE_RE.test(out)).toBe(false);
  });
});
