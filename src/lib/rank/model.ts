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
 * Cost, finished all the way to the number that matters (the monthly bill, not one run):
 * measured baseline was 12,862 input + 14,206 output tokens = $0.25 for a 200-article FINAL
 * run. Raising the cap to 250 sends ~25% more input tokens per run, so one FINAL (06:00) run
 * now costs roughly $0.31 — that alone is ~$9.30/month at 30 runs. But this file's cap isn't
 * the only thing that changed the bill: there are now TWO rank runs a day (see `resolveDay` in
 * src/lambda/rank.ts), and the second, INTERIM (18:00), run is not free just because it's
 * smaller. It sees a partial day — most, not all, of a day's articles have usually posted by
 * 18:00 Europe/Istanbul, so it stays comfortably under the 250 cap and its input cost scales
 * down with article count — call it roughly $0.15–0.20/run, or ~$4.50–6.00/month at 30 runs.
 * Combined, that lands the real monthly figure near **$14–15/month**, against the $25/month
 * budget alarm and the owner's stated $20–30 ceiling: comfortable headroom, not a rounding
 * error away from tripping the alarm. This is the number to revisit before adding a third run.
 */
export const RANK_INPUT_CAP = 250;

/** Caps thinking PLUS response text, not response text alone. Spec §6. */
export const MAX_TOKENS = 32_000;

/**
 * ~600s. Task 8 sets the rank Lambda's timeout to 900s so this fires with 300s to spare: a
 * Lambda timeout kills the environment with no catchable signal, so an abort at the same
 * moment as the timeout would never let the degraded-mode fallback run.
 */
export const BEDROCK_ABORT_MS = 600_000;
