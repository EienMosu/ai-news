import "server-only";

import { GetCommand } from "@aws-sdk/lib-dynamodb";
import type { Section } from "../../types/article.js";
import { docClient } from "../store/client.js";
import { articleKey, DAY_META_PK, LAST_RUN_PK, LAST_RUN_SK } from "../store/keys.js";
import type { DayMeta, LastRun } from "../store/meta.js";
import { getLatestCompleteDay, listDays, queryDay } from "../store/query.js";
import { bySection, toArticleDetail, toFeedArticle, type ArticleDetail, type FeedArticle } from "./shape.js";

const DAY_STATUSES = ["complete", "partial"] as const;
const LAST_RUN_STATUSES = ["ok", "skipped", "failed"] as const;

/** `null` for anything that is not a member of `values` -- the same discipline `shape.ts` uses
 *  for `FeedArticle`'s narrow-union fields, applied here to the two remaining DynamoDB
 *  boundaries this file reads without going through `toFeedArticle`/`toArticleDetail`: an
 *  unrecognised value surfaces as an absence rather than flowing a bad write straight into a
 *  union-typed field via an unchecked cast. */
function memberOrNull<T extends string>(values: readonly T[], v: unknown): T | null {
  return typeof v === "string" && (values as readonly string[]).includes(v) ? (v as T) : null;
}

const asNumberOrNull = (v: unknown): number | null => (typeof v === "number" ? v : null);

/**
 * A day's worth of feed articles plus the metadata the UI needs to say what it is looking at.
 *
 * `llmRankedInDay` and `truncatedInDay` are day totals across BOTH verticals, not counts of
 * `articles` -- the model's ranking cap and corroboration pass run once per day, not once per
 * section, so there is no per-section equivalent to report. The "InDay" suffix is deliberate:
 * a plain `llmRanked` sitting beside a section-filtered `articles` array would read, at the
 * call site, as if it described that array -- the same hazard Spec §7 calls out for the
 * sibling `articleCount` field ("a header reading '23 stories' ... must be computed from the
 * filtered list, not read from the meta item"). A header built on this value must say
 * "40 ranked across both sections today", never "40 of this section's articles were ranked".
 */
export interface FeedResult {
  articles: FeedArticle[];
  day: string | null;
  status: "complete" | "partial" | null;
  llmRankedInDay: number | null;
  truncatedInDay: number | null;
}

/** A fresh object every call -- never a shared module-level singleton, which a consumer's
 *  in-place mutation of `articles` (`.sort()`, `.push()`) could corrupt for every later request
 *  handled by the same Node process. */
function emptyFeedResult(): FeedResult {
  return { articles: [], day: null, status: null, llmRankedInDay: null, truncatedInDay: null };
}

/**
 * `TABLE_NAME` is read here, at call time, never at module load: Next's build step and this
 * file's own tests both import the module without the variable set, and a module-level read
 * would capture `undefined` permanently. A missing variable throws a message naming it --
 * cheaper to diagnose than the SDK's own "table not found" once a client actually calls out.
 * Called before `docClient()` in every exported function below, so a misconfiguration is
 * reported before anything is constructed, not after.
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
  const table = requireTableName();
  const client = docClient();
  const day = await getLatestCompleteDay(client, table);
  if (day === null) return emptyFeedResult();

  const items = await queryDay(client, table, day.day);
  return {
    articles: bySection(items.map(toFeedArticle), section),
    day: day.day,
    status: day.status,
    llmRankedInDay: day.llmRanked,
    truncatedInDay: day.truncated,
  };
}

/**
 * The home feed's day list, newest first: one entry per day `listDays(count)` names, each
 * carrying that day's `section`-filtered articles alongside the day totals `listDays` already
 * returned -- Task 7 Step 2. Exactly `count` days are asked for (`listDays(client, table,
 * count)`, never a fixed 30) and every day's `queryDay` is issued **concurrently**
 * (`Promise.all`), not one after another: sequential reads would make the home page as slow as
 * the sum of every day's round trip, and concurrency is the actual requirement, not an
 * optimisation on top of it.
 *
 * Deliberately reuses each day's own `DayMeta` (`status`, `llmRanked`, `truncated`) already
 * returned by the single `listDays` call rather than calling `getDay` per day, which would
 * issue a redundant `GetCommand` against `META#DAY` for a record already in hand -- the day
 * list and the day's articles are two different query shapes on purpose (one `Query` on
 * `META#DAY`'s partition, then N `Query`s on `feed-by-day`), never N pairs of both.
 *
 * `Promise.all` also keeps the array in `days`' own newest-first order regardless of which
 * day's `queryDay` happens to resolve first -- the array passed to `.map` fixes the order of
 * the returned promises, and `Promise.all` preserves that positional order in its result no
 * matter the completion order underneath.
 *
 * Returns `FeedResult[]` (not a new interface) so each entry can be handed straight to
 * `FeedView` -- the same per-day rendering `getFeed`'s single day already uses, now called once
 * per array element instead of once for the page.
 */
export async function getRecentDays(section: Section, count: number): Promise<FeedResult[]> {
  const table = requireTableName();
  const client = docClient();
  const days = await listDays(client, table, count);

  return await Promise.all(days.map(async (day): Promise<FeedResult> => {
    const items = await queryDay(client, table, day.day);
    return {
      articles: bySection(items.map(toFeedArticle), section),
      day: day.day,
      status: day.status,
      llmRankedInDay: day.llmRanked,
      truncatedInDay: day.truncated,
    };
  }));
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
 *
 * The two reads run concurrently via `Promise.allSettled`, not `Promise.all`: to the reader, a
 * transient failure on the small `META#DAY` read and the record simply not existing yet are the
 * same event, and both must degrade to `status: null` rather than the first discarding articles
 * that already came back fine. A failure on `queryDay` itself is not degraded the same way --
 * there is nothing to show without it -- and propagates.
 *
 * `status` is narrowed through `memberOrNull` rather than trusted via an unchecked cast: an
 * unrecognised value comes back `null`, same as an absent record, instead of flowing a bad
 * write straight into a union-typed field.
 */
export async function getDay(date: string): Promise<FeedResult> {
  const table = requireTableName();
  const client = docClient();

  const [itemsResult, metaResult] = await Promise.allSettled([
    queryDay(client, table, date),
    client.send(new GetCommand({ TableName: table, Key: { pk: DAY_META_PK, sk: date } })),
  ]);

  if (itemsResult.status === "rejected") throw itemsResult.reason;
  const metaItem = metaResult.status === "fulfilled" ? metaResult.value.Item : undefined;

  return {
    articles: itemsResult.value.map(toFeedArticle),
    day: date,
    status: memberOrNull(DAY_STATUSES, metaItem?.status),
    llmRankedInDay: asNumberOrNull(metaItem?.llmRanked),
    truncatedInDay: asNumberOrNull(metaItem?.truncated),
  };
}

/**
 * One article by `urlHash`, read from the base table -- a `GetItem` on `ART#<urlHash>` / `A`,
 * never the `feed-by-day` index. Mapped through `toArticleDetail`, not `toFeedArticle`: the
 * GSI's `INCLUDE` projection is exactly `FeedArticle`'s 18 fields (`points` among them), so
 * mapping the base item through `toFeedArticle` here would throw away the two fields that are
 * the entire reason to read the base table instead of the index -- `ingestDay` (how the story
 * page locates its own day partition, the only way to look up cluster siblings at all) and
 * `publishedAtSource` (how it can say a date was guessed rather than reported). The remaining
 * non-projected attributes (`hashVersion`, `gsi1pk`, `gsi1sk`, `v`) are internal plumbing the
 * UI never needs and stay out of `ArticleDetail`.
 *
 * A missing item returns `null`. `urlHash` can arrive from a stale link or a bad guess and
 * that is not exceptional -- the caller (a page component) decides whether that is a 404.
 */
export async function getArticle(urlHash: string): Promise<ArticleDetail | null> {
  const table = requireTableName();
  const client = docClient();
  const out = await client.send(new GetCommand({ TableName: table, Key: articleKey(urlHash) }));
  return out.Item ? toArticleDetail(out.Item) : null;
}

/**
 * The archive calendar: up to `limit` days, newest first. A thin wrapper over `listDays` -- no
 * new query shape, per Step 2 -- but `listDays` issues a single un-paged `QueryCommand` on the
 * premise that its `Limit` is a hard, small cap (Spec §4 sizes the calendar at 60 days); `limit`
 * here is a caller-supplied number with no such bound, and Spec §8 forbids unhandled pagination.
 * Clamped to 60 so a caller asking for more cannot silently get back a partial page instead of
 * the wider archive it thinks it received.
 */
export async function getArchive(limit: number): Promise<DayMeta[]> {
  const table = requireTableName();
  return await listDays(docClient(), table, Math.min(limit, 60));
}

/**
 * `META#lastRun` as the health surface reads it. Differs from `LastRun` in exactly two ways,
 * both about what a reader can trust: `llmStatus` may be `null` when the stored value is not
 * a recognised member, and the four fields §8's header iterates always arrive renderable.
 * The scalars stay as `capture.ts` writes them -- it is the only writer and always populates
 * them, so widening those would push null-handling onto every component for a case that
 * cannot occur.
 */
export interface RunStatus {
  startedAt: string;
  durationMs: number;
  perSourceCounts: Record<string, number>;
  filtered: Record<string, number>;
  quarantined: Record<string, number>;
  llmStatus: LastRun["llmStatus"] | null;
  itemsWritten: number;
  itemsFailed: number;
  errors: { source: string; message: string }[];
}

/** A per-source counter map, keeping only the entries that are actually numbers. §8's header
 *  iterates these; a non-object or a string count would throw inside the component rather
 *  than in this file, where the boundary actually is. */
function countRecord(v: unknown): Record<string, number> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return {};
  const out: Record<string, number> = {};
  for (const [k, n] of Object.entries(v)) if (Number.isFinite(n)) out[k] = n as number;
  return out;
}

/** §8's `errors[]`, keeping only entries carrying both strings the header renders. */
function errorList(v: unknown): { source: string; message: string }[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((e) =>
    typeof e === "object" && e !== null
      && typeof (e as { source?: unknown }).source === "string"
      && typeof (e as { message?: unknown }).message === "string"
      ? [{ source: (e as { source: string }).source, message: (e as { message: string }).message }]
      : []);
}

/**
 * The header's run-status line (Spec §7/§8) -- the last capture-or-rank run's outcome, read
 * from the single `META#lastRun` item. `null` means exactly one thing -- the pipeline has
 * never run, e.g. right after a fresh deploy. Every other malformed-write case degrades a
 * field rather than the record, because §8's whole point is that a single null must not
 * conflate states an operator needs to tell apart. The four fields the header iterates
 * (`perSourceCounts`, `filtered`, `quarantined`, `errors`) are coerced to renderable shapes
 * here, at the boundary, rather than throwing inside the component.
 */
export async function getRunStatus(): Promise<RunStatus | null> {
  const table = requireTableName();
  const client = docClient();
  const out = await client.send(
    new GetCommand({ TableName: table, Key: { pk: LAST_RUN_PK, sk: LAST_RUN_SK } }),
  );
  if (!out.Item) return null;
  const item = out.Item as LastRun;
  return {
    startedAt: item.startedAt,
    durationMs: item.durationMs,
    perSourceCounts: countRecord(item.perSourceCounts),
    filtered: countRecord(item.filtered),
    quarantined: countRecord(item.quarantined),
    llmStatus: memberOrNull(LAST_RUN_STATUSES, item.llmStatus),
    itemsWritten: item.itemsWritten,
    itemsFailed: item.itemsFailed,
    errors: errorList(item.errors),
  };
}
