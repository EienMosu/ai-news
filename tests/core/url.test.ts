import { describe, expect, it } from "vitest";
import { normalizeUrl, urlHash, titleHash } from "../../src/lib/core/url.js";

describe("normalizeUrl", () => {
  it("lowercases the host but preserves path case", () => {
    expect(normalizeUrl("https://TechCrunch.com/Some-Post")).toBe(
      "https://techcrunch.com/Some-Post",
    );
  });

  it("strips tracking parameters", () => {
    expect(
      normalizeUrl("https://x.com/a?utm_source=rss&utm_medium=feed&gclid=1&id=7"),
    ).toBe("https://x.com/a?id=7");
  });

  it("strips every documented tracking parameter", () => {
    const url =
      "https://x.com/a?utm_campaign=c&fbclid=f&mc_cid=m&mc_eid=e&igshid=i&ref=r&source=s&at_medium=a";
    expect(normalizeUrl(url)).toBe("https://x.com/a");
  });

  it("strips a trailing slash", () => {
    expect(normalizeUrl("https://x.com/a/")).toBe("https://x.com/a");
  });

  it("strips text-fragment hashes", () => {
    expect(normalizeUrl("https://x.com/a#:~:text=hello")).toBe("https://x.com/a");
  });

  it("returns the input unchanged when it cannot be parsed", () => {
    expect(normalizeUrl("not a url")).toBe("not a url");
  });
});

describe("urlHash", () => {
  it("is a 64-character hex digest", () => {
    expect(urlHash("https://x.com/a")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic", () => {
    expect(urlHash("https://x.com/a")).toBe(urlHash("https://x.com/a"));
  });

  it("collapses tracking variants of one article to a single hash", () => {
    const a = urlHash(normalizeUrl("https://x.com/a?utm_source=rss"));
    const b = urlHash(normalizeUrl("https://x.com/a/"));
    expect(a).toBe(b);
  });

  it("separates genuinely different URLs", () => {
    expect(urlHash("https://x.com/a")).not.toBe(urlHash("https://x.com/b"));
  });
});

describe("titleHash", () => {
  it("is case-insensitive on the title", () => {
    expect(titleHash("OpenAI Ships GPT-6", "TechCrunch")).toBe(
      titleHash("openai ships gpt-6", "TechCrunch"),
    );
  });

  it("separates identical titles from different sources", () => {
    expect(titleHash("Same", "A")).not.toBe(titleHash("Same", "B"));
  });
});
