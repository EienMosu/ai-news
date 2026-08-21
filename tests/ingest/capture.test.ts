import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { captureAll } from "../../src/lib/ingest/capture.js";
import { SOURCES } from "../../src/lib/ingest/sources.js";
import { normalizeUrl, urlHash } from "../../src/lib/core/url.js";

const fixture = (n: string) => readFileSync(new URL(`../fixtures/${n}`, import.meta.url), "utf8");
const NOW = new Date("2026-08-18T12:00:00.000Z");

/**
 * Minimal synthetic RSS body, parameterised by source id, so distinct
 * sources produce distinct articles (and distinct urlHashes) instead of all
 * colliding on one shared fixture. Without this every "lab" source produced
 * the exact same hash as "techcrunch" and lost the dedup race, so no lab
 * article ever reached an assertion.
 */
function rssFor(id: string, link?: string) {
  return `<?xml version="1.0"?><rss version="2.0"><channel><title>${id}</title>
<item><title>${id} headline</title><link>${link ?? `https://example.com/${id}/story-1`}</link><description>Summary for ${id}</description><pubDate>Mon, 17 Aug 2026 12:00:00 +0000</pubDate></item>
</channel></rss>`;
}

/**
 * Builds an RSS body from an arbitrary list of items, each with its own
 * title/link and an optional pubDate. Omitting pubDate produces a
 * fallback-dated article, exactly like a real feed entry with no date —
 * used by the recency-window tests below.
 */
function rssItems(items: { title: string; link: string; pubDate?: string }[]) {
  const body = items
    .map(
      (it) =>
        `<item><title>${it.title}</title><link>${it.link}</link><description>desc</description>${
          it.pubDate ? `<pubDate>${it.pubDate}</pubDate>` : ""
        }</item>`,
    )
    .join("\n");
  return `<?xml version="1.0"?><rss version="2.0"><channel><title>test</title>\n${body}\n</channel></rss>`;
}

function stubFetch(overrides: Record<string, string> = {}) {
  return async (url: string) => {
    if (overrides[url] !== undefined) return overrides[url];
    if (url.includes("hn.algolia.com")) return fixture("hn.json");
    if (url.includes("daily_papers")) return fixture("hf-papers.json");
    const src = SOURCES.find((s) => s.url === url);
    return rssFor(src?.id ?? "unknown");
  };
}

describe("captureAll", () => {
  it("returns articles from every source", async () => {
    const r = await captureAll({ fetchText: stubFetch(), now: NOW });
    expect(r.articles.length).toBeGreaterThan(0);
    expect(Object.keys(r.perSourceCounts)).toHaveLength(SOURCES.length);
    // Fix 4: hn.json was a stale fixture from Algolia's relevance-sorted
    // /search endpoint carrying 2025 dates, which the 7-day recency window
    // silently dropped in full — HN contributed zero, making this test's
    // name false without failing it. Re-fetched from the /search_by_date
    // endpoint the registry actually uses (see sources.ts), so every source
    // must now contribute at least one article, not just the total.
    for (const src of SOURCES) {
      expect(r.perSourceCounts[src.id]).toBeGreaterThan(0);
    }
  });

  it("produces articles that pass schema validation, across more than one category", async () => {
    const r = await captureAll({ fetchText: stubFetch(), now: NOW });
    for (const a of r.articles) {
      expect(a.urlHash).toMatch(/^[0-9a-f]{64}$/);
      expect(a.title.length).toBeGreaterThan(0);
      expect(["news", "lab", "community", "research"]).toContain(a.category);
    }
    // With distinct per-source content, lab sources no longer lose the dedup
    // race to techcrunch — this would have silently passed on 3 of 4
    // categories before the stub gave every source its own content.
    const categories = new Set(r.articles.map((a) => a.category));
    expect(categories.size).toBeGreaterThan(1);
  });

  // The default stub now gives every source distinct content (Fix 6), so a
  // plain "no urlHash repeats" check over that data can never fail — it's
  // trivially true for an array whose elements are already distinct, and
  // would still pass if the Map were replaced with a plain array. This test
  // forces a genuine collision so the assertion can actually fail on a
  // dedup regression.
  it("deduplicates by urlHash across sources, keeping the earlier registry source and not hiding the shadowed source's count", async () => {
    const tc = SOURCES.find((s) => s.id === "techcrunch")!;
    const verge = SOURCES.find((s) => s.id === "verge")!;
    const sharedUrl = "https://collide.example.com/duplicate-story";
    const expectedHash = urlHash(normalizeUrl(sharedUrl));

    const r = await captureAll({
      fetchText: stubFetch({
        [tc.url]: rssFor("techcrunch", sharedUrl),
        [verge.url]: rssFor("verge", sharedUrl),
      }),
      now: NOW,
    });

    // No urlHash repeats anywhere in the result, generally.
    const hashes = r.articles.map((a) => a.urlHash);
    expect(new Set(hashes).size).toBe(hashes.length);

    // Specifically: the collided URL survives exactly once, ...
    const matches = r.articles.filter((a) => a.urlHash === expectedHash);
    expect(matches).toHaveLength(1);
    // ... and it's the earlier-registered source's copy — first-wins, not
    // last-wins.
    expect(matches[0]?.source).toBe("techcrunch");

    // Losing the dedup race is not the same as being dead: the count is
    // deliberately taken before dedup, so verge — whose item never made it
    // into the final array — must still report a non-zero count rather
    // than looking like a dead source.
    expect(r.perSourceCounts["techcrunch"]).toBeGreaterThan(0);
    expect(r.perSourceCounts["verge"]).toBeGreaterThan(0);
  });

  // One dead source must not take the run down with it.
  it("keeps going when a single source throws", async () => {
    const failing = async (url: string) => {
      if (url.includes("techcrunch")) throw new Error("ECONNREFUSED");
      return stubFetch()(url);
    };
    const r = await captureAll({ fetchText: failing, now: NOW });
    expect(r.articles.length).toBeGreaterThan(0);
    expect(r.errors.some((e) => e.message.includes("ECONNREFUSED"))).toBe(true);
  });

  it("records a zero count for a source that returns an HTML error page", async () => {
    const tc = SOURCES.find((s) => s.id === "techcrunch")!;
    const r = await captureAll({
      fetchText: stubFetch({ [tc.url]: fixture("html-error.html") }),
      now: NOW,
    });
    expect(r.perSourceCounts["techcrunch"]).toBe(0);
  });

  it("marks publishedAt as fallback when the feed omits it", async () => {
    const tc = SOURCES.find((s) => s.id === "techcrunch")!;
    const r = await captureAll({
      fetchText: stubFetch({ [tc.url]: fixture("atom-no-date.xml") }),
      now: NOW,
    });
    const undated = r.articles.find((a) => a.source === "techcrunch");
    expect(undated?.publishedAtSource).toBe("fallback");
    expect(undated?.publishedAt).toBe(NOW.toISOString());
  });

  // Fix 1: a source whose items all fail schema validation must not look
  // like a dead feed — perSourceCounts is 0 in both cases, so quarantined is
  // the only field that tells them apart.
  it("records quarantined items separately from a dead source", async () => {
    const tc = SOURCES.find((s) => s.id === "techcrunch")!;
    const noTitleOrLink = `<?xml version="1.0"?><rss version="2.0"><channel><title>Bad</title>
<item><description>No title, no link — fails schema on both title and url</description></item>
<item><description>Same problem, second item</description></item>
</channel></rss>`;
    const r = await captureAll({
      fetchText: stubFetch({ [tc.url]: noTitleOrLink }),
      now: NOW,
    });
    expect(r.perSourceCounts["techcrunch"]).toBe(0);
    expect(r.quarantined["techcrunch"]).toBeGreaterThan(0);
  });

  it("initialises quarantined to 0 for a healthy source rather than omitting it", async () => {
    const r = await captureAll({ fetchText: stubFetch(), now: NOW });
    expect(r.quarantined["techcrunch"]).toBe(0);
  });

  // Fix 2's claim survives the 2026-08-21 replacement: the community seats must stay
  // registered, or a dead community feed could not even report a zero. Reddit itself is gone
  // (403s datacenter IPs, zero items ever landed); the seats now belong to the replacements.
  it("registers the community replacements for the dead Reddit pair", () => {
    const simon = SOURCES.find((s) => s.id === "simonwillison");
    const local = SOURCES.find((s) => s.id === "hn-local");
    expect(simon).toMatchObject({
      kind: "rss",
      category: "community",
      section: "ai",
      url: "https://simonwillison.net/atom/everything/",
    });
    expect(local).toMatchObject({
      kind: "hn",
      category: "community",
      section: "ai",
    });
    expect(SOURCES.some((s) => s.id.startsWith("reddit"))).toBe(false);
  });

  // Fix 3: on a cross-source collision, content fields stay first-writer-wins,
  // but points — the one field only HN produces — must be backfilled rather
  // than discarded when the winning record has none.
  it("merges in Hacker News points on a urlHash collision instead of discarding them", async () => {
    const tc = SOURCES.find((s) => s.id === "techcrunch")!;
    const hn = SOURCES.find((s) => s.id === "hn")!;
    const sharedUrl = "https://collide.example.com/shared-story";
    const tcXml = rssFor("techcrunch", sharedUrl);
    const hnJson = JSON.stringify({
      hits: [
        {
          title: "Shared Story",
          url: sharedUrl,
          points: 321,
          objectID: "1",
          created_at: "2026-08-17T12:00:00.000Z",
        },
      ],
    });
    const r = await captureAll({
      fetchText: stubFetch({ [tc.url]: tcXml, [hn.url]: hnJson }),
      now: NOW,
    });
    const merged = r.articles.find((a) => a.url === sharedUrl);
    expect(merged?.source).toBe("techcrunch"); // first-wins on content fields
    expect(merged?.points).toBe(321); // but points backfilled from HN
  });

  // Fix 5: RSS and JSON sources have different failure contracts when the
  // fetch succeeds but the body is garbage — parseFeed swallows it into a
  // silent zero, but JSON.parse throws, which must surface as an error entry
  // (not just a zero) and must not affect any other source.
  it("records an error, not just a zero, when an HN/HF source's fetch succeeds but returns unparsable JSON", async () => {
    const hn = SOURCES.find((s) => s.id === "hn")!;
    const r = await captureAll({
      fetchText: stubFetch({ [hn.url]: fixture("html-error.html") }),
      now: NOW,
    });
    expect(r.perSourceCounts["hn"]).toBe(0);
    expect(r.errors.some((e) => e.source === "hn")).toBe(true);
    // Other sources are unaffected.
    expect(r.articles.length).toBeGreaterThan(0);
    expect(r.perSourceCounts["techcrunch"]).toBeGreaterThan(0);
  });

  // Guard against a feed shipping its entire history rather than recent
  // items (observed live: OpenAI 1132 items back to 2015, Hugging Face 843
  // back to 2020) — both a cost problem (23x the budgeted Bedrock prompt
  // size) and a correctness problem (years-old posts in a "today" ingest).
  describe("recency window and per-source cap", () => {
    it("excludes an article older than the recency window (30 days) and keeps one within it (2 days)", async () => {
      const tc = SOURCES.find((s) => s.id === "techcrunch")!;
      const oldDate = new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000).toUTCString();
      const recentDate = new Date(NOW.getTime() - 2 * 24 * 60 * 60 * 1000).toUTCString();
      const body = rssItems([
        { title: "Old story", link: "https://example.com/old-story", pubDate: oldDate },
        { title: "Recent story", link: "https://example.com/recent-story", pubDate: recentDate },
      ]);

      const r = await captureAll({ fetchText: stubFetch({ [tc.url]: body }), now: NOW });
      const titles = r.articles.filter((a) => a.source === "techcrunch").map((a) => a.title);

      expect(titles).toContain("Recent story");
      expect(titles).not.toContain("Old story");
      expect(r.filtered["techcrunch"]).toBe(1);
      expect(r.quarantined["techcrunch"]).toBe(0); // excluded, not invalid
    });

    it("keeps a fallback-dated article regardless of age, unlike an old dated article from the same source", async () => {
      const tc = SOURCES.find((s) => s.id === "techcrunch")!;
      const oldDate = new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000).toUTCString();
      const body = rssItems([
        { title: "Old dated story", link: "https://example.com/old-dated", pubDate: oldDate },
        { title: "Undated story", link: "https://example.com/undated" }, // no pubDate -> fallback
      ]);

      const r = await captureAll({ fetchText: stubFetch({ [tc.url]: body }), now: NOW });
      const tcArticles = r.articles.filter((a) => a.source === "techcrunch");
      const undated = tcArticles.find((a) => a.title === "Undated story");

      expect(undated).toBeDefined();
      expect(undated?.publishedAtSource).toBe("fallback");
      expect(tcArticles.some((a) => a.title === "Old dated story")).toBe(false);
      // Only the old dated article is counted as filtered; the fallback one
      // was never a candidate for exclusion.
      expect(r.filtered["techcrunch"]).toBe(1);
    });

    it("caps a source at 50 items, keeping the 50 newest, even when the feed is not date-ordered", async () => {
      const tc = SOURCES.find((s) => s.id === "techcrunch")!;
      const total = 200;
      // Deterministic shuffle of 0..199 (131 is coprime with 200) so the feed
      // body is neither ascending nor descending by date — a naive "keep the
      // first 50 encountered" (or "last 50 encountered") implementation would
      // fail this test even though it might pass on an already-sorted fixture.
      const order = Array.from({ length: total }, (_, i) => i).sort(
        (a, b) => ((a * 131) % total) - ((b * 131) % total),
      );
      const items = order.map((i) => ({
        title: `story-${i}`,
        link: `https://example.com/story-${i}`,
        // i=0 is newest (0 minutes old); i=199 is oldest (~6.9 days old) —
        // every item is within the 7-day window, so only the cap applies.
        pubDate: new Date(NOW.getTime() - i * 50 * 60 * 1000).toUTCString(),
      }));

      const r = await captureAll({
        fetchText: stubFetch({ [tc.url]: rssItems(items) }),
        now: NOW,
      });
      const tcArticles = r.articles.filter((a) => a.source === "techcrunch");

      expect(tcArticles).toHaveLength(50);
      expect(r.perSourceCounts["techcrunch"]).toBe(50);
      expect(r.filtered["techcrunch"]).toBe(150);
      expect(r.quarantined["techcrunch"]).toBe(0);

      const keptTitles = new Set(tcArticles.map((a) => a.title));
      for (let i = 0; i < 50; i++) expect(keptTitles.has(`story-${i}`)).toBe(true);
      for (let i = 50; i < total; i++) expect(keptTitles.has(`story-${i}`)).toBe(false);
    });

    // Fix 1: fallback-dated items (no date in the feed) are exempt from the
    // recency window, but now.toISOString() is the newest possible
    // timestamp — if fallback items sort ahead of dated ones, they win the
    // cap and evict genuinely recent, dated articles. This is the exact
    // shape that exposed the regression: 60 undated items plus 10 dated
    // items within the window, capped at 50, previously kept zero of the 10
    // dated ones.
    it("keeps dated articles over fallback-dated ones at the per-source cap (fallback exemption interacting with the cap)", async () => {
      const tc = SOURCES.find((s) => s.id === "techcrunch")!;
      const undated = Array.from({ length: 60 }, (_, i) => ({
        title: `undated-${i}`,
        link: `https://example.com/undated-${i}`,
        // No pubDate -> fallback-dated, publishedAt = now.toISOString().
      }));
      const dated = Array.from({ length: 10 }, (_, i) => ({
        title: `dated-${i}`,
        link: `https://example.com/dated-${i}`,
        pubDate: new Date(NOW.getTime() - i * 60 * 60 * 1000).toUTCString(),
      }));

      const r = await captureAll({
        fetchText: stubFetch({ [tc.url]: rssItems([...undated, ...dated]) }),
        now: NOW,
      });
      const tcArticles = r.articles.filter((a) => a.source === "techcrunch");

      expect(tcArticles).toHaveLength(50);
      for (let i = 0; i < 10; i++) {
        expect(tcArticles.some((a) => a.title === `dated-${i}`)).toBe(true);
      }
    });

    it("keeps filtered at 0 and does not touch quarantined for a source with nothing to filter", async () => {
      const r = await captureAll({ fetchText: stubFetch(), now: NOW });
      expect(r.filtered["techcrunch"]).toBe(0);
      expect(r.quarantined["techcrunch"]).toBe(0);
    });
  });

  // Spec §3: the Anthropic source is a Google News search wrapper. Its titles carry a
  // trailing " - <Publisher>" label, and its links are opaque wrapper tokens whose
  // multi-day stability is unproven, so this source alone keys by title, not url.
  describe("Google News source (anthropic): hashStrategy, publisher suffix, quarantine", () => {
    const anthropic = SOURCES.find((s) => s.id === "anthropic")!;

    const gnewsFeed = (title: string, link: string) =>
      `<?xml version="1.0"?><rss version="2.0"><channel><item>` +
      `<title>${title}</title><link>${link}</link>` +
      `<pubDate>Mon, 18 Aug 2026 09:00:00 GMT</pubDate></item></channel></rss>`;

    const runAnthropic = async (title: string, link: string) =>
      await captureAll({
        now: NOW,
        fetchText: stubFetch({ [anthropic.url]: gnewsFeed(title, link) }),
      });

    it("keys a title-strategy source by title, so a changed wrapper url does not re-key it", async () => {
      const a = (await runAnthropic("Anthropic ships a thing - Anthropic",
        "https://news.google.com/rss/articles/AAA")).articles.find((x) => x.source === "anthropic");
      const b = (await runAnthropic("Anthropic ships a thing - Anthropic",
        "https://news.google.com/rss/articles/BBB")).articles.find((x) => x.source === "anthropic");

      expect(a).toBeDefined();
      expect(b).toBeDefined();
      expect(b!.urlHash).toBe(a!.urlHash);                                  // same story, same key
      expect(b!.url).toBe("https://news.google.com/rss/articles/BBB");      // url still refreshes
    });

    it("strips the publisher suffix from the stored title", async () => {
      const r = await runAnthropic("Anthropic ships a thing - Anthropic",
        "https://news.google.com/rss/articles/AAA");
      expect(r.articles.find((x) => x.source === "anthropic")!.title)
        .toBe("Anthropic ships a thing");
    });

    it("quarantines an item whose title is nothing but the publisher suffix", async () => {
      // Observed live 2026-08-18. Without this, every such item hashes identically under
      // hashStrategy "title" and they silently overwrite one another.
      const r = await runAnthropic(" - Anthropic", "https://news.google.com/rss/articles/AAA");
      expect(r.articles.filter((x) => x.source === "anthropic")).toHaveLength(0);
      expect(r.quarantined.anthropic).toBe(1);
    });

    it("drops CDN fragments that site: matched on a subdomain", async () => {
      const r = await runAnthropic("some pdf text - www-cdn.anthropic.com",
        "https://news.google.com/rss/articles/CCC");
      expect(r.articles.filter((x) => x.source === "anthropic")).toHaveLength(0);
    });

    // Code review finding: `filtered[src.id] = filteredCount` (an overwrite) would
    // silently discard the CDN-fragment drop's count the moment the recency window
    // also filters something from the same source in the same run. Reverting the fix
    // to `=` must fail this test even though every other test in the suite still
    // passes -- this is the only assertion that exercises both contributions to
    // `filtered` landing on the same source in one captureAll call.
    it("accumulates the CDN-fragment drop and the recency-window filter into one filtered count, instead of the later write overwriting the earlier one", async () => {
      const tenDaysAgo = new Date(NOW.getTime() - 10 * 24 * 60 * 60 * 1000).toUTCString();
      const body = rssItems([
        // Dropped by the publisherSuffix CDN check, before the recency window runs.
        { title: "some pdf text - www-cdn.anthropic.com", link: "https://news.google.com/rss/articles/CDN" },
        // Passes the CDN/quarantine checks and schema validation, then gets excluded
        // by the 7-day recency window (10 days old) -- a second, independent reason
        // to increment `filtered` for the same source in the same run.
        { title: "Old Anthropic post - Anthropic", link: "https://news.google.com/rss/articles/OLD", pubDate: tenDaysAgo },
      ]);

      const r = await captureAll({ now: NOW, fetchText: stubFetch({ [anthropic.url]: body }) });

      expect(r.articles.filter((x) => x.source === "anthropic")).toHaveLength(0);
      expect(r.quarantined.anthropic).toBe(0);
      // 1 (CDN fragment) + 1 (recency window) = 2. A plain `=` instead of `+=` in
      // capture.ts would leave this at 1 -- the recency window's own count,
      // clobbering the CDN drop that was counted first.
      expect(r.filtered.anthropic).toBe(2);
    });
  });
});
