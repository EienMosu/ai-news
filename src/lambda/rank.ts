import { PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import { istanbulDay } from "../lib/core/day.js";
import { computeScore } from "../lib/core/score.js";
import { BEDROCK_ABORT_MS } from "../lib/rank/model.js";
import { TruncationError, RANK_INPUT_CAP, rankArticles } from "../lib/rank/bedrock.js";
import { allocateRankingCap } from "../lib/rank/allocate.js";
import { reconcile, type RankingEntry } from "../lib/rank/reconcile.js";
import { countCorroboration } from "../lib/rank/corroboration.js";
import { backupDay } from "../lib/rank/backup.js";
import { buildRankUpdate } from "../lib/store/articles.js";
import { buildDayMetaPut } from "../lib/store/meta.js";
import { dayHasArticles, listDays, queryDay } from "../lib/store/query.js";
import { docClient } from "../lib/store/client.js";

export interface RankSummary {
  day: string;
  ranked: number;
  /** How many articles the model actually returned an entry for. */
  llmRanked: number;
  /** How many were cut by RANK_INPUT_CAP and never reached the model at all. */
  truncated: number;
  /**
   * Phase-1 enrichment writes (model output -> DynamoDB) that failed. Unlike capture's
   * `itemsFailed` or phase 2's own `ranked` undercount, this used to be logged and nothing
   * else -- so a DynamoDB failure here silently discarded Bedrock output already paid for
   * while the day still reported "complete". Nonzero forces `status: "partial"` below.
   */
  enrichmentFailed: number;
  status: "complete" | "partial";
  llmStatus: "ok" | "failed" | "truncated";
  backedUp: boolean;
  /**
   * How many of the last 7 days have articles but no `"complete"` day record. Task 7 review,
   * ruling on a multi-day Bedrock outage: no automatic catch-up (see the comment at the call
   * site for why), so this is what makes the gap visible instead of silently permanent — the
   * manual `{ day }` invocation already exists, this is what tells a human to use it.
   *
   * Wall-clock "today" is excluded from the 7, whether or not it is `day`: today is by
   * definition incomplete until tomorrow morning's final run, so counting it would make this
   * number always at least 1 on every INTERIM run — a count that never reaches zero stops
   * meaning anything.
   */
  unrankedRecentDays: number;
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
 *
 * This is the FINAL run's day selection only. See `resolveDay` for the INTERIM run (18:00),
 * which targets today instead.
 */
export function targetDay(now: Date): string {
  return istanbulDay(new Date(now.getTime() - 24 * 60 * 60 * 1000));
}

/**
 * Which day this invocation ranks, and whether it is the INTERIM (18:00) run rather than the
 * FINAL (06:00) one.
 *
 * The 18:00 CfnSchedule sends `{ interim: true }`. Re-targeting `targetDay` (yesterday) at
 * 18:00 would just re-rank a day the 06:00 run already finished — the "already complete"
 * guard would then skip it, making the second run a no-op. So `interim: true` targets TODAY
 * instead: whatever has been captured so far.
 *
 * `day` and `interim` are independent: `day`, when given, decides WHICH day is ranked and
 * nothing else — it does not reset `interim` to `false`. `interim` decides whether this run is
 * allowed to be the FINAL word on that day, which is why the runbook's manual override (an
 * explicit `day`, no `interim`) still defaults to `interim: false` and the 18:00 schedule (no
 * `day`) still defaults to targeting today. A caller is free to combine both — e.g. a manual
 * interim re-run of a specific day — and get exactly what each field says on its own.
 *
 * This function does NOT decide whether a day can actually be marked `"complete"`, on purpose:
 * that is `handler`'s `dayNotYetOver` check, and it does not trust `interim` (or anything else
 * a caller sets) either. See the comment there for why.
 */
export function resolveDay(
  event: { day?: string; interim?: boolean } | undefined,
  now: Date,
): { day: string; interim: boolean } {
  const interim = Boolean(event?.interim);
  const day = event?.day ?? (interim ? istanbulDay(now) : targetDay(now));
  return { day, interim };
}

/**
 * `n` days before `day` (n=0 returns `day` itself). Anchored at noon UTC so the 24h subtraction
 * can never land on the wrong side of a midnight boundary before istanbulDay re-derives the
 * local calendar day — Turkey's constant UTC+3 makes this exact either way, per targetDay above.
 */
function daysBefore(day: string, n: number): string {
  const anchor = new Date(`${day}T12:00:00Z`);
  return istanbulDay(new Date(anchor.getTime() - n * 24 * 60 * 60 * 1000));
}

export async function handler(
  event?: { day?: string; force?: boolean; interim?: boolean },
): Promise<RankSummary> {
  const table = process.env.TABLE_NAME;
  const tokenParam = process.env.GITHUB_TOKEN_PARAM;
  const repo = process.env.BACKUP_REPO;
  if (!table) throw new Error("TABLE_NAME is not set");

  const now = new Date();
  const { day, interim } = resolveDay(event, now);
  const client = docClient();

  // ---- Already-complete guard (final review, axis 5) ------------------------------------
  // EventBridge Scheduler has its OWN retry policy (see infra/lib/functions.ts), separate from
  // the Lambda-side `retryAttempts: 0`. This guard is the half of that fix that matters most:
  // it is idempotent protection that does not depend on getting retry configuration right in
  // two different places. Without it, a redelivery after the day lock's 20-minute expiry (or
  // any other unexpected repeat invocation) would re-rank -- and re-bill Bedrock for -- a day
  // that already finished successfully. `event.force` is the explicit human override, for
  // someone who really does want to redo a day (e.g. after a data correction).
  if (!event?.force) {
    const recentMetas = await listDays(client, table, 30);
    const already = recentMetas.find((m) => m.day === day);
    if (already?.status === "complete") {
      console.log("day already complete; skipping without calling Bedrock", { day });
      return {
        day, ranked: already.articleCount, llmRanked: already.llmRanked,
        truncated: already.truncated, enrichmentFailed: 0, status: "complete",
        llmStatus: already.llmStatus, backedUp: false, unrankedRecentDays: 0,
      };
    }
  }

  const stored = await queryDay(client, table, day);
  if (stored.length === 0) {
    // Nothing captured. Recording a complete day with zero articles is wrong — it would make
    // the feed show an empty day as authoritative. Leave no META#DAY at all.
    return {
      day, ranked: 0, llmRanked: 0, truncated: 0, enrichmentFailed: 0, status: "partial",
      llmStatus: "ok", backedUp: false, unrankedRecentDays: 0,
    };
  }

  const candidates = stored.map((a) => ({
    urlHash: String(a.pk).slice("ART#".length),
    title: String(a.title ?? ""),
    summary: String(a.summary ?? ""),
    sourceName: String(a.sourceName ?? ""),
    category: String(a.category ?? "news"),
    // Defaults to "ai" for any pre-migration item written before `section` existed; every
    // source in the registry sets one going forward (sources.ts requires it at compile time).
    section: String(a.section ?? "ai"),
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
  } catch (e) {
    // "The call failed" and "the thing is already taken" are different facts. A
    // ConditionalCheckFailedException means the condition was evaluated and genuinely lost —
    // another run holds the day, nothing is wrong. Anything else (a throttle, a network
    // blip, ...) means the condition was never evaluated, so we do NOT know whether we hold
    // the lock — proceeding could interleave two runs exactly as the lock exists to prevent.
    // llmStatus: "failed" is what lets a human tell the two apart in the summary and the log.
    const name = e instanceof Error ? e.name : "Unknown";
    if (name === "ConditionalCheckFailedException") {
      console.warn("another rank run holds this day", { day });
      return {
        day, ranked: 0, llmRanked: 0, truncated: 0, enrichmentFailed: 0, status: "partial",
        llmStatus: "ok", backedUp: false, unrankedRecentDays: 0,
      };
    }
    console.error("day lock write failed; not proceeding without knowing if we hold it", {
      day, error: name,
    });
    return {
      day, ranked: 0, llmRanked: 0, truncated: 0, enrichmentFailed: 0, status: "partial",
      llmStatus: "failed", backedUp: false, unrankedRecentDays: 0,
    };
  }

  // ---- Phase 1: ask the model, write enrichment only -----------------------------------
  let byHash = new Map<string, RankingEntry>();
  let llmStatus: "ok" | "failed" | "truncated" = "ok";
  let truncated = 0;

  // Rank the top N by a score recomputed NOW, not by the stored score. Stored scores mix two
  // scales — a degraded score frozen at first capture for unranked articles, a real score for
  // articles ranked on an earlier day — so slicing by them selects on write history rather
  // than on importance.
  //
  // Computed once per article, not once per comparison: allocateRankingCap sorts each
  // per-section group, and degradedScore is pure given `now`, so recomputing it inline in a
  // comparator would repeat the same work for the same article on every comparison it's part
  // of.
  //
  // Allocated per section (Part 2), not sorted globally and sliced: design tops out at a 0.7
  // source weight while an AI `lab` announcement reaches 1.0, so a global sort outranks design
  // by construction rather than merit, and on a busy AI day a global slice could squeeze
  // design out of the ranked set entirely. allocateRankingCap returns every candidate, with
  // each section's fair share first, so rankArticles's own `slice(0, RANK_INPUT_CAP)` backstop
  // (still in force) selects exactly that fair share.
  const scored = candidates.map((c) => ({ item: c, section: c.section, score: degradedScore(c, now) }));
  const ordered = allocateRankingCap(scored, RANK_INPUT_CAP);

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
    // Logged together with the day, not just left in the SDK's own types: thinking tokens are
    // the entire difference between the $6 floor and the $16 ceiling for one call, so this is
    // the one line that says which month we're having.
    console.log("bedrock usage", {
      day, inputTokens: outcome.usage.inputTokens, outputTokens: outcome.usage.outputTokens,
      thinkingTokens: outcome.usage.thinkingTokens,
    });
  } catch (e) {
    // Truncation is NOT an outage. It means we were billed for the full 32k cap and got
    // unusable output; folding it into the generic failure branch is what spec §6 forbids,
    // because the two need different responses (shrink the batch vs wait for Bedrock).
    llmStatus = e instanceof TruncationError ? "truncated" : "failed";
    console.error("ranking did not produce a usable result", {
      reason: llmStatus, message: e instanceof Error ? e.message : "unknown",
      // A TruncationError is the one failure that still carries a real cost -- the full 32k
      // cap was billed even though the output was unusable, so its usage is worth logging too.
      ...(e instanceof TruncationError ? { usage: e.usage } : {}),
    });
  } finally {
    clearTimeout(abortTimer);
  }

  // Counted, not just logged: capture's `itemsFailed` and phase 2's own `ranked` undercount
  // both surface a write failure in the run's returned summary; this loop used to be the one
  // exception, so a DynamoDB failure here could silently discard Bedrock output already paid
  // for while the day still reported "complete" (final review, axis 5).
  let enrichmentFailed = 0;
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
      enrichmentFailed += 1;
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
  // `enrichmentFailed === 0` is its own condition, not folded into `llmStatus`: the model call
  // can succeed outright (`llmStatus: "ok"`) while a handful of its writes still fail, and a
  // day is not honestly "complete" while Bedrock output we already paid for was discarded.
  //
  // `interim` forces "partial" regardless of how well the run went. This is the whole point
  // of the 18:00 run (see `resolveDay`): today's evening articles have not been captured yet,
  // so no matter how cleanly this run scores what HAS been captured, marking today
  // "complete" now would make tomorrow's 06:00 final run skip it via the already-complete
  // guard above, stranding everything captured after 18:00.
  //
  // `dayNotYetOver` closes a hazard `interim` alone leaves open: runbook step 8 tells an
  // operator to invoke rank by hand with `{"day":"<today>"}` -- an explicit day, no `interim`
  // flag, so `resolveDay` reports `interim: false` and nothing above would stop that call from
  // marking TODAY "complete". Tomorrow's 06:00 final run would then hit the already-complete
  // guard and skip today entirely, stranding everything captured after the manual run forever
  // -- the exact failure the interim run exists to prevent, reachable through the runbook we
  // ship. Finality is a property of the calendar, not of the payload: a day that has not
  // ended cannot be finally ranked no matter who asks or which fields they set, so this check
  // does not depend on `interim`, `force`, or any future caller getting a flag combination
  // right -- ISO date strings compare correctly with `<`, so no date arithmetic is needed.
  const dayNotYetOver = day >= istanbulDay(now);
  const status: "complete" | "partial" = interim || dayNotYetOver
    ? "partial"
    : ranked === afterEnrichment.length && truncated === 0 && llmStatus === "ok" &&
      enrichmentFailed === 0
      ? "complete"
      : "partial";

  // Written LAST, after every article. A run that dies before this leaves the day without a
  // META#DAY pointer, so readers never observe a partially-written day. Spec §4.
  await client.send(new PutCommand(buildDayMetaPut(table, {
    day, status, articleCount: ranked, llmRanked, truncated, llmStatus,
    runId,
    completedAt: new Date().toISOString(),
  })));

  // ---- Multi-day gap visibility (Task 7 review ruling) ----------------------------------
  // Deliberately NOT an automatic catch-up. Two reasons: freshness beats completeness in a
  // news reader, so ranking an old gap before today would delay today's news to recover
  // last week's; and every make-up day is another Bedrock call on the one path in this
  // system that spends money, which is exactly where an unbounded recovery loop would hide.
  // Instead the gap is made visible, since the manual `{ day }` invocation already exists
  // and the missing piece is knowing to use it — so count and log it instead of acting on it.
  let unrankedRecentDays = 0;
  try {
    const recentDays = Array.from({ length: 7 }, (_, i) => daysBefore(day, i));
    // Today (wall-clock, not `day` — the interim run's `day` IS today) is by definition
    // incomplete until tomorrow morning's final run: capture keeps writing to it all day, and
    // nothing marks it "complete" before then. Counting it here would make this metric always
    // report at least 1 for every interim run — a number that never reaches zero stops being a
    // gap signal at all.
    const wallClockToday = istanbulDay(now);
    const metas = await listDays(client, table, 30);
    const completed = new Set(metas.filter((m) => m.status === "complete").map((m) => m.day));
    for (const d of recentDays) {
      if (d === wallClockToday) continue;
      if (completed.has(d)) continue;
      if (await dayHasArticles(client, table, d)) unrankedRecentDays += 1;
    }
    if (unrankedRecentDays > 0) {
      console.error("days with articles but no complete ranking in the last 7", {
        unrankedRecentDays, day,
      });
    }
  } catch (e) {
    // Best-effort. The ranking work above is already committed; a failure here must not
    // undo it or throw out of an otherwise-successful run.
    console.error("gap check failed", { message: e instanceof Error ? e.message : "unknown" });
  }

  return {
    day, ranked, llmRanked, truncated, enrichmentFailed, status, llmStatus, backedUp,
    unrankedRecentDays,
  };
}
