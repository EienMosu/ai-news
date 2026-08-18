import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseHnResponse } from "../../src/lib/ingest/fetchers/hn.js";

const hn = JSON.parse(readFileSync(new URL("../fixtures/hn.json", import.meta.url), "utf8"));

describe("parseHnResponse", () => {
  it("extracts title, link and points", () => {
    const items = parseHnResponse(hn);
    expect(items.length).toBeGreaterThan(0);
    expect(typeof items[0]!.points).toBe("number");
    expect(items[0]!.title).toBeTruthy();
  });

  it("falls back to the HN discussion URL when a story has no external link", () => {
    const items = parseHnResponse({
      hits: [{ objectID: "123", title: "Ask HN: something", url: null, points: 80, created_at: "2026-08-18T00:00:00Z" }],
    });
    expect(items[0]!.link).toBe("https://news.ycombinator.com/item?id=123");
  });

  it("returns an empty array for a malformed payload", () => {
    expect(parseHnResponse({})).toEqual([]);
    expect(parseHnResponse(null)).toEqual([]);
  });
});
