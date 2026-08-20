import { relativeTime } from "./format.js";
import type { RunStatus } from "./read.js";
import type { DayMeta } from "../store/meta.js";

/**
 * Spec §8's five states. `perSourceCounts`, `filtered`, `quarantined` and `errors` on
 * `RunStatus` are all keyed by source id -- there is no such thing as a single "produced"
 * count for a whole run, so the table is evaluated once per source, not once per run.
 */
export type SourceState = "healthy" | "quiet" | "drift" | "fetchFailed" | "dead";

export interface SourceCounts {
  produced: number;
  filtered: number;
  quarantined: number;
  hasError: boolean;
}

/**
 * Spec §8's table, reproduced as code:
 *
 * | produced | filtered | quarantined | error | state |
 * |---|---|---|---|---|
 * | >0  | any | 0  | no  | healthy |
 * | 0   | >0  | 0  | no  | quiet |
 * | any | any | >0 | no  | drift |
 * | 0   | 0   | 0  | yes | fetchFailed |
 * | 0   | 0   | 0  | no  | dead |
 *
 * `quarantined > 0` is checked first because it is the one column the table marks "any" on
 * both sides of: a source that quarantines everything it fetched (produced 0) is still drift,
 * never dead, and a source that quarantines one degenerate title while producing forty good
 * articles (the `anthropic` case spec §8 names) is still drift, never plain "healthy" --
 * quarantined>0 must never be silent. `src/lib/ingest/capture.ts`'s rejection branch (a fetch
 * error zeroes `produced`/`filtered`/`quarantined` for that source and returns before touching
 * `quarantined`) means `quarantined > 0` and `hasError` can never both be true in the data this
 * pipeline actually writes today, but this function does not depend on that invariant holding --
 * the check order is correct even if a future capture change breaks it.
 */
export function classifySourceState(counts: SourceCounts): SourceState {
  if (counts.quarantined > 0) return "drift";
  if (counts.produced > 0) return "healthy";
  if (counts.filtered > 0) return "quiet";
  return counts.hasError ? "fetchFailed" : "dead";
}

/** Display text for a non-healthy source -- named so the reader knows which feed and why. */
export const SOURCE_STATE_LABEL: Record<Exclude<SourceState, "healthy">, string> = {
  quiet: "quiet",
  drift: "parser or schema drift",
  fetchFailed: "fetch failed",
  dead: "no items",
};

/**
 * Tailwind color class per non-healthy state. `fetchFailed` and `dead` are spec §8's two rows
 * that "turn red on two consecutive runs" -- but `getRunStatus` (src/lib/feed/read.ts) reads a
 * single `META#lastRun` item, with no record of the run before it. There is no second data point
 * here to check "two consecutive" against, so both render amber, the same as `drift`, rather
 * than inventing a red state this layer cannot actually verify -- see components/RunStatusLine.tsx
 * and the Task 9 report for the fuller reasoning. `quiet` is grey, never amber: spec §8 is
 * explicit that a reliably-quiet source (`alistapart`) is not a fault.
 */
export const SOURCE_STATE_CLASS: Record<Exclude<SourceState, "healthy">, string> = {
  quiet: "text-neutral-400",
  drift: "text-amber-600",
  fetchFailed: "text-amber-600",
  dead: "text-amber-600",
};

/**
 * Fix round 1, F2: the header's "LLM ..." segment is sourced from the latest `META#DAY` record
 * (a second, concurrent read -- `getArchive(1)` in `components/RunStatusLine.tsx`), never from
 * `META#lastRun.llmStatus` on `RunStatus`. That field is not usable for this: `capture.ts`
 * hardcodes it to `"skipped"` on every hourly write (capture never calls the model) and
 * `rank.ts` never writes `META#lastRun` at all, so it is permanently `"skipped"` on the live
 * data regardless of how ranking actually went -- a segment that renders the same word forever
 * is worse than no segment, because it reads as a live signal while certifying nothing.
 *
 * `META#DAY` is the correct source because it is the ONLY thing that can show a rank Lambda
 * that has stopped running at all: `day`/`completedAt` freeze on the last day that genuinely
 * ranked, while `META#lastRun` keeps refreshing every hour off capture alone. No value of any
 * field capture writes can ever show "rank hasn't run in a week," because a Lambda that never
 * runs never writes anything -- only a second, independent read can catch that.
 *
 * `DayMeta.status` is deliberately NEVER surfaced here, unlike `llmStatus`: days are
 * permanently `"partial"` under the current `RANK_INPUT_CAP` (~250 kept of ~264 candidates), so
 * a header reading "partial" every day would be exactly the alarm-that-always-fires spec §8
 * spends its longest revision note warning against. `llmStatus` (`"ok" | "failed" |
 * "truncated"`) is a real per-run outcome, not a permanent artifact of the cap, so it is safe to
 * show.
 */
const RANK_STATUSES = ["ok", "failed", "truncated"] as const;
type RankStatus = (typeof RANK_STATUSES)[number];

/** `listDays`/`getArchive` (`src/lib/store/query.ts`) cast DynamoDB's raw `Items` straight to
 *  `DayMeta[]` with no field-level coercion, unlike `getRunStatus`'s careful `memberOrNull`
 *  treatment of `META#lastRun`. A malformed or future-added `llmStatus` value must not reach an
 *  object literal keyed by the exact union below -- that lookup would return `undefined` and
 *  render the literal string "undefined" into the header, which is exactly Task 9 fix round 1's
 *  finding about `truncated` being missing, generalised to any value this function does not
 *  recognise. */
function rankStatusOrNull(v: unknown): RankStatus | null {
  return typeof v === "string" && (RANK_STATUSES as readonly string[]).includes(v)
    ? (v as RankStatus)
    : null;
}

const RANK_STATUS_LABEL: Record<RankStatus, string> = {
  ok: "ok",
  failed: "failed",
  truncated: "truncated",
};

/**
 * The header's trailing "LLM ..." clause. `latestDay` carries three distinct states, not two:
 * `undefined` means the `getArchive(1)` read itself failed (fix round 1, F6 -- a secondary read
 * failing must degrade this segment, not the whole component); `null` means the read succeeded
 * and there is genuinely no ranked day yet (a fresh deploy, matching `getDay`'s own `status ===
 * null` case); a `DayMeta` means both reads succeeded and this is the most recent one. Collapsing
 * "the read failed" and "there is nothing" into one case would render a working system's own
 * transient blip as "no ranked day yet," which is false, not merely uninformative.
 */
function llmLine(latestDay: DayMeta | null | undefined): string {
  if (latestDay === undefined) return "LLM status unavailable";
  if (latestDay === null) return "LLM no ranked day yet";
  const rankStatus = rankStatusOrNull(latestDay.llmStatus);
  const label = rankStatus !== null ? RANK_STATUS_LABEL[rankStatus] : "unknown";
  return `LLM ${label} (ranked through ${latestDay.day})`;
}

export interface RunStatusSummary {
  relativeTime: string;
  itemsWritten: number;
  /**
   * Fix round 1, F3: sources classified `healthy` OR `drift` -- i.e. every source that produced
   * at least one article this run, whether or not it also quarantined something. Folding
   * `drift` out of this count (the previous behaviour) meant a source that reliably quarantines
   * one degenerate title a day -- the `anthropic` case spec §8 names as *not* a fault -- could
   * never let the fraction read `M/M` on a day where nothing is actually broken: the exact
   * alarm-that-always-fires §8 warns against, implemented inside the warning itself. `drift`
   * still appears in `notable` below (quarantined>0 is never silent), so "is anything
   * producing" and "is anything drifting" stay two independent signals instead of one collapsed
   * number.
   */
  producingCount: number;
  totalSources: number;
  /** The full "LLM ..." clause -- see `llmLine`'s doc comment for what each shape of input
   *  means and why `DayMeta.status` never appears here. */
  llmLine: string;
  /** Every source not in the `healthy` state, sorted by id for a stable render order. */
  notable: { source: string; state: Exclude<SourceState, "healthy"> }[];
}

/**
 * The header's run-status line (spec §8) plus the per-source detail beneath it. `now` is a
 * parameter, never read internally, matching `relativeTime`'s own purity rule -- see its doc
 * comment in `format.ts`. `latestDay` is `getArchive(1)`'s first result (or `null`/`undefined`
 * -- see `llmLine`), read concurrently with `status` by the caller, never fetched here: this
 * function stays pure and synchronous, the same reason `classifySourceState` takes plain counts
 * rather than reading `RunStatus` itself.
 *
 * The source-id set is the union of every id appearing in `perSourceCounts`, `filtered`,
 * `quarantined` or `errors`, not just `Object.keys(status.perSourceCounts)`: capture.ts
 * initialises `filtered`/`quarantined` for every registered source up front and only ever adds
 * to `perSourceCounts` inside the `settled.forEach` loop, so today the three maps always carry
 * the same key set -- but this function does not assume that alignment holds forever, since a
 * source counted only through `errors` (and missing from the other three) must still be
 * surfaced rather than silently dropped from the denominator.
 */
export function summarizeRunStatus(
  status: RunStatus,
  latestDay: DayMeta | null | undefined,
  now: Date,
): RunStatusSummary {
  const ids = new Set<string>([
    ...Object.keys(status.perSourceCounts),
    ...Object.keys(status.filtered),
    ...Object.keys(status.quarantined),
    ...status.errors.map((e) => e.source),
  ]);
  const errorSources = new Set(status.errors.map((e) => e.source));

  let producingCount = 0;
  const notable: { source: string; state: Exclude<SourceState, "healthy"> }[] = [];

  for (const id of ids) {
    const state = classifySourceState({
      produced: status.perSourceCounts[id] ?? 0,
      filtered: status.filtered[id] ?? 0,
      quarantined: status.quarantined[id] ?? 0,
      hasError: errorSources.has(id),
    });
    if (state === "healthy" || state === "drift") producingCount += 1;
    if (state !== "healthy") notable.push({ source: id, state });
  }
  notable.sort((a, b) => a.source.localeCompare(b.source));

  return {
    relativeTime: relativeTime(status.startedAt, now),
    itemsWritten: status.itemsWritten,
    producingCount,
    totalSources: ids.size,
    llmLine: llmLine(latestDay),
    notable,
  };
}
