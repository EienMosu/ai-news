import { PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import { istanbulDay } from "../lib/core/day.js";
import { computeScore } from "../lib/core/score.js";
import { BEDROCK_ABORT_MS } from "../lib/rank/model.js";
import { TruncationError, rankArticles } from "../lib/rank/bedrock.js";
import { reconcile, type RankingEntry } from "../lib/rank/reconcile.js";
import { countCorroboration } from "../lib/rank/corroboration.js";
import { backupDay } from "../lib/rank/backup.js";
import { buildRankUpdate } from "../lib/store/articles.js";
import { buildDayMetaPut } from "../lib/store/meta.js";
import { queryDay } from "../lib/store/query.js";
import { docClient } from "../lib/store/client.js";

export interface RankSummary {
  day: string;
  ranked: number;
  /** How many articles the model actually returned an entry for. */
  llmRanked: number;
  /** How many were cut by RANK_INPUT_CAP and never reached the model at all. */
  truncated: number;
  status: "complete" | "partial";
  llmStatus: "ok" | "failed" | "truncated";
  backedUp: boolean;
}

/**
 * The ordering score used to choose which articles reach the model.
 *
 * Deliberately recomputed rather than read from the item: stored scores mix a degraded score
 * frozen at first capture with a real score from an earlier ranking, so sorting by them
 * selects on write history instead of on importance.
 */
function degradedScore(c: { category: string; points: number | null; publishedAt: string | null },
                       now: Date): number {
  return computeScore({
    llmImportance: null, category: c.category as never, corroborationToday: null,
    points: c.points, publishedAt: c.publishedAt,
    ingestedAt: now.toISOString(), now,
  }).score;
}

/**
 * The day this run ranks.
 *
 * Runs at 06:00 Europe/Istanbul and ranks the day BEFORE it, which is what makes the window
 * complete — spec §2 moved the cron off 00:00 for exactly this reason. Turkey has been a
 * constant UTC+3 with no DST since 2016, so subtracting 24 hours and re-deriving the local
 * day is exact; istanbulDay does the timezone work either way.
 */
export function targetDay(now: Date): string {
  return istanbulDay(new Date(now.getTime() - 24 * 60 * 60 * 1000));
}

export async function handler(event?: { day?: string }): Promise<RankSummary> {
  const table = process.env.TABLE_NAME;
  const tokenParam = process.env.GITHUB_TOKEN_PARAM;
  const repo = process.env.BACKUP_REPO;
  if (!table) throw new Error("TABLE_NAME is not set");

  const now = new Date();
  const day = event?.day ?? targetDay(now);
  const client = docClient();

  const stored = await queryDay(client, table, day);
  if (stored.length === 0) {
    // Nothing captured. Recording a complete day with zero articles is wrong — it would make
    // the feed show an empty day as authoritative. Leave no META#DAY at all.
    return { day, ranked: 0, llmRanked: 0, truncated: 0, status: "partial", llmStatus: "ok", backedUp: false };
  }

  const candidates = stored.map((a) => ({
    urlHash: String(a.pk).slice("ART#".length),
    title: String(a.title ?? ""),
    summary: String(a.summary ?? ""),
    sourceName: String(a.sourceName ?? ""),
    category: String(a.category ?? "news"),
    publishedAt: (a.publishedAt as string | null) ?? null,
    points: (a.points as number | null) ?? null,
  }));

  // ---- Acquire the day lock (spec §9) ----------------------------------------------
  // Reserved concurrency of 1 stops two SCHEDULED runs overlapping, but a manual
  // `{ day }` invocation from the console bypasses nothing and would interleave two
  // different clusterings into one day partition, each reporting "complete". The lock is
  // the second half of that requirement. It expires so a killed run cannot wedge the day
  // permanently.
  const runId = now.toISOString();
  const lockExpiry = new Date(now.getTime() + 20 * 60 * 1000).toISOString();
  try {
    await client.send(new PutCommand({
      TableName: table,
      Item: { pk: "META#lock", sk: day, runId, expiresAt: lockExpiry },
      ConditionExpression: "attribute_not_exists(pk) OR expiresAt < :now",
      ExpressionAttributeValues: { ":now": runId },
    }));
  } catch {
    console.warn("another rank run holds this day", { day });
    return { day, ranked: 0, llmRanked: 0, truncated: 0, status: "partial", llmStatus: "ok", backedUp: false };
  }

  // ---- Phase 1: ask the model, write enrichment only -----------------------------------
  let byHash = new Map<string, RankingEntry>();
  let llmStatus: "ok" | "failed" | "truncated" = "ok";
  let truncated = 0;

  // Rank the top N by a score recomputed NOW, not by the stored score. Stored scores mix two
  // scales — a degraded score frozen at first capture for unranked articles, a real score for
  // articles ranked on an earlier day — so slicing by them selects on write history rather
  // than on importance.
  const ordered = [...candidates].sort((a, b) =>
    degradedScore(b, now) - degradedScore(a, now));

  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), BEDROCK_ABORT_MS);
  try {
    const outcome = await rankArticles(ordered, { signal: controller.signal });
    truncated = outcome.truncated;
    const r = reconcile(outcome.inputHashes, outcome.response);
    byHash = r.byHash;
    console.log("reconciled", {
      matched: r.matched, missing: r.missing, unknown: r.unknown,
      withoutCluster: r.withoutCluster, withoutRationale: r.withoutRationale, truncated,
    });
  } catch (e) {
    // Truncation is NOT an outage. It means we were billed for the full 32k cap and got
    // unusable output; folding it into the generic failure branch is what spec §6 forbids,
    // because the two need different responses (shrink the batch vs wait for Bedrock).
    llmStatus = e instanceof TruncationError ? "truncated" : "failed";
    console.error("ranking did not produce a usable result", {
      reason: llmStatus, message: e instanceof Error ? e.message : "unknown",
    });
  } finally {
    clearTimeout(abortTimer);
  }

  for (const [hash, entry] of byHash) {
    try {
      await client.send(new UpdateCommand(buildRankUpdate(table, {
        urlHash: hash,
        llmImportance: entry.importance,
        whyItMatters: entry.whyItMatters,
        // Namespaced per spec §5 so a slug reused on a later day cannot merge two days'
        // stories. `__self__:` ids already carry their own hash and are left alone.
        clusterId: entry.clusterId.startsWith("__self__:")
          ? entry.clusterId
          : `${day}#${entry.clusterId}`,
        corroborationToday: null,   // computed in phase 2, from stored state
        score: null,
        scoreVersion: null,
      })));
    } catch {
      console.error("enrichment write failed", { urlHash: hash });
    }
  }

  // ---- Phase 2: re-read the day, then score the WHOLE day ------------------------------
  // Spec §5: "At the end of each run the day partition is re-read once and corroborationToday
  // recomputed for the whole day, making it consistent and idempotent under repeated manual
  // triggers." Deriving corroboration from stored state rather than from this run's map is
  // what makes a second run produce the same answer as the first.
  const afterEnrichment = await queryDay(client, table, day);
  const corroboration = countCorroboration(afterEnrichment);

  let ranked = 0;
  for (const item of afterEnrichment) {
    const hash = String(item.pk).slice("ART#".length);
    const { score, scoreVersion } = computeScore({
      llmImportance: (item.llmImportance as number | null) ?? null,
      category: item.category as never,
      corroborationToday: corroboration.get(hash) ?? null,
      points: (item.points as number | null) ?? null,
      publishedAt: (item.publishedAt as string | null) ?? null,
      ingestedAt: (item.firstSeenAt as string) ?? runId,
      now,
    });
    try {
      await client.send(new UpdateCommand(buildRankUpdate(table, {
        urlHash: hash,
        llmImportance: null, whyItMatters: null, clusterId: null,
        corroborationToday: corroboration.get(hash) ?? null,
        score, scoreVersion,
      })));
      ranked += 1;
    } catch {
      console.error("score write failed", { urlHash: hash });
    }
  }

  // ---- Phase 3: back up, then publish the day -------------------------------------------
  let backedUp = false;
  if (tokenParam && repo) {
    const ssm = new SSMClient({});
    const result = await backupDay(day, afterEnrichment, {
      fetch,
      repo,
      getToken: async () => {
        const parameter = await ssm.send(new GetParameterCommand({
          Name: tokenParam, WithDecryption: true,
        }));
        const v = parameter.Parameter?.Value;
        if (!v) throw new Error("github token parameter is empty");
        return v;
      },
    });
    backedUp = result.ok;
    if (!result.ok) console.error("backup failed", { error: result.error });
  }

  // `complete` means every article in the day was scored AND every one of them was seen by
  // the model. Reporting `complete` for a day where 450 of 650 articles never reached Bedrock
  // would make the cap invisible in the data model — `truncated` is persisted for the same
  // reason, so the gap is inspectable without reading a log.
  const llmRanked = byHash.size;
  const status: "complete" | "partial" =
    ranked === afterEnrichment.length && truncated === 0 && llmStatus === "ok"
      ? "complete"
      : "partial";

  // Written LAST, after every article. A run that dies before this leaves the day without a
  // META#DAY pointer, so readers never observe a partially-written day. Spec §4.
  await client.send(new PutCommand(buildDayMetaPut(table, {
    day, status, articleCount: ranked, llmRanked, truncated, llmStatus,
    runId,
    completedAt: new Date().toISOString(),
  })));

  return { day, ranked, llmRanked, truncated, status, llmStatus, backedUp };
}
