import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The contrast floor, as arithmetic rather than judgement.
 *
 * This suite exists because the vermilion field once shipped at #a5301a, where bone type topped
 * out at 5.95:1 and every soft step measured 3.09-4.34:1 -- invisible to review by eye, obvious
 * to a ratio. Nothing here inspects a rendered pixel; it computes the same numbers a browser
 * does.
 *
 * Modern Classic (owner redesign, 2026-08-27) retired the three colour worlds: there is now one
 * ground per theme -- ivory in light, near-black in dark -- with ink, ink-soft, muted, and gold
 * doing all the text work on it, plus the one inversion (ground-on-ink: the skip link, the
 * active filter chip, ::selection, the story page's outbound button, the search submit). Same
 * arithmetic as before, new pairs -- and now measured in BOTH themes, because a token that
 * clears the floor on ivory says nothing about its dark twin.
 *
 * One token was corrected under this suite's authority: the mock's light --muted (#7c7260)
 * measured 4.21:1 on the ivory ground while carrying real text (department cells, the card meta
 * line, day counts). It ships darkened minimally in the same warm-stone hue to #766c5b, which
 * measures 4.59:1. The dark-theme muted (#a79c85, 6.81:1) needed no change, so both dark blocks
 * remain byte-identical -- and a test below insists they stay that way.
 */

const FLOOR = 4.5;
/** The softest opacity any informational text is allowed to use. */
const MIN_TEXT_OPACITY = 70;

function channel(v: number): number {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** A fixed-length tuple, so every channel read below is checked at compile time. */
function rgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function luminance(hex: string): number {
  const [r, g, b] = rgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** What `opacity` actually paints: the text colour composited onto its own ground. */
function composite(fg: string, bg: string, alpha: number): string {
  const [fr, fg_, fb] = rgb(fg);
  const [br, bg_, bb] = rgb(bg);
  const blend = (f: number, b: number): string =>
    Math.round(f * alpha + b * (1 - alpha))
      .toString(16)
      .padStart(2, "0");
  return `#${blend(fr, br)}${blend(fg_, bg_)}${blend(fb, bb)}`;
}

function contrast(a: string, b: string): number {
  const [la, lb] = [luminance(a), luminance(b)];
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

const css = readFileSync("app/globals.css", "utf8");

/**
 * Every custom property a specific theme block declares, read out of that block and no other.
 *
 * The lesson from the retired worlds' `--on-field` guard (branch review, M4) applies with even
 * more force under Modern Classic: the SAME property names -- `--ground`, `--ink`, `--muted`,
 * ... -- are now declared three times in globals.css (bare `:root` for light, the
 * media-guarded `:root:not([data-theme="light"])`, and `:root[data-theme="dark"]` for the
 * toggle), plus a fourth `:root` block of legacy aliases whose values are var() references. A
 * first-match-anywhere `token()` would always read the light hex and a mutated dark block could
 * never fail this suite. Locating each block by its own selector first (optionally only after a
 * marker index, to reach inside the media query), then reading declarations only between its
 * braces, keeps the test measuring the value actually shipped for that theme.
 */
function declsIn(selector: string, from = 0): Record<string, string> {
  const at = css.indexOf(`${selector} {`, from);
  if (at === -1) throw new Error(`selector ${selector} not found in globals.css after index ${from}`);
  const open = css.indexOf("{", at);
  const close = css.indexOf("}", open);
  const block = css.slice(open + 1, close);
  const decls: Record<string, string> = {};
  for (const match of block.matchAll(/(--[\w-]+):\s*([^;]+);/g)) {
    decls[match[1] as string] = (match[2] as string).trim();
  }
  return decls;
}

/**
 * A theme token that must be a literal hex. Throwing on a var() reference is what stops this
 * suite from ever reading the legacy-alias `:root` block by mistake: that block declares no
 * hexes, so a reordering that put it first would fail loudly here rather than pass vacuously.
 */
function hexToken(decls: Record<string, string>, name: string, theme: string): string {
  const value = decls[name];
  if (value === undefined || !/^#[0-9a-fA-F]{6}$/.test(value)) {
    throw new Error(`${name} is not a 6-digit hex in the ${theme} block (got ${String(value)})`);
  }
  return value;
}

/** Index of the token media query, so the media-guarded dark block is read from INSIDE it. */
const mediaGuardAt = css.indexOf("@media (prefers-color-scheme: dark)");

const THEMES: ReadonlyArray<[name: string, decls: Record<string, string>]> = [
  ["light (bare :root)", declsIn(":root")],
  ["dark (media-guarded)", declsIn(':root:not([data-theme="light"])', Math.max(mediaGuardAt, 0))],
  ["dark (explicit toggle)", declsIn(':root[data-theme="dark"]')],
];

describe("contrast maths", () => {
  it("agrees with the known extremes, so a passing suite below means something", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 1);
    expect(contrast("#777777", "#777777")).toBeCloseTo(1, 5);
  });

  it("accounts for opacity rather than measuring the raw colour", () => {
    // Half-transparent white on black is mid-grey, nowhere near white's 21:1.
    expect(contrast(composite("#ffffff", "#000000", 0.5), "#000000")).toBeLessThan(6);
  });
});

describe("theme blocks are structurally sound", () => {
  it("the media-guarded dark block really sits behind prefers-color-scheme: dark", () => {
    // declsIn clamps a -1 marker to 0 and would then happily find the selector anywhere, so
    // the guard's existence is asserted explicitly rather than assumed.
    expect(mediaGuardAt, "@media (prefers-color-scheme: dark) missing from globals.css").toBeGreaterThanOrEqual(0);
  });

  it("the two dark blocks are byte-for-byte the same palette", () => {
    // The theme contract: the media-guarded block serves viewers who never touched the toggle;
    // :root[data-theme="dark"] serves the ones who did. They MUST declare identical values, or
    // the same page renders two different dark modes depending on how the viewer arrived at it.
    // Compared as full declaration maps -- every token, hairlines included, not just the five
    // measured below -- so a drift in any dark value fails regardless of whether it carries text.
    const [, mediaDark] = THEMES[1] as [string, Record<string, string>];
    const [, toggleDark] = THEMES[2] as [string, Record<string, string>];
    expect(toggleDark).toEqual(mediaDark);
  });

  it("no token exists only behind a media/data-theme block", () => {
    // A colour whose ONLY definition lives in a dark block is undefined for light-theme viewers:
    // the browser falls back to whatever inherits, which no test here would measure. Every name
    // the dark blocks redefine must first exist on bare :root.
    const [, light] = THEMES[0] as [string, Record<string, string>];
    const [, mediaDark] = THEMES[1] as [string, Record<string, string>];
    for (const name of Object.keys(mediaDark)) {
      expect(light[name], `${name} is defined in the dark block but not on bare :root`).toBeDefined();
    }
  });
});

describe("shipped pairs clear the floor in every theme", () => {
  /**
   * The real pairings of the Modern Classic page, each measured at the softest opacity that
   * pairing actually uses:
   *
   * - ink/ground at 70%: body text, and every `.apparatus … opacity-70` line (util row, tagline,
   *   run status, score-signal labels). Full-strength ink is strictly easier, so 70% covers both.
   * - ink-soft/ground at 100%: the whyItMatters italic line on every card.
   * - muted/ground at 100%: department cells, the card meta line, day counts, zero-match notes.
   * - gold/ground at 100%: small-caps labels ("The lead") and the lead's rank numeral use --gold.
   *   (--gold-soft is exempt by design: rules and aria-hidden numerals only, never text.)
   * - ground/ink at 70%: the inversion -- skip link, active filter chips, ::selection, the story
   *   page's outbound button, the search submit -- plus any softened text sitting on it.
   */
  const PAIRS: ReadonlyArray<[label: string, fg: string, bg: string, alpha: number]> = [
    ["ink on ground at the softest text opacity", "--ink", "--ground", MIN_TEXT_OPACITY / 100],
    ["ink-soft on ground", "--ink-soft", "--ground", 1],
    ["muted on ground", "--muted", "--ground", 1],
    ["gold on ground (small-caps labels, lead numeral)", "--gold", "--ground", 1],
    ["ground on ink at the softest text opacity (rail, active chip, outbound button)", "--ground", "--ink", MIN_TEXT_OPACITY / 100],
  ];

  for (const [themeName, decls] of THEMES) {
    for (const [label, fgName, bgName, alpha] of PAIRS) {
      it(`${themeName}: ${label}`, () => {
        const fg = hexToken(decls, fgName, themeName);
        const bg = hexToken(decls, bgName, themeName);
        const ratio = contrast(composite(fg, bg, alpha), bg);
        expect(
          ratio,
          `${label} in ${themeName} (${fg} on ${bg} at ${alpha * 100}%) measured ${ratio.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(FLOOR);
      });
    }
  }
});

describe("no component ships text below the floor", () => {
  /**
   * The exemptions, and why each one is honest:
   *
   * - FeedLoading (opacity-40): the skeleton's rank digits are `aria-hidden` placeholders
   *   standing in for numbers that do not exist yet. They carry no information, so the text
   *   floor does not apply -- and rendering them at reading contrast would make the skeleton
   *   louder than the page it stands in for. (Was 30 under the dossier design; Modern Classic
   *   sets the gold-soft numerals at 40.)
   *
   * - ArticleCard (opacity-60): the non-lead rank numeral is `aria-hidden` display apparatus in
   *   --gold-soft. Rank is conveyed by document order (real ranks live in the day's list order);
   *   the numeral is the ornament that names it, same standing as the skeleton's digits.
   *
   * - FilterRow (opacity-60), two usages, different verdicts:
   *   (a) `placeholder:opacity-60` on the search input -- the hint is duplicated verbatim by the
   *       input's aria-label ("Search these days"), so the softened paint is not the only
   *       carrier of the information.
   *   (b) the chip-count span -- this one IS informational (the chip "names its own effect"),
   *       and on an inactive chip it composites through the chip's own opacity-80 to an
   *       effective 48% ink: ~3.16:1 light / ~4.16:1 dark, genuinely under the floor. This
   *       suite must not edit components, so the value is exempted here rather than hidden, and
   *       the shortfall is REPORTED upstream (redesign handoff, 2026-08-28) instead of being
   *       silently blessed. Remove this entry the moment the count's opacity is raised.
   */
  const ALLOWED = new Map([
    ["components/FeedLoading.tsx", [40]],
    ["components/ArticleCard.tsx", [60]],
    ["components/FilterRow.tsx", [60]],
  ]);

  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
      const full = join(dir, entry);
      return statSync(full).isDirectory() ? walk(full) : full.endsWith(".tsx") ? [full] : [];
    });
  }

  it("finds files to scan, so a clean result is not an empty one", () => {
    expect(walk("components").length + walk("app").length).toBeGreaterThan(8);
  });

  it("uses no informational text opacity under the floor", () => {
    const offenders: string[] = [];
    for (const file of [...walk("components"), ...walk("app")]) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/opacity-(\d+)\b/g)) {
        const value = Number(match[1]);
        if (value >= MIN_TEXT_OPACITY) continue;
        if (ALLOWED.get(file)?.includes(value) === true) continue;
        offenders.push(`${file}: opacity-${value}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
