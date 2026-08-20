import { PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { istanbulDay } from "../lib/core/day.js";
import { computeScore } from "../lib/core/score.js";
import { captureAll } from "../lib/ingest/capture.js";
import { buildCaptureUpdate } from "../lib/store/articles.js";
import { buildIngestCounterIncrement, buildLastRunPut } from "../lib/store/meta.js";
import { docClient } from "../lib/store/client.js";

export interface CaptureSummary {
  ingestDay: string;
  itemsWritten: number;
  itemsFailed: number;
  durationMs: number;
}

/**
 * Spec §9's real ceiling on the per-day /api/ingest cap: an atomic conditional `ADD` against
 * `META#INGEST/<ingestDay>` (see buildIngestCounterIncrement). Two simultaneous manual triggers
 * can both pass the route's own advisory read, so this -- not the route -- is the guarantee.
 *
 * Returns `true` when the slot was reserved (capture should proceed) and `false` when the day's
 * cap is already spent (`ConditionalCheckFailedException` -- genuine contention with the cap
 * itself, nothing is wrong). Any other failure is rethrown rather than silently allowed through
 * or silently refused: an ambiguous DynamoDB error here is only ever reachable from a MANUAL
 * trigger (see the `event?.manual` guard at the call site), so rethrowing cannot affect the
 * hourly scheduled path at all.
 */
async function reserveManualIngestSlot(
  client: ReturnType<typeof docClient>,
  table: string,
  ingestDay: string,
): Promise<boolean> {
  try {
    await client.send(new UpdateCommand(buildIngestCounterIncrement(table, ingestDay)));
    return true;
  } catch (e) {
    if (e instanceof Error && e.name === "ConditionalCheckFailedException") return false;
    throw e;
  }
}

export async function handler(event?: { manual?: boolean }): Promise<CaptureSummary> {
  const startedAt = new Date();
  const table = process.env.TABLE_NAME;
  if (!table) throw new Error("TABLE_NAME is not set");

  const client = docClient();
  const ingestDay = istanbulDay(startedAt);

  // Only a MANUAL trigger (the /api/ingest route -- spec §9) ever touches META#INGEST. The
  // hourly EventBridge schedule invokes with no payload at all (or an empty `{}`), so
  // `event?.manual` is always falsy on that path and this block never runs there. Getting this
  // guard wrong is the single most important failure mode in this change: a cap of 20 counted
  // against the SCHEDULED path too would stop hourly capture within the day, and RSS has no
  // history endpoint to recover a missed window from -- see
  // tests/lambda/capture.test.ts's "scheduled path" test.
  if (event?.manual) {
    const reserved = await reserveManualIngestSlot(client, table, ingestDay);
    if (!reserved) {
      console.warn("manual ingest capped for the day; skipping capture", { ingestDay });
      return {
        ingestDay, itemsWritten: 0, itemsFailed: 0,
        durationMs: Date.now() - startedAt.getTime(),
      };
    }
  }

  const result = await captureAll({ now: startedAt, fetchText: fetchText });
  const nowIso = startedAt.toISOString();

  let itemsWritten = 0;
  let itemsFailed = 0;

  for (const a of result.articles) {
    // Degraded on purpose: capture has no LLM signals. computeScore imputes neutral values
    // and keeps the weights fixed (spec §5) rather than renormalising, so a captured article
    // is comparable with a ranked one instead of being pushed to the bottom.
    const { score, scoreVersion, pointsImputed } = computeScore({
      llmImportance: null,
      category: a.category,
      corroborationToday: null,
      points: a.points,
      publishedAt: a.publishedAt,
      ingestedAt: nowIso,
      now: startedAt,
    });

    try {
      await client.send(new UpdateCommand(
        buildCaptureUpdate(table, {
          article: a, ingestDay, score, scoreVersion, pointsImputed, now: nowIso,
        }),
      ));
      itemsWritten += 1;
    } catch (e) {
      // One throttled write must not cost the other 169 articles, and must not hide.
      // Log the hash and source only: feed URLs carry query strings and this log is
      // retained for two weeks, so the URL and the raw error text never appear here.
      itemsFailed += 1;
      console.error("article write failed", { urlHash: a.urlHash, source: a.source });
    }
  }

  const durationMs = Date.now() - startedAt.getTime();

  try {
    await client.send(new PutCommand(buildLastRunPut(table, {
      startedAt: nowIso,
      durationMs,
      perSourceCounts: result.perSourceCounts,
      filtered: result.filtered,
      quarantined: result.quarantined,
      llmStatus: "skipped",
      itemsWritten,
      itemsFailed,
      errors: result.errors,
    })));
  } catch (e) {
    // This is the one write that must never disappear silently: if it's lost, the whole
    // hour's diagnostics vanish even though the articles already landed. Unlike the
    // per-article try/catch above (isolated so one bad item can't cost the other 169), this
    // one is isolated so ITS failure can't erase the record of what succeeded — so log
    // everything needed to reconstruct the run from CloudWatch and return normally rather
    // than throwing.
    console.error("META#lastRun write failed", {
      itemsWritten,
      itemsFailed,
      perSourceCounts: result.perSourceCounts,
      filtered: result.filtered,
      quarantined: result.quarantined,
      errors: result.errors,
      error: String((e as Error).message ?? e),
    });
  }

  return { ingestDay, itemsWritten, itemsFailed, durationMs };
}

/** Kept here rather than in the domain layer so captureAll stays free of I/O policy. */
export async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": "ai-news/1.0 (+https://github.com/EienMosu/ai-news)" },
    signal: AbortSignal.timeout(15_000),
  });
  // Names the status, not the url: this message can reach CloudWatch (retained two weeks)
  // or bubble into `errors` on META#lastRun, and feed URLs carry query strings.
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}
