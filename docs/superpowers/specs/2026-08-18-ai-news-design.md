# ai-news — Design

**Date:** 2026-08-18
**Status:** Approved, ready for implementation planning

A personal AI-news reader. Single user. Aggregates AI news from free, keyless sources,
ranks it by importance, accumulates a searchable archive.

This design has been through a four-axis review (AWS infrastructure, data model,
Bedrock integration, end-to-end failure modes). Decisions that reverse an earlier
draft are marked **[revised]** with the reason, so the rationale is not lost.

---

## 1. Goals and constraints

**Goals**
- Pull AI news once a day, ranked most-important-first.
- Accumulate an archive that stays searchable as it grows.
- Manual on-demand refresh in addition to the schedule.

**Constraints**
- Single user, personal, non-commercial. Sources' non-commercial terms are not a problem.
- AWS account is on the post-July-2025 **Free Plan**: ~$176 credit remaining of $200 max.
  The plan ends at 6 months **or** credit exhaustion, whichever comes first. After that,
  the account is closed 90 days later and its data deleted unless upgraded to a Paid Plan.
  **This is the single largest risk to the product and drives the off-AWS backup (§8).**
- Bedrock model access on this account is limited to Sonnet 4.6, Sonnet 4.5, and
  Haiku 4.5. Other models require a support ticket that a free-tier account will not get.

**Stack:** Next.js 16.2 / React 19.2 / TypeScript 5 / Tailwind 4 / Zod 4 / Vitest 4 /
pnpm 10.34, hosted on Vercel. AWS CDK (TypeScript) for infrastructure. Node 24 Lambda runtime.

> **[revised]** TanStack Query was in the original stack list. It is dropped for v1: the
> app has no client-side server-state fetching. Pages are Server Components, category
> filtering and cluster expansion are local state over already-fetched data, and search
> resolves server-side through `searchParams`.

---

## 2. Architecture

Capture and ranking are separate schedules.

```
EventBridge Scheduler  (hourly)          EventBridge Scheduler  (daily 06:00 Europe/Istanbul)
   capture-lambda                            rank-lambda
     fetch + normalize                         read the day partition
     conditional write (new items only)        one Bedrock call: cluster + importance
                                               compute scores, write back
                                               export NDJSON to GitHub
                                               write META#DAY (last) + META#lastRun

Next.js /api/ingest  ->  lambda:InvokeAsync on capture-lambda, returns 202
                         (capture only, never rank — see "Manual refresh" below)
```

> **[revised]** The original design ran fetch + rank together in one nightly job.
> Two problems forced the split:
> 1. **Steady-state loss.** VentureBeat returns ~7 items per fetch and The Verge ~10.
>    On a busy day that window is under 24 hours, so a daily-only fetch drops articles
>    even when it succeeds.
> 2. **No recovery.** RSS has no history endpoint. A single missed run is permanent
>    data loss with nothing to catch up from.
>
> Hourly capture costs ~720 EventBridge invocations/month against a 14M free allowance,
> and the deterministic primary key makes over-fetching harmless.

> **[revised]** The cron moved from 00:00 to 06:00 Europe/Istanbul. Ranking at 06:00
> gives a clean, complete previous-day window and removes an entire class of
> day-boundary off-by-one errors.

> **[revised]** `/api/ingest` was originally going to run the ingestion logic itself.
> It cannot: Vercel's Hobby plan caps function duration at **60 seconds** and the Bedrock
> call alone is multi-minute. Running it there would also require giving Vercel
> `bedrock:InvokeModel` and DynamoDB write permission as long-lived static keys — the one
> credential that can drain the credit balance. It is now a thin trigger.

### Manual refresh

`/api/ingest` invokes **capture-lambda only**. It fetches and stores new articles; it does
not call Bedrock and does not rank.

This is deliberate. Ranking is the only expensive step, and a refresh button that triggers
a Bedrock call lets a stuck finger — or a leaked secret — spend the credit balance that
keeps the account alive. Capture is idempotent, costs fractions of a cent, and is safe to
run arbitrarily often.

**Consequence to surface in the UI:** articles pulled by a manual refresh carry no
`llmImportance` until the next daily ranking run, so they score on the deterministic
signals alone and will generally sit lower than they deserve. The feed shows them under a
"new since last ranking" marker rather than silently mixing them into a ranking they were
not part of.

### Repository layout

```
ai-news/
  src/app/
    page.tsx                  feed (latest complete day)
    day/[date]/page.tsx       archive
    search/page.tsx           search
    api/ingest/route.ts       trigger only
  src/lib/ingest/
    sources.ts                all sources in one file
    fetchers/                 rss.ts, hn.ts, hfPapers.ts
    normalize.ts, dedupe.ts, capture.ts
  src/lib/rank/
    bedrock.ts, score.ts, sortKey.ts
  src/lib/db/
    client.ts, articles.ts, meta.ts
  src/lib/backup/github.ts
  src/types/article.ts
  lambda/capture.ts           thin wrapper
  lambda/rank.ts              thin wrapper
  infra/                      AWS CDK
  tests/
```

CDK's `NodejsFunction` bundles `src/lib` via esbuild. Set `bundling.externalModules`
explicitly rather than relying on the CDK default, which has changed across versions.

### Expected cost

| Service | Usage | Always-free allowance | Monthly |
|---|---|---|---|
| Lambda | ~750 invocations, ~15,300 GB-s | 1M requests, 400,000 GB-s | $0 |
| EventBridge Scheduler | ~750 invocations | 14M | $0 |
| DynamoDB (on-demand) | ~18K write units | none — on-demand has no free tier | ~$0.15 |
| CloudWatch Logs | 30 runs' logs | 5 GB | ~$0 |
| GitHub backup, Vercel Hobby | — | — | $0 |
| **Bedrock** | one call/day | **none** | **$4.50 – $12.50** |

**Total: roughly $5–13/month, essentially all Bedrock**, varying with the `effort`
setting. Everything else sits well inside always-free allowances. Anything above ~$15
means something is misbehaving — a runaway loop, a leaked ingest secret, or thinking
tokens growing unchecked — which is what the budget alarms in §8 are calibrated for.

Note the credit is not the binding constraint: $176 at $10/month is 17 months, but the
Free Plan expires at **6 months** regardless. Plan against the calendar, not the balance.

### Portability across AWS accounts

The stack is CDK (TypeScript — same language and repo as the application; Terraform would
add a second toolchain for no gain here). Moving to a different AWS account should be
`cdk deploy` with different credentials, which requires discipline in the stack code:

- No hardcoded account IDs or ARNs. Use `Stack.of(this).account` / `.region` and CDK's
  own resource references; never paste an ARN.
- No globally-unique hardcoded names. Let CDK generate physical names, or suffix them
  with the account/region.
- Region is a stack parameter, not a literal.

**Three steps IaC cannot do, required once per new account:**

1. `cdk bootstrap` for the target account and region.
2. Bedrock **model access** for Sonnet 4.6, plus Anthropic's one-time **First Time Use**
   form, and AWS Marketplace permission on the billing account. Console only — there is
   no API for this, and it gates the entire ranking stage.
3. Write the GitHub PAT into SSM Parameter Store. It is a secret, so it never lives in
   the repo and cannot be deployed.

Keep this list in the repo README as a bootstrap checklist — it is exactly the knowledge
that evaporates between the day the stack is written and the day the account changes.

---

## 3. Sources

All keyless and verified reachable on 2026-08-18.

| Category | Sources |
|---|---|
| `news` | TechCrunch AI, The Verge AI, Ars Technica AI, VentureBeat AI, MIT Technology Review |
| `lab` | OpenAI news RSS, Google DeepMind RSS, HuggingFace blog, Anthropic via Google News RSS `site:anthropic.com` |
| `community` | HN Algolia API (no key, 10k req/hr), Reddit RSS (the JSON endpoint 403s without OAuth) |
| `research` | HuggingFace Daily Papers JSON API |

**arXiv `cs.AI` is deliberately excluded.** It publishes ~268 items/day, which would
drown the feed and dominate the Bedrock token budget. HF Daily Papers covers the same
ground curated, at ~10-20 items/day.

**Anthropic has no official RSS feed** — re-verified 2026-08-18: `/rss.xml`, `/feed.xml`,
`/news/rss.xml`, `/atom.xml`, `/news/feed`, `/index.xml` all return 404. The Google News
fallback returns `news.google.com/rss/articles/...` wrapper URLs.

> **[revised]** The original design required resolving the wrapper to the publisher URL
> before hashing. **That is not buildable.** Measured 2026-08-18: following the wrapper with
> redirects enabled ends on `news.google.com` itself (1 redirect, HTTP 200, 579 KB), and the
> returned body contains **zero occurrences of `anthropic.com`** and no external publisher URL
> of any kind. The `CBMi…` id base64-decodes to an opaque 83-byte token, not a URL. Google now
> resolves the target **client-side in JavaScript** (the body carries four `location.href`
> assignments), so no server-side fetch can recover the publisher link.

Three consequences, each ruled on:

1. **Hashing.** Anthropic items are keyed by `titleHash(title, sourceName)`, not by the wrapper
   URL. The wrapper token is opaque and its multi-day stability is unproven — hashing it risks
   the same post being re-keyed onto a later day and **duplicated in the archive**, which is the
   exact failure `if_not_exists` on `ingestDay` exists to prevent. A title hash is deterministic,
   and its failure mode (two distinct posts sharing a title) collapses to a dedup, not a
   duplicate. This requires a per-source `hashStrategy: 'url' | 'title'`, defaulting to `'url'`.
2. **Outbound link.** The wrapper URL is kept as the article's `url`. It is degraded but not
   broken: a real browser follows the JavaScript hop and lands on the Anthropic post. The user
   pays one extra redirect.
3. **Do not drop the source.** Anthropic is a primary lab; losing it entirely is a worse product
   than an extra redirect hop.

**Follow-up (not v1):** scraping `anthropic.com/news` directly yields correct publisher URLs —
14 `/news/<slug>` anchors were extracted from the live page at HTTP 200 without JavaScript.
It is deferred because the surrounding text is positionally unreliable: on the same page one
card reads `Introducing Claude Opus 5 · Product · Jul 24, 2026` while the next reads
`Announcements · Jul 9, 2026 · Inviting hard questions` — title and date swap places between
adjacent items, so a positional parser would mis-title articles **silently**. That needs its own
task and its own tests, not a line in this one.

---

## 4. Data model

**Single DynamoDB table, on-demand billing.**

> **[revised]** The original design used provisioned capacity at 25 RCU / 25 WCU "to stay
> in the always-free tier." That is arithmetically impossible: the free allowance is
> 25 RCU + 25 WCU **per region per payer account, aggregated across tables and indexes**,
> and GSIs are provisioned separately with a 1/1 minimum. The base table alone consumes
> the whole allowance; at CDK's defaults two GSIs bring the total to 75/75, about
> **$28/month** — which would end the Free Plan early and trigger the account-closure risk.
> On-demand costs roughly **$0.15/month** at this volume and removes an entire class of
> throttling failures, including the one where an under-provisioned GSI throttles
> **base-table writes** and silently drops articles.

```
pk = ART#<urlHash>        sk = A
     urlHash = sha256(normalize(url))            <- hashStrategy 'url'  (default)
             | sha256(lower(title) + '|' + sourceName)   <- hashStrategy 'title' (Anthropic, see 3)
     normalize: lowercase host; strip utm_*, fbclid, gclid, mc_cid, mc_eid, igshid,
                ref, source, at_*; strip trailing slash; strip #:~:text= fragments

pk = META#DAY             sk = <YYYY-MM-DD>
     status ("complete" | "partial"), articleCount, runId, completedAt

pk = META#lastRun         sk = A
     startedAt, durationMs, llmStatus, itemsWritten, itemsFailed, errors[]
     perSourceCounts, filtered, quarantined      <- all three persisted, see below
```

**GSI1 — `feed-by-day`** (the only index)
- `gsi1pk = DAY#<ingestDay>`
- `gsi1sk = <score, 4-digit>#<urlHash>`
- Projection: **INCLUDE** of feed-card fields only — `title`, `summary`, `imageUrl`,
  `sourceName`, `category`, `publishedAt`, `clusterId`, `corroborationToday`, `whyItMatters`.
  Not `ALL`, which duplicates every field into the index and doubles per-write cost.
  **A GSI's projection cannot be changed after creation — the index must be recreated.
  Settle this before the first `cdk deploy`.**

> **[revised]** GSI2 (`CAT#<category>` / `publishedAt`) is dropped. It served no access
> pattern the app actually has: the primary view is ranked, not chronological, and the
> day's 100 items are already fetched, so category filtering is a client-side filter
> costing zero round trips. It only added write cost and storage.

### Item attributes

```
urlHash, url, title, summary, imageUrl
source, sourceName, category
publishedAt, publishedAtSource ('feed' | 'fallback'), firstSeenAt, ingestDay
clusterId, corroborationToday
llmImportance, whyItMatters
points, upvotes, pointsImputed
score, scoreVersion
hashVersion                  (which urlHash algorithm produced this key)
v                            (schema version, for future backfills)
```

### Writes are UpdateItem, never PutItem

> **[revised]** The original design used `PutItem` with a deterministic key and called it
> idempotent. The key choice is right; the write verb is not. `PutItem` replaces the
> **whole item**, which causes two kinds of permanent damage:
> 1. Articles linger in RSS feeds for days. A second day's write changes `ingestDay`,
>    which moves the GSI1 entry — **the article disappears from the first day's archive.**
>    That directly contradicts the goal of an accumulating archive.
> 2. On a degraded run (Bedrock unavailable) a re-ingested article's good `whyItMatters`,
>    `llmImportance`, and `clusterId` are **permanently destroyed**. The feed gets
>    quietly dumber and never recovers.

Two rules:
- `ingestDay`, `firstSeenAt`, `publishedAt` are written with `if_not_exists`. This pins
  the GSI1 partition for the life of the item and is the archive-integrity guarantee.
- **Never emit an attribute whose new value is null.** Build the `UpdateExpression` at
  runtime and omit the LLM fields entirely when that stage failed, so a degraded run
  refreshes volatile signals without touching enrichment.

> **[revised]** This section previously ended with "Capture writes use a conditional put
> (`attribute_not_exists(pk)`) so re-seeing an article costs a failed condition rather than a
> full item write." **That line is deleted.** It contradicted the rule directly above it — a
> conditional put that succeeds is still a whole-item replace, and one that fails never
> refreshes `points` — and, checked against AWS's documented on-demand billing, the
> optimisation **would not have saved money even if implemented.** It was left over from the
> pre-UpdateItem design. Hourly capture re-writing unchanged articles costs roughly
> $0.60-0.90/month in total, which is the real figure this section should have carried.

### Day derivation

`ingestDay` is derived **once**, in the capture path, from the run clock in
`Europe/Istanbul` via `Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' })`,
and persisted. **Readers never compute a date** — they follow the `META#DAY` pointer.
One shared helper, unit-tested at the 23:59 and 00:01 boundaries.

> **[revised]** The original design specified `Europe/Istanbul` on the Scheduler but left
> the day string underived. Lambda and Vercel both default to `TZ=UTC`, and Turkey is a
> constant UTC+3, so `new Date().toISOString().slice(0,10)` at 00:00 local stamps
> **the previous day**. The reader would query a partition that never exists. Not an edge
> case — it would have been wrong every single day.

### Key and cluster invariants

**`hashVersion` is mandatory on every item.** `urlHash` is a normalization pipeline — strip this
query parameter, lowercase that host — and any change to it silently re-keys every future write.
The archive would fork: the same article stored twice under two keys, with no way after the fact
to tell which items came from which algorithm. `hashVersion` starts at `1` and increments with
any normalization change; a backfill can then find every affected item. This attribute costs one
number per item and is the only thing that makes the key algorithm revisable at all.

**`clusterId` values beginning with `__self__:` are not clusters.** When the model returns no
cluster for an article, capture assigns `__self__:<urlHash>` rather than leaving the field blank.

> **[revised]** Blank cluster ids were originally left as empty strings. Every article the model
> failed to cluster then shared the id `""`, so they merged into one giant cluster — converting a
> *missing* signal into a *fabricated corroboration* signal that inflated `corroborationToday`
> and pushed unrelated articles up the ranking. The namespace prefix makes each one a singleton.

Consumers must honour this: `corroborationToday` is `1` for a `__self__:` item, and the UI shows
no cluster affordance for it. The prefix is reserved — a model-supplied id starting with
`__self__:` is treated as absent.

**Day partitions are bounded.** With 13 sources, a 7-day recency window and a 50-item per-source
cap, one day's GSI1 partition holds at most 650 items and in practice ~170. That is far inside
DynamoDB's 10 GB partition limit and one `Query` page, so the feed read stays a single round trip
and needs no pagination in v1. If sources are added, re-check this bound before assuming it holds.

### Access patterns

| Pattern | Query | Round trips |
|---|---|---|
| Home feed, N day sections | `META#DAY` desc limit N, then one GSI1 Query per day, concurrent | 1 + N |
| Archive calendar | `META#DAY` desc limit 60 | 1 |
| Specific day | GSI1 `DAY#<date>` desc, plus `META#DAY`/`<date>` | 2, issued together |
| Category filter | client-side over the fetched day | 0 |
| Cluster expansion | client-side over the fetched day | 0 |
| Search | see §8 | 1 |

The `META#DAY` item is written **last**, after all articles. Readers therefore never
observe a partially-written day, and a run that dies mid-way leaves a day marked
`partial` rather than silently truncated.

> **[revised]** "Specific day" was originally one round trip — the GSI query alone. It now
> also reads that day's `META#DAY` record, because a `/day/<date>` page that cannot see the
> record cannot tell a finished day from one whose run died mid-write, nor an empty day from
> a date before the archive begins. That distinction is the entire reason `META#DAY` is
> written last, so a reader that ignores it discards the guarantee this section just made.
> The two reads are issued together with `Promise.allSettled`, so the added cost is ~0.5 RCU
> and no added latency, and a transient failure on the metadata read degrades the page to
> "status unknown" instead of killing it. The record is fetched by key rather than through
> `listDays`, which reaches only 30 days back and would silently miss an older archived day.

> **[revised]** "Latest complete day" was a two-round-trip pattern: find the newest day whose
> status is `complete`, then Query it. The home feed no longer works that way. It renders **N
> day sections** (7 by default, up to 30), reading the newest N `META#DAY` records in one Query
> and then Querying each day's partition concurrently — `1 + N` round trips, 8 at the default.
>
> The "prefer complete" preference is gone deliberately, not by accident. It existed to pick the
> one best day to show; seven days each labelled with its own status tells a reader more than one
> day picked silently. `getLatestCompleteDay` was deleted once nothing called it. Only days with
> a `META#DAY` record appear at all, and that record is written last, so a day still being
> captured cannot leak into the feed unranked.

---

## 5. Scoring

```
score = 1000 * (
    0.30 * llmImportance / 100
  + 0.30 * sourceWeight              lab 1.0 | news 0.7 | research 0.6 | community 0.5
  + 0.15 * corroborationToday        min(clusterMembersToday / 5, 1)
  + 0.15 * pnorm                     log10(1 + points) / log10(501)
  + 0.10 * recency                   0.5 ^ (max(0, ageHours) / 24)
)
```

Weights live in one config file. `scoreVersion` records which weight set produced a score.
Raw signals are stored separately so weights can be re-tuned and scores recomputed
without re-calling Bedrock.

### Sort-key encoding — the highest-risk line in the codebase

```ts
const sk = String(Math.min(9999, Math.max(0, Math.round(score)))).padStart(4, '0')
         + '#' + urlHash
```

> **[revised]** The original design said "score, zero-padded to 4 digits" without
> specifying rounding. The score is a float: `String(814.4).padStart(4,'0')` is
> `"814.4"` — five characters, so padding never applies — and GSI sort keys compare
> **lexicographically**. Simulated over a realistic batch, the day's two *lowest*-scoring
> items land at positions 1 and 2 of the front page, every day, with no error anywhere.
> It would have read as "the LLM ranks badly" rather than as an encoding bug.
>
> `Math.round` and the clamp are both load-bearing: rounding gives fixed width, and the
> clamp prevents a future-dated feed item (`0.5^-2 = 4`) from exceeding 1000 and
> overflowing to five characters.

### `corroborationToday`, and why the weight came down

> **[revised]** This was `clusterSize` at weight 0.35, described as "how many sources
> covered this story." It cannot mean that. The LLM only sees one run's batch, so a story
> breaking at 23:50 is split: tonight one article, tomorrow four. True cluster size is
> five and neither day records it — and the lone article is usually the lab announcement
> itself, the highest-value item, which lands at the bottom of its day.
>
> Rather than build cross-run clustering (extra index, extra write pass, more complex
> prompt), the signal is renamed to what it actually measures and its weight cut from
> 0.35 to 0.15, with the freed 0.20 going to `sourceWeight`. An honest signal at 15%
> beats a misleading one at 35%.

`clusterId` is namespaced as `<ingestDay>#<slug>` so ids from different days cannot collide.
Ids the model did not supply are assigned `__self__:<urlHash>` by `reconcile` **before**
namespacing and are left un-prefixed — they already carry a unique hash, and the reserved
prefix is what marks them as non-clusters (§4). At the end of each run the day partition is re-read once and `corroborationToday`
recomputed for the whole day, making it consistent and idempotent under repeated
manual triggers.

### Missing-data handling

Every one of these is a silent-wrong-answer path if unhandled:

| Signal | Missing / bad value | Handling |
|---|---|---|
| `points` | null on every RSS source | **Impute `pnorm = 0.5`**, set `pointsImputed`. Treating null as 0 taxes exactly the highest-value sources — a lab announcement lost to a mid-tier HN post at equal importance. |
| `publishedAt` | absent in some Atom/malformed feeds | Fall back to `ingestedAt`; record `publishedAtSource`. `new Date(undefined)` yields `NaN`, and `String(NaN).padStart(4,'0')` is `"0NaN"`, which sorts **above** `"0999"`. |
| `publishedAt` | future-dated (wrong TZ offsets are common) | `ageHours = max(0, ageHours)` |
| `llmImportance` | out of range | Clamp to `[0,100]`. Structured-output schemas cannot enforce numeric ranges. |
| any GSI key attribute | undefined | **Never allow.** DynamoDB does not error — it silently omits the item from the index. An article with no `score` is stored, billed, and invisible in the primary view. |

Every normalized item is validated with Zod before writing. Failures are quarantined
and counted in `META#lastRun`, not written partially.

### Degraded mode (Bedrock unavailable)

Impute neutral values and **keep the weights fixed**: `corroborationToday = 1`,
`llmImportance = 50`, `scoreVersion = "v1-degraded"`. The next successful run backfills
items where `llmImportance` is null.

> **[revised]** The original design renormalized the surviving weights. That triples
> `points` (0.15 -> 0.43) and, since `points` is null on every RSS source, hands the top
> of the feed to Hacker News: **any HN item with 8 or more points outranks the day's
> biggest lab announcement.** Worse, on a Bedrock-failure day the raw LLM signals do not
> exist, so no later recompute can repair that day — without the backfill the damage
> is permanent.

---

## 6. Bedrock integration

One call per day, from `rank-lambda`.

```ts
import AnthropicBedrock from "@anthropic-ai/bedrock-sdk";   // default export

const client = new AnthropicBedrock({ awsRegion: "eu-central-1", maxRetries: 4 });

const stream = client.messages.stream({
  model: "global.anthropic.claude-sonnet-4-6",
  max_tokens: 32000,
  thinking: { type: "adaptive" },
  output_config: {
    effort: "medium",
    format: { type: "json_schema", schema: RANKING_SCHEMA },
  },
  messages: [{ role: "user", content: prompt }],
});

const msg = await stream.finalMessage();
if (msg.stop_reason === "max_tokens") throw new TruncationError();
const text = msg.content.find((b) => b.type === "text")?.text;
```

> **[revised]** The original design used `AnthropicBedrockMantle`. Verified against
> primary documentation: **Sonnet 4.6 is not on the Mantle endpoint** (its supported
> models are Fable 5, Opus 5, Opus 4.8, Opus 4.7, Sonnet 5, Haiku 4.5), and Mantle lists
> **structured outputs under "Features not supported."** The legacy `bedrock-runtime`
> path carries both Sonnet 4.6 and structured outputs, so legacy client + Sonnet 4.6 is
> the only combination that satisfies this design. Moving to a Mantle model to modernise
> the client would cost `output_config.format` and force prompt-and-parse.

> **[revised]** The model ID prefix is **mandatory**, not an EU-residency option —
> Sonnet 4.6 has no in-region on-demand availability outside eu-west-2, and a bare ID
> returns HTTP 400. Use `global.`: regional prefixes such as `eu.` carry a **10% pricing
> premium** and a single personal user has no data-residency requirement.

**Non-obvious details, each of which breaks something if missed:**

- `max_tokens` caps thinking **plus** response text. The original 3K output estimate was
  30 tokens per article; ~100 items with a one-sentence rationale each is realistically
  4.5-7K before thinking. Set 32000 and validate against a real batch before deploying.

  > **[revised]** The original instruction said to validate with `countTokens()`. **That does
  > not work on Bedrock, and it fails in the worst possible way.** Measured 2026-08-18: the
  > method is present and callable on `AnthropicBedrock`, does **not** throw, and RESOLVES with
  > `{"Output":{"__type":"com.amazon.coral.service#UnknownOperationException"},"Version":"1.0"}`
  > — an AWS error envelope handed back as though it were a successful response. So
  > `const { input_tokens } = await countTokens(...)` yields `undefined` and the caller carries
  > on. A missing method fails loudly; this fails plausibly, and no `typeof` guard detects it.
  > Validate instead from the `usage` field of one real ranking call, which the smoke script
  > runs once before the first scheduled run.
- **`stop_reason === "max_tokens"` branches separately** from a failed call. Truncation
  yields invalid JSON, which would otherwise be caught as a generic Bedrock failure and
  silently degrade the whole day, looking identical to an outage.
- `content[0]` is a **thinking block**, not text — `thinking.display` defaults to
  `"summarized"` on Sonnet 4.6. Always `content.find(b => b.type === "text")`.
- The schema carries **`urlHash` as a join key on every object**. `maxItems` is not
  supported, so the model cannot be forced to return all ~100 items. Reconcile returned
  ids against the input set: matched items take their values, unmatched get the neutral
  imputation, unknown ids are dropped, and all three counts go into `META#lastRun`.
- Structured-output grammars are compiled and cached for **24 hours**. A once-daily job
  sits exactly on that boundary, so budget for cold compilation on essentially every run.
- `effort: "medium"` rather than the `high` default: `high` on a 100-item clustering task
  runs 150-500 seconds, straddling the timeout. (`xhigh` does not exist on Sonnet 4.6.)
- Lambda timeout **900s**, with an explicit `AbortSignal` on the Bedrock call at ~600s.
  A Lambda timeout kills the execution environment with no catchable signal, so without
  the abort the degraded-mode fallback **cannot run at all**.

**Cost:** $3/MTok input, $15/MTok output on the global endpoint. Bedrock has **no
always-free allowance** — every call draws credit from day one, unlike Lambda, DynamoDB and
EventBridge.

> **[revised]** The original estimate of **$4.50-12.50/month** was too low. Recomputed
> independently against 200 articles at 300 summary characters, with `thinking` billed as
> output: **$10.50-16.50+/month** for Bedrock alone, plus ~$0.60-0.90 for DynamoDB under
> *hourly* capture (the original $0.15 figure appears to assume a daily job) and ~$0.50 for
> everything else. **Total: roughly $12-18/month.** Still inside the $20-30 ceiling, but with
> materially less headroom than first stated. The thinking-token component remains an
> estimate — it is the reason the range is wide, and why `countTokens()` validation against a
> real batch is required before the first scheduled run.

---

## 7. User interface

### Pages

```
/                    AI news — day sections, newest first
/design              Design news — the same, for the other vertical
/article/[urlHash]   story detail
/day/[date]          a single day, deep-linkable
/search              search
/api/ingest          trigger (POST)
```

> **[revised]** This section predated the second content vertical. Articles now carry a
> `section` (`"ai" | "design"`), and the two are **sibling destinations in a nav**, not a
> filter chip inside one feed. Reasons, in order of weight:
>
> 1. **They do not compete.** No design source qualifies as a `lab`, so design articles top
>    out at a 0.7 source weight while an AI lab announcement reaches 1.0. Interleaved in one
>    ranked list, design news would sit at the bottom by construction rather than by merit.
>    Separate destinations remove the question rather than answering it badly.
> 2. **Ranking already treats them separately.** The daily Bedrock call allocates its input
>    cap per section and scores importance *within* a section, so the scores were never
>    comparable across verticals in the first place.
> 3. **It costs no extra reads.** Both verticals live in the same `DAY#<date>` partition, so
>    one Query serves both and the nav switches a client-side filter — the same mechanism §4
>    already specifies for the category filter, at zero additional round trips.
>
> > **[revised]** Point 3 above describes an architecture the implementation did not take, and
> > is left in place so the change is visible rather than silently overwritten. The verticals
> > are separate **routes** (`/` and `/design`), not a client-side filter over one fetched day,
> > so switching verticals costs a fresh read of the day rather than zero. Points 1 and 2 are
> > unaffected and are the reasons that actually carry the decision.
> >
> > To be accurate about how this happened: the routes were specified by the implementation
> > plan, and no filter-versus-routes trade was weighed while building it. What follows is the
> > case for keeping them, not a record of a deliberation.
> >
> > A client-side filter needs the filter state in the browser, which makes the feed a client
> > component and pulls the card tree across that boundary. Separate routes also give each
> > vertical a real URL to link, bookmark and share, which a filter chip does not.
> >
> > What it costs: one `Query` per day rendered, plus the `META#DAY` list. **Not free** — §2's
> > table is explicit that on-demand DynamoDB has no free tier, and this revision originally
> > claimed otherwise, which is the misconception this document corrects in two other places.
> > At ~264 items/day of ~1.5 KB, an eventually-consistent Query reads ~400 KB ≈ 50 RRU **per
> > day section**. The ~$0.00001-per-page-view figure first written here assumed the feed
> > rendered one day; it renders seven, so the real cost is ~350 RRU (~$0.00005) at the default
> > and ~1,500 RRU (~$0.0002) at `?days=30`. Still negligible in dollars, which remains a
> > different claim from free. If traffic ever makes it matter, the fix is caching the day, not
> > merging the verticals.
>
> **The day-section count is per vertical.** `META#DAY.articleCount` is the total across both,
> so a header reading "23 stories" under the AI nav must be computed from the filtered list,
> not read from the meta item. Showing the combined count on a filtered feed would be a number
> that matches nothing on screen.
>
> A story's detail page is reachable from either vertical and does not change with it; the
> nav is a property of the feed, not of the article.

### The feed

The home page is a vertical list of **day sections**, newest first. Each section header
carries the date and that day's article count, read straight from `META#DAY.articleCount`
— the count is already stored, so the header costs nothing extra.

Within a section, cards are ordered by score descending, which is GSI1's sort order. The
most important story of each day sits at the top of its section.

Cards render from the GSI1 `INCLUDE` projection alone — `title`, `summary`, `imageUrl`,
`sourceName`, `category`, `publishedAt`, `corroborationToday`, `whyItMatters` — so a day
section costs exactly one Query with no per-card lookups. The initial load renders seven
day sections; older days load on demand, one Query each.

### Story detail

**We never fetch article bodies.** Feeds and APIs give a title, a summary or excerpt, and
a link. Fetching and storing publishers' full text is a different product on different
legal footing and is out of scope (§11).

The detail page is therefore a *story page*, not a reader view. It shows what we actually
know and then sends the reader to the source:

- Title, hero image, source, published time.
- The feed's own summary.
- `whyItMatters` — the model's one-line rationale. This is the thing the app adds that
  the reader cannot get from the feed itself, so it is given prominence, not a footnote.
- The signals behind the score — source weight, corroboration today, engagement where it
  exists — shown plainly, so the ranking is inspectable rather than magic. A reader who
  disagrees with the order should be able to see why the order is what it is.
- Other articles in the same cluster: "also covered by The Verge, Ars Technica", each
  linking to its own story page.
- A prominent link to the original article.

### Design direction

Visual design is left to implementation, with two constraints that come from the data
rather than from taste:

- **Cards must degrade gracefully.** `imageUrl` is absent on a large share of items (HN,
  research papers, several RSS feeds) and `whyItMatters` is absent on any degraded-mode
  day (§5). A card that only looks right with a hero image and a rationale will look
  broken on an ordinary day, so the imageless, rationale-less card is the layout to
  design first and the decorated one is the enhancement.
- **The run-status line from §8 belongs in the header**, not on a settings page. It is
  the only thing standing between the user and a pipeline that has been quietly broken
  for a week.

## 8. Durability, search, and monitoring

### Off-AWS backup

At the end of every ranking run, the day's items are written as NDJSON to a private
GitHub repository at `archive/YYYY/MM/DD.ndjson` (~150 KB/day, ~55 MB/year).

Written through the **GitHub Contents API** (`PUT /repos/{owner}/{repo}/contents/{path}`)
over plain HTTPS. Lambda has no `git` binary and no access to a developer's SSH key, so
`git push` is not an option. The fine-grained PAT lives in **SSM Parameter Store
SecureString** — free for standard parameters, where Secrets Manager charges $0.40 per
secret per month.

This exists because the Free Plan's expiry closes the account and deletes its data, and
the archive would otherwise have exactly one copy inside that account. **It must run from
day one** — the value of a backup is entirely in it having run before it was needed.

### Search

| Range | Source | Cost |
|---|---|---|
| Last 30 days | GSI1, one Query per day partition | ~30 queries |
| Older | the NDJSON exports | one HTTP GET per month, filtered in memory, zero DynamoDB reads |

> **[revised]** The original plan — query GSI1 across a date range and filter in the route
> handler — does not scale. A Query needs one exact partition key value, so a year-long
> search is 365 queries reading ~6,800 RCU, and a `FilterExpression` would not help:
> filters are applied *after* the read, so they cost the same capacity. The backup
> artifact doubles as the deep-search index, so one mechanism serves both needs.

Queries must handle `LastEvaluatedKey`. DynamoDB's 1 MB page limit applies before
filtering, and unhandled pagination silently returns partial results.

### Monitoring

Three things, all free, sized for a single-user project:

1. **`META#lastRun` surfaced in the UI header** —
   `last run 4h ago · 97 items · 13/13 sources · LLM ok`. This is the highest-value item:
   without it, a feed that starts 404ing or returning an HTML error page with HTTP 200 is
   indistinguishable from a quiet news day, and `Promise.allSettled` swallows it forever.

   > **[revised]** The original rule — "turns red when any source returns zero items on two
   > consecutive runs" — is wrong, and the 2026-08-18 dry run proved it by producing two
   > *different* zeroes at once: `venturebeat` produced 0 because all 7 of its items fell
   > outside the recency window (a healthy but slow feed), and `reddit-ml` produced 0 because
   > it was rate-limited with HTTP 429 (a transient fetch failure). Under the old rule both
   > would alarm identically, and so would a genuinely dead feed. An alarm that fires on
   > normal operation gets ignored within a week.

   Capture therefore persists three counters per source — `perSourceCounts` (produced),
   `filtered` (fetched, parsed, dropped by the recency window or the cap) and `quarantined`
   (fetched, parsed, rejected by the schema) — plus `errors[]`. These four separate the states
   that a single zero conflates:

   | produced | filtered | quarantined | error | state | surfaced as |
   |---|---|---|---|---|---|
   | >0 | any | 0 | no | healthy | normal |
   | 0 | >0 | 0 | no | quiet — nothing recent enough | grey, no alarm |
   | any | any | >0 | no | **parser or schema drift** | amber, always shown |
   | 0 | 0 | 0 | yes | fetch failed | amber; red on 2 consecutive runs |
   | 0 | 0 | 0 | no | **dead — feed returned nothing at all** | red on 2 consecutive runs |

   Only the last two rows can turn the header red, and only on two consecutive runs.
   `quarantined > 0` is never silent: it is the signature of a feed whose shape changed
   under us, which is the failure most likely to degrade the archive without anyone noticing.
2. **Two CloudWatch alarms → SNS → email:** Lambda `Errors >= 1`, and
   `Invocations < 1 over 25 hours` with `treatMissingData: breaching` — the second is
   what catches a silently stopped schedule.
3. **Two AWS Budget alarms**, plus calendar reminders for the Free Plan expiry and the
   90-day closure date. Thresholds are set against expected spend (§8, cost) rather than
   against zero: **$25/month** as the "higher than it should be" warning and **$40/month**
   as "something is wrong — go look". These were $15/$30 until the cost estimate was corrected
   upward; at a ~$16.30 worst case a $15 warning fires in a legitimate month. A $5 alarm would
   fire during normal operation and
   be ignored within a week, which is worse than no alarm. This is the only defense
   against the failure that destroys the product.

---

## 9. Security and IAM

**Lambda execution roles** (capture and rank, separately scoped):
- `dynamodb:UpdateItem` on the **table ARN only** — writes propagate to GSIs automatically
  and index ARNs are not needed for writes. A `Query` **against a GSI does need the index
  ARN**, so the rank role carries `.../index/feed-by-day` as a separate statement. `PutItem`
  is needed for the `META#*` snapshot items and is constrained by a `dynamodb:LeadingKeys`
  condition, so a compromised role cannot overwrite an article wholesale or forge `META#DAY`.
- `bedrock:InvokeModel` must carry a **`bedrock:InferenceProfileArn` condition**. Without it
  the foundation-model ARN in the resource list also authorises direct on-demand invocation of
  the bare model, bypassing the `global.` profile — the grant fails **open**, not closed.
- `bedrock:InvokeModel` (rank only) on the inference-profile ARN **plus the
  foundation-model ARN in every region the profile can route to**. Omitting those
  produces *intermittent* `AccessDeniedException` that fails only when a request happens
  to route to an unlisted region — the non-determinism is what pushes people to attach
  `AmazonBedrockFullAccess`. Write them out explicitly.
- `ssm:GetParameter` (rank only) on the single PAT parameter ARN.
- `logs:CreateLogStream`, `logs:PutLogEvents` on the function's own log group.

**Vercel IAM user:**
- `dynamodb:Query`, `GetItem` on the table + `index/*`. No `Scan`.
- `lambda:InvokeFunction` on the one capture function ARN.
- **No Bedrock permission and no DynamoDB write permission.**
- Vercel OIDC federation is the eventual upgrade; static keys are acceptable for v1
  only because their blast radius is now read-only plus one function invocation.

**`/api/ingest`:** secret header compared with `timingSafeEqual`, plus a per-day run
counter so a leaked secret caps out. If the UI gets a "refresh now" button, it calls a
Server Action holding the secret server-side — the secret must never reach the browser
bundle, where anyone opening devtools could burn the credit balance.

**Concurrency:** Lambda reserved concurrency of 1 plus a conditional-write lock item, so
a manual trigger and the schedule cannot interleave and produce two incompatible
clusterings in one day partition.

**Public reads:** the Vercel URL is public and the content is aggregated public news, so
there is no privacy concern — but day data is cached with Next.js `revalidate` so
repeated hits do not translate into DynamoDB reads.

**Other cost guards:** explicit `LogGroup` with one-month retention and
`removalPolicy: DESTROY` (CDK's implicit log group never expires); PITR left off;
no VPC — adding one for a function that only calls public HTTPS and AWS APIs would add
a NAT Gateway at roughly $32/month, instantly the largest line item on the account.

---

## 10. Testing

Vitest. No network in tests — feeds are replayed from saved fixtures.

**The sort-key property test is the single highest-value test in the project.** For any
array of scores, ordering by the generated sort-key string descending must equal ordering
by numeric score descending. Written first, this test catches the float-encoding bug on
the first run.

Also covered:
- Score formula: `points` imputation, `publishedAt` fallback, future-date clamp,
  degraded-mode neutral imputation.
- URL normalization and `urlHash` determinism — utm/gclid variants of one URL must
  produce one hash.
- Day-string derivation at the 23:59 and 00:01 Europe/Istanbul boundaries.
- Feed parsing against fixtures, including a feed that returns HTTP 200 with an HTML
  error body and one with no `pubDate`.
- LLM response reconciliation: missing ids, unknown ids, out-of-range importance,
  truncated JSON.

---

## 11. Explicitly out of scope for v1

- **Full article text.** We store what feeds and APIs hand us: title, summary, link.
  Fetching and storing publishers' article bodies is scraping — a different product with
  different legal footing. The story page (§7) links out instead.
- Read/unread state and favourites.
- Trend statistics and topic-over-time views.
- Cross-run semantic clustering (see §5 — `corroborationToday` is deliberately a
  within-day signal at a weight that reflects that).
- arXiv `cs.AI` ingestion (§3).
- Multi-user support and authentication.
- OpenSearch — its floor is roughly $700/month, which would consume the entire credit
  balance in under a week.
