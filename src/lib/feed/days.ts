/**
 * The home feed's `?days=<n>` search param -- Task 7 Step 2's "older days on demand". The
 * initial render always asks for `DEFAULT_ARCHIVE_DAYS`; a plain link raises the number rather
 * than mounting a client-side "load more" component (everything in this app is server-rendered,
 * and a client boundary here would pull the whole card tree across it).
 *
 * `MAX_ARCHIVE_DAYS` matches `getArchive`'s own 60-day calendar bound in src/lib/feed/read.ts --
 * chosen at half of it, not the same number, because the archive calendar and the home feed's
 * inline day list solve different problems: the calendar is a lightweight `META#DAY` list with
 * no article Queries behind it, while `days` here is one `queryDay` per day, issued
 * concurrently. Capping this one lower keeps a maliciously large `?days=` value from fanning out
 * into dozens of concurrent day-partition reads on every request.
 */
export const MIN_ARCHIVE_DAYS = 7;
export const MAX_ARCHIVE_DAYS = 30;
export const DEFAULT_ARCHIVE_DAYS = MIN_ARCHIVE_DAYS;

/**
 * Parses a `searchParams.days` value into a safe day count. A URL is user input, never trusted
 * as-is:
 *
 * - Missing, an array (a repeated `?days=` param), or anything that is not a bare non-negative
 *   integer string is "unparseable" and falls back to `DEFAULT_ARCHIVE_DAYS` -- never `NaN`,
 *   never `0`.
 * - A parsed value is clamped to `[MIN_ARCHIVE_DAYS, MAX_ARCHIVE_DAYS]`. The clamped number is
 *   what the caller must actually use to fetch and render -- a value of `1000` becomes `30` in
 *   truth, not a page that claims to show 1000 days while quietly rendering 30.
 */
export function parseDaysParam(raw: string | string[] | undefined): number {
  if (typeof raw !== "string" || !/^\d+$/.test(raw)) return DEFAULT_ARCHIVE_DAYS;
  const n = Number(raw);
  return Math.min(MAX_ARCHIVE_DAYS, Math.max(MIN_ARCHIVE_DAYS, n));
}
