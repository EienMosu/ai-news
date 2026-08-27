import Link from "next/link";
import { ARCHIVE_STEP_DAYS, MAX_ARCHIVE_DAYS } from "../src/lib/feed/days.js";
import { repeatedStoryHashes } from "../src/lib/feed/dedupe.js";
import { matchesFilter, type FilterDef } from "../src/lib/feed/filter.js";
import type { FeedResult } from "../src/lib/feed/read.js";
import type { Section } from "../src/types/article.js";
import { FeedView } from "./FeedView.js";
import { formatDayKey } from "../src/lib/feed/format.js";

export interface FeedArchiveProps {
  section: Section;
  /** One `FeedResult` per day `getRecentDays` returned, newest first. Empty means no ranked
   *  day exists at all -- not "every day was empty for this vertical", which is instead one or
   *  more entries whose own `articles` array is empty (see `NO_DAYS_RESULT` below). */
  results: FeedResult[];
  /** How many of the requested days `getRecentDays` could not read at all (final review, M2) --
   *  distinct from a day that read fine and had nothing for this vertical, which is already
   *  represented as an entry in `results` with an empty `articles` array. Surfaced the same way
   *  `/search`'s `ArchiveSearchOutcome.failedDays` already is, rather than a second vocabulary
   *  for "some of these parallel reads failed." */
  failedDays: number;
  now: Date;
  /** The (already-clamped) day count this page actually asked `getRecentDays` for -- used only
   *  to decide whether more, older days might exist and to compute the "load more" link's
   *  target. Never the raw, unclamped `searchParams.days` value. */
  days: number;
  /** "/" or "/design" -- where the "load more" link points. A prop, not `usePathname`: the
   *  caller already knows which vertical's route this is, and reading it via a hook would force
   *  a client component onto something with no other reason to be one. */
  basePath: string;
  /** The page's one resolved quick filter (spec 6.3), or `null`/omitted for the unfiltered
   *  archive. Passed straight through to every day's `FeedView` unchanged -- the filter applies
   *  identically to every rendered day, so there is exactly one def for the whole archive, not
   *  one per day. */
  filterDef?: FilterDef | null;
}

/** The exact shape `FeedView` already renders as "no ranked day has ever completed" (Task 5).
 *  Reused here, unchanged, for the archive's own empty case, rather than a second copy of that
 *  message living in this file -- see the `results.length === 0` branch below. */
const NO_DAYS_RESULT: FeedResult = {
  articles: [], day: null, status: null, llmRankedInDay: null, truncatedInDay: null,
};

/**
 * The home feed's day list (Task 7 Step 2): one `FeedView` per day in `results`, newest first,
 * plus a link to load further-back days.
 *
 * **A day with nothing in this vertical still gets its own section**, showing `FeedView`'s
 * existing "No {section} stories for {day}" message, rather than being omitted from the list.
 * With seven-plus day sections instead of one, an empty vertical-day is now the common case, not
 * the edge case Task 5 treated it as -- but omitting it would make "seven days requested" render
 * as some silently smaller number of visible sections, which looks like a bug (a day vanished)
 * rather than a fact (nothing ran in this vertical that day). Showing the message is also the
 * direct generalisation of what a single day already does today, via the exact same `FeedView`
 * codepath, rather than a second, new way to express the same absence.
 *
 * `results.length === 0 && failedDays === 0` (no ranked day has ever completed, distinct from
 * "every requested day was empty for this vertical") renders `FeedView`'s own no-day message
 * once, via `NO_DAYS_RESULT`, instead of a wall of N empty per-day messages that would all be
 * lying about there being N real days to report on. `results.length === 0 && failedDays > 0` --
 * final review, M2 -- is a THIRD, distinct state this no longer collapses into the same message:
 * days were requested and at least one exists, but every one of them failed to read just now,
 * which is not the same fact as "no day has ever ranked" and must not be worded as though it
 * were.
 */
/** How many day spines the drawer shows before the "open all" handle. */
const ARCHIVE_DRAWER_SPINES = 5;

/**
 * The next calendar days behind the last rendered one, as store day keys. Pure key arithmetic
 * in UTC: the day key is a calendar label, so parsing it at UTC midnight and stepping in
 * 86400s units can never skip or double a day across DST, which local-time stepping would.
 * Days that turn out empty are fine: /day renders an honest empty state.
 */
function olderDays(results: { day: string | null }[], count: number): string[] {
  const lastDay = [...results].reverse().find((r) => r.day !== null)?.day;
  if (lastDay === undefined || lastDay === null) return [];
  const t = Date.parse(`${lastDay}T00:00:00.000Z`);
  if (Number.isNaN(t)) return [];
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(t - (i + 1) * 86_400_000);
    return d.toISOString().slice(0, 10);
  });
}

export function FeedArchive({
  section,
  results,
  failedDays,
  now,
  days,
  basePath,
  filterDef,
}: FeedArchiveProps) {
  if (results.length === 0 && failedDays === 0) {
    return <FeedView section={section} result={NO_DAYS_RESULT} now={now} filterDef={filterDef} />;
  }

  // More days can only exist if `listDays` returned as many as were asked for -- fewer means
  // the table's history was exhausted before `days` was reached, and asking again would just
  // repeat the same query for no new data. `+ failedDays` (final review, M2): a day dropped by
  // `getRecentDays` because its own `queryDay` failed is not evidence the archive is exhausted --
  // it is evidence one read failed -- so the comparison is against how many days were actually
  // ATTEMPTED (`results.length + failedDays`), not just how many came back.
  const moreMayExist = results.length + failedDays === days && days < MAX_ARCHIVE_DAYS;
  const nextDays = Math.min(days + ARCHIVE_STEP_DAYS, MAX_ARCHIVE_DAYS);

  // Branch review M6: the FILTER stamp is a SECTION-wide summary -- task-C3-brief.md asked for
  // shown/total "summed over the rendered days of this section", which is one number, not one
  // per day. Summed here, once, across every day `results` actually holds, and rendered once
  // above the whole list; `FeedView` no longer renders any filter-status line of its own (see
  // its own doc comment). `matchesFilter` runs again here rather than reading a count back off
  // each `FeedView` render -- a pure function over data already in hand, cheaper than plumbing a
  // per-day count back up through a prop.
  // Story repeats folded across the whole archive render: cluster siblings within a day, and
  // the same slug ranked again on an older day. Computed ONCE over all rendered days -- the
  // cross-day rule ("keep the newest appearance") is inherently an archive-level fact no single
  // day's FeedView could decide for itself. See src/lib/feed/dedupe.ts for the full rationale.
  const hiddenHashes = repeatedStoryHashes(results);

  const filterTotals = filterDef
    ? results.reduce(
        (totals, result) => ({
          // `shown` counts what actually renders, so it excludes folded repeats too; `total`
          // stays the day's own fact, same as DaySection's "K of N stories" header.
          shown:
            totals.shown +
            result.articles.filter((a) => !hiddenHashes.has(a.urlHash) && matchesFilter(a, filterDef))
              .length,
          total: totals.total + result.articles.length,
        }),
        { shown: 0, total: 0 },
      )
    : null;

  return (
    <>
      {failedDays > 0 ? (
        <p data-testid="feed-days-failed" className="apparatus mb-6 flex flex-wrap items-center gap-2 opacity-85">
          <span className="stamp">Incomplete</span>
          {failedDays} {failedDays === 1 ? "day" : "days"} could not be loaded just now; the
          sections below may be missing {failedDays === 1 ? "that day" : "those days"}.
        </p>
      ) : null}
      {filterDef && filterTotals ? (
        <p
          data-testid="filter-status"
          className="apparatus mb-6 flex flex-wrap items-center gap-x-2 gap-y-1.5 opacity-70"
          data-numeric
        >
          <span className="stamp shrink-0">Filter</span>
          <span>
            {`Filtered by "${filterDef.label}": ${filterTotals.shown} of ${filterTotals.total} stories in view.`}
          </span>
        </p>
      ) : null}
      <div id="stories">
      {results.map((result) => (
        <FeedView
          key={result.day}
          section={section}
          result={result}
          now={now}
          filterDef={filterDef}
          hiddenHashes={hiddenHashes}
        />
      ))}
      </div>
      {moreMayExist ? (
        /* The drawer: the days behind the fold, shown as the file-drawer tab spines they are in
           this world. Each spine is a real /day link derived from the last rendered day by
           calendar arithmetic -- zero extra reads -- and the drawer handle keeps the old
           extend-the-feed behaviour. UTC date maths on the day KEY, deliberately: the key is a
           calendar label, not an instant, and local-time arithmetic would skip or repeat a day
           twice a year. */
        <nav data-testid="archive-drawer" aria-label="Older days" className="mt-4">
          <h2 className="apparatus mb-2 opacity-75">In the drawer</h2>
          <ul className="flex flex-wrap gap-2">
            {olderDays(results, ARCHIVE_DRAWER_SPINES).map((day) => (
              <li key={day}>
                <Link
                  href={`/day/${day}`}
                  data-numeric
                  className="apparatus inline-block border border-current/45 border-t-2 border-t-current px-3 py-2 no-underline opacity-70 transition-colors duration-200 hover:opacity-100 hover:bg-[var(--ink)] hover:text-[color:var(--ground)]"
                >
                  {formatDayKey(day)}
                </Link>
              </li>
            ))}
            <li>
              <Link
                href={`${basePath}?days=${nextDays}`}
                data-testid="load-more-days"
                className="apparatus inline-block border border-current/45 px-3 py-2 no-underline transition-colors duration-200 hover:bg-[var(--ink)] hover:text-[color:var(--ground)]"
              >
                Open all older days
              </Link>
            </li>
          </ul>
        </nav>
      ) : null}
    </>
  );
}
