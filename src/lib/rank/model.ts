// src/lib/rank/model.ts — no imports, deliberately.
//
// infra/lib/functions.ts needs the model id to write the IAM policy, and scripts/smoke.ts
// needs it too. Importing these from bedrock.ts would pull @anthropic-ai/bedrock-sdk into
// every `cdk synth` and every smoke run — slower at best, and a synth-time failure mode if
// the SDK does credential or environment work on import. A file with no imports cannot do
// that.

/**
 * The `global.` prefix is mandatory, not an EU-residency option. Spec §6: Sonnet 4.6 has no
 * in-region on-demand availability outside eu-west-2 and a bare id returns HTTP 400, while
 * regional prefixes such as `eu.` carry a 10% pricing premium. Verified ACTIVE and invokable
 * in eu-central-1 on 2026-08-18.
 */
export const RANK_MODEL = "global.anthropic.claude-sonnet-4-6";

/**
 * Ranked in one call so clustering is globally consistent — an article can only be grouped
 * with another the model saw at the same time. Spec §4 bounds a day at ~650 articles, so this
 * cap can bite; everything beyond it keeps the degraded score capture assigned, and Task 7
 * persists how many were left out.
 *
 * Raised from 200 to 250 after the first live end-to-end run measured 229 articles for a
 * single day at 21 sources and truncated 29 of them at the old cap — every one of those 29
 * kept its degraded capture score and never got a `whyItMatters`. At 21 sources the live dry
 * run produces ~230/day, so 250 ranks the whole day with headroom, and the per-section
 * allocator in allocate.ts still splits that 250 fairly across sections exactly as it split
 * 200.
 *
 * Cost, priced from the real prompt shape rather than input tokens alone (branch review, I2:
 * an earlier version of this comment priced only the cheap side and its conclusion did not
 * follow from its own arithmetic). The per-candidate line (prompt.ts, SUMMARY_CHARS_FOR_RANKING
 * = 300) measures out to ~97 input tokens/candidate at ~3.9 chars/token. At $3/M input and
 * $15/M output (Sonnet 4.6; adaptive thinking is billed as output), the marginal cost per
 * candidate is 97 tok x $3/M + ~50 tok x $15/M = ~$0.00104, of which OUTPUT is ~72% -- the
 * side this comment used to attribute the cap raise to is the smaller ~28%. There are two rank
 * runs a day (`resolveDay` in src/lambda/rank.ts): FINAL (06:00) sees the full day, INTERIM
 * (18:00) a partial one, so it costs less per run without a separate estimate here.
 *
 * Raised again, 250 to 375, when the Cloud vertical shipped (spec theslowwire-design.md §5.1,
 * "Ranking budget"). allocateRankingCap already splits the cap fairly by section and needed no
 * change; but a third vertical against an unchanged cap would have quietly cut every section's
 * own fair share too -- ai and design each held 125 of the old 250, back when there were only
 * two sections; 375 across three sections keeps that same 125 per section rather than shrinking
 * it to make room for cloud.
 *
 * With cloud's per-source `maxItems` caps in place (src/lib/ingest/sources.ts), realistic total
 * supply lands near 300-330 candidates/day rather than saturating 375 -- roughly +$5/month over
 * the previous baseline, landing near $20/month total. The cap-saturated case (every section at
 * its ceiling, every run) costs more, but is itself bounded by those same per-source `maxItems`
 * caps rather than open-ended, so 375 is a ceiling on spend, not only on candidate count.
 * Revisit this estimate once the first live 375-candidate day's real
 * inputTokens/outputTokens/thinkingTokens land -- src/lambda/rank.ts already logs all three.
 */
export const RANK_INPUT_CAP = 375;

/**
 * Caps thinking PLUS response text, not response text alone. Spec §6.
 *
 * Raised 32,000 to 48,000 alongside RANK_INPUT_CAP's 250 to 375 (branch review, I1): the
 * response JSON grows in near-lockstep with candidate count -- one schema item per candidate --
 * so a 50% bigger input cap sends roughly 50% more response tokens into the same ceiling that
 * adaptive thinking (bedrock.ts) also draws from. Left at 32,000, this was not a graceful
 * degradation: bedrock.ts throws TruncationError on stop_reason === "max_tokens", no byHash
 * entries get written for that run, and the whole day falls back to its degraded capture score
 * -- silent to a reader, since the day just looks unranked. 48,000 restores the same thinking
 * headroom this cap left at 32,000 against the smaller 250-candidate input, instead of quietly
 * shrinking it under the bigger one.
 */
export const MAX_TOKENS = 48_000;

/**
 * ~600s. Task 8 sets the rank Lambda's timeout to 900s so this fires with 300s to spare: a
 * Lambda timeout kills the environment with no catchable signal, so an abort at the same
 * moment as the timeout would never let the degraded-mode fallback run.
 */
export const BEDROCK_ABORT_MS = 600_000;
