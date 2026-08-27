import { FILTERS, matchesFilter } from "./filter.js";
import { formatDayKey } from "./format.js";
import type { FeedResult } from "./read.js";
import type { Section } from "../../types/article.js";

/**
 * The data the Modern Classic masthead zone needs, computed once per page render:
 *
 * - `subline` — the newest resolved day and its own unfiltered count ("26.08.2026 · 99
 *   stories"), the line under the masthead. `undefined` when no day resolved, letting
 *   `SectionNav` fall back to the tagline rather than printing a count it does not have.
 * - `chipCounts` — per quick-filter chip, how many of the rendered days' articles it matches,
 *   so a chip names its effect before it is pressed. Counted over the raw day lists (the same
 *   universe `FeedArchive`'s FILTER sentence totals), not the folded render: a count here is
 *   "matches in these days", not a promise about visible rows.
 */
export function feedHeaderData(
  section: Section,
  results: FeedResult[],
): { subline: string | undefined; chipCounts: Record<string, number> } {
  const firstDay = results.find((r) => r.day !== null);
  const subline =
    firstDay && firstDay.day !== null
      ? `${formatDayKey(firstDay.day)} · ${firstDay.articles.length} ${
          firstDay.articles.length === 1 ? "story" : "stories"
        }`
      : undefined;

  const chipCounts: Record<string, number> = {};
  for (const chip of FILTERS[section]) {
    chipCounts[chip.id] = results.reduce(
      (n, r) => n + r.articles.filter((a) => matchesFilter(a, chip)).length,
      0,
    );
  }
  return { subline, chipCounts };
}
