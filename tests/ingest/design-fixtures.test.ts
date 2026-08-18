import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { captureAll } from "../../src/lib/ingest/capture.js";
import { SOURCES } from "../../src/lib/ingest/sources.js";

const fixture = (id: string) =>
  readFileSync(new URL(`../fixtures/design/${id}.xml`, import.meta.url), "utf8");

const EMPTY_FEED = `<?xml version="1.0"?><rss version="2.0"><channel></channel></rss>`;

/**
 * Fix 10 (final review, axis 3): the 8 design sources had no fixture coverage at all --
 * `tests/ingest/sources.test.ts` only checks registry metadata (id/name/category/url/kind),
 * and `capture.test.ts`'s "returns articles from every source" test feeds every design source
 * a SYNTHETIC per-id stub, not anything a real feed ever actually returned. Live verification
 * ("all 8 parse today") is not a regression guard -- it proves today, says nothing about
 * tomorrow, and is exactly the gap this file closes.
 *
 * Each fixture below is a genuine response fetched live from the source on 2026-08-18,
 * trimmed to its first two real `<item>`s (oversized `<content:encoded>`/`<description>`
 * CDATA bodies clipped to keep the file small -- still real text, just a shorter excerpt of
 * it) rather than fabricated.
 *
 * `now` is set per source to shortly after that fixture's own newest item, not to "today":
 * `captureAll`'s 7-day recency window is real, intentional behaviour (guards against a feed
 * dumping its whole history), not a test inconvenience, and some of these sites genuinely
 * don't publish every week. Testing at a `now` consistent with when the response was current
 * is what exercises the PARSER, rather than accidentally exercising the window instead.
 */
const DESIGN_CASES: { id: string; now: string }[] = [
  { id: "smashing", now: "2026-08-14T00:00:00.000Z" },      // newest item 2026-08-13
  { id: "alistapart", now: "2026-07-01T00:00:00.000Z" },    // newest item 2026-06-30
  { id: "csstricks", now: "2026-08-18T00:00:00.000Z" },     // newest item 2026-08-17
  { id: "creativebloq", now: "2026-08-19T00:00:00.000Z" },  // newest item 2026-08-18
  { id: "nngroup", now: "2026-08-15T00:00:00.000Z" },       // newest item 2026-08-14
  { id: "uxcollective", now: "2026-08-18T00:00:00.000Z" },  // newest item 2026-08-17
  { id: "sidebar", now: "2026-08-19T00:00:00.000Z" },       // newest item 2026-08-18
  { id: "awwwards", now: "2026-08-13T00:00:00.000Z" },      // newest item 2026-08-12
];

describe("captureAll against a real captured response per design source", () => {
  it.each(DESIGN_CASES)("parses $id's real fixture into at least one article", async ({ id, now }) => {
    const src = SOURCES.find((s) => s.id === id)!;
    const fetchText = async (url: string) => (url === src.url ? fixture(id) : EMPTY_FEED);

    const r = await captureAll({ fetchText, now: new Date(now) });

    // Mutation: pointing this source's fixture at an empty or malformed body (e.g. an
    // unclosed tag) drops perSourceCounts[id] to 0 and fails this case specifically, without
    // touching any other source's case.
    expect(r.perSourceCounts[id]).toBeGreaterThan(0);
    expect(r.quarantined[id]).toBe(0);
    expect(r.errors.find((e) => e.source === id)).toBeUndefined();
  });
});
