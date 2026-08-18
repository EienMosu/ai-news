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

  return { ingestDay, itemsWritten, itemsFailed, durationMs };
}

/** Kept here rather than in the domain layer so captureAll stays free of I/O policy. */
async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": "ai-news/1.0 (+https://github.com/EienMosu/ai-news)" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}
