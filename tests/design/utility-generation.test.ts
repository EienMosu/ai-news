import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { compile } from "tailwindcss";
import { describe, expect, it } from "vitest";

/**
 * Tailwind only emits a rule for an arbitrary value it can type. When it cannot, it emits
 * NOTHING, silently, and the element inherits — which is how the story page's outbound button
 * once shipped bone-on-bone: `bg-` painted, the un-generated `text-` inherited. Invisible in
 * review, obvious in a computed-style probe. This file used to ban the unhinted
 * `text-[var(...)]` spelling outright as a proxy for that failure. The Modern Classic redesign
 * legitimately writes that spelling (the active filter chip is `bg-[var(--ink)]
 * text-[var(--ground)]`), and the Tailwind version pinned here provably types it as a colour —
 * so the guard is now the real invariant, asserted directly: every `var(...)` arbitrary
 * utility written anywhere in the tree must compile to an actual CSS rule. That covers text-,
 * bg-, border-, font- and whatever form is written next, and it fails loudly the day a
 * Tailwind upgrade changes its mind about an ambiguous value.
 */
describe("var() arbitrary utilities", () => {
  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
      const full = join(dir, entry);
      return statSync(full).isDirectory() ? walk(full) : full.endsWith(".tsx") ? [full] : [];
    });
  }

  // A whitespace-delimited class token containing an arbitrary var() value, hinted or not:
  // `text-[var(--ground)]`, `hover:text-[color:var(--ground)]`, `font-[family-name:var(--font-text)]`.
  // Backticks/quotes/`${` are excluded so template-literal plumbing never fuses into a token,
  // and the mandatory `[` before var( keeps prose comments that mention `var(--x)` out of scope.
  const VAR_UTILITY = /[^\s"'`{}$]*\[[a-z-]*:?var\(--[a-z0-9-]+\)\][^\s"'`{}$]*/g;

  function collectCandidates(): Set<string> {
    const candidates = new Set<string>();
    for (const file of [...walk("components"), ...walk("app")]) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(VAR_UTILITY)) {
        candidates.add(match[0]);
      }
    }
    return candidates;
  }

  it("scans a real tree", () => {
    expect(walk("components").length + walk("app").length).toBeGreaterThan(10);
  });

  it("every var() arbitrary utility in the tree compiles to a real rule", async () => {
    const candidates = collectCandidates();

    // The extraction regex must keep seeing the classes the design leans on hardest. If it
    // silently rotted into matching nothing, the emptiness below would pass vacuously — so pin
    // the single ground and the active chip's unhinted text colour (the exact spelling this
    // file exists to police) as required members of the candidate set.
    expect([...candidates]).toEqual(
      expect.arrayContaining(["bg-[var(--ground)]", "text-[var(--ground)]"]),
    );

    const css = (await compile("@tailwind utilities;")).build([...candidates].sort());

    // Tailwind escapes every non-alphanumeric selector character; mirror that and demand each
    // candidate's own selector in the output. A candidate Tailwind dropped is an element that
    // silently inherits its colour in production.
    const escape = (cls: string) => cls.replace(/[^a-zA-Z0-9-]/g, (ch) => `\\${ch}`);
    const dropped = [...candidates].filter((c) => !css.includes(`.${escape(c)}`));
    expect(dropped).toEqual([]);
  });

  /**
   * Modern Classic retires the three colour worlds: one ground, painted from --ground. The
   * old --field/--on-field tokens survive only as CSS-side legacy aliases in :root; markup
   * that paints with them would resurrect the per-vertical inversion the redesign removed.
   */
  it("one ground: --ground is painted, the retired colour-world tokens are not", () => {
    const candidates = [...collectCandidates()];
    expect(candidates).toContain("bg-[var(--ground)]");
    const resurrected = candidates.filter((c) => /var\(--(?:field|on-field)\)/.test(c));
    expect(resurrected).toEqual([]);
  });
});
