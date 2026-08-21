import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Pins the fix for the 745px mobile viewport defect diagnosed against the live root route
 * (`/` measured at requested width 390, `innerWidth`/`scrollWidth` both 745, `pnpm exec node
 * scripts/mobile-probe.mjs`). Root cause: `getBoundingClientRect()` only reports an element's
 * own layout box, never overflowing ink from unwrapped text -- a raw pasted URL with no space
 * to break on (scraped article summaries and titles both carry hostile third-party text) paints
 * past its box without ever making the box measure wider, invisible to any rect-based sweep, and
 * still inflates the document's scrollWidth and the mobile layout viewport itself.
 *
 * `break-words` (`overflow-wrap: break-word`) on the title, why-it-matters, and summary is the
 * complete guard: same idiom as tests/design/contrast.test.ts, a source scan rather than a
 * rendered check, so deleting the class fails this test without needing a browser.
 */

const source = readFileSync("components/ArticleCard.tsx", "utf8");

/** The nearest opening tag before `marker`, up to and including the marker -- covers exactly one
 *  element's own attributes without depending on line breaks or attribute order. */
function elementBefore(openTag: string, marker: string): string {
  const markerIndex = source.indexOf(marker);
  if (markerIndex === -1) {
    throw new Error(`marker not found in ArticleCard.tsx: ${marker}`);
  }
  const tagIndex = source.lastIndexOf(openTag, markerIndex);
  if (tagIndex === -1) {
    throw new Error(`no ${openTag} found before marker: ${marker}`);
  }
  return source.slice(tagIndex, markerIndex);
}

describe("ArticleCard guards scraped text against the 745px ink-overflow defect", () => {
  it("breaks an unwrapped token in the title", () => {
    expect(elementBefore("<h3", "{article.title}")).toMatch(/break-words/);
  });

  it("breaks an unwrapped token in the why-it-matters line", () => {
    expect(elementBefore("<p", "{article.whyItMatters}")).toMatch(/break-words/);
  });

  it("breaks an unwrapped token in the summary", () => {
    expect(elementBefore("<p", "{article.summary}")).toMatch(/break-words/);
  });
});
