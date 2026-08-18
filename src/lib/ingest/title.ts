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
  const i = title.lastIndexOf(" - ");
  if (i !== -1) return title.slice(0, i).trim();

  // No " - " separator survived to split on. A leading "- " by itself is NOT evidence
  // of a degenerate title -- "- Interesting update - Anthropic" also starts with "- "
  // but has a real separator later in the string, and is handled by the branch above.
  // It is only when there is no separator anywhere that a leading "- " means something:
  // the real title was empty and the whole string is just "- Publisher" -- the pre-trim
  // form " - Publisher" with its leading space already eaten by fetchers/rss.ts's
  // whitespace trimming/collapsing, which runs before this function ever sees the title.
  return title.startsWith("- ") ? "" : title;
}
