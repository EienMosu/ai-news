import { PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { istanbulDay } from "../lib/core/day.js";
import { computeScore } from "../lib/core/score.js";
import { captureAll } from "../lib/ingest/capture.js";
import { buildCaptureUpdate } from "../lib/store/articles.js";
import { buildLastRunPut } from "../lib/store/meta.js";
import { docClient } from "../lib/store/client.js";

export interface CaptureSummary {
  ingestDay: string;
  itemsWritten: number;
  itemsFailed: number;
  durationMs: number;
}

export async function handler(_event?: unknown): Promise<CaptureSummary> {
  const startedAt = new Date();
  const table = process.env.TABLE_NAME;
  if (!table) throw new Error("TABLE_NAME is not set");

  const client = docClient();
  const result = await captureAll({ now: startedAt, fetchText: fetchText });
  const ingestDay = istanbulDay(startedAt);
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
