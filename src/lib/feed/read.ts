import "server-only";

import { GetCommand } from "@aws-sdk/lib-dynamodb";
import type { Section } from "../../types/article.js";
import { docClient } from "../store/client.js";
import { articleKey, DAY_META_PK, LAST_RUN_PK, LAST_RUN_SK } from "../store/keys.js";
import type { DayMeta, LastRun } from "../store/meta.js";
import { getLatestCompleteDay, listDays, queryDay } from "../store/query.js";
import { bySection, toFeedArticle, type FeedArticle } from "./shape.js";

/**
 * A day's worth of feed articles plus the metadata the UI needs to say what it is looking
 * at -- whether the day completed, how many of its articles the model actually ranked, and
 * how many were cut by the input cap and never reached it.
 */
export interface FeedResult {
  articles: FeedArticle[];
  day: string | null;
  status: "complete" | "partial" | null;
  llmRanked: number | null;
  truncated: number | null;
}

const emptyFeedResult: FeedResult = {
  articles: [], day: null, status: null, llmRanked: null, truncated: null,
};

/**
 * `TABLE_NAME` is read here, at call time, never at module load: Next's build step and this
 * file's own tests both import the module without the variable set, and a module-level read
 * would capture `undefined` permanently. A missing variable throws a message naming it --
 * cheaper to diagnose than the SDK's own "table not found" once a client actually calls out.
 */
function requireTableName(): string {
  const name = process.env.TABLE_NAME;
  if (!name) throw new Error("TABLE_NAME environment variable is not set");
  return name;
}

/**
 * The feed's entry point. Follows the `META#DAY` pointer via `getLatestCompleteDay` rather
 * than computing a date -- Spec §4: "Readers never compute a date — they follow the
 * `META#DAY` pointer." `getLatestCompleteDay` already falls back to the newest day of ANY
 * status when nothing in the last 30 days is `complete`, so a `partial` day is returned to
 * the caller -- with its real status -- rather than silently swallowed.
 *
 * A fresh deploy with no ranked day yet is a state the UI renders, not an error: this
 * returns the empty `FeedResult` rather than throwing.
 */
export async function getFeed(section: Section): Promise<FeedResult> {
  const client = docClient();
  const table = requireTableName();
  const day = await getLatestCompleteDay(client, table);
  if (day === null) return emptyFeedResult;

  const items = await queryDay(client, table, day.day);
  return {
    articles: bySection(items.map(toFeedArticle), section),
    day: day.day,
    status: day.status,
    llmRanked: day.llmRanked,
    truncated: day.truncated,
  };
}

/**
 * The named day, unfiltered by section -- `/day/[date]` deep-links to a specific date and
 * shows both verticals. Unlike `getFeed`, the day is a caller-supplied fact, not something
 * this function discovers, so `day` in the result is always the input, even when nothing
 * was found for it.
 *
 * The day's `META#DAY` record is looked up directly (a `GetItem` on a known key, not a new
 * query shape) rather than reusing `listDays`, which only reaches 30 days back and would
 * silently miss an older archived day that this function must still be able to answer for.
 * If articles exist for the day but no `META#DAY` record does (get the record before rank
 * ever wrote one for it, or a lookup for a day older than the archive keeps meta for),
 * `status`, `llmRanked` and `truncated` come back `null` rather than a guess.
 */
export async function getDay(date: string): Promise<FeedResult> {
  const client = docClient();
  const table = requireTableName();

  const [items, metaOut] = await Promise.all([
    queryDay(client, table, date),
    client.send(new GetCommand({ TableName: table, Key: { pk: DAY_META_PK, sk: date } })),
  ]);
  const meta = metaOut.Item as DayMeta | undefined;

  return {
    articles: items.map(toFeedArticle),
    day: date,
    status: meta?.status ?? null,
    llmRanked: meta?.llmRanked ?? null,
    truncated: meta?.truncated ?? null,
  };
}

/**
 * One article by `urlHash`, read from the base table -- a `GetItem` on `ART#<urlHash>` / `A`,
 * never the `feed-by-day` index. The GSI's `INCLUDE` projection carries only the 18 card
 * fields; the story detail page needs `points`, `publishedAtSource` and everything else that
 * projection leaves out, which only the base-table item has.
 *
 * A missing item returns `null`. `urlHash` can arrive from a stale link or a bad guess and
 * that is not exceptional -- the caller (a page component) decides whether that is a 404.
 */
export async function getArticle(urlHash: string): Promise<FeedArticle | null> {
  const client = docClient();
  const table = requireTableName();
  const out = await client.send(new GetCommand({ TableName: table, Key: articleKey(urlHash) }));
  return out.Item ? toFeedArticle(out.Item) : null;
}

/** The archive calendar: up to `limit` days, newest first. A thin wrapper over `listDays` --
 *  no new query shape, per Step 2. */
export async function getArchive(limit: number): Promise<DayMeta[]> {
  return await listDays(docClient(), requireTableName(), limit);
}

/**
 * The header's run-status line (Spec §7/§8) -- the last capture-or-rank run's outcome, read
 * from the single `META#lastRun` item. `null` when the pipeline has never run, e.g. right
 * after a fresh deploy.
 */
export async function getRunStatus(): Promise<LastRun | null> {
  const client = docClient();
  const table = requireTableName();
  const out = await client.send(
    new GetCommand({ TableName: table, Key: { pk: LAST_RUN_PK, sk: LAST_RUN_SK } }),
  );
  return (out.Item as LastRun | undefined) ?? null;
}
