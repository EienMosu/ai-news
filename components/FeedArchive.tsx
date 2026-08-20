import Link from "next/link";
import { ARCHIVE_STEP_DAYS, MAX_ARCHIVE_DAYS } from "../src/lib/feed/days.js";
import type { FeedResult } from "../src/lib/feed/read.js";
import type { Section } from "../src/types/article.js";
import { FeedView } from "./FeedView.js";

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
export function FeedArchive({ section, results, failedDays, now, days, basePath }: FeedArchiveProps) {
  if (results.length === 0 && failedDays === 0) {
    return <FeedView section={section} result={NO_DAYS_RESULT} now={now} />;
  }

  // More days can only exist if `listDays` returned as many as were asked for -- fewer means
  // the table's history was exhausted before `days` was reached, and asking again would just
  // repeat the same query for no new data. `+ failedDays` (final review, M2): a day dropped by
  // `getRecentDays` because its own `queryDay` failed is not evidence the archive is exhausted --
  // it is evidence one read failed -- so the comparison is against how many days were actually
  // ATTEMPTED (`results.length + failedDays`), not just how many came back.
  const moreMayExist = results.length + failedDays === days && days < MAX_ARCHIVE_DAYS;
  const nextDays = Math.min(days + ARCHIVE_STEP_DAYS, MAX_ARCHIVE_DAYS);

  return (
    <>
      {failedDays > 0 ? (
        <p data-testid="feed-days-failed" className="apparatus mb-6 flex flex-wrap items-center gap-2 opacity-85">
          <span className="stamp">Incomplete</span>
          {failedDays} {failedDays === 1 ? "day" : "days"} could not be loaded just now; the
          sections below may be missing {failedDays === 1 ? "that day" : "those days"}.
        </p>
      ) : null}
      {results.map((result) => (
        <FeedView key={result.day} section={section} result={result} now={now} />
      ))}
      {moreMayExist ? (
        <Link
          href={`${basePath}?days=${nextDays}`}
          data-testid="load-more-days"
          className="apparatus mt-2 inline-block border border-current/45 px-4 py-2.5 no-underline transition-colors duration-200 hover:bg-[var(--color-paper)] hover:text-[var(--field)]"
        >
          Load older days
        </Link>
      ) : null}
    </>
  );
}
