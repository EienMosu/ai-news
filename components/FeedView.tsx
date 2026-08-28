import Link from "next/link";
import { matchesFilter, type FilterDef } from "../src/lib/feed/filter.js";
import { formatDayKey } from "../src/lib/feed/format.js";
import type { FeedResult } from "../src/lib/feed/read.js";
import type { Section } from "../src/types/article.js";
import { DaySection, type RankedEntry } from "./DaySection.js";

export interface FeedViewProps {
  section: Section;
  result: FeedResult;
  now: Date;
  /** The active quick filter (spec 6.3), or `null`/omitted for the unfiltered feed. Resolved
   *  once per page via `resolveFilter` and threaded down through `FeedArchive` unchanged -- this
   *  is the one place that actually runs `matchesFilter` against this day's articles, which is
   *  what lets it filter WITHOUT losing each entry's original day rank: ranks come off the full,
   *  unfiltered `entries` array (index-based, exactly as before) and only then get narrowed down
   *  to the matches, so a survivor keeps the rank number it always had (shared-preamble.md's
   *  "Filter states" paragraph; `DaySection`'s own contract for `RankedEntry`). */
  filterDef?: FilterDef | null;
  /** urlHashes the archive has folded away as story repeats (cluster siblings within a day,
   *  the same slug ranked again on an older day) -- computed once per archive by
   *  `repeatedStoryHashes` (src/lib/feed/dedupe.ts) and applied here, at the same
   *  after-rank-assignment seam as `filterDef`, for the same reason: a survivor keeps the rank
   *  number it always had. Omitted by `/day/[date]`, which shows the day as it was judged,
   *  repeats and all. */
  hiddenHashes?: Set<string>;
}

const SECTION_LABELS: Record<Section, string> = { ai: "AI", design: "design", cloud: "cloud" };

/**
 * The day-status line. `llmRankedInDay`/`truncatedInDay` are totals across every vertical (see
 * the doc comment on `FeedResult` in src/lib/feed/read.ts), so this sentence names the day
 * explicitly rather than reading like a count of the section list rendered beneath it -- "264
 * ranked" beside 40 AI cards would otherwise look like it described those 40.
 *
 * `status: "partial"` is worded as a plain fact, not an error: a partial day with some articles
 * truncated by the ranking cap (the live data's normal case -- 14 of 264 -- is exactly this) is
 * not a failure state and must not read like one. It is also never worded as "today's ranking":
 * the day this describes is whatever `getRecentDays`/`getDay` returned, which is
 * routinely yesterday (or, once a pipeline has been quietly broken for a while, weeks old) --
 * this function has no `now` and cannot know whether `day` is today, so it must never claim it
 * is. "That day's ranking was partial" names the fact without a claim it cannot back up.
 *
 * Takes `llmRankedInDay` as a definite `number`, not `number | null` -- the caller (`FeedView`)
 * only invokes this once the count is known, and omits the whole day-status line otherwise
 * rather than call this with a count it does not have. A `?? 0` fallback here would turn "we
 * don't know" into a confident, self-contradicting "0 stories ranked" printed directly above a
 * header that might read "1 story" -- pushing that decision into the type signature makes it
 * impossible to reintroduce by accident.
 *
 * Exported and pure (no JSX) so the wording can be checked directly, one clause at a time,
 * without going through a DOM render.
 */
export function dayStatusLine(
  status: FeedResult["status"],
  llmRankedInDay: number,
  truncatedInDay: number | null,
  day: string,
): string {
  const rankedPart =
    `${llmRankedInDay} ${llmRankedInDay === 1 ? "story" : "stories"} ranked across all sections on ${formatDayKey(day)}`;
  const truncatedPart =
    truncatedInDay !== null && truncatedInDay > 0
      ? `, ${truncatedInDay} truncated by the day's ranking cap`
      : "";
  const partialPart = status === "partial" ? "; that day's ranking was partial" : "";
  return `${rankedPart}${truncatedPart}${partialPart}.`;
}

/**
 * The three states Task 5 Step 3 requires be told apart, worded so they cannot be confused with
 * one another:
 *
 * 1. `day === null` -- no ranked day exists at all (what a fresh deploy legitimately shows).
 * 2. `day` set, `articles` empty -- that day ranked fine, this vertical just had nothing.
 * 3. `articles` present -- the normal case, handed to `DaySection`.
 *
 * A spinner, a blank page, or one generic message for all three would collapse distinctions a
 * reader needs to tell "nothing has run yet" apart from "nothing today, in this vertical".
 *
 * The day-status line above states 2 and 3 is skipped entirely when `llmRankedInDay` is `null`
 * -- reachable via `getDay()` (Task 6's `/day/[date]`) whenever the day's `META#DAY` record is
 * absent or malformed. There is nothing honest to say about a count that was never recorded, so
 * this omits the line rather than hand `dayStatusLine` a fallback `0` it would then report as
 * fact.
 */
export function FeedView({ section, result, now, filterDef, hiddenHashes }: FeedViewProps) {
  const { day, articles, status, llmRankedInDay, truncatedInDay } = result;

  if (day === null) {
    return (
      <p data-testid="feed-empty-no-day" className="font-[family-name:var(--font-text)] text-[1.0625rem] italic opacity-80">
        The pipeline has not produced a ranked day yet. Check back soon.
      </p>
    );
  }

  // Owner's call (2026-08-28, matching the iOS app): the number beside an entry is its
  // VISIBLE position, renumbered after every narrowing, so repeat-folding and filtering
  // never leave gaps (1, 2, 3 — not 1, 5, 7). A skipped number reads as a bug to a reader,
  // not as a fact about the day; the day's own totals stay honest in the header's K of N.
  const allEntries: RankedEntry[] = articles.map((article) => ({ article, rank: 0 }));
  const visibleEntries = hiddenHashes
    ? allEntries.filter((entry) => !hiddenHashes.has(entry.article.urlHash))
    : allEntries;
  const matchedEntries = (
    filterDef
      ? visibleEntries.filter((entry) => matchesFilter(entry.article, filterDef))
      : visibleEntries
  ).map((entry, i) => ({ article: entry.article, rank: i + 1 }));

  // Branch review M6: the FILTER stamp line is a section-wide summary, not a per-day one (its
  // shown/total are already summed across every rendered day, task-C3-brief.md), so it renders
  // exactly once per section view, above the whole day list -- in `FeedArchive`, never here.
  // `FeedView` still suppresses its own per-day day-status line under an active filter (the
  // section-wide FILTER line above the list already covers what is filtered), it just no
  // longer renders a replacement line of its own.
  return (
    <>
      {filterDef == null && llmRankedInDay !== null ? (
        <p
          data-testid="day-status"
          className="apparatus mb-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 opacity-70"
          data-numeric
        >
          {/* Labelled because the number beside it in the sheet header is a DIFFERENT scope --
              that one counts this vertical, this one totals both. Unlabelled, 93 above 72 reads
              as an arithmetic error rather than two facts. */}
          <span className="stamp shrink-0">Day total</span>
          <span>{dayStatusLine(status, llmRankedInDay, truncatedInDay, day)}</span>
        </p>
      ) : null}

      {articles.length === 0 ? (
        <p data-testid="feed-empty-section" className="font-[family-name:var(--font-text)] text-[1.0625rem] italic opacity-80">
          No {SECTION_LABELS[section]} stories for {formatDayKey(day)}.
        </p>
      ) : filterDef && matchedEntries.length === 0 ? (
        // A zero-match day still keeps its sheet (shared-preamble.md's "Filter states"
        // paragraph) -- the header and paper frame, reused from `DaySection`'s own markup
        // rather than duplicating the whole component for one extra line, plus the notice that
        // says so explicitly instead of a blank paper panel that looks broken.
        <section className="mb-10 sm:mb-14">
          <div className="border-y border-[var(--hair-soft)] py-4">
            <header className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
              <h2 className="font-[family-name:var(--font-display)] text-[1.375rem] font-bold leading-none tracking-[-0.02em] sm:text-[1.625rem]">
                <Link href={`/day/${day}`} className="no-underline hover:underline" data-numeric>
                  {formatDayKey(day)}
                </Link>
              </h2>
              <span className="apparatus text-[color:var(--muted)]" data-numeric>
                0 of {articles.length} stories
              </span>
            </header>
            <p className="apparatus opacity-70">No matches this day.</p>
          </div>
        </section>
      ) : (
        <DaySection day={day} entries={matchedEntries} totalInDay={articles.length} now={now} />
      )}
    </>
  );
}
