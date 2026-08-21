import "server-only";

import { GetCommand } from "@aws-sdk/lib-dynamodb";
import type { Section } from "../../types/article.js";
import { docClient } from "../store/client.js";
import { articleKey, DAY_META_PK, LAST_RUN_PK, LAST_RUN_SK } from "../store/keys.js";
import type { DayMeta, LastRun } from "../store/meta.js";
import { listDays, queryDay } from "../store/query.js";
import { MAX_ARCHIVE_DAYS } from "./days.js";
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
 * `llmRankedInDay` and `truncatedInDay` are day totals across every vertical, not counts of
 * `articles` -- the model's ranking cap and corroboration pass run once per day, not once per
 * section, so there is no per-section equivalent to report. The "InDay" suffix is deliberate:
 * a plain `llmRanked` sitting beside a section-filtered `articles` array would read, at the
 * call site, as if it described that array -- the same hazard Spec §7 calls out for the
 * sibling `articleCount` field ("a header reading '23 stories' ... must be computed from the
 * filtered list, not read from the meta item"). A header built on this value must say
 * "40 ranked across all sections today", never "40 of this section's articles were ranked".
 */
export interface FeedResult {
  articles: FeedArticle[];
  day: string | null;
  status: "complete" | "partial" | null;
  llmRankedInDay: number | null;
  truncatedInDay: number | null;
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
 * `getRecentDays`'s outcome: the days that resolved, in `listDays`' own newest-first order, plus
 * how many of the requested days could not be read at all. The same shape
 * `searchArchiveDays`/`ArchiveSearchOutcome` (src/lib/search/read.ts) already uses for the
 * identical fact on a different fan-out -- one vocabulary for "some of these parallel reads
 * failed," not a second one invented for this caller.
 */
export interface RecentDaysOutcome {
  results: FeedResult[];
  failedDays: number;
}

/**
 * The home feed's day list, newest first: one entry per day `listDays(count)` names, each
 * carrying that day's `section`-filtered articles alongside the day totals `listDays` already
 * returned -- Task 7 Step 2. `count` is clamped to `MAX_ARCHIVE_DAYS` before being handed to
 * `listDays` (fix round 1, Q2/Q5): unlike `getArchive`'s unclamped case (one Query with a large
 * `Limit`, degrading to a merely partial page), an unclamped `count` here would fan out into
 * `count` full-partition `queryDay` Queries, all fired simultaneously with no concurrency
 * limit -- a real cost and latency incident, not a wrong-but-cheap answer. `parseDaysParam`
 * remains the loud, tested boundary that shapes what a reader can request; this clamp is the
 * quiet backstop for every other caller. Every day's `queryDay` is issued **concurrently**
 * (`Promise.allSettled`), not one after another: sequential reads would make the home page as
 * slow as the sum of every day's round trip, and concurrency is the actual requirement, not an
 * optimisation on top of it.
 *
 * `Promise.allSettled`, not `Promise.all` -- final review, M2. `getDay` below already wrote this
 * rule down for its own two-read fan-out: a failed secondary read must not discard data that came
 * back fine. Before this fix, this function used `Promise.all`, so a single throttled day's
 * `queryDay` (one Query out of up to `MAX_ARCHIVE_DAYS`) rejected the whole call and blanked the
 * entire home feed -- discarding every other day's data that had already come back, with no
 * `error.tsx` anywhere under `app/` to catch it, so the reader saw Next's default 500 page. A
 * failed day is now dropped and counted in `failedDays`, exactly the way `searchArchiveDays`
 * already drops and counts a failed archive day -- see that function's own doc comment for the
 * fuller reasoning, which applies here unchanged.
 *
 * Deliberately reuses each day's own `DayMeta` (`status`, `llmRanked`, `truncated`) already
 * returned by the single `listDays` call rather than calling `getDay` per day, which would
 * issue a redundant `GetCommand` against `META#DAY` for a record already in hand -- the day
 * list and the day's articles are two different query shapes on purpose (one `Query` on
 * `META#DAY`'s partition, then N `Query`s on `feed-by-day`), never N pairs of both.
 *
 * Those three `DayMeta` fields are run through the same two coercers (`memberOrNull`,
 * `asNumberOrNull`) `getDay` already applies to `META#DAY`, not trusted via `listDays`' own
 * unchecked `as DayMeta[]` cast (src/lib/store/query.ts) -- final review, M4. `listDays` is
 * reused by three callers (`getRecentDays`, `getArchive`, `src/lambda/rank.ts`'s own internal
 * bookkeeping) precisely because it is one query shape, so the cast itself is not this
 * function's to fix; but this was the one caller that piped an uncoerced field straight into a
 * union-typed `FeedResult` a component renders. A record missing `llmRanked` used to reach
 * `FeedView` as `undefined`, which is not `null`, so `FeedView`'s `llmRankedInDay !== null` guard
 * let it through and rendered the literal string "undefined stories ranked across all sections"
 * -- the exact bug class Task 9 fix round 1 closed for `truncated` on the `getDay` path, still
 * live here until now.
 *
 * `Promise.allSettled` still keeps the array in `days`' own newest-first order regardless of
 * which day's `queryDay` happens to resolve first, and regardless of which one rejects -- the
 * array passed to `.map` fixes the order of the returned promises, and `allSettled` preserves
 * that positional order in its result no matter the completion order underneath; a rejection
 * removes an entry from the middle without reordering the rest.
 */
export async function getRecentDays(section: Section, count: number): Promise<RecentDaysOutcome> {
  const table = requireTableName();
  const client = docClient();
  const days = await listDays(client, table, Math.min(count, MAX_ARCHIVE_DAYS));

  const settled = await Promise.allSettled(days.map(async (day): Promise<FeedResult> => {
    const items = await queryDay(client, table, day.day);
    return {
      articles: bySection(items.map(toFeedArticle), section),
      day: day.day,
      status: memberOrNull(DAY_STATUSES, day.status),
      llmRankedInDay: asNumberOrNull(day.llmRanked),
      truncatedInDay: asNumberOrNull(day.truncated),
    };
  }));

  const results: FeedResult[] = [];
  let failedDays = 0;
  for (const outcome of settled) {
    if (outcome.status === "fulfilled") results.push(outcome.value);
    else failedDays += 1;
  }

  return { results, failedDays };
}

/**
 * The named day, unfiltered by section -- `/day/[date]` deep-links to a specific date and
 * shows every vertical. Unlike `getRecentDays`, the day is a caller-supplied fact, not something
 * this function discovers itself from `listDays`, so `day` in the result is always the input,
 * even when nothing was found for it.
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
