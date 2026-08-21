import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The overscroll ground, pinned in CSS.
 *
 * The browser paints pull-to-refresh from the root element, which sits above the world on
 * `<main data-field>`, so every vertical used to flash AI blue at the page edges (owner report,
 * measured html rgb(22,48,127) against a vermilion main). An earlier fix injected a per-page
 * inline `<style>`; this replaces it with `:has()`, which also removes the string-interpolation
 * sink that fix created and lets the CSP ban nothing we actually need.
 */
describe("the overscroll ground", () => {
  const css = readFileSync("app/globals.css", "utf8");

  it("paints the root and body from the world below for every non-default ground", () => {
    for (const [selector, token] of [
      ['html:has(main[data-field="design"])', "--color-field-design"],
      ['html:has(main[data-field="cloud"])', "--color-field-cloud"],
      ['html:has(main[data-ground="ink"])', "--color-ink"],
    ] as const) {
      expect(css, selector).toContain(selector);
      expect(css, `${selector} body`).toContain(`${selector} body`);
      expect(css).toContain(`background: var(${token})`);
    }
  });

  it("scopes the selector to main, not any element carrying data-field", () => {
    // The section switch marks every vertical's link with data-field, so an unscoped :has()
    // matched the cloud link on every page and painted all three worlds pine (measured).
    expect(css).not.toMatch(/html:has\(\[data-field/);
  });

  it("keeps no inline style tag as the mechanism", () => {
    // The component that did this is deleted; a source scan keeps it from coming back.
    const files = ["app/globals.css"];
    for (const f of files) expect(readFileSync(f, "utf8")).not.toContain("<style>");
  });
});
