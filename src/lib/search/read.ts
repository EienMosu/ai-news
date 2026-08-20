import "server-only";

import { bySection, toFeedArticle, type FeedArticle } from "../feed/shape.js";
import { docClient } from "../store/client.js";
import { queryDay } from "../store/query.js";
import { fetchArchiveDay } from "./archive.js";
import { matchesQuery } from "./match.js";
import type { SearchScope } from "./params.js";

/** One day's matching articles, already in the day query's own score order -- decision 6:
 *  matching only decides membership, never reorders anything. */
export interface DayMatches {
  day: string;
  articles: FeedArticle[];
}

/** Shared outcome shape for a fan-out over several days: the ones that resolved, plus how many
 *  did not. Originally introduced for the archive half only (`ArchiveSearchOutcome`, Task 8 fix
 *  round 1, F5); final review, M2 gives `searchRecentDays` the identical shape for the identical
 *  fact, rather than one vocabulary for "some days failed" on the archive half and silence (a
 *  wholesale rejection) on the recent half. */
export interface DayMatchesOutcome {
  days: DayMatches[];
  failedDays: number;
}

/**
 * `TABLE_NAME` read at call time, never at module load -- the same discipline
 * `src/lib/feed/read.ts`'s own `requireTableName` applies, duplicated here (rather than
 * imported from there) so this module has no dependency on `feed/read.ts` at all: the two read
 * different backends for the same logical thing (a day's articles) and importing across them
 * would couple search's DynamoDB path to the feed module's own exports for no reason beyond
 * saving four lines.
 */
function requireTableName(): string {
  const name = process.env.TABLE_NAME;
  if (!name) throw new Error("TABLE_NAME environment variable is not set");
  return name;
}

/** Maps raw items through `toFeedArticle`, narrows to `scope` (or not, for `"both"`), then
 *  keeps only the ones `matchesQuery` accepts -- one shared filter so `searchRecentDays` and
 *  `searchArchiveDays` cannot drift into two different notions of "matches". */
function filterMatches(
  rawItems: Record<string, unknown>[], scope: SearchScope, query: string,
): FeedArticle[] {
  const articles = rawItems.map(toFeedArticle);
  const scoped = scope === "both" ? articles : bySection(articles, scope);
  return scoped.filter((a) => matchesQuery(a, query));
}

/**
 * The recent-window half of a search: one `queryDay` (GSI1) per day in `days`, run
 * concurrently -- the same fan-out shape as `getRecentDays` (src/lib/feed/read.ts), but
 * filtered down to matches instead of returned whole. A day with zero matches is dropped
 * entirely rather than kept as an empty entry: `FeedArchive`'s per-day "No AI stories for
 * <day>" message earns its place because every requested day is meaningful there (Task 7 Step
 * 2's initial seven-day view); a search result list has no such promise about which specific
 * days it will cover, so an empty day here is noise, not information.
 *
 * `Promise.allSettled`, not `Promise.all` -- final review, M2. This function used to reject the
 * whole call when a single day's `queryDay` rejected, which had two compounding effects: it
 * discarded every OTHER recent day's matches that had already come back fine (the exact rule
 * `getDay`, src/lib/feed/read.ts, wrote down and this file's own `searchArchiveDays` below
 * already follows), and -- one level up -- it made the search page's
 * `Promise.all([searchRecentDays(...), searchArchiveDays(...)])` reject too, discarding up to
 * `MAX_ARCHIVE_SEARCH_DAYS` archive HTTP GETs that had already been paid for and had already
 * resolved. A failed day is now dropped and counted in `failedDays`, mirroring
 * `searchArchiveDays` exactly -- see that function's own doc comment for the fuller reasoning.
 */
export async function searchRecentDays(
  days: string[], scope: SearchScope, query: string,
): Promise<DayMatchesOutcome> {
  const table = requireTableName();
  const client = docClient();
  const settled = await Promise.allSettled(days.map(async (day): Promise<DayMatches> => {
    const items = await queryDay(client, table, day);
    return { day, articles: filterMatches(items, scope, query) };
  }));

  const resolved: DayMatches[] = [];
  let failedDays = 0;
  for (const outcome of settled) {
    if (outcome.status === "fulfilled") resolved.push(outcome.value);
    else failedDays += 1;
  }

  return { days: resolved.filter((r) => r.articles.length > 0), failedDays };
}

/** `searchArchiveDays`' result: the days that resolved, plus how many did not. Task 8 fix round
 *  1, finding F5 -- distinct from a bare `DayMatches[]` so a caller can tell "the archive had
 *  nothing" (`days: [], failedDays: 0`) apart from "some of the archive could not be read"
 *  (`failedDays > 0`), which the page surfaces as its own notice rather than silently rendering
 *  the same as a clean zero. Kept as its own named export (rather than inlining
 *  `DayMatchesOutcome` at every call site) so existing imports of this name are undisturbed;
 *  `searchRecentDays` above now returns the identical shape under `DayMatchesOutcome`'s own name
 *  -- final review, M2 -- rather than a third, differently-named copy of the same two fields. */
export type ArchiveSearchOutcome = DayMatchesOutcome;

/**
 * The archive half of a search: one `fetchArchiveDay` GET per day in `days`, run concurrently,
 * filtered the same way `searchRecentDays` filters GSI1 results. Zero DynamoDB reads --
 * `fetchArchiveDay` talks to `raw.githubusercontent.com` only.
 *
 * `Promise.allSettled`, not `Promise.all` -- Task 8 fix round 1, finding F5. A single archive
 * day's `fetchArchiveDay` throwing (a transient GitHub 5xx, not the 404-is-absence case
 * `fetchArchiveDay` already degrades on its own) used to reject the whole call, which the page
 * then let propagate into an unhandled 500 that discarded the recent-window results it had
 * already paid for and received. That inverted a rule this codebase already wrote down:
 * `getDay` (src/lib/feed/read.ts) uses `Promise.allSettled` specifically so a transient failure
 * on a secondary read degrades rather than discards data that came back fine, and propagates
 * only when there is nothing to show without it. Here there is something to show without the
 * archive -- the recent half -- so a failed archive day is dropped and counted, not allowed to
 * blank the page. Order among the *fulfilled* days is preserved (`settled[i]` still corresponds
 * to `days[i]`), so newest-first ordering survives a failure anywhere in the middle of the list.
 */
export async function searchArchiveDays(
  days: string[], scope: SearchScope, query: string,
): Promise<ArchiveSearchOutcome> {
  const settled = await Promise.allSettled(days.map(async (day): Promise<DayMatches> => {
    const items = await fetchArchiveDay(day);
    return { day, articles: filterMatches(items, scope, query) };
  }));

  const resolved: DayMatches[] = [];
  let failedDays = 0;
  for (const outcome of settled) {
    if (outcome.status === "fulfilled") resolved.push(outcome.value);
    else failedDays += 1;
  }

  return { days: resolved.filter((r) => r.articles.length > 0), failedDays };
}
