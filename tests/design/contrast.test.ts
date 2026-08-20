import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The contrast floor, as arithmetic rather than judgement.
 *
 * This suite exists because the vermilion field shipped at #a5301a, where bone type topped out
 * at 5.95:1 and every soft step measured 3.09-4.34:1 -- invisible to review by eye, obvious to
 * a ratio. Nothing here inspects a rendered pixel; it computes the same numbers a browser does.
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

/** Reads a custom property out of globals.css so the test cannot drift from the shipped value. */
function token(name: string): string {
  const css = readFileSync("app/globals.css", "utf8");
  const value = css.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`))?.[1];
  if (value === undefined) throw new Error(`token ${name} not found in globals.css`);
  return value;
}

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

describe("shipped grounds clear the floor at the softest opacity in use", () => {
  const grounds: Array<[string, string, string]> = [
    ["ai field", "--color-field-ai", "#f3eee2"],
    ["design field", "--color-field-design", "#f6ece7"],
  ];

  for (const [label, tokenName, onColour] of grounds) {
    it(`${label} carries its text at ${MIN_TEXT_OPACITY}% opacity`, () => {
      const field = token(tokenName);
      const ratio = contrast(composite(onColour, field, MIN_TEXT_OPACITY / 100), field);
      expect(ratio, `${label} (${field}) measured ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(FLOOR);
    });
  }

  it("the paper sheet carries ink at the same opacity", () => {
    const paper = token("--color-paper");
    const ink = token("--color-ink");
    const ratio = contrast(composite(ink, paper, MIN_TEXT_OPACITY / 100), paper);
    expect(ratio, `paper measured ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(FLOOR);
  });

  it("the ink rail carries paper at the same opacity", () => {
    const ink = token("--color-ink");
    const ratio = contrast(composite(token("--color-paper"), ink, MIN_TEXT_OPACITY / 100), ink);
    expect(ratio, `ink rail measured ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(FLOOR);
  });
});

describe("no component ships text below the floor", () => {
  /**
   * The one exemption, and why: the loading skeleton's rank digits are `aria-hidden` placeholders
   * standing in for numbers that do not exist yet. They carry no information, so the text floor
   * does not apply -- and rendering them at reading contrast would make the skeleton louder than
   * the page it stands in for.
   */
  const ALLOWED = new Map([["components/FeedLoading.tsx", [30]]]);

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
