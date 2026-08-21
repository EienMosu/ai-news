import { notFound } from "next/navigation";
import { WorldGround } from "../../../../components/WorldGround.js";
import { DaySection } from "../../../../components/DaySection.js";
import { dayStatusLine } from "../../../../components/FeedView.js";
import { SectionNav } from "../../../../components/SectionNav.js";
import { getDay } from "../../../../src/lib/feed/read.js";
import { isValidDay } from "../../../../src/lib/search/range.js";

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

/**
 * A single day, both verticals, at `/day/[date]` -- Task 7 Step 1. `getDay` is deliberately
 * unfiltered by section (see its doc comment in src/lib/feed/read.ts): a deep link to a date is
 * a link to that day, not to a vertical, so this renders `<SectionNav current={null} />` rather
 * than picking one section arbitrarily.
 *
 * A date this page cannot look up at all -- one that fails `isValidDay` -- is a real 404 via
 * `notFound()`, never an empty page that looks broken. `isValidDay` (src/lib/search/range.ts) is
 * a full calendar check, not just a `YYYY-MM-DD` shape check: final review, L3 -- a plain regex
 * accepts `"2026-02-30"` (four digits, two digits, two digits) as well-formed even though no
 * February reaches the 30th, and this page's own comment used to claim the shape check alone
 * "skips a DynamoDB read that could only ever come back empty," which was true of `"banana"` and
 * false of a calendar-impossible-but-shape-valid date -- `/search` already exports `isValidDay`
 * for exactly this reason ("reject a semantically impossible `?since=` before it ever reaches the
 * day-walk"), and this page now shares that one calendar check rather than a second, weaker copy
 * of it. The check still runs before `getDay` is even called, so a calendar-impossible date pays
 * no `queryDay` and no `GetItem` -- see tests/feed/day-page.test.tsx for the call-count pin.
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
  if (!isValidDay(date)) {
    notFound();
  }

  const result = await getDay(date);
  if (result.articles.length === 0 && result.status === null) {
    notFound();
  }

  const now = new Date();

  return (
    <main data-ground="ink" className="min-h-dvh bg-[var(--field)] px-5 py-10 sm:px-8 sm:py-14">
      <WorldGround field="ink" />
      <div className="mx-auto max-w-3xl">
      <SectionNav current={null} />

      {result.llmRankedInDay !== null ? (
        <p data-testid="day-status" className="mb-4 text-xs opacity-75">
          {dayStatusLine(result.status, result.llmRankedInDay, result.truncatedInDay, date)}
        </p>
      ) : null}

      {result.articles.length === 0 ? (
        <p data-testid="day-empty" className="opacity-80">
          This day ranked but produced no stories in either vertical.
        </p>
      ) : (
        <DaySection
          day={date}
          entries={result.articles.map((article, i) => ({ article, rank: i + 1 }))}
          totalInDay={result.articles.length}
          now={now}
        />
      )}
      </div>
    </main>
  );
}
