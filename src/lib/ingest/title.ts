/**
 * Removes the ` - <Publisher>` label Google News appends to every title.
 *
 * Splits on the LAST " - " so a title that legitimately contains a dash keeps it
 * ("GPT-5 - what actually changed - Anthropic" -> "GPT-5 - what actually changed").
 *
 * Returns "" when nothing precedes the suffix. That is not a degenerate edge case to
 * paper over — the live feed carried exactly one such item on 2026-08-18 (" - Anthropic",
 * an article whose real title was empty). Callers MUST treat "" as a quarantine signal:
 * with hashStrategy "title" every empty-titled item hashes to the same key and they
 * overwrite each other silently.
 */
export function stripPublisherSuffix(title: string): string {
  // Upstream RSS parsing (fetchers/rss.ts) trims and collapses whitespace before this
  // function ever sees the title, so a degenerate "<empty> - <Publisher>" item arrives
  // here as "- Publisher" -- its leading space already gone -- not " - Publisher". A
  // leading "- " is therefore equivalent to a " - " separator with nothing before it and
  // must resolve to "" the same way, or the degenerate-title quarantine below never fires.
  if (title.startsWith("- ")) return "";
  const i = title.lastIndexOf(" - ");
  return i === -1 ? title : title.slice(0, i).trim();
}
