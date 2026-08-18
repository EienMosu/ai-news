import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseFeed } from "../../src/lib/ingest/fetchers/rss.js";

const fixture = (n: string) => readFileSync(new URL(`../fixtures/${n}`, import.meta.url), "utf8");

const LONE_SURROGATE_RE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/;

describe("parseFeed", () => {
  it("parses an RSS 2.0 feed", () => {
    const items = parseFeed(fixture("techcrunch.xml"));
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]!.title).toBeTruthy();
    expect(items[0]!.link).toMatch(/^https?:\/\//);
  });

  it("parses an Atom feed", () => {
    const items = parseFeed(fixture("verge.xml"));
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]!.link).toMatch(/^https?:\/\//);
  });

  // deepmind.google/blog/rss.xml is served as RSS 2.0, not Atom, despite the
  // name — this exercises real-world RSS with media:content images rather
  // than the Atom parsing path (verge.xml covers that above).
  it("parses real-world RSS with media:content images", () => {
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

  it("keeps real words between literal < and > comparison operators", () => {
    const xml = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <item>
    <title>Benchmark results</title>
    <link>https://example.com/a</link>
    <description>Accuracy &lt; 0.5, which is &gt; baseline. Loss dropped: 3 &lt; 5 and 9 &gt; 2 in this run.</description>
  </item>
</channel></rss>`;
    const items = parseFeed(xml);
    expect(items).toHaveLength(1);
    expect(items[0]!.summary).toContain("3 < 5 and 9 > 2");
  });

  it("decodes named, decimal, and hex entities in summaries", () => {
    const xml = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <item>
    <title>Entity test</title>
    <link>https://example.com/b</link>
    <description>Tom &amp; Jerry&#8230; it&#x2019;s great</description>
  </item>
</channel></rss>`;
    const items = parseFeed(xml);
    expect(items[0]!.summary).toBe("Tom & Jerry… it’s great");
  });

  it("caps summary length at 600 code points with no dangling surrogate", () => {
    const long = "a".repeat(650) + "\u{1F600}".repeat(5);
    const xml = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <item>
    <title>Long body</title>
    <link>https://example.com/c</link>
    <description>${long}</description>
  </item>
</channel></rss>`;
    const items = parseFeed(xml);
    const summary = items[0]!.summary;
    expect(Array.from(summary).length).toBeLessThanOrEqual(600);
    expect(LONE_SURROGATE_RE.test(summary)).toBe(false);
  });

  it("does not treat an audio enclosure as an image", () => {
    const xml = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <item>
    <title>Podcast episode</title>
    <link>https://example.com/d</link>
    <description>Episode notes</description>
    <enclosure url="https://example.com/episode.mp3" type="audio/mpeg"/>
  </item>
</channel></rss>`;
    const items = parseFeed(xml);
    expect(items[0]!.imageUrl).toBeNull();
  });

  it("accepts an image enclosure or media:content as imageUrl", () => {
    const xmlEnclosure = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <item>
    <title>Post with image enclosure</title>
    <link>https://example.com/e</link>
    <description>Body</description>
    <enclosure url="https://example.com/cover.jpg" type="image/jpeg"/>
  </item>
</channel></rss>`;
    expect(parseFeed(xmlEnclosure)[0]!.imageUrl).toBe("https://example.com/cover.jpg");

    const xmlMedia = `<?xml version="1.0"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel>
  <item>
    <title>Post with media:content</title>
    <link>https://example.com/f</link>
    <description>Body</description>
    <media:content url="https://example.com/hero.png" medium="image"/>
  </item>
</channel></rss>`;
    expect(parseFeed(xmlMedia)[0]!.imageUrl).toBe("https://example.com/hero.png");
  });

  it("skips an Atom entry whose only link is rel=self and whose id is a tag: URI", () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Feed</title>
  <entry>
    <title>Undiscoverable post</title>
    <link rel="self" href="https://example.com/feed.xml"/>
    <id>tag:example.com,2026:3:blog-post</id>
    <summary>Body</summary>
  </entry>
</feed>`;
    expect(parseFeed(xml)).toEqual([]);
  });

  it("returns a non-empty, entity-free summary from a real Atom feed", () => {
    const items = parseFeed(fixture("verge.xml"));
    const withSummary = items.find((i) => i.summary.length > 0);
    expect(withSummary).toBeDefined();
    expect(withSummary!.summary).not.toMatch(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/);
  });
});
