import { describe, expect, it } from "vitest";
import { stripPublisherSuffix } from "../../src/lib/ingest/title.js";

describe("stripPublisherSuffix", () => {
  it("removes the publisher label Google News appends", () => {
    expect(stripPublisherSuffix("How Claude's text watermarking works - Anthropic"))
      .toBe("How Claude's text watermarking works");
    expect(stripPublisherSuffix("Introducing the Conceptual Reasoning Index - Alignment Science Blog"))
      .toBe("Introducing the Conceptual Reasoning Index");
  });

  it("removes only the last segment, so a title containing a dash survives", () => {
    expect(stripPublisherSuffix("GPT-5 - what actually changed - Anthropic"))
      .toBe("GPT-5 - what actually changed");
    expect(stripPublisherSuffix("Claude 3.5 Sonnet - Anthropic")).toBe("Claude 3.5 Sonnet");
  });

  it("returns an empty string for a title that is nothing but a suffix", () => {
    // The exact degenerate item observed on 2026-08-18. Empty is the signal to quarantine.
    expect(stripPublisherSuffix(" - Anthropic")).toBe("");
  });

  it("leaves a title with no suffix untouched", () => {
    expect(stripPublisherSuffix("OpenAI ships GPT-6")).toBe("OpenAI ships GPT-6");
    expect(stripPublisherSuffix("Well-tuned models")).toBe("Well-tuned models");
  });

  // Code review finding: a leading "- " is not, on its own, evidence of a degenerate
  // title -- only the ABSENCE of a " - " separator to split on makes it one. Every row
  // here is a case from that sanity table, each its own test so a regression names the
  // exact failing input rather than a batch of assertions in one it().
  describe("degenerate-vs-real titles that start with a dash (post code-review)", () => {
    it.each<[string, string]>([
      // Real title was empty; upstream whitespace trimming already ate the leading
      // space, so no " - " separator survives anywhere in the string.
      ["- Anthropic", ""],
      // Same item, pre-trim form: the " - " separator is intact here, so this also
      // resolves via the ordinary split path, not the leading-dash fallback.
      [" - Anthropic", ""],
      // A real title that happens to start with a dash. The " - " separator before
      // "Anthropic" is still present, so this must split normally and survive.
      ["- Interesting update - Anthropic", "- Interesting update"],
      ["Real post - Anthropic", "Real post"],
      ["GPT-5 - what changed - Anthropic", "GPT-5 - what changed"],
      ["No suffix here", "No suffix here"],
      ["Well-tuned models", "Well-tuned models"],
    ])("resolves %j to %j", (input, expected) => {
      expect(stripPublisherSuffix(input)).toBe(expected);
    });
  });
});
