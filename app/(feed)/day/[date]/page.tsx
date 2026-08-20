import { notFound } from "next/navigation";
import { DaySection } from "../../../../components/DaySection.js";
import { dayStatusLine } from "../../../../components/FeedView.js";
import { SectionNav } from "../../../../components/SectionNav.js";
import { getDay } from "../../../../src/lib/feed/read.js";

// Same reason as the two feed routes and the story page: without this, Next prerenders the
// route at build time, calling `getDay` (and hitting DynamoDB) with no TABLE_NAME set. Verified
// via `pnpm build`'s route table: this route must show `ƒ` (Dynamic), never `○` (Static).
export const dynamic = "force-dynamic";

/**
 * Next 15+ makes a dynamic segment's `params` a Promise, not a plain object -- the same trap
 * documented on `app/article/[urlHash]/page.tsx`. Typing this as `{ date: string }` and reading
 * `params.date` directly compiles and builds clean but serves `undefined` at runtime.
 */
interface DayPageProps {
  params: Promise<{ date: string }>;
}

/** The store's day key shape, `YYYY-MM-DD` -- nothing more. Task 7 Step 3: the date in the URL
 *  is a string we look up, never a date we compute from, so this is a shape check on the
 *  string itself, not a parse into a `Date` (which would accept things like `2026-2-1` or
 *  `2026-08-01T00:00:00Z` that are not this store's key format, and could shift under timezone
 *  arithmetic this page must never perform). Rejecting an obviously-malformed date here, before
 *  querying, also skips a DynamoDB read that could only ever come back empty. */
const DAY_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A single day, both verticals, at `/day/[date]` -- Task 7 Step 1. `getDay` is deliberately
 * unfiltered by section (see its doc comment in src/lib/feed/read.ts): a deep link to a date is
 * a link to that day, not to a vertical, so this renders `<SectionNav current={null} />` rather
 * than picking one section arbitrarily.
 *
 * A date this page cannot look up at all -- one that fails the `YYYY-MM-DD` shape check -- is a
 * real 404 via `notFound()`, never an empty page that looks broken. The shape check runs before
 * `getDay` is even called: a string like `"banana"` cannot possibly match a stored partition, so
 * querying for it would only ever waste a read.
 *
 * A shape-valid date with **no articles and no `META#DAY` record** (`result.status === null`)
 * is also a 404 -- an unknown day, or one before the archive begins. This departs from the
 * brief's literal "an unknown or empty date is a 404" (fix round 1, F6, my ruling, not the
 * brief's): a date with no articles but a REAL `META#DAY` record is a day that ran and legitimately
 * ranked nothing, which §4 added the `META#DAY` read precisely so a reader could tell apart from
 * "this day never happened". Collapsing that into the same 404 as an unknown date would throw
 * away the one signal that distinguishes them. `src/lambda/rank.ts` (around the "Recording a
 * complete day with zero articles is wrong ... Leave no META#DAY at all" comment) currently
 * refuses to ever write a `META#DAY` record for a zero-article day, so this branch is not
 * reachable from today's writer -- but the reader does not lean on that cross-file invariant to
 * stay safe: if a record ever does exist for an empty day, this renders an honest explanation
 * instead of a 404, rather than silently depending on the writer never producing that state.
 */
export default async function DayPage({ params }: DayPageProps) {
  const { date } = await params;
  if (!DAY_SHAPE.test(date)) {
    notFound();
  }

  const result = await getDay(date);
  if (result.articles.length === 0 && result.status === null) {
    notFound();
  }

  const now = new Date();

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <SectionNav current={null} />

      {result.llmRankedInDay !== null ? (
        <p data-testid="day-status" className="mb-4 text-xs text-neutral-500">
          {dayStatusLine(result.status, result.llmRankedInDay, result.truncatedInDay, date)}
        </p>
      ) : null}

      {result.articles.length === 0 ? (
        <p data-testid="day-empty" className="text-neutral-600">
          This day ranked but produced no stories in either vertical.
        </p>
      ) : (
        <DaySection day={date} articles={result.articles} now={now} />
      )}
    </main>
  );
}
