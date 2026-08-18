import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { captureAll } from "../../src/lib/ingest/capture.js";
import { SOURCES } from "../../src/lib/ingest/sources.js";

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

  it("deduplicates by urlHash across sources", async () => {
    const r = await captureAll({ fetchText: stubFetch(), now: NOW });
    const hashes = r.articles.map((a) => a.urlHash);
    expect(new Set(hashes).size).toBe(hashes.length);
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

  // Fix 2: Reddit must be registered, or a dead Reddit feed could not even
  // report a zero.
  it("registers both Reddit sources under the community category", () => {
    const localllama = SOURCES.find((s) => s.id === "reddit-localllama");
    const ml = SOURCES.find((s) => s.id === "reddit-ml");
    expect(localllama).toMatchObject({
      kind: "rss",
      category: "community",
      name: "r/LocalLLaMA",
      url: "https://www.reddit.com/r/LocalLLaMA/hot.rss",
    });
    expect(ml).toMatchObject({
      kind: "rss",
      category: "community",
      name: "r/MachineLearning",
      url: "https://www.reddit.com/r/MachineLearning/hot.rss",
    });
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
});
