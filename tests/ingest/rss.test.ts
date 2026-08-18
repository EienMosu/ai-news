import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseFeed } from "../../src/lib/ingest/fetchers/rss.js";

const fixture = (n: string) => readFileSync(new URL(`../fixtures/${n}`, import.meta.url), "utf8");

describe("parseFeed", () => {
  it("parses an RSS 2.0 feed", () => {
    const items = parseFeed(fixture("techcrunch.xml"));
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]!.title).toBeTruthy();
    expect(items[0]!.link).toMatch(/^https?:\/\//);
  });

  it("parses an Atom feed", () => {
    const items = parseFeed(fixture("deepmind.xml"));
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]!.link).toMatch(/^https?:\/\//);
  });

  it("returns null publishedAt rather than an invalid date when the feed omits it", () => {
    const items = parseFeed(fixture("atom-no-date.xml"));
    expect(items).toHaveLength(1);
    expect(items[0]!.publishedAt).toBeNull();
  });

  // A dead feed that answers 200 with an HTML error page must look like a dead
  // feed, not like a quiet news day.
  it("returns an empty array for an HTML error body", () => {
    expect(parseFeed(fixture("html-error.html"))).toEqual([]);
  });

  it("returns an empty array for empty input", () => {
    expect(parseFeed("")).toEqual([]);
  });

  it("normalizes publishedAt to an ISO string when present", () => {
    const items = parseFeed(fixture("techcrunch.xml"));
    const dated = items.find((i) => i.publishedAt !== null);
    expect(dated).toBeDefined();
    expect(() => new Date(dated!.publishedAt!).toISOString()).not.toThrow();
  });
});
