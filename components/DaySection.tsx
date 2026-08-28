import Link from "next/link";
import type { FeedArticle } from "../src/lib/feed/shape.js";
import { ArticleCard } from "./ArticleCard.js";
import { formatDayKey } from "../src/lib/feed/format.js";

/** One entry on a day sheet: the article, paired with the number it displays. Since the
 *  owner's 2026-08-28 call (matching the iOS app), that number is the entry's VISIBLE
 *  position — `FeedView` renumbers after folding and filtering, so the list always counts
 *  1, 2, 3 with no gaps. The day's own size still reads honestly from the header's
 *  `K of N stories`. */
export interface RankedEntry {
  article: FeedArticle;
  rank: number;
}

export interface DaySectionProps {
  /** The store's day key (`YYYY-MM-DD`), shown as-is -- no locale formatting here. */
  day: string;
  /** Already in score order (GSI1's sort order) and already carrying each entry's day rank;
   *  this component renders them exactly as given -- never re-sorts, never renumbers. */
  entries: RankedEntry[];
  /** The day's own unfiltered article count. Equal to `entries.length` when nothing has
   *  filtered the day; smaller than `entries.length` is never valid. When a filter has narrowed
   *  `entries` below this count, the header switches from "N stories" to "K of N stories". */
  totalInDay: number;
  now: Date;
}

/**
 * One day, as the sheet it was judged on.
 *
 * The header count is always this section's own numbers, never `META#DAY.articleCount` and
 * never `llmRankedInDay` -- both total across every vertical, and a day total printed beside a
 * section- or filter-narrowed list is a number that matches nothing on screen. Unfiltered
 * (`entries.length === totalInDay`), that reads as `entries.length` stories -- what this section
 * actually renders. Under a filter, `entries.length` is smaller than `totalInDay`, and the
 * header instead reads `K of N stories`: a filtered day still says how big the day was, not just
 * how many matches survived the filter (shared-preamble.md's "Filter states" paragraph).
 *
 * Numbers are read off each entry (`entry.rank`) exactly as `FeedView` assigned them:
 * sequential visible positions (owner's call, 2026-08-28) — a gapped count reads as a bug,
 * not as a fact about the day.
 *
 * The first entry given -- whatever its rank number is -- is the day's lead and renders
 * inverted, on the field rather than the paper. That is the whole ranking device: no entry is
 * set larger than another, so the reader's eye is pulled by ground, and every other row stays
 * comparable at one size.
 */
export function DaySection({ day, entries, totalInDay, now }: DaySectionProps) {
  const countLabel =
    entries.length === totalInDay
      ? `${entries.length} ${entries.length === 1 ? "story" : "stories"}`
      : `${entries.length} of ${totalInDay} stories`;

  return (
    <section className="mb-10 sm:mb-14" data-day-sheet>
      <header className="mb-1 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <h2 className="font-[family-name:var(--font-display)] text-[1.375rem] font-bold leading-none tracking-[-0.02em] sm:text-[1.625rem]">
          <Link href={`/day/${day}`} className="no-underline hover:underline" data-numeric>
            {formatDayKey(day)}
          </Link>
        </h2>
        <span
          className="apparatus text-[color:var(--muted)]"
          data-numeric
          data-day-count
          data-total={totalInDay}
        >
          {countLabel}
        </span>
      </header>

      {/* The lead's announcement: the gold double-rule and its tag open the day, Modern
          Classic's replacement for the retired field inversion — rank still shows as ground
          (the announcement), never as scale. */}
      <div className="mt-3 h-[4px] border-y border-[var(--gold-soft)]" aria-hidden="true" />
      <p className="apparatus mt-2.5 font-medium tracking-[0.3em] text-[color:var(--gold)]">
        The lead
      </p>

      {/* data-haystack mirrors matchesFilter's exact haystack (title + summary + sourceName,
          lowercased): it is what the live-search script substring-matches, so typing narrows
          on the same text the server's ?f= free-text filter would. The between-entries
          hairline and the lead numeral both moved to position-driven CSS ([data-entry]
          sibling selectors in globals.css) so hiding an entry re-derives them, exactly as the
          iOS list rebuilds — the first VISIBLE entry is the lead, wherever it started. */}
      {entries.map((entry, i) => (
        <div
          key={entry.article.urlHash}
          data-entry
          data-haystack={`${entry.article.title} ${entry.article.summary} ${entry.article.sourceName}`.toLowerCase()}
        >
          <ArticleCard article={entry.article} now={now} rank={entry.rank} lead={i === 0} />
        </div>
      ))}
    </section>
  );
}
