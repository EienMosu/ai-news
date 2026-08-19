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
 * `exceedsArchiveBound`), never silently served its first `MAX_ARCHIVE_SEARCH_DAYS` days --
 * "a search that quietly returns part of the archive is worse than one that says it will not
 * run."
 */
export const MAX_ARCHIVE_SEARCH_DAYS = 31;

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
 */
export function splitSearchRange(from: string, to: string, today: string): SearchRange {
  const recentDays: string[] = [];
  const archiveDays: string[] = [];
  if (from > to) return { recentDays, archiveDays };

  const cutoff = subtractDays(today, RECENT_WINDOW_DAYS - 1);

  let cur = to;
  for (;;) {
    if (cur >= cutoff) recentDays.push(cur);
    else archiveDays.push(cur);
    if (cur === from) break;
    cur = previousDay(cur);
  }

  return { recentDays, archiveDays };
}

/**
 * True when a split range's archive portion is larger than one search should fetch (Spec §8:
 * `MAX_ARCHIVE_SEARCH_DAYS`). The caller (the search page) must refuse the whole archive branch
 * on `true` -- ask the reader to narrow the range -- rather than fetch the first
 * `MAX_ARCHIVE_SEARCH_DAYS` of `archiveDays` and quietly drop the rest.
 */
export function exceedsArchiveBound(archiveDays: string[]): boolean {
  return archiveDays.length > MAX_ARCHIVE_SEARCH_DAYS;
}
