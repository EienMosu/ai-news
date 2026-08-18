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

  it("returns an empty string for the degenerate title once whitespace has already been trimmed", () => {
    // fetchers/rss.ts trims and collapses whitespace before a title reaches this
    // function, so the real degenerate item (" - Anthropic") arrives here as
    // "- Anthropic" -- no leading space. Must resolve to "" the same as the
    // untrimmed form above, or the quarantine in capture.ts never fires on real feeds.
    expect(stripPublisherSuffix("- Anthropic")).toBe("");
  });
});
