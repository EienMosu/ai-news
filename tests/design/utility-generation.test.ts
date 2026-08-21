import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Tailwind 4 cannot type an arbitrary `text-[var(...)]` value (font-size or colour?) and emits
 * NOTHING, silently. The element then inherits, which is how the story page's outbound button
 * shipped bone-on-bone: `bg-` painted paper, the un-generated `text-` inherited the on-field
 * bone. Invisible in review, obvious in a computed-style probe. The `[color:...]` hint removes
 * the ambiguity, and this scan makes the unhinted form unwritable.
 */
describe("no ambiguous text-[var(...)] utilities", () => {
  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
      const full = join(dir, entry);
      return statSync(full).isDirectory() ? walk(full) : full.endsWith(".tsx") ? [full] : [];
    });
  }

  it("scans a real tree", () => {
    expect(walk("components").length + walk("app").length).toBeGreaterThan(10);
  });

  it("every text- arbitrary var carries the color: hint", () => {
    const offenders: string[] = [];
    for (const file of [...walk("components"), ...walk("app")]) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/text-\[var\(/g)) {
        offenders.push(`${file}: ...${source.slice(Math.max(0, match.index - 20), match.index + 20)}...`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
