import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { captureAll } from "../../src/lib/ingest/capture.js";
import { SOURCES } from "../../src/lib/ingest/sources.js";

const fixture = (n: string) => readFileSync(new URL(`../fixtures/${n}`, import.meta.url), "utf8");
const NOW = new Date("2026-08-18T12:00:00.000Z");

function stubFetch(overrides: Record<string, string> = {}) {
  return async (url: string) => {
    if (overrides[url] !== undefined) return overrides[url];
    if (url.includes("hn.algolia.com")) return fixture("hn.json");
    if (url.includes("daily_papers")) return fixture("hf-papers.json");
    return fixture("techcrunch.xml");
  };
}

describe("captureAll", () => {
  it("returns articles from every source", async () => {
    const r = await captureAll({ fetchText: stubFetch(), now: NOW });
    expect(r.articles.length).toBeGreaterThan(0);
    expect(Object.keys(r.perSourceCounts)).toHaveLength(SOURCES.length);
  });

  it("produces articles that pass schema validation", async () => {
    const r = await captureAll({ fetchText: stubFetch(), now: NOW });
    for (const a of r.articles) {
      expect(a.urlHash).toMatch(/^[0-9a-f]{64}$/);
      expect(a.title.length).toBeGreaterThan(0);
      expect(["news", "lab", "community", "research"]).toContain(a.category);
    }
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
});
