import { DaySection } from "../../../components/DaySection.js";
import { SectionNav } from "../../../components/SectionNav.js";
import { istanbulDay } from "../../../src/lib/core/day.js";
import { parseQueryParam, parseSectionParam, parseSinceParam, type SearchScope } from "../../../src/lib/search/params.js";
import {
  MAX_ARCHIVE_SEARCH_DAYS,
  RECENT_WINDOW_DAYS,
  exceedsArchiveBoundForRange,
  splitSearchRange,
  subtractDays,
} from "../../../src/lib/search/range.js";
import { searchArchiveDays, searchRecentDays, type ArchiveSearchOutcome } from "../../../src/lib/search/read.js";
import type { Section } from "../../../src/types/article.js";

// Without this, Next prerenders the route at build time, and a search actually reaching
// searchRecentDays would call DynamoDB with no TABLE_NAME set -- same reason as every other
// data-backed route in this app. Verified via `pnpm build`'s route table: this route must show
// `ƒ` (Dynamic), never `○` (Static).
export const dynamic = "force-dynamic";

/**
 * Next 15+ makes `searchParams` a Promise, not a plain object -- the same trap documented on
 * `app/page.tsx`, `app/design/page.tsx`, and the two dynamic-segment pages. Typing this as a
 * plain object and reading `searchParams.q` directly compiles and builds clean but serves
 * `undefined` at runtime for every request, regardless of the actual URL.
 */
interface SearchPageProps {
  searchParams: Promise<{
    q?: string | string[];
    section?: string | string[];
    since?: string | string[];
  }>;
}

const SECTION_OPTIONS: { value: SearchScope; label: string }[] = [
  { value: "ai", label: "AI" },
  { value: "design", label: "Design" },
  { value: "both", label: "Both" },
];

/** The default vertical a bare `/search` (no `?section=`) runs against -- decision 3: "search
 *  the current vertical by default". This module has no way to know which page linked here, so
 *  "current" collapses to the app's own primary vertical, the same one `/` (not `/design`)
 *  serves. */
const DEFAULT_SCOPE: Section = "ai";

/**
 * The plain GET form: `q`, `section`, and `since` are all real form-field names, so submitting
 * this form (a native browser action, no JS) is exactly a navigation to `/search?q=...` --
 * decision 3's "search runs on submit, never on keystroke", and the reason this whole page has
 * no client component boundary. Field values round-trip through `defaultValue` so a search
 * result page still shows what was actually searched for, not a blank form above its own
 * results.
 */
function SearchForm(
  { query, scope, since, today }: { query: string; scope: SearchScope; since: string; today: string },
) {
  // Fix round 1, finding 8 (F9 in the review): `min`/`max` make the browser itself refuse a
  // date outside the window the server would honour, with zero client JS -- consistent with the
  // rest of this app's no-JS posture. This does not replace server-side validation (a hand-typed
  // or scripted request still goes through `parseSinceParam`/`isValidDay`); it only spares an
  // ordinary reader clicking through a native date picker from ever picking a value the server
  // would have to refuse or reinterpret.
  const minSince = subtractDays(today, RECENT_WINDOW_DAYS + MAX_ARCHIVE_SEARCH_DAYS - 1);

  return (
    <form method="get" action="/search" className="mb-8 flex flex-wrap items-end gap-3 text-sm">
      <label className="flex flex-col opacity-85">
        Search
        <input
          type="text"
          name="q"
          defaultValue={query}
          placeholder="title or summary text"
          className="mt-1 rounded border border-neutral-300 px-2 py-1"
        />
      </label>
      <label className="flex flex-col opacity-85">
        Section
        <select
          name="section"
          defaultValue={scope}
          className="mt-1 rounded border border-neutral-300 px-2 py-1"
        >
          {SECTION_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </label>
      <label className="flex flex-col opacity-85">
        Since
        <input
          type="date"
          name="since"
          defaultValue={since}
          min={minSince}
          max={today}
          className="mt-1 rounded border border-neutral-300 px-2 py-1"
        />
      </label>
      <button
        type="submit"
        className="rounded bg-[var(--color-paper)] px-4 py-1.5 font-semibold text-[var(--field)] hover:opacity-85"
      >
        Search
      </button>
    </form>
  );
}

/**
 * `/search` -- Task 8. A plain form doing a GET, never a client "search as you type": each
 * recent-range search is ~30 `queryDay` Queries (~1,500 RRU), and a per-keystroke search would
 * multiply that by the length of whatever the reader is still typing. That cost, plus there
 * being nothing to hold in client state, is also why this stays a server component with no
 * `"use client"` boundary anywhere in the tree.
 *
 * An empty or whitespace-only `q` (decision 7) renders `SearchForm` and returns immediately --
 * before `scope`/`since` are even used for anything beyond pre-filling the form's own fields --
 * so a blank submit never reaches `searchRecentDays`/`searchArchiveDays` and never costs a
 * single Query.
 *
 * `since` alone decides both halves of the range -- fix round 1, finding 4: whichever
 * `splitSearchRange` call below actually runs, `recentDays` is whatever it classifies as
 * "recent" for *this* `since`, not an unconditional `RECENT_WINDOW_DAYS`-long list, so `?since=`
 * narrows the recent half too, at the same rate it narrows the archive half.
 *
 * The archive branch's 31-day bound (decision 2) is checked on the *archive* half only, and --
 * fix round 2 -- checked BEFORE `splitSearchRange` ever walks the range, not after:
 * `exceedsArchiveBoundForRange(since, today, today)` answers "is this too long" in O(1), with no
 * day-by-day walk, so a `since` that is calendar-valid but absurdly distant (`?since=0000-01-01`
 * -- `isValidDay` correctly does not reject a real, if extreme, date) is refused the same way a
 * merely-too-long range is, instead of `splitSearchRange` discovering the same fact the slow way
 * and hitting its own defensive cap first. When refused, `recentDays` still comes from
 * `splitSearchRange`, but anchored at the recent window's own `cutoff` rather than the raw
 * (unbounded) `since` -- correct, because a refused range is by definition wider than the recent
 * window on its own, so the recent half is unconditionally the full window either way, and safe,
 * because that walk is always exactly `RECENT_WINDOW_DAYS` steps regardless of how far back
 * `since` reached. `searchRecentDays` still runs either way -- the last 30 days (or however many
 * `since` narrows that to, when not refused) are always affordable regardless of how far back
 * `since` reaches, so a too-wide request still gets the cheap half of its answer instead of
 * nothing at all. What it never gets is a silently partial archive: the message names the bound
 * and asks the reader to narrow `since`, rather than the page fetching the first
 * `MAX_ARCHIVE_SEARCH_DAYS` of `archiveDays` and calling that "the archive searched".
 *
 * A *fetch* failure partway through the archive half (fix round 1, finding 5) is not the same
 * thing as a refused range, and must not be treated the same way: `searchArchiveDays` already
 * degrades a failed day to "dropped, counted" rather than rejecting the whole call (see its own
 * doc comment), so the only thing left for this page to do is show that count when it is
 * nonzero -- the recent results render regardless, exactly as they do for a refused range.
 */
export default async function SearchPage({ searchParams }: SearchPageProps) {
  const params = await searchParams;
  const query = parseQueryParam(params.q);

  const now = new Date();
  const today = istanbulDay(now);
  const scope = parseSectionParam(params.section, DEFAULT_SCOPE);
  const since = parseSinceParam(params.since, today);

  if (query === "") {
    return (
      <main data-field="ai" className="min-h-dvh bg-[var(--field)] px-5 py-10 sm:px-8 sm:py-14">
      <div className="mx-auto max-w-3xl">
        <SectionNav current={null} />
        <h1 className="mb-4 text-xl font-bold text-current">Search</h1>
        <SearchForm query={query} scope={scope} since={since} today={today} />
        </div>
    </main>
    );
  }

  // Fix round 2: decide BEFORE walking, not after. `exceedsArchiveBoundForRange` never walks a
  // single day -- so a `since` that reaches back centuries costs the same as one that reaches
  // back a week. Only once we know the range is safe do we let `splitSearchRange` actually walk
  // it; when it is not, `recentDays` still needs computing, but anchored at `cutoff` rather than
  // the raw `since` -- see the doc comment above for why that is both correct and bounded.
  const archiveRefused = exceedsArchiveBoundForRange(since, today, today);
  const { recentDays, archiveDays } = archiveRefused
    ? splitSearchRange(subtractDays(today, RECENT_WINDOW_DAYS - 1), today, today)
    : splitSearchRange(since, today, today);

  const emptyArchiveOutcome: ArchiveSearchOutcome = { days: [], failedDays: 0 };

  // Both halves now return a `{ days, failedDays }` outcome (final review, M2) rather than
  // `searchRecentDays` returning a bare array that could reject wholesale: before this fix, one
  // throttled recent-window day rejected the whole `searchRecentDays` call, which rejected THIS
  // `Promise.all` too, discarding up to `MAX_ARCHIVE_SEARCH_DAYS` archive HTTP GETs that had
  // already resolved successfully -- the exact inversion of the `allSettled` rule `getDay`
  // (src/lib/feed/read.ts) wrote down, one level up from where `searchArchiveDays` already
  // applied it. Neither half can reject on a per-day failure any more, so this `Promise.all` is
  // safe again: it only ever rejects on a real configuration error (a missing `TABLE_NAME` or
  // `BACKUP_REPO`), not on a single day's read.
  const [recentOutcome, archiveOutcome] = await Promise.all([
    searchRecentDays(recentDays, scope, query),
    archiveRefused || archiveDays.length === 0
      ? Promise.resolve(emptyArchiveOutcome)
      : searchArchiveDays(archiveDays, scope, query),
  ]);

  const results = [...recentOutcome.days, ...archiveOutcome.days];

  return (
    <main data-field="ai" className="min-h-dvh bg-[var(--field)] px-5 py-10 sm:px-8 sm:py-14">
      <div className="mx-auto max-w-3xl">
      <SectionNav current={null} />
      <h1 className="mb-4 text-xl font-bold text-current">Search</h1>
      <SearchForm query={query} scope={scope} since={since} today={today} />

      {archiveRefused ? (
        <p data-testid="search-archive-refused" className="mb-4 text-sm opacity-90">
          That start date reaches more than {MAX_ARCHIVE_SEARCH_DAYS} days into the archive in
          one search, so the archive was not searched. Pick a "Since" date within the last{" "}
          {RECENT_WINDOW_DAYS + MAX_ARCHIVE_SEARCH_DAYS} days to include it.
        </p>
      ) : null}

      {recentOutcome.failedDays > 0 ? (
        <p data-testid="search-recent-failed" className="mb-4 text-sm opacity-90">
          {recentOutcome.failedDays} recent {recentOutcome.failedDays === 1 ? "day" : "days"}{" "}
          could not be searched just now; the results below may be missing matches from{" "}
          {recentOutcome.failedDays === 1 ? "that day" : "those days"}.
        </p>
      ) : null}

      {archiveOutcome.failedDays > 0 ? (
        <p data-testid="search-archive-failed" className="mb-4 text-sm opacity-90">
          {archiveOutcome.failedDays} archive {archiveOutcome.failedDays === 1 ? "day" : "days"}{" "}
          could not be searched just now; the results below may be missing matches from{" "}
          {archiveOutcome.failedDays === 1 ? "that day" : "those days"}.
        </p>
      ) : null}

      {results.length === 0 ? (
        <p data-testid="search-empty" className="opacity-80">
          No results for &quot;{query}&quot;.
        </p>
      ) : (
        results.map((r) => <DaySection key={r.day} day={r.day} articles={r.articles} now={now} />)
      )}
      </div>
    </main>
  );
}
