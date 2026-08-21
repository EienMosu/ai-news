import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WorldGround } from "../../components/WorldGround.js";

/**
 * The browser paints overscroll with the ROOT's background, and data-field lives on <main>,
 * so without this hand-up /design and /cloud showed ink blue above and below the page
 * (owner report; measured html rgb(22,48,127) against a vermilion main). The component pins
 * the exact rule; the source scan pins that every world-setting surface actually renders it.
 */
describe("WorldGround", () => {
  it("hands the root the section token by name, never a hex", () => {
    expect(renderToStaticMarkup(<WorldGround field="design" />)).toBe(
      "<style>:root,body{background:var(--color-field-design)}</style>",
    );
    expect(renderToStaticMarkup(<WorldGround field="ink" />)).toBe(
      "<style>:root,body{background:var(--color-ink)}</style>",
    );
  });

  it("is rendered by every surface that sets a world", () => {
    const surfaces = [
      "app/(feed)/page.tsx",
      "app/(feed)/design/page.tsx",
      "app/(feed)/cloud/page.tsx",
      "app/(feed)/day/[date]/page.tsx",
      "app/(feed)/search/page.tsx",
      "app/(feed)/article/[urlHash]/page.tsx",
      "components/FeedLoading.tsx",
    ];
    const missing = surfaces.filter((f) => !readFileSync(f, "utf8").includes("<WorldGround"));
    expect(missing).toEqual([]);
  });
});
