import Link from "next/link";
import { DEFAULT_ARCHIVE_DAYS, MAX_ARCHIVE_DAYS } from "../src/lib/feed/days.js";
import type { FeedResult } from "../src/lib/feed/read.js";
import type { Section } from "../src/types/article.js";
import { FeedView } from "./FeedView.js";

export interface FeedArchiveProps {
  section: Section;
  /** One `FeedResult` per day `getRecentDays` returned, newest first. Empty means no ranked
   *  day exists at all -- not "every day was empty for this vertical", which is instead one or
   *  more entries whose own `articles` array is empty (see `NO_DAYS_RESULT` below). */
  results: FeedResult[];
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
 * `results.length === 0` (no ranked day has ever completed, distinct from "every requested day
 * was empty for this vertical") renders `FeedView`'s own no-day message once, via
 * `NO_DAYS_RESULT`, instead of a wall of N empty per-day messages that would all be lying about
 * there being N real days to report on.
 */
export function FeedArchive({ section, results, now, days, basePath }: FeedArchiveProps) {
  if (results.length === 0) {
    return <FeedView section={section} result={NO_DAYS_RESULT} now={now} />;
  }

  // More days can only exist if `listDays` returned as many as were asked for -- fewer means
  // the table's history was exhausted before `days` was reached, and asking again would just
  // repeat the same query for no new data.
  const moreMayExist = results.length === days && days < MAX_ARCHIVE_DAYS;
  const nextDays = Math.min(days + DEFAULT_ARCHIVE_DAYS, MAX_ARCHIVE_DAYS);

  return (
    <>
      {results.map((result) => (
        <FeedView key={result.day} section={section} result={result} now={now} />
      ))}
      {moreMayExist ? (
        <Link
          href={`${basePath}?days=${nextDays}`}
          data-testid="load-more-days"
          className="mt-2 inline-block text-sm text-neutral-500 underline hover:text-neutral-900"
        >
          Load older days
        </Link>
      ) : null}
    </>
  );
}
