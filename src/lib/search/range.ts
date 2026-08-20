/**
 * Task 8 (search), Spec §8. The reason this file exists at all: a DynamoDB `Query` needs one
 * exact partition key, so a search spanning more than the recent window cannot be answered by
 * widening one `Query`'s key condition -- it has to become N `Query`s, one per day, and beyond
 * `RECENT_WINDOW_DAYS` that N gets expensive fast (a year is 365 `Query`s and ~6,800 RCU). The
 * NDJSON backup (`src/lib/rank/backup.ts`) doubles as the deep-search index for exactly that
 * reason, so a search range always splits into two disjoint day lists: the ones GSI1 can still
 * answer cheaply, and the ones that must come from the archive instead.
 */

/**
 * How many of the most recent calendar days (including `today`) GSI1 answers directly, one
 * `Query` per day partition. Spec §8's own number, not `MAX_ARCHIVE_DAYS` from
 * `src/lib/feed/days.ts` -- that constant bounds the home feed's `?days=` fan-out for an
 * unrelated reason (capping concurrent `queryDay` calls from a hostile `?days=` value) and
 * could change for that reason alone without this recency window meaning to move with it, even
 * though both constants happen to be 30 today.
 */
export const RECENT_WINDOW_DAYS = 30;

/**
 * Spec §8 [revised]: the archive branch is bounded to this many calendar days per search --
 * roughly a month of NDJSON GETs, which the spec's own accounting calls "comfortable" (~31
 * concurrent requests, ~8 MB). A request whose range asks for more is refused outright (see
 * `exceedsArchiveBoundForRange`), never silently served its first `MAX_ARCHIVE_SEARCH_DAYS` days --
 * "a search that quietly returns part of the archive is worse than one that says it will not
 * run."
 */
export const MAX_ARCHIVE_SEARCH_DAYS = 31;

/**
 * A defensive ceiling on how many days `splitSearchRange` will ever walk in one call --
 * Task 8 fix round 1, finding F3, **reduced to an invariant by fix round 2**. The day-walk's own
 * only exit condition is "we reached `from`", and it must not trust a caller unconditionally: a
 * future validation gap, or a caller that bypasses `exceedsArchiveBoundForRange`/`isValidDay`
 * entirely, would otherwise walk and allocate one string per day for as long as it takes to
 * reach the given `from`.
 *
 * As of fix round 2, this should be **unreachable from any URL today**: the search page now
 * calls `exceedsArchiveBoundForRange` -- an O(1) check, no walking -- *before* ever calling this
 * function with a raw `since`, so `?since=0000-01-01` (a real, valid, merely extreme calendar
 * date) is refused with the same message every too-long range gets, never handed to the walk at
 * all. Fix round 1 measured the walk itself at ~740,000 iterations and ~160 ms for that exact
 * input, reached because the only way to *learn* a range was too long used to be to walk it and
 * see; this cap is what remains once that is no longer true -- protection against a future
 * regression in that ordering, not the mechanism doing the deciding. 10,000 days (~27 years) is
 * far larger than any legitimate call needs -- every test in this file that exercises a
 * long-but-real range stays comfortably under it -- while still turning a pathological `from`
 * (however it got here) into a fast, loud throw instead of a slow, silent crawl.
 */
const MAX_ENUMERATION_DAYS = 10_000;

/** `app/day/[date]/page.tsx` carries its own copy of this exact regex, for an unrelated reason
 *  (rejecting a malformed URL segment before it ever reaches a DynamoDB read, on a page that has
 *  no reason to import from `src/lib/search`). This copy is the one this module's own parsing
 *  and `isValidDay` share -- not shared across the two module boundaries, since neither file
 *  depends on the other and a shared import would only save one regex literal (Task 8 fix round
 *  1, finding F10). */
const DAY_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

interface Ymd {
  y: number;
  m: number;
  d: number;
}

/** Splits a `YYYY-MM-DD` string into numeric parts. Throws on anything else -- a bogus day
 *  string reaching this function is a caller bug, and a wrong-but-quiet answer would be worse
 *  than an early, loud failure (the same choice `src/lib/core/day.ts`'s `istanbulDay` makes for
 *  an invalid `Date`). */
function parseDay(day: string): Ymd {
  if (!DAY_SHAPE.test(day)) throw new Error(`not a YYYY-MM-DD day string: ${day}`);
  const parts = day.split("-");
  return { y: Number(parts[0]!), m: Number(parts[1]!), d: Number(parts[2]!) };
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

function formatDay({ y, m, d }: Ymd): string {
  return `${pad(y, 4)}-${pad(m, 2)}-${pad(d, 2)}`;
}

function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

/** Index 0 is January. February's real value depends on the year, so `daysInMonth` never
 *  reads index 1 from this table -- it special-cases February itself, via `isLeapYear`. */
const DAYS_IN_MONTH: readonly number[] = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function daysInMonth(y: number, m: number): number {
  if (m === 2) return isLeapYear(y) ? 29 : 28;
  return DAYS_IN_MONTH[m - 1] ?? 31;
}

/**
 * True when `day` is not just shape-valid (`YYYY-MM-DD`) but a real calendar date -- Task 8 fix
 * round 1, finding F3. `"2026-08-00"` and `"2026-02-30"` both match `DAY_SHAPE` (four digits, two
 * digits, two digits) but do not exist on any calendar: `00` is not a month or a day, and
 * February never reaches 30. A shape check alone let either string reach `splitSearchRange`'s
 * day-walk, which then stepped past `from` without ever matching `cur === from` (there is no
 * calendar day equal to `"2026-08-00"` to walk down to) and threw only after enumerating roughly
 * 740,000 strings -- an unhandled 500 on `/search`, reachable from a plain URL.
 *
 * Exported so `parseSinceParam` (src/lib/search/params.ts) can reject a semantically impossible
 * `?since=` before it ever reaches the day-walk, rather than relying on the walk to fail safely.
 */
export function isValidDay(day: string): boolean {
  if (!DAY_SHAPE.test(day)) return false;
  const { y, m, d } = parseDay(day);
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}

/**
 * The calendar day immediately before `day` -- plain Y/M/D arithmetic, never a `Date` object.
 * Task 7 was pinned on "the date in the URL is a string we look up, never a date we compute
 * from" only after that gap was attacked with no test pressure on it; this function is how
 * `splitSearchRange` walks a range without ever constructing a `Date` at all, so there is no
 * timezone or DST behaviour to get wrong in the first place.
 */
function previousDay(day: string): string {
  const { y, m, d } = parseDay(day);
  if (d > 1) return formatDay({ y, m, d: d - 1 });
  if (m > 1) return formatDay({ y, m: m - 1, d: daysInMonth(y, m - 1) });
  return formatDay({ y: y - 1, m: 12, d: 31 });
}

/**
 * `day`, `n` calendar days earlier (`n = 0` returns `day` unchanged). Exported so callers (the
 * search page) can compute a default `from` boundary -- e.g. `subtractDays(today,
 * RECENT_WINDOW_DAYS - 1)` for "the last 30 days including today" -- with the same Date-free
 * calendar arithmetic `splitSearchRange` uses internally, rather than reaching for `new Date()`
 * themselves.
 */
export function subtractDays(day: string, n: number): string {
  let cur = day;
  for (let i = 0; i < n; i += 1) cur = previousDay(cur);
  return cur;
}

export interface SearchRange {
  /** Newest first, one entry per calendar day within the last `RECENT_WINDOW_DAYS` days of
   *  `today` (inclusive of `today` and of the boundary day itself) -- fetch these via GSI1
   *  (`queryDay`), never the archive. */
  recentDays: string[];
  /** Newest first, one entry per calendar day within `[from, to]` that is older than the
   *  recent window -- fetch these from the NDJSON archive, never GSI1. */
  archiveDays: string[];
}

/**
 * Splits the inclusive day range `[from, to]` into the days GSI1 can answer cheaply (the most
 * recent `RECENT_WINDOW_DAYS` days of `today`) and the days that require the NDJSON archive
 * instead.
 *
 * Pure: no network, no `Date.now()`, no argless `new Date()` -- `today` names "now" as an
 * explicit argument, exactly like `ArticleCard`'s `now` prop or `computeScore`'s `now`
 * parameter, and the range is walked one calendar day at a time via plain Y/M/D arithmetic
 * (`previousDay`), never through the `Date` class at all. The recent/archive boundary itself is
 * a plain STRING comparison (`cur >= cutoff`) against a cutoff computed once up front, not a
 * numeric days-elapsed calculation off two parsed dates -- fixed-width, zero-padded `YYYY-MM-DD`
 * strings sort lexicographically in exactly calendar order, so comparing them as strings is
 * both sufficient and the thing Task 7 was pinned on doing instead of recomputing through `Date`.
 *
 * `from > to` (a caller error, or a `to` earlier than this app's own inception) returns two
 * empty arrays rather than throwing: there is no day in an empty range, which is a fact about
 * the input, not a failure to compute one.
 *
 * Task 8 fix round 2: this function is meant to be called only once a caller already knows the
 * archive portion is within bounds (`!exceedsArchiveBoundForRange(from, to, today)`), or with a
 * `from` deliberately substituted for a safe one (the search page uses `cutoff`, never the raw
 * `since`, once a range is refused) -- never with a raw, unvalidated `from` straight from a
 * request. `MAX_ENUMERATION_DAYS` below is what happens if that discipline is ever violated: a
 * defensive invariant, not the mechanism that decides whether a range is too long. That decision
 * belongs to `exceedsArchiveBoundForRange`, which answers it in O(1) *before* any day gets walked
 * -- see its own doc comment for why checking `archiveDays.length` after this function had
 * already built it was the wrong order.
 */
export function splitSearchRange(from: string, to: string, today: string): SearchRange {
  const recentDays: string[] = [];
  const archiveDays: string[] = [];
  if (from > to) return { recentDays, archiveDays };

  const cutoff = subtractDays(today, RECENT_WINDOW_DAYS - 1);

  let cur = to;
  let steps = 0;
  for (;;) {
    if (cur >= cutoff) recentDays.push(cur);
    else archiveDays.push(cur);
    if (cur === from) break;
    steps += 1;
    if (steps > MAX_ENUMERATION_DAYS) {
      throw new Error(
        `splitSearchRange: range from ${from} to ${to} exceeds ${MAX_ENUMERATION_DAYS} days -- refusing to keep walking`,
      );
    }
    cur = previousDay(cur);
  }

  return { recentDays, archiveDays };
}

/**
 * Days elapsed before Jan 1 of proleptic-Gregorian year `y`, counting from year 1 (day 0) -- the
 * standard closed-form leap-year day count. Used only by `dayOrdinal` below, for O(1)
 * range-length arithmetic; never for producing an actual date string (`formatDay`/`previousDay`
 * do that, and stay just as `Date`-free).
 */
function daysBeforeYear(y: number): number {
  const priorYears = y - 1;
  return 365 * priorYears + Math.floor(priorYears / 4) - Math.floor(priorYears / 100)
    + Math.floor(priorYears / 400);
}

/**
 * `day`'s ordinal position on the proleptic Gregorian calendar -- a plain integer, monotonic
 * with calendar order, that turns "how many days apart are these two dates" into one
 * subtraction instead of a day-by-day walk.
 *
 * Task 8 fix round 2: this is what lets `archiveDayCount`/`exceedsArchiveBoundForRange` decide a
 * range is too long to search *before* walking it. Only a handful of month-table lookups
 * (bounded by 12, never by how far `y` is from today), so computing it costs the same whether
 * `day` is next week or the year 0000 -- unlike `previousDay`, which is exactly the day-by-day
 * cost this function exists to avoid paying up front. Never used to produce a date string back,
 * only to compare distances.
 */
function dayOrdinal(day: string): number {
  const { y, m, d } = parseDay(day);
  let ordinal = daysBeforeYear(y) + d;
  for (let month = 1; month < m; month += 1) ordinal += daysInMonth(y, month);
  return ordinal;
}

/**
 * How many days in the inclusive range `[from, to]` fall in the archive (older than the last
 * `RECENT_WINDOW_DAYS` days of `today`) -- computed via `dayOrdinal` in O(1), without walking a
 * single day.
 *
 * Task 8 fix round 2: before this existed, the only way to know whether a range's archive
 * portion was too large was to ask `splitSearchRange` to build it, one day at a time -- so a
 * range spanning centuries paid hundreds of thousands of `previousDay` calls just to *learn* it
 * should be refused, and hit `splitSearchRange`'s own defensive enumeration cap before the
 * refusal path ever got a chance to run (a plain `?since=0000-01-01` threw an unhandled error
 * instead of rendering the same refusal message a merely-too-long range already got). This
 * function is the caller's way to ask the question cheaply, first, and only call
 * `splitSearchRange` at all once the answer is known to be safe.
 *
 * `from > to` returns `0`, matching `splitSearchRange`'s own "empty range" convention.
 */
export function archiveDayCount(from: string, to: string, today: string): number {
  if (from > to) return 0;
  const cutoff = subtractDays(today, RECENT_WINDOW_DAYS - 1);
  const archiveEnd = Math.min(dayOrdinal(to), dayOrdinal(cutoff) - 1);
  const start = dayOrdinal(from);
  return archiveEnd >= start ? archiveEnd - start + 1 : 0;
}

/**
 * True when the archive portion of `[from, to]` is larger than one search should fetch (Spec §8:
 * `MAX_ARCHIVE_SEARCH_DAYS`) -- via `archiveDayCount`, so the caller (the search page) can decide
 * to refuse *before* ever calling `splitSearchRange` with an unbounded `from`. Task 8 fix round
 * 2: this replaces the previous `exceedsArchiveBound(archiveDays: string[])`, which could only
 * answer this question *after* `splitSearchRange` had already paid for the walk that produced
 * `archiveDays` -- the wrong order for a `from` that is calendar-valid but absurdly distant
 * (`isValidDay` correctly does not reject `"0000-01-01"`; it is a real date, just an extreme
 * one). The caller must refuse the whole archive branch on `true` -- ask the reader to narrow
 * the range -- rather than fetch the first `MAX_ARCHIVE_SEARCH_DAYS` of a would-be `archiveDays`
 * and quietly drop the rest.
 */
export function exceedsArchiveBoundForRange(from: string, to: string, today: string): boolean {
  return archiveDayCount(from, to, today) > MAX_ARCHIVE_SEARCH_DAYS;
}
