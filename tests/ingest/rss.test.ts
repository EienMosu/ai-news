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
    expect(dated!.publishedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
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

  // Fix 2: the XML parser decodes &lt;/&gt; for non-CDATA content before our
  // pipeline ever runs, so an author-quoted "<model>" or "<think>" arrives
  // as a literal, tag-shaped substring. A bare "strip anything <letter...>"
  // rule deletes it (and the word inside); only an allowlist of real HTML
  // tag names can tell the difference.
  it("keeps unrecognised pseudo-tags and comparison operators intact (non-CDATA path)", () => {
    const xml = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <item>
    <title>Pseudo tags</title>
    <link>https://example.com/model-think</link>
    <description>its new &lt;model&gt; system shipped. the &lt;think&gt; block is hidden. if x&lt;y and z&gt;w then stop</description>
  </item>
</channel></rss>`;
    const items = parseFeed(xml);
    expect(items[0]!.summary).toBe(
      "its new <model> system shipped. the <think> block is hidden. if x<y and z>w then stop",
    );
  });

  // Fix 2: CDATA is verbatim per spec, so the XML parser never touches its
  // entities — decodeEntities is the first thing to see them, and it runs
  // AFTER the first stripTags pass. A defanged &lt;script&gt; in a CDATA
  // body therefore only becomes tag-shaped once decoding has already
  // happened, which is why cleanText must strip tags a second time after
  // decoding, not just once before it.
  it("strips a tag reassembled from CDATA-encoded entities after decoding (does not leave <script> in the output)", () => {
    const xml = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <item>
    <title>CDATA entity reassembly</title>
    <link>https://example.com/cdata-script</link>
    <description><![CDATA[before &lt;script&gt;alert(1)&lt;/script&gt; after]]></description>
  </item>
</channel></rss>`;
    const items = parseFeed(xml);
    expect(items[0]!.summary).not.toContain("<script>");
    expect(items[0]!.summary).not.toContain("</script>");
    expect(items[0]!.summary).toBe("before alert(1) after");
  });

  it("strips real HTML tags from CDATA content, leaving only the text", () => {
    const xml = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <item>
    <title>Real tags in CDATA</title>
    <link>https://example.com/cdata-tags</link>
    <description><![CDATA[<p>Real paragraph</p> with <a href="https://example.com">a link</a>]]></description>
  </item>
</channel></rss>`;
    const items = parseFeed(xml);
    expect(items[0]!.summary).toBe("Real paragraph with a link");
  });

  it("strips real HTML tags from non-CDATA content, leaving only the text", () => {
    const xml = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <item>
    <title>Real tags, non-CDATA</title>
    <link>https://example.com/plain-tags</link>
    <description>&lt;p&gt;Real paragraph&lt;/p&gt; with &lt;a href="https://example.com"&gt;a link&lt;/a&gt;</description>
  </item>
</channel></rss>`;
    const items = parseFeed(xml);
    expect(items[0]!.summary).toBe("Real paragraph with a link");
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

  const feedWith = (description: string) =>
    `<?xml version="1.0"?><rss version="2.0"><channel><item>` +
    `<title>T</title><link>https://example.com/a</link>` +
    `<description>${description}</description></item></channel></rss>`;

  it("strips real HTML elements that a hand-built allowlist would miss", () => {
    // Regression: an allowlist built from "tags we happened to see" left time,
    // nav, mark and svg -- attributes included -- in the archived summary.
    const cases: [string, string][] = [
      ["<![CDATA[Posted <time datetime='x'>now</time> ok]]>", "Posted now ok"],
      ["<![CDATA[A <nav class='z'>menu</nav> B]]>", "A menu B"],
      ["<![CDATA[A <mark>hi</mark> B]]>", "A hi B"],
      ["<![CDATA[A <picture>x</picture> B]]>", "A x B"],
    ];
    for (const [body, expected] of cases) {
      expect(parseFeed(feedWith(body))[0]!.summary, body).toBe(expected);
    }
  });

  it("strips an unrecognised tag that carries attributes, since prose never does", () => {
    expect(parseFeed(feedWith("<![CDATA[A <svg onload=alert(1)>x</svg> B]]>"))[0]!.summary)
      .toBe("A x B");
    expect(parseFeed(feedWith('<![CDATA[A <custom-embed data-id="7">x</custom-embed> B]]>'))[0]!.summary)
      .toBe("A x B");
  });

  it("keeps bracketed prose that only looks like markup", () => {
    // Why stripping stays a heuristic: summary goes to an archive that cannot be
    // re-fetched, so keeping surplus text beats deleting a real word.
    const keep: [string, string][] = [
      ["its new &lt;model&gt; system shipped", "its new <model> system shipped"],
      ["the &lt;think&gt; block is hidden", "the <think> block is hidden"],
      ["accuracy &lt; 0.5 and loss &gt; 2", "accuracy < 0.5 and loss > 2"],
      // One-letter element names are the sharpest edge here: without a guard on
      // what may follow the name, `<b = c>` reads as a <b> tag and eats " = c".
      ["a &lt;b = c&gt; d", "a <b = c> d"],
      ["compare x &lt;y then z&gt; w", "compare x <y then z> w"],
      ["a &lt;tool_use&gt; block", "a <tool_use> block"],
    ];
    for (const [body, expected] of keep) {
      expect(parseFeed(feedWith(body))[0]!.summary, body).toBe(expected);
    }
  });
});
