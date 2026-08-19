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
 */
export async function searchRecentDays(
  days: string[], scope: SearchScope, query: string,
): Promise<DayMatches[]> {
  const table = requireTableName();
  const client = docClient();
  const results = await Promise.all(days.map(async (day): Promise<DayMatches> => {
    const items = await queryDay(client, table, day);
    return { day, articles: filterMatches(items, scope, query) };
  }));
  return results.filter((r) => r.articles.length > 0);
}

/**
 * The archive half of a search: one `fetchArchiveDay` GET per day in `days`, run concurrently,
 * filtered the same way `searchRecentDays` filters GSI1 results. Zero DynamoDB reads --
 * `fetchArchiveDay` talks to `raw.githubusercontent.com` only.
 */
export async function searchArchiveDays(
  days: string[], scope: SearchScope, query: string,
): Promise<DayMatches[]> {
  const results = await Promise.all(days.map(async (day): Promise<DayMatches> => {
    const items = await fetchArchiveDay(day);
    return { day, articles: filterMatches(items, scope, query) };
  }));
  return results.filter((r) => r.articles.length > 0);
}
