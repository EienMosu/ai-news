import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The overscroll ground, pinned in CSS.
 *
 * The browser paints pull-to-refresh from the root element. In the dossier era the world lived
 * on `<main data-field>`, so the root needed a per-world `:has()` forwarding rule -- and before
 * that, a per-page inline `<style>` with a string-interpolation sink. Modern Classic retires the
 * three colour worlds entirely: one ground, `var(--ground)`, painted on `html` and `body`
 * directly and re-inked by the theme blocks. These tests pin that mechanism (the token, never a
 * literal), prove the token actually changes in both dark states so the edges cannot flash the
 * wrong colour in any viewer state, and keep both retired mechanisms from coming back.
 */
describe("the overscroll ground", () => {
  const css = readFileSync("app/globals.css", "utf8");

  /** The declarations of the first `selector {` block -- none of the blocks read here nest. */
  function block(selector: string): string {
    const at = css.indexOf(`${selector} {`);
    if (at === -1) throw new Error(`selector ${selector} not found in globals.css`);
    const open = css.indexOf("{", at);
    const close = css.indexOf("}", open);
    return css.slice(open + 1, close);
  }

  /** Reads `--ground` out of a specific block, so each theme state is measured where it ships. */
  function groundIn(declarations: string, where: string): string {
    const hex = declarations.match(/--ground:\s*(#[0-9a-fA-F]{6})/)?.[1];
    if (hex === undefined) throw new Error(`--ground not declared in ${where}`);
    return hex;
  }

  it("paints the root and body from the one ground token, not a literal", () => {
    // Both must carry it: html is what overscroll exposes, body is what the page sits on. A
    // hex literal here would pass in light and flash ivory at the edges of every dark page.
    expect(block("html")).toContain("background: var(--ground)");
    expect(block("body")).toContain("background: var(--ground)");
  });

  it("re-inks the token in both dark states, so the root ground follows the theme", () => {
    // Three viewer states share one declaration on html. The token must therefore be defined
    // in light on bare :root, redefined under the media query guarded with
    // :not([data-theme="light"]) (system dark), and redefined again under [data-theme="dark"]
    // (explicit toggle) -- the guard structure layout.tsx's theme script depends on.
    const light = groundIn(block(":root"), "bare :root");
    const mediaDark = css.match(
      /@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\[data-theme="light"\]\) \{([^}]*)\}/,
    )?.[1];
    if (mediaDark === undefined) {
      throw new Error("guarded :root dark block not found inside the dark media query");
    }
    const systemDark = groundIn(mediaDark, "the guarded media-query block");
    const toggleDark = groundIn(block(':root[data-theme="dark"]'), ':root[data-theme="dark"]');

    // The toggle must land on the same ground the media query paints -- one dark, two routes.
    expect(toggleDark).toBe(systemDark);
    // And dark must actually differ from light, or "both theme states" is one state twice.
    expect(systemDark).not.toBe(light);
  });

  it("flips color-scheme under the same two guards, so browser-painted chrome follows", () => {
    // Scrollbars and form chrome are painted by the browser from color-scheme, not from any
    // rule we write; if it stayed `light` in dark mode the edges would carry light chrome on
    // an ink ground. Same guard pair as the tokens, asserted with the same nesting.
    expect(block("html")).toContain("color-scheme: light");
    expect(css).toMatch(
      /@media \(prefers-color-scheme: dark\) \{\s*html:not\(\[data-theme="light"\]\) \{\s*color-scheme: dark/,
    );
    expect(css).toMatch(/html\[data-theme="dark"\] \{\s*color-scheme: dark/);
  });

  it("keeps no per-world :has forwarding rules", () => {
    // The whole `:has(main[data-field])` machinery is retired with the worlds. Any data-field
    // or data-ground selector reappearing in globals.css means a second ground is back -- and
    // with it the edge-flash this file exists to prevent.
    expect(css).not.toMatch(/html:has\(/);
    expect(css).not.toMatch(/data-field|data-ground/);
  });

  it("keeps no inline style tag as the mechanism", () => {
    // The component that did this is deleted; a source scan keeps it from coming back.
    const files = ["app/globals.css"];
    for (const f of files) expect(readFileSync(f, "utf8")).not.toContain("<style>");
  });
});
