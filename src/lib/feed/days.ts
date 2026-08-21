/**
 * The home feed's `?days=<n>` search param -- Task 7 Step 2's "older days on demand". The
 * initial render always asks for `DEFAULT_ARCHIVE_DAYS`; a plain link raises the number rather
 * than mounting a client-side "load more" component (everything in this app is server-rendered,
 * and a client boundary here would pull the whole card tree across it).
 *
 * `MAX_ARCHIVE_DAYS` is deliberately HALF of `getArchive`'s own 60-day calendar bound in
 * src/lib/feed/read.ts, not the same number: the archive calendar is a single lightweight
 * `META#DAY` list with no article Queries behind it, while `days` here is one full-partition
 * `queryDay` per day, issued concurrently. Capping this one lower keeps a maliciously large
 * `?days=` value from fanning out into dozens of concurrent day-partition reads on every
 * request -- see `getRecentDays` in read.ts, which clamps to this same constant for exactly
 * that reason (fix round 1, Q2/Q5).
 *
 * `MIN_ARCHIVE_DAYS` is `1`, not `DEFAULT_ARCHIVE_DAYS` -- Spec §7's "seven" describes the
 * *initial* load, not a floor on what a reader may deliberately request. A reader asking for
 * `?days=1` gets exactly one day and one concurrent Query, not seven silently substituted for
 * one (fix round 1, F7).
 *
 * `DEFAULT_ARCHIVE_DAYS` (the initial count) and `ARCHIVE_STEP_DAYS` (how far "Load older days"
 * advances) are separate constants, even though both happen to be `5` today (owner request, 2026-08-21: lighter first paint, load five more per step), because they answer
 * different questions -- changing the initial page size should not silently also change the
 * load-more increment (fix round 1, F8).
 */
export const MIN_ARCHIVE_DAYS = 1;
export const MAX_ARCHIVE_DAYS = 30;
export const DEFAULT_ARCHIVE_DAYS = 5;
export const ARCHIVE_STEP_DAYS = 5;

/**
 * Parses a `searchParams.days` value into a safe day count. A URL is user input, never trusted
 * as-is:
 *
 * - Missing, an array (a repeated `?days=` param), or anything that is not a bare non-negative
 *   integer string is "unparseable" and falls back to `DEFAULT_ARCHIVE_DAYS` -- never `NaN`,
 *   never `0`.
 * - A parsed value is clamped to `[MIN_ARCHIVE_DAYS, MAX_ARCHIVE_DAYS]`. The clamped number is
 *   what the caller must actually use to fetch and render -- a value of `1000` becomes `30` in
 *   truth, not a page that claims to show 1000 days while quietly rendering 30. `0` becomes `1`,
 *   the floor, not the unparseable-value default.
 */
export function parseDaysParam(raw: string | string[] | undefined): number {
  if (typeof raw !== "string" || !/^\d+$/.test(raw)) return DEFAULT_ARCHIVE_DAYS;
  const n = Number(raw);
  return Math.min(MAX_ARCHIVE_DAYS, Math.max(MIN_ARCHIVE_DAYS, n));
}
