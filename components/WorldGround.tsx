import type { Section } from "../src/types/article.js";

export interface WorldGroundProps {
  /** The world this page lives in, or "ink" for the surfaces that belong to no vertical. */
  field: Section | "ink";
}

/**
 * Tells the ROOT which world this page is in.
 *
 * `data-field` lives on `<main>`, but the browser paints overscroll (pull-to-refresh, rubber
 * banding) with the root's background -- and at `<html>`, `--field` resolves to the :root
 * default, so `/design` and `/cloud` flashed ink blue above and below the page (owner report,
 * measured: html rgb(22,48,127) vs main vermilion). Only the page knows its world and only the
 * root layout renders `<html>`, so the page hands the value up as one `:root,body` rule (body carries the same stylesheet fallback); `:root`
 * outranks the stylesheet's `html` fallback by specificity, not by ordering luck.
 *
 * References the token by name rather than repeating the hex: the values stay owned by
 * globals.css, where the contrast suite reads them.
 */
export function WorldGround({ field }: WorldGroundProps) {
  const token = field === "ink" ? "--color-ink" : `--color-field-${field}`;
  return <style>{`:root,body{background:var(${token})}`}</style>;
}
