import { relativeTime } from "./format.js";
import type { RunStatus } from "./read.js";

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
 * than inventing a red state this layer cannot actually verify -- see components/RunStatus.tsx
 * and the Task 9 report for the fuller reasoning. `quiet` is grey, never amber: spec §8 is
 * explicit that a reliably-quiet source (`alistapart`) is not a fault.
 */
export const SOURCE_STATE_CLASS: Record<Exclude<SourceState, "healthy">, string> = {
  quiet: "text-neutral-400",
  drift: "text-amber-600",
  fetchFailed: "text-amber-600",
  dead: "text-amber-600",
};

const LLM_LABEL: Record<NonNullable<RunStatus["llmStatus"]>, string> = {
  ok: "ok",
  skipped: "skipped",
  failed: "failed",
};

export interface RunStatusSummary {
  relativeTime: string;
  itemsWritten: number;
  /** Sources classified `healthy` this run -- see `classifySourceState`. A source in `drift`
   *  (spec §8's "amber, never hidden" row) does not count here even when it also produced
   *  items, so this can read e.g. 19/21 on a day where nothing is actually broken; the
   *  `notable` list below is what explains the gap, so the fraction alone is never the whole
   *  story a reader needs. */
  producingCount: number;
  totalSources: number;
  llmLabel: string;
  /** Every source not in the `healthy` state, sorted by id for a stable render order. */
  notable: { source: string; state: Exclude<SourceState, "healthy"> }[];
}

/**
 * The header's run-status line (spec §8) plus the per-source detail beneath it. `now` is a
 * parameter, never read internally, matching `relativeTime`'s own purity rule -- see its doc
 * comment in `format.ts`.
 *
 * The source-id set is the union of every id appearing in `perSourceCounts`, `filtered`,
 * `quarantined` or `errors`, not just `Object.keys(status.perSourceCounts)`: capture.ts
 * initialises `filtered`/`quarantined` for every registered source up front and only ever adds
 * to `perSourceCounts` inside the `settled.forEach` loop, so today the three maps always carry
 * the same key set -- but this function does not assume that alignment holds forever, since a
 * source counted only through `errors` (and missing from the other three) must still be
 * surfaced rather than silently dropped from the denominator.
 */
export function summarizeRunStatus(status: RunStatus, now: Date): RunStatusSummary {
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
    if (state === "healthy") producingCount += 1;
    else notable.push({ source: id, state });
  }
  notable.sort((a, b) => a.source.localeCompare(b.source));

  return {
    relativeTime: relativeTime(status.startedAt, now),
    itemsWritten: status.itemsWritten,
    producingCount,
    totalSources: ids.size,
    llmLabel: status.llmStatus !== null ? LLM_LABEL[status.llmStatus] : "unknown",
    notable,
  };
}
