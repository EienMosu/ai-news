import { DaySection } from "../../components/DaySection.js";
import { istanbulDay } from "../../src/lib/core/day.js";
import { parseQueryParam, parseSectionParam, parseSinceParam, type SearchScope } from "../../src/lib/search/params.js";
import {
  MAX_ARCHIVE_SEARCH_DAYS,
  RECENT_WINDOW_DAYS,
  exceedsArchiveBound,
  splitSearchRange,
} from "../../src/lib/search/range.js";
import { searchArchiveDays, searchRecentDays, type DayMatches } from "../../src/lib/search/read.js";
import type { Section } from "../../src/types/article.js";

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
function SearchForm({ query, scope, since }: { query: string; scope: SearchScope; since: string }) {
  return (
    <form method="get" action="/search" className="mb-8 flex flex-wrap items-end gap-3 text-sm">
      <label className="flex flex-col text-neutral-700">
        Search
        <input
          type="text"
          name="q"
          defaultValue={query}
          placeholder="title or summary text"
          className="mt-1 rounded border border-neutral-300 px-2 py-1"
        />
      </label>
      <label className="flex flex-col text-neutral-700">
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
      <label className="flex flex-col text-neutral-700">
        Since
        <input
          type="date"
          name="since"
          defaultValue={since}
          className="mt-1 rounded border border-neutral-300 px-2 py-1"
        />
      </label>
      <button
        type="submit"
        className="rounded bg-neutral-900 px-4 py-1.5 font-semibold text-white hover:bg-neutral-700"
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
 * before `today`/`scope`/`since` are even used for anything beyond pre-filling the form's own
 * fields -- so a blank submit never reaches `searchRecentDays`/`searchArchiveDays` and never
 * costs a single Query.
 *
 * The archive branch's 31-day bound (decision 2) is checked on the *archive* half only:
 * `exceedsArchiveBound` refuses to run `searchArchiveDays` and says so in a visible message,
 * but `searchRecentDays` still runs -- the last 30 days are always affordable regardless of how
 * far back `since` reaches, so a too-wide request still gets the cheap half of its answer
 * instead of nothing at all. What it never gets is a silently partial archive: the message
 * names the bound and asks the reader to narrow `since`, rather than the page fetching the
 * first `MAX_ARCHIVE_SEARCH_DAYS` of `archiveDays` and calling that "the archive searched".
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
      <main className="mx-auto max-w-2xl px-4 py-8">
        <h1 className="mb-4 text-xl font-bold text-neutral-900">Search</h1>
        <SearchForm query={query} scope={scope} since={since} />
      </main>
    );
  }

  const { recentDays, archiveDays } = splitSearchRange(since, today, today);
  const archiveRefused = exceedsArchiveBound(archiveDays);

  const [recentResults, archiveResults] = await Promise.all([
    searchRecentDays(recentDays, scope, query),
    archiveRefused || archiveDays.length === 0
      ? Promise.resolve<DayMatches[]>([])
      : searchArchiveDays(archiveDays, scope, query),
  ]);

  const results = [...recentResults, ...archiveResults];

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="mb-4 text-xl font-bold text-neutral-900">Search</h1>
      <SearchForm query={query} scope={scope} since={since} />

      {archiveRefused ? (
        <p data-testid="search-archive-refused" className="mb-4 text-sm text-amber-700">
          That start date reaches more than {MAX_ARCHIVE_SEARCH_DAYS} days into the archive in
          one search, so the archive was not searched. Pick a "Since" date within the last{" "}
          {RECENT_WINDOW_DAYS + MAX_ARCHIVE_SEARCH_DAYS} days to include it.
        </p>
      ) : null}

      {results.length === 0 ? (
        <p data-testid="search-empty" className="text-neutral-600">
          No results for &quot;{query}&quot;.
        </p>
      ) : (
        results.map((r) => <DaySection key={r.day} day={r.day} articles={r.articles} now={now} />)
      )}
    </main>
  );
}
