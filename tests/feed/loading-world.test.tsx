import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AiLoading from "../../app/(feed)/loading.js";
import DesignLoading from "../../app/(feed)/design/loading.js";
import DayLoading from "../../app/(feed)/day/[date]/loading.js";
import SearchLoading from "../../app/(feed)/search/loading.js";
import CloudLoading from "../../app/(feed)/cloud/loading.js";

/**
 * The wait belongs to the edition, not to a world.
 *
 * The per-vertical colour worlds are retired: there is one ivory/ink ground and every route's
 * loading shell wears it. The per-route `loading.tsx` files still exist (Next resolves the nearest
 * one above the route, so removing them would change nothing visible today but would silently
 * re-couple routes if a group-level shell ever diverged) and still pass a `field` prop, but the
 * shell must ignore it — a shell that still branched on the vertical would flash a colour the
 * loaded page no longer has. These tests pin that: same ground everywhere, no world attributes,
 * and the product's own loading language (masthead, gold rule, counted ranks) instead of a spinner.
 */
describe("the loading shell wears the one ground", () => {
  const shells = {
    ai: renderToStaticMarkup(<AiLoading />),
    design: renderToStaticMarkup(<DesignLoading />),
    cloud: renderToStaticMarkup(<CloudLoading />),
    day: renderToStaticMarkup(<DayLoading />),
    search: renderToStaticMarkup(<SearchLoading />),
  };

  it("paints every route's wait on the shared ground, with no world attributes left", () => {
    for (const [route, shell] of Object.entries(shells)) {
      // One ground: the token the loaded pages paint, not a per-vertical colour.
      expect(shell, `${route} shell`).toContain("bg-[var(--ground)]");
      // The retired worlds must not leak back in through the loading path: no vertical field,
      // no neutral-ink ground, no paper surface. CSS keyed on these is gone, so any of them
      // reappearing here would be a dead attribute at best and a style regression at worst.
      expect(shell, `${route} shell`).not.toContain("data-field=");
      expect(shell, `${route} shell`).not.toContain("data-ground=");
      expect(shell, `${route} shell`).not.toContain("data-surface");
    }
  });

  it("renders the identical shell for every route, because the field prop is decorative now", () => {
    // Stronger than checking attributes one by one: if the shared component ever starts
    // branching on `field` again, the markup diverges and this catches it wherever it shows up.
    expect(shells.design).toBe(shells.ai);
    expect(shells.cloud).toBe(shells.ai);
    expect(shells.day).toBe(shells.ai);
    expect(shells.search).toBe(shells.ai);
  });

  it("opens with the centered masthead and names the act, claiming nothing it does not know", () => {
    // The wait is the edition being opened, so it shows the paper's own front matter. The
    // subline says what is happening ("Opening the edition"), not a number it cannot know yet.
    expect(shells.ai).toContain("The Slow Wire");
    expect(shells.ai).toContain("text-center");
    expect(shells.ai).toContain("Opening the edition");
  });

  it("draws the gold double-rule below the masthead, hidden from the accessibility tree", () => {
    // The double-rule is the design's page-opening ornament; it is decoration, so it must not
    // be announced. Assert the token (not a hex) so theme changes flow through CSS alone.
    expect(shells.ai).toContain("border-y border-[var(--gold-soft)]");
    expect(shells.ai).toContain('aria-hidden="true"');
  });

  it("numbers the skeleton ranks 1 through 5 as italic display numerals, without zero-padding", () => {
    // The numbering IS the design: the skeleton is the ranked file filling in, and the real
    // ArticleCard now prints ranks unpadded ("1", not "01") as italic serif numerals — the
    // skeleton must speak the same numeral language or the swap-in visibly jumps.
    for (const rank of [1, 2, 3, 4, 5]) {
      expect(shells.ai).toContain(`>${rank}</span>`);
    }
    expect(shells.ai).not.toContain(">01<");
    expect(shells.ai).toContain("italic");
  });

  it("shows the counter and the stamp in every shell, not a spinner", () => {
    // The honest loading mechanism: the day being counted (the cycling odometer strips), then
    // stamped ("Ranking" names the act, not a result). A spinner would say only "busy".
    for (const [route, shell] of Object.entries(shells)) {
      expect(shell, `${route} shell`).toContain("odo");
      expect(shell, `${route} shell`).toContain("Ranking");
    }
  });
});
