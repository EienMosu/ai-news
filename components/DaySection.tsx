import Link from "next/link";
import type { FeedArticle } from "../src/lib/feed/shape.js";
import { ArticleCard } from "./ArticleCard.js";

/** One entry on a day sheet: the article, paired with its rank within the day. Rank travels
 *  with the entry rather than being derived from array position, so a filtered subset of a day
 *  (see `totalInDay` below) can still print each entry's real, day-wide rank instead of
 *  renumbering from 1 -- the rank is a fact about the day, not about whatever filter is
 *  currently narrowing what is shown. */
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
 * Ranks are read off each entry (`entry.rank`), never re-derived from array position -- the
 * whole point of carrying them explicitly is that a filtered render still prints the day's real
 * numbers (e.g. 01, 04, 07 for a day's #1, #4, and #7 stories) rather than silently renumbering
 * the survivors from 1, which would make a filtered sheet's ranks incomparable to the same day
 * unfiltered.
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
    <section className="mb-10 sm:mb-14">
      <div
        data-surface="paper"
        className="px-4 pb-2 pt-5 shadow-[0_18px_40px_-24px_rgba(0,0,0,0.55)] sm:px-7 sm:pb-4 sm:pt-7"
      >
        <header className="mb-5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 sm:mb-6">
          <h2 className="font-[family-name:var(--font-display)] text-[1.75rem] font-extrabold leading-none tracking-[-0.028em] sm:text-[2.25rem]">
            <Link href={`/day/${day}`} className="no-underline hover:underline" data-numeric>
              {day}
            </Link>
          </h2>
          <span className="apparatus opacity-70" data-numeric>
            {countLabel}
          </span>
        </header>

        {entries.map((entry, i) => (
          <ArticleCard
            key={entry.article.urlHash}
            article={entry.article}
            now={now}
            rank={entry.rank}
            lead={i === 0}
          />
        ))}
      </div>
    </section>
  );
}
