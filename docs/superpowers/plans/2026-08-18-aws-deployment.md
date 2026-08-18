# ai-news — AWS Deployment Implementation Plan (Plan 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist captured articles to DynamoDB, rank them daily with one Bedrock call, and
deploy the whole thing as CDK infrastructure that can be re-created in any AWS account.

**Architecture:** Two Lambdas on EventBridge Scheduler — `capture` hourly, `rank` daily at
06:00 Europe/Istanbul. Both write to a single on-demand DynamoDB table with one GSI. Capture
scores every article in degraded mode so the feed is never empty; rank overwrites those scores
with LLM-informed ones. All infrastructure is CDK v2 in `infra/`, so moving accounts is
`cdk bootstrap && cdk deploy` against a different profile.

**Tech Stack:** TypeScript 5.9.3 (ESM), Node 24 local / `nodejs22.x` on Lambda, CDK v2,
`@aws-sdk/client-dynamodb` + `lib-dynamodb`, `@anthropic-ai/bedrock-sdk`, Vitest 4,
`aws-sdk-client-mock`, pnpm 10.

**Spec:** `docs/superpowers/specs/2026-08-18-ai-news-design.md` — read it. The spec is the
binding authority; where this plan and the spec disagree, the spec wins and the conflict is a
finding to report, not a judgment call to make silently.

**Depends on:** Plan 1 (`docs/superpowers/plans/2026-08-18-core-domain.md`), complete and
merged into `feat/core-domain`. Every pure function this plan calls already exists and is
tested — do not reimplement `computeScore`, `buildSortKey`, `istanbulDay`, `captureAll`,
`reconcile`, `urlHash`, or `titleHash`.

---

## Verified environment facts

These were measured on 2026-08-18 against the live account. They are inputs, not assumptions.
If any turns out false at implementation time, that is a finding — stop and report it.

| Fact | Value | How it was verified |
|---|---|---|
| AWS account | `356117015048` | `aws sts get-caller-identity` |
| Caller | IAM user `ozkan`, group `admin` | `aws iam list-groups-for-user` |
| Default region | `eu-central-1` | `aws configure get region` |
| Bedrock model | `global.anthropic.claude-sonnet-4-6` — **ACTIVE and invokable** | live `bedrock-runtime converse` returned `OK`, 12 in / 4 out tokens |
| CDK bootstrap | **absent** in eu-central-1 — must be bootstrapped first | `describe-stacks CDKToolkit` → `ValidationError` |
| DynamoDB tables | 0 | `list-tables` |
| CloudFormation stacks | 0 | `list-stacks` |
| Pre-existing Lambda | `HelloWorld` (python3.12, unrelated) — **do not touch, do not alarm on it** | `list-functions` |
| Pre-existing budgets | `My Zero-Spend Budget` ($1), `My Monthly Cost Budget 10USD` ($10) | `describe-budgets` |

> **The $1 zero-spend budget will fire during normal operation.** Bedrock has no always-free
> tier, so the first ranked day breaches it. This plan does **not** delete or modify either
> existing budget — they belong to the account owner. Task 9 adds the spec's $15/$30 budgets
> alongside them and the runbook flags the conflict for the owner to resolve.

---

## Global Constraints

Copied from the spec. Every task's requirements implicitly include this section.

- **ESM everywhere.** `"type": "module"`. Source imports use a `.js` extension even when the
  file on disk is `.ts` (`import { computeScore } from "../core/score.js"`). Tests do the same.
- **Node:** local Node 24.16.0; Lambda runtime `nodejs22.x`. If a newer GA Node runtime exists
  at implementation time, using it is fine — record the change. Never go below `nodejs22.x`.
- **Region `eu-central-1`, account `356117015048`.** Never hardcode either in application
  code; both come from CDK context or environment variables so the stack is portable.
- **Bedrock model id is exactly `global.anthropic.claude-sonnet-4-6`.** The `global.` prefix is
  mandatory — `eu.` is a different inference profile and costs ~10% more.
- **DynamoDB is on-demand (`PAY_PER_REQUEST`).** Never provisioned. The spec explains why at
  length: provisioned capacity at this shape costs ~$28/month and can end the Free Plan early.
- **Writes are `UpdateItem`, never `PutItem`.** `ingestDay`, `firstSeenAt`, `publishedAt`,
  `hashVersion` and `gsi1pk` are written with `if_not_exists`. Never emit an attribute whose
  new value is null.
- **No secrets in the repository, ever.** The GitHub PAT lives in SSM Parameter Store as a
  `SecureString`. No token, key, or account-specific ARN is committed.
- **No `console.log` of article URLs with query strings, tokens, or any SSM value.**
- **Every AWS call in a unit test is mocked** (`aws-sdk-client-mock`). No test may reach the
  network. No test may call Bedrock.
- **No `cdk deploy` from any task in this plan.** Tasks synthesize and test; deployment is a
  human-run step in the Task 10 runbook. `cdk synth` is allowed and expected.
- **Never merge, never push to a shared branch.** Commits on the working branch only.

---

## File Structure

```
src/
  lib/
    store/
      keys.ts          pk/sk/gsi1 builders — pure, no SDK import
      articles.ts      buildCaptureUpdate / buildRankUpdate -> UpdateCommandInput
      meta.ts          buildLastRunPut / buildDayMetaPut
      client.ts        the one DynamoDBDocumentClient, created lazily
      query.ts         queryDay / listDays / getLatestCompleteDay
    rank/
      bedrock.ts       the single Bedrock call: prompt, tool schema, streaming
      prompt.ts        prompt + tool schema as data, so it is testable without AWS
      backup.ts        NDJSON export to GitHub via the Contents API
      reconcile.ts     (exists, Plan 1)
    ingest/
      sources.ts       (exists) gains hashStrategy
      capture.ts       (exists) honours hashStrategy
  lambda/
    capture.ts         handler: captureAll -> degraded score -> store -> META#lastRun
    rank.ts            handler: read day -> Bedrock -> reconcile -> score -> store -> META#DAY
infra/
  bin/ai-news.ts       CDK app entry
  lib/table.ts         DynamoDB table + GSI1
  lib/functions.ts     both NodejsFunctions, their IAM, and the schedules
  lib/monitoring.ts    SNS topic, CloudWatch alarms, AWS Budgets
  lib/ai-news-stack.ts composes the three above
  cdk.json
tests/
  store/…  rank/…  lambda/…  infra/…
scripts/
  smoke.ts             post-deploy verification, read-only
docs/
  RUNBOOK.md           deploy, rollback, and account-migration steps
```

Rationale for the split: `store/` is pure command-building plus one thin client, so every
write shape is unit-testable without a network or a mock server. `infra/` mirrors it —
one file per concern, each small enough to review as a unit. `lambda/` holds only wiring;
if a handler grows past ~120 lines it is doing work that belongs in `lib/`.

---

### Task 1: Google News source hardening (`hashStrategy` + title cleanup)

Carries spec §3's Anthropic ruling into code. Today every article is keyed by
`urlHash(normalizeUrl(url))`, so Anthropic articles are keyed by an opaque Google News
wrapper token whose multi-day stability is unproven — if it drifts, the same post is
re-keyed onto a later day and **duplicated in the archive**. `titleHash` already exists and
is tested but is unreachable, because the wrapper is a valid http URL so `urlHash` always wins.

**Switching to a title hash is not safe on its own.** The live feed was read on 2026-08-18
and has three defects that only matter once the title becomes the primary key:

| # | Observed in the live feed (11 items) | Consequence |
|---|---|---|
| a | Every title carries a publisher suffix: `How Claude's text watermarking works - Anthropic`, `… - Alignment Science Blog`, `… - www-cdn.anthropic.com` | Display noise, and the key depends on Google's publisher labelling |
| b | One item's title is literally `" - Anthropic"` — an empty title plus the suffix | **Every** future degenerate item hashes identically and they silently overwrite each other |
| c | `site:anthropic.com` matches subdomains, so two `www-cdn.anthropic.com` PDF fragments arrived as articles (one titled `than two thirds of the zeros of the riemann zeta function are simple and on the critical line`) | Junk in the feed |

(b) is why this task is bigger than one field. Do not implement the hash switch without the
suffix strip and the degenerate-title quarantine — the switch alone converts a cosmetic
problem into article loss.

**Files:**
- Modify: `src/lib/ingest/sources.ts`, `src/lib/ingest/capture.ts`
- Create: `src/lib/ingest/title.ts`
- Test: `tests/ingest/title.test.ts`, `tests/ingest/sources.test.ts`, `tests/ingest/capture.test.ts`

**Interfaces:**
- Consumes: `titleHash(title, sourceName)`, `urlHash(normalized)` from `src/lib/core/url.js`
- Produces:
  - `SourceDef.hashStrategy?: "url" | "title"` (absent means `"url"`)
  - `SourceDef.publisherSuffix?: boolean` (absent means false)
  - `stripPublisherSuffix(title: string): string` from `src/lib/ingest/title.js`

- [ ] **Step 1: Write the failing tests for `stripPublisherSuffix`**

Create `tests/ingest/title.test.ts`. Every input below is a real title from the live feed:

```ts
import { describe, expect, it } from "vitest";
import { stripPublisherSuffix } from "../../src/lib/ingest/title.js";

describe("stripPublisherSuffix", () => {
  it("removes the publisher label Google News appends", () => {
    expect(stripPublisherSuffix("How Claude's text watermarking works - Anthropic"))
      .toBe("How Claude's text watermarking works");
    expect(stripPublisherSuffix("Introducing the Conceptual Reasoning Index - Alignment Science Blog"))
      .toBe("Introducing the Conceptual Reasoning Index");
  });

  it("removes only the last segment, so a title containing a dash survives", () => {
    expect(stripPublisherSuffix("GPT-5 - what actually changed - Anthropic"))
      .toBe("GPT-5 - what actually changed");
    expect(stripPublisherSuffix("Claude 3.5 Sonnet - Anthropic")).toBe("Claude 3.5 Sonnet");
  });

  it("returns an empty string for a title that is nothing but a suffix", () => {
    // The exact degenerate item observed on 2026-08-18. Empty is the signal to quarantine.
    expect(stripPublisherSuffix(" - Anthropic")).toBe("");
  });

  it("leaves a title with no suffix untouched", () => {
    expect(stripPublisherSuffix("OpenAI ships GPT-6")).toBe("OpenAI ships GPT-6");
    expect(stripPublisherSuffix("Well-tuned models")).toBe("Well-tuned models");
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run tests/ingest/title.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write `src/lib/ingest/title.ts`**

```ts
/**
 * Removes the ` - <Publisher>` label Google News appends to every title.
 *
 * Splits on the LAST " - " so a title that legitimately contains a dash keeps it
 * ("GPT-5 - what actually changed - Anthropic" -> "GPT-5 - what actually changed").
 *
 * Returns "" when nothing precedes the suffix. That is not a degenerate edge case to
 * paper over — the live feed carried exactly one such item on 2026-08-18 (" - Anthropic",
 * an article whose real title was empty). Callers MUST treat "" as a quarantine signal:
 * with hashStrategy "title" every empty-titled item hashes to the same key and they
 * overwrite each other silently.
 */
export function stripPublisherSuffix(title: string): string {
  const i = title.lastIndexOf(" - ");
  return i === -1 ? title : title.slice(0, i).trim();
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm vitest run tests/ingest/title.test.ts`
Expected: PASS, all 4.

- [ ] **Step 5: Write the failing registry and capture tests**

In `tests/ingest/sources.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { SOURCES } from "../../src/lib/ingest/sources.js";

describe("hashStrategy", () => {
  it("uses the title strategy for the Google News wrapped source", () => {
    const anthropic = SOURCES.find((s) => s.id === "anthropic");
    expect(anthropic?.hashStrategy).toBe("title");
    expect(anthropic?.publisherSuffix).toBe(true);
  });

  it("leaves every directly-fetched source on the url strategy", () => {
    for (const s of SOURCES.filter((s) => s.id !== "anthropic")) {
      expect(s.hashStrategy ?? "url").toBe("url");
      expect(s.publisherSuffix ?? false).toBe(false);
    }
  });
});
```

In `tests/ingest/capture.test.ts` — read the file first and reuse its existing helper for
stubbing the other twelve sources rather than inventing a new one:

```ts
const gnewsFeed = (title: string, link: string) =>
  `<?xml version="1.0"?><rss version="2.0"><channel><item>` +
  `<title>${title}</title><link>${link}</link>` +
  `<pubDate>Mon, 18 Aug 2026 09:00:00 GMT</pubDate></item></channel></rss>`;

const runAnthropic = async (title: string, link: string) =>
  await captureAll({
    now: new Date("2026-08-18T12:00:00Z"),
    fetchText: async (url) =>
      url.includes("news.google.com") ? gnewsFeed(title, link) : emptyFeedFor(url),
  });

it("keys a title-strategy source by title, so a changed wrapper url does not re-key it", async () => {
  const a = (await runAnthropic("Anthropic ships a thing - Anthropic",
    "https://news.google.com/rss/articles/AAA")).articles.find((x) => x.source === "anthropic");
  const b = (await runAnthropic("Anthropic ships a thing - Anthropic",
    "https://news.google.com/rss/articles/BBB")).articles.find((x) => x.source === "anthropic");

  expect(a).toBeDefined();
  expect(b).toBeDefined();
  expect(b!.urlHash).toBe(a!.urlHash);                                  // same story, same key
  expect(b!.url).toBe("https://news.google.com/rss/articles/BBB");      // url still refreshes
});

it("strips the publisher suffix from the stored title", async () => {
  const r = await runAnthropic("Anthropic ships a thing - Anthropic",
    "https://news.google.com/rss/articles/AAA");
  expect(r.articles.find((x) => x.source === "anthropic")!.title)
    .toBe("Anthropic ships a thing");
});

it("quarantines an item whose title is nothing but the publisher suffix", async () => {
  // Observed live 2026-08-18. Without this, every such item hashes identically under
  // hashStrategy "title" and they silently overwrite one another.
  const r = await runAnthropic(" - Anthropic", "https://news.google.com/rss/articles/AAA");
  expect(r.articles.filter((x) => x.source === "anthropic")).toHaveLength(0);
  expect(r.quarantined.anthropic).toBe(1);
});

it("drops CDN fragments that site: matched on a subdomain", async () => {
  const r = await runAnthropic("some pdf text - www-cdn.anthropic.com",
    "https://news.google.com/rss/articles/CCC");
  expect(r.articles.filter((x) => x.source === "anthropic")).toHaveLength(0);
});
```

- [ ] **Step 6: Run to verify they fail**

Run: `pnpm vitest run tests/ingest/sources.test.ts tests/ingest/capture.test.ts`
Expected: FAIL on all five new assertions.

- [ ] **Step 7: Extend the registry**

In `src/lib/ingest/sources.ts`:

```ts
export interface SourceDef {
  id: string;
  name: string;
  kind: SourceKind;
  category: Category;
  url: string;
  maxItems?: number;
  /**
   * How this source's primary key is derived. Defaults to "url".
   *
   * "title" exists for exactly one reason: Google News wrapper links. Spec §3 records the
   * measurement — the wrapper cannot be resolved to a publisher URL server-side (Google
   * resolves it in client-side JavaScript), and the wrapper token is opaque, so hashing it
   * risks re-keying the same article onto a later day and duplicating it in the archive.
   * A title hash is deterministic; its failure mode (two posts sharing a title) collapses
   * to a dedup rather than a duplicate, which is the safe direction.
   *
   * Requires publisherSuffix handling — see below. Do not set one without the other.
   */
  hashStrategy?: "url" | "title";
  /**
   * This source's titles carry a trailing " - <Publisher>" label that must be stripped
   * before the title is stored or hashed, and whose removal can leave nothing behind.
   */
  publisherSuffix?: boolean;
}
```

and on the anthropic entry only:

```ts
  { id: "anthropic", name: "Anthropic", kind: "rss", category: "lab",
    hashStrategy: "title", publisherSuffix: true,
    url: "https://news.google.com/rss/search?q=site:anthropic.com&hl=en-US&gl=US&ceid=US:en" },
```

- [ ] **Step 8: Honour all three rules in capture**

In `src/lib/ingest/capture.ts`. Read the surrounding code first and match its existing
variable names — the snippets below are shaped to the current structure, not copied from it.

Before an item is turned into an article, when `src.publisherSuffix` is set:

```ts
// Google News appends " - <Publisher>" to every title and sometimes appends nothing else.
// Both the stored title and the hash must see the cleaned form.
const rawTitle = item.title;
const cleanedTitle = src.publisherSuffix ? stripPublisherSuffix(rawTitle) : rawTitle;

// A site: query matches subdomains, so anthropic.com's CDN turns PDF fragments into
// "articles". The publisher label is the only place that origin survives.
if (src.publisherSuffix && /\s-\s(?:[a-z0-9-]+\.)*www-cdn\.[a-z0-9.-]+$/i.test(rawTitle)) {
  // dropped as out of scope, not quarantined — nothing is broken, it is simply not news
  filteredCount += 1;
  continue;
}

// Empty after stripping means the feed gave no title at all. Under hashStrategy "title"
// every such item hashes identically, so letting one through silently destroys the next.
if (cleanedTitle.length === 0) {
  quarantinedCount += 1;
  continue;
}
```

Then the hash selection:

```ts
// An explicit "title" strategy wins outright (spec §3). Otherwise prefer the url, and
// fall back to the title for links that are not http(s) at all.
const hash =
  src.hashStrategy === "title" || !isHttp(normalized)
    ? titleHash(cleanedTitle, src.name)
    : urlHash(normalized);
```

and `cleanedTitle` is what goes into the `NormalizedArticle`.

- [ ] **Step 9: Run the full suite and the live dry run**

Run: `pnpm test && pnpm typecheck`
Expected: all pass.

Run: `pnpm dry-run`
Expected: the anthropic rows no longer show a `- Anthropic` suffix in the ranked titles, no
`www-cdn.anthropic.com` entries appear, and `quarantined` for anthropic is `1` on a day the
degenerate item is present. Record the actual numbers in the task report — the point of this
step is to look at the output as a reader would, which is how these three defects were found
in the first place.

- [ ] **Step 10: Commit**

```bash
git add src/lib/ingest tests/ingest
git commit -m "feat: key Google News sources by a cleaned title, not the wrapper url"
```

---

### Task 2: DynamoDB store layer

Every write shape the system will ever perform, built as **pure functions returning command
input objects**. No task in this plan calls DynamoDB from a unit test; they assert on the
`UpdateExpression` and values instead. This is what makes the two rules in spec §4 —
`if_not_exists` on the archive-pinning fields, and never emitting a null attribute —
testable rather than aspirational.

**Files:**
- Create: `src/lib/store/keys.ts`, `src/lib/store/expression.ts`, `src/lib/store/articles.ts`,
  `src/lib/store/meta.ts`, `src/lib/store/client.ts`, `src/lib/store/query.ts`
- Test: `tests/store/articles.test.ts`, `tests/store/meta.test.ts`, `tests/store/query.test.ts`

**Interfaces:**
- Consumes: `NormalizedArticle` from `src/types/article.js`; `buildSortKey` from
  `src/lib/core/sortKey.js`
- Produces:
  - `buildCaptureUpdate(tableName: string, input: CaptureWriteInput): UpdateCommandInput`
  - `buildRankUpdate(tableName: string, input: RankWriteInput): UpdateCommandInput`
  - `buildDayMetaPut(tableName: string, input: DayMeta): PutCommandInput`
  - `buildLastRunPut(tableName: string, input: LastRun): PutCommandInput`
  - `queryDay(client, tableName, day): Promise<FeedItemRecord[]>`
  - `listDays(client, tableName, limit): Promise<DayMeta[]>`
  - `getLatestCompleteDay(client, tableName): Promise<DayMeta | null>`
  - `HASH_VERSION = 1`

- [ ] **Step 1: Install the dependencies**

```bash
pnpm add @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb
pnpm add -D aws-sdk-client-mock
```

Commit the lockfile change with the task's final commit, not separately.

Only the core package. `aws-sdk-client-mock-vitest` supplies custom matchers
(`toHaveReceivedCommandWith` and friends) that nothing in this plan uses — every assertion
below reads `ddb.commandCalls(...)` directly. An unused dependency in a Lambda project is not
free: it is one more thing to audit and update, and the reason it was added would be invisible
to the next reader.

- [ ] **Step 2: Write the failing tests for `buildCaptureUpdate`**

Create `tests/store/articles.test.ts`. These assertions are the point of the whole task —
each one names a spec rule and fails loudly if the rule is broken:

```ts
import { describe, expect, it } from "vitest";
import { buildCaptureUpdate, buildRankUpdate } from "../../src/lib/store/articles.js";
import type { NormalizedArticle } from "../../src/types/article.js";

const HASH = "a".repeat(64);

const article: NormalizedArticle = {
  urlHash: HASH,
  url: "https://example.com/post",
  title: "A title",
  summary: "A summary",
  imageUrl: "https://example.com/i.png",
  source: "techcrunch",
  sourceName: "TechCrunch",
  category: "news",
  publishedAt: "2026-08-18T09:00:00.000Z",
  publishedAtSource: "feed",
  points: 42,
};

const base = {
  article,
  ingestDay: "2026-08-18",
  score: 814,
  scoreVersion: "v1-degraded",
  now: "2026-08-18T12:00:00.000Z",
};

/** Every attribute name is aliased, so read them back through the alias map. */
function attrs(cmd: { UpdateExpression?: string; ExpressionAttributeNames?: Record<string, string>; ExpressionAttributeValues?: Record<string, unknown> }) {
  const out: Record<string, { value: unknown; guarded: boolean }> = {};
  for (const [alias, name] of Object.entries(cmd.ExpressionAttributeNames ?? {})) {
    const m = new RegExp(`${alias} = (if_not_exists\\(${alias}, )?(:v\\d+)\\)?`).exec(cmd.UpdateExpression ?? "");
    if (m) out[name] = { value: cmd.ExpressionAttributeValues?.[m[2]!], guarded: Boolean(m[1]) };
  }
  return out;
}

describe("buildCaptureUpdate", () => {
  it("addresses the item by its deterministic key", () => {
    const cmd = buildCaptureUpdate("t", base);
    expect(cmd.TableName).toBe("t");
    expect(cmd.Key).toEqual({ pk: `ART#${HASH}`, sk: "A" });
  });

  it("guards the archive-pinning fields with if_not_exists", () => {
    const a = attrs(buildCaptureUpdate("t", base));
    for (const field of ["ingestDay", "firstSeenAt", "publishedAt", "hashVersion", "gsi1pk"]) {
      expect(a[field], `${field} must be present`).toBeDefined();
      expect(a[field]!.guarded, `${field} must use if_not_exists`).toBe(true);
    }
  });

  it("does NOT guard the fields that must stay fresh", () => {
    const a = attrs(buildCaptureUpdate("t", base));
    for (const field of ["title", "summary", "url", "points"]) {
      expect(a[field], `${field} must be present`).toBeDefined();
      expect(a[field]!.guarded, `${field} must be overwritten every run`).toBe(false);
    }
  });

  it("never reverts an already-ranked article's score back to the degraded one", () => {
    // Capture runs hourly and always scores in degraded mode. Overwriting score/gsi1sk would
    // move a ranked article back down the feed an hour after it was ranked.
    const a = attrs(buildCaptureUpdate("t", base));
    for (const field of ["score", "scoreVersion", "gsi1sk"]) {
      expect(a[field], `${field} must be present`).toBeDefined();
      expect(a[field]!.guarded, `${field} must use if_not_exists`).toBe(true);
    }
  });

  it("pins the day partition so a re-seen article never leaves its first day", () => {
    const a = attrs(buildCaptureUpdate("t", base));
    expect(a.gsi1pk!.value).toBe("DAY#2026-08-18");
    expect(a.gsi1pk!.guarded).toBe(true);
  });

  it("encodes the sort key zero-padded so lexicographic order is numeric order", () => {
    const a = attrs(buildCaptureUpdate("t", { ...base, score: 7 }));
    expect(a.gsi1sk!.value).toBe(`0007#${HASH}`);
  });

  it("omits null attributes entirely rather than writing null", () => {
    const cmd = buildCaptureUpdate("t", {
      ...base,
      article: { ...article, imageUrl: null, points: null },
    });
    const a = attrs(cmd);
    expect(a.imageUrl).toBeUndefined();
    expect(a.points).toBeUndefined();
    expect(JSON.stringify(cmd.ExpressionAttributeValues)).not.toContain("null");
  });

  it("stamps hashVersion so the key algorithm stays revisable", () => {
    expect(attrs(buildCaptureUpdate("t", base)).hashVersion!.value).toBe(1);
  });
});

describe("buildRankUpdate", () => {
  const rank = {
    urlHash: HASH,
    llmImportance: 88,
    whyItMatters: "Because.",
    clusterId: "c1",
    corroborationToday: 3,
    score: 912,
    scoreVersion: "v1",
  };

  it("refuses to create an item that capture never wrote", () => {
    const cmd = buildRankUpdate("t", rank);
    expect(cmd.ConditionExpression).toContain("attribute_exists");
  });

  it("moves the item within its day by rewriting only the sort key", () => {
    const a = attrs(buildRankUpdate("t", rank));
    expect(a.gsi1sk!.value).toBe(`0912#${HASH}`);
    expect(a.gsi1pk).toBeUndefined();   // the day partition is never touched by ranking
  });

  it("omits enrichment fields the model did not supply, leaving prior values intact", () => {
    const a = attrs(buildRankUpdate("t", { ...rank, llmImportance: null, whyItMatters: null }));
    expect(a.llmImportance).toBeUndefined();
    expect(a.whyItMatters).toBeUndefined();
    expect(a.score).toBeDefined();      // the score still updates
  });

  it("writes no sort key when there is no score, so enrichment cannot move the item", () => {
    // The enrichment pass runs before scoring. A gsi1sk built from a null score would move the
    // article to an arbitrary position in the day, visible to any reader in between.
    const a = attrs(buildRankUpdate("t", { ...rank, score: null, scoreVersion: null }));
    expect(a.gsi1sk).toBeUndefined();
    expect(a.llmImportance).toBeDefined();
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `pnpm vitest run tests/store/articles.test.ts`
Expected: FAIL — module `src/lib/store/articles.ts` does not exist.

- [ ] **Step 4: Write `keys.ts` and `expression.ts`**

`src/lib/store/keys.ts`:

```ts
/** Spec §4. Every key string in the system is built here and nowhere else. */
export const ARTICLE_SK = "A";
export const DAY_META_PK = "META#DAY";
export const LAST_RUN_PK = "META#lastRun";
export const LAST_RUN_SK = "A";

/** Bumped by any change to the urlHash normalization pipeline. Spec §4. */
export const HASH_VERSION = 1;

/** Current item schema version, for future backfills. */
export const SCHEMA_VERSION = 1;

export const articleKey = (urlHash: string) => ({ pk: `ART#${urlHash}`, sk: ARTICLE_SK });
export const dayPartition = (ingestDay: string) => `DAY#${ingestDay}`;
```

`src/lib/store/expression.ts` — the reason this exists is not elegance. DynamoDB reserves
`source`, `status`, `name`, `count` and about 570 other words, and an unaliased reserved word
fails at runtime with a `ValidationException`, not at compile time. Aliasing everything makes
that class of bug unreachable:

```ts
/**
 * Accumulates a DynamoDB SET expression with every attribute name aliased.
 *
 * Two invariants, both from spec §4:
 *   - null/undefined values are dropped, never written. A degraded run must refresh what it
 *     knows without destroying enrichment it does not know.
 *   - `setIfAbsent` emits `if_not_exists`, which is what pins an article to the first day it
 *     was seen. Without it a second day's write moves the GSI1 entry and the article
 *     disappears from the earlier day's archive.
 */
export function updateBuilder() {
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {};
  const sets: string[] = [];
  let n = 0;

  const alias = (attr: string, value: unknown) => {
    const nk = `#n${n}`;
    const vk = `:v${n}`;
    n += 1;
    names[nk] = attr;
    values[vk] = value;
    return { nk, vk };
  };

  return {
    set(attr: string, value: unknown) {
      if (value === null || value === undefined) return;
      const { nk, vk } = alias(attr, value);
      sets.push(`${nk} = ${vk}`);
    },
    setIfAbsent(attr: string, value: unknown) {
      if (value === null || value === undefined) return;
      const { nk, vk } = alias(attr, value);
      sets.push(`${nk} = if_not_exists(${nk}, ${vk})`);
    },
    build() {
      if (sets.length === 0) throw new Error("updateBuilder: refusing to build an empty update");
      return {
        UpdateExpression: `SET ${sets.join(", ")}`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
      };
    },
  };
}
```

- [ ] **Step 5: Write `articles.ts`**

```ts
import type { PutCommandInput, UpdateCommandInput } from "@aws-sdk/lib-dynamodb";
import { buildSortKey } from "../core/sortKey.js";
import type { NormalizedArticle } from "../../types/article.js";
import { HASH_VERSION, SCHEMA_VERSION, articleKey, dayPartition } from "./keys.js";
import { updateBuilder } from "./expression.js";

export interface CaptureWriteInput {
  article: NormalizedArticle;
  ingestDay: string;
  score: number;
  scoreVersion: string;
  /** From `computeScore`. Spec §4 lists it as an item attribute; without it a projected
   *  `points` cannot be told apart from an imputed one. */
  pointsImputed: boolean;
  now: string;
}

export function buildCaptureUpdate(tableName: string, input: CaptureWriteInput): UpdateCommandInput {
  const { article: a, ingestDay, score, scoreVersion, pointsImputed, now } = input;
  const b = updateBuilder();

  // Pinned once, for the life of the item. These four are the archive-integrity guarantee.
  b.setIfAbsent("ingestDay", ingestDay);
  b.setIfAbsent("firstSeenAt", now);
  b.setIfAbsent("publishedAt", a.publishedAt);
  b.setIfAbsent("hashVersion", HASH_VERSION);
  b.setIfAbsent("gsi1pk", dayPartition(ingestDay));

  // Refreshed every run.
  b.set("url", a.url);
  b.set("title", a.title);
  b.set("summary", a.summary);
  b.set("imageUrl", a.imageUrl);
  b.set("source", a.source);
  b.set("sourceName", a.sourceName);
  b.set("category", a.category);
  b.set("publishedAtSource", a.publishedAtSource);
  b.set("points", a.points);
  // Persisted, not just computed. computeScore already returns it and spec §4 lists it as an
  // item attribute; it is what stops the UI from presenting an imputed 0.5 as a measurement.
  b.set("pointsImputed", pointsImputed);
  b.set("v", SCHEMA_VERSION);

  // setIfAbsent, NOT set. Capture runs hourly and its score is always the DEGRADED one, so
  // overwriting here reverts the rank position of every article ranked earlier that day --
  // enrichment survives (it is omitted-when-null) but the ORDERING does not, which is the
  // half of the archive invariant that is visible to the reader. Feeds carry items for days;
  // this is routine, not an edge case.
  //
  // The tradeoff: an unranked article's recency term stops decaying between captures. That is
  // acceptable because rank recomputes every score daily even when Bedrock is down, so no
  // score stays frozen longer than 24 hours.
  b.setIfAbsent("score", score);
  b.setIfAbsent("scoreVersion", scoreVersion);
  b.setIfAbsent("gsi1sk", buildSortKey(score, a.urlHash));

  return { TableName: tableName, Key: articleKey(a.urlHash), ...b.build() };
}

export interface RankWriteInput {
  urlHash: string;
  llmImportance: number | null;
  whyItMatters: string | null;
  clusterId: string | null;
  corroborationToday: number | null;
  /** Null in the enrichment phase, which writes model output without touching the ordering. */
  score: number | null;
  scoreVersion: string | null;
}

export function buildRankUpdate(tableName: string, input: RankWriteInput): UpdateCommandInput {
  const b = updateBuilder();
  b.set("llmImportance", input.llmImportance);
  b.set("whyItMatters", input.whyItMatters);
  b.set("clusterId", input.clusterId);
  b.set("corroborationToday", input.corroborationToday);
  b.set("score", input.score);
  b.set("scoreVersion", input.scoreVersion);
  // Only when there is a score to encode. The rank handler writes enrichment first and scores
  // second (spec §5's re-read pass), and the first write must not move the item in the index
  // using a sort key built from a null.
  if (input.score !== null) b.set("gsi1sk", buildSortKey(input.score, input.urlHash));

  return {
    TableName: tableName,
    Key: articleKey(input.urlHash),
    // The model can return a hash that was never captured. reconcile() reports those as
    // `unknown`, but this condition is what guarantees one can never materialise as a
    // half-built item with a score and no title.
    ConditionExpression: "attribute_exists(pk)",
    ...b.build(),
  };
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm vitest run tests/store/articles.test.ts`
Expected: PASS, all 9.

- [ ] **Step 7: Write `meta.ts` with its tests**

`src/lib/store/meta.ts` — these are whole-item snapshots, so `PutCommand` is correct here
(unlike articles, where it would destroy history):

```ts
import type { PutCommandInput } from "@aws-sdk/lib-dynamodb";
import { DAY_META_PK, LAST_RUN_PK, LAST_RUN_SK } from "./keys.js";

export interface DayMeta {
  day: string;
  status: "complete" | "partial";
  articleCount: number;
  /** How many of the day's articles the model actually scored. */
  llmRanked: number;
  /** How many were cut by RANK_INPUT_CAP and never reached the model. Persisted, not logged:
   *  a day where 450 of 650 articles were never ranked must be visible in the data. */
  truncated: number;
  llmStatus: "ok" | "failed" | "truncated";
  runId: string;
  completedAt: string;
}

export interface LastRun {
  startedAt: string;
  durationMs: number;
  perSourceCounts: Record<string, number>;
  filtered: Record<string, number>;
  quarantined: Record<string, number>;
  llmStatus: "ok" | "skipped" | "failed";
  itemsWritten: number;
  itemsFailed: number;
  errors: { source: string; message: string }[];
}

export function buildDayMetaPut(tableName: string, m: DayMeta): PutCommandInput {
  return { TableName: tableName, Item: { pk: DAY_META_PK, sk: m.day, ...m } };
}

export function buildLastRunPut(tableName: string, r: LastRun): PutCommandInput {
  return { TableName: tableName, Item: { pk: LAST_RUN_PK, sk: LAST_RUN_SK, ...r } };
}
```

`tests/store/meta.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildDayMetaPut, buildLastRunPut } from "../../src/lib/store/meta.js";

describe("buildDayMetaPut", () => {
  it("sorts days lexicographically by using the ISO date as the sort key", () => {
    const item = buildDayMetaPut("t", {
      day: "2026-08-18", status: "complete", articleCount: 97,
      llmRanked: 97, truncated: 0, llmStatus: "ok",
      runId: "r1", completedAt: "2026-08-18T03:05:00.000Z",
    }).Item!;
    expect(item.pk).toBe("META#DAY");
    expect(item.sk).toBe("2026-08-18");
    expect(item.status).toBe("complete");
  });

  it("records how much of the day the model actually saw", () => {
    // These three are REQUIRED on DayMeta, not optional, and this is why: a day where 450 of
    // 650 articles never reached Bedrock would otherwise persist as plain "complete" and the
    // gap would exist only in a log line nobody reads. Making them optional lets the rank
    // handler omit them and reopens exactly that hole.
    const item = buildDayMetaPut("t", {
      day: "2026-08-18", status: "partial", articleCount: 650,
      llmRanked: 200, truncated: 450, llmStatus: "ok",
      runId: "r1", completedAt: "2026-08-18T03:05:00.000Z",
    }).Item!;
    expect(item.llmRanked).toBe(200);
    expect(item.truncated).toBe(450);
    expect(item.status).toBe("partial");
  });
});

describe("buildLastRunPut", () => {
  it("carries all three per-source counters, which is what makes a dead source detectable", () => {
    const item = buildLastRunPut("t", {
      startedAt: "2026-08-18T03:00:00.000Z", durationMs: 4200,
      perSourceCounts: { verge: 10, venturebeat: 0 },
      filtered: { venturebeat: 7 },
      quarantined: {},
      llmStatus: "ok", itemsWritten: 10, itemsFailed: 0, errors: [],
    }).Item!;
    // venturebeat produced 0 but filtered 7 -> quiet, not dead. Spec §8.
    expect(item.perSourceCounts.venturebeat).toBe(0);
    expect(item.filtered.venturebeat).toBe(7);
    expect(item.quarantined).toEqual({});
  });
});
```

- [ ] **Step 8: Write `client.ts` and `query.ts` with their tests**

`src/lib/store/client.ts`:

```ts
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

let cached: DynamoDBDocumentClient | undefined;

/**
 * One client per Lambda container. Created lazily so importing this module in a unit test
 * does not construct an SDK client or attempt credential resolution.
 */
export function docClient(): DynamoDBDocumentClient {
  cached ??= DynamoDBDocumentClient.from(new DynamoDBClient({}), {
    marshallOptions: { removeUndefinedValues: true },
  });
  return cached;
}

/** Test seam. Never called in production code. */
export function __setDocClient(c: DynamoDBDocumentClient | undefined) {
  cached = c;
}
```

`src/lib/store/query.ts`:

```ts
import {
  QueryCommand,
  type DynamoDBDocumentClient,
  type QueryCommandInput,
} from "@aws-sdk/lib-dynamodb";
import { DAY_META_PK, dayPartition } from "./keys.js";
import type { DayMeta } from "./meta.js";

/**
 * Pages a Query to exhaustion.
 *
 * Spec §8 requires this and it is not optional: DynamoDB's 1 MB page limit is applied BEFORE
 * any filtering, and a caller that ignores LastEvaluatedKey silently receives partial results
 * — a feed that looks complete and is not. Spec §4 bounds a day at ~650 items which, at a
 * realistic 1.5 KB per projected item, lands almost exactly ON the 1 MB boundary. Treating
 * that bound as "one page is enough" would be a rationalisation, not a guarantee.
 */
async function queryAll(
  client: DynamoDBDocumentClient, input: QueryCommandInput,
): Promise<Record<string, unknown>[]> {
  const items: Record<string, unknown>[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const out = await client.send(new QueryCommand({ ...input, ExclusiveStartKey: startKey }));
    items.push(...((out.Items ?? []) as Record<string, unknown>[]));
    startKey = out.LastEvaluatedKey;
  } while (startKey);
  return items;
}

/** One day's articles, highest score first. */
export async function queryDay(
  client: DynamoDBDocumentClient, tableName: string, day: string,
): Promise<Record<string, unknown>[]> {
  return await queryAll(client, {
    TableName: tableName,
    IndexName: "feed-by-day",
    KeyConditionExpression: "gsi1pk = :d",
    ExpressionAttributeValues: { ":d": dayPartition(day) },
    ScanIndexForward: false,
  });
}

/** Newest days first. Limit is a hard cap, so this one page is genuinely enough. */
export async function listDays(
  client: DynamoDBDocumentClient, tableName: string, limit: number,
): Promise<DayMeta[]> {
  const out = await client.send(new QueryCommand({
    TableName: tableName,
    KeyConditionExpression: "pk = :p",
    ExpressionAttributeValues: { ":p": DAY_META_PK },
    ScanIndexForward: false,
    Limit: limit,
  }));
  return (out.Items ?? []) as DayMeta[];
}

/**
 * The feed's entry point. Readers never compute a date — they follow this pointer. Spec §4.
 *
 * Falls back to the newest day of ANY status when no complete day is in the window. A single
 * transient write failure marks a day `partial` and nothing retries it, so preferring
 * "complete" without a fallback means a run of unlucky days makes the site show NOTHING —
 * a worse outcome than showing a day that is 199 articles out of 200. The caller gets the
 * status and can say so in the UI.
 */
export async function getLatestCompleteDay(
  client: DynamoDBDocumentClient, tableName: string,
): Promise<DayMeta | null> {
  const days = await listDays(client, tableName, 30);
  return days.find((d) => d.status === "complete") ?? days[0] ?? null;
}
```

`tests/store/query.test.ts` uses `aws-sdk-client-mock`:

```ts
import { mockClient } from "aws-sdk-client-mock";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { beforeEach, describe, expect, it } from "vitest";
import { getLatestCompleteDay, queryDay } from "../../src/lib/store/query.js";

const ddb = mockClient(DynamoDBDocumentClient);
beforeEach(() => ddb.reset());

describe("queryDay", () => {
  it("reads the day partition descending, so the highest score comes back first", async () => {
    ddb.on(QueryCommand).resolves({ Items: [{ title: "a" }] });
    await queryDay(ddb as never, "t", "2026-08-18");
    const call = ddb.commandCalls(QueryCommand)[0]!.args[0].input;
    expect(call.IndexName).toBe("feed-by-day");
    expect(call.ExpressionAttributeValues![":d"]).toBe("DAY#2026-08-18");
    expect(call.ScanIndexForward).toBe(false);
  });

  it("follows LastEvaluatedKey to the end, rather than returning a partial day", async () => {
    // Spec §8. The 1 MB page limit applies before filtering, so a day at the size bound
    // returns silently truncated without this.
    ddb.on(QueryCommand)
      .resolvesOnce({ Items: [{ title: "a" }], LastEvaluatedKey: { pk: "x" } })
      .resolvesOnce({ Items: [{ title: "b" }], LastEvaluatedKey: { pk: "y" } })
      .resolves({ Items: [{ title: "c" }] });

    const items = await queryDay(ddb as never, "t", "2026-08-18");
    expect(items.map((i) => i.title)).toEqual(["a", "b", "c"]);
    expect(ddb.commandCalls(QueryCommand)).toHaveLength(3);
    expect(ddb.commandCalls(QueryCommand)[1]!.args[0].input.ExclusiveStartKey).toEqual({ pk: "x" });
  });
});

describe("getLatestCompleteDay", () => {
  it("skips a partial day and returns the newest complete one", async () => {
    ddb.on(QueryCommand).resolves({ Items: [
      { day: "2026-08-19", status: "partial" },
      { day: "2026-08-18", status: "complete" },
    ] });
    expect((await getLatestCompleteDay(ddb as never, "t"))?.day).toBe("2026-08-18");
  });

  it("returns null rather than throwing when no day has completed yet", async () => {
    ddb.on(QueryCommand).resolves({ Items: [] });
    expect(await getLatestCompleteDay(ddb as never, "t")).toBeNull();
  });
});
```

- [ ] **Step 9: Run the full suite**

Run: `pnpm test && pnpm typecheck`
Expected: all pass.

- [ ] **Step 10: Commit**

```bash
git add src/lib/store tests/store package.json pnpm-lock.yaml
git commit -m "feat: add the DynamoDB store layer as pure command builders"
```
---

### Task 3: CDK app scaffold and the DynamoDB table

**The GSI projection is the one irreversible decision in this plan.** A GSI's projection
cannot be altered after creation — changing it means deleting and recreating the index, and
recreating it on a table that already holds the archive means a full backfill. Settle it here.

**Files:**
- Create: `cdk.json`, `infra/bin/ai-news.ts`, `infra/lib/table.ts`, `infra/lib/ai-news-stack.ts`
- Create: `tests/infra/table.test.ts`
- Modify: `package.json` (scripts + devDependencies), `.gitignore` (`cdk.out/`)

**Interfaces:**
- Produces: `ArticleTable` construct exposing `.table: dynamodb.TableV2`;
  `AiNewsStack` exposing `.articleTable: ArticleTable`

- [ ] **Step 1: Install CDK**

```bash
pnpm add -D aws-cdk-lib constructs aws-cdk
```

Add to `package.json` scripts:

```json
"cdk": "cdk",
"synth": "cdk synth"
```

Add `cdk.out/` to `.gitignore`.

- [ ] **Step 2: Write `cdk.json`**

```json
{
  "app": "node --experimental-strip-types --import ./scripts/register-ts-extension-resolve-hook.mjs infra/bin/ai-news.ts",
  "context": {
    "@aws-cdk/core:enableStackNameDuplicates": false,
    "@aws-cdk/aws-lambda:recognizeLayerVersion": true
  }
}
```

The loader hook is the same one `pnpm dry-run` already uses — this repo imports source with a
`.js` extension while the files on disk are `.ts`, and plain Node does not remap it. If the
hook's path differs, read `package.json`'s `dry-run` script and copy from there rather than
guessing.

- [ ] **Step 3: Write the failing test**

Create `tests/infra/table.test.ts`. Every assertion here corresponds to a spec rule that costs
real money or real data if it is wrong:

```ts
import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { AiNewsStack } from "../../infra/lib/ai-news-stack.js";

const template = () =>
  Template.fromStack(new AiNewsStack(new App(), "Test", {
    env: { account: "111111111111", region: "eu-central-1" },
  }));

describe("article table", () => {
  it("bills on demand, because provisioned capacity at this shape costs ~$28/month", () => {
    // Spec §4: the free 25 RCU/WCU allowance is per-account-per-region across tables AND
    // indexes, so "provisioned to stay free" is arithmetically impossible here.
    template().hasResourceProperties("AWS::DynamoDB::GlobalTable", {
      BillingMode: "PAY_PER_REQUEST",
    });
  });

  it("retains the table when the stack is destroyed, because it holds the archive", () => {
    template().hasResource("AWS::DynamoDB::GlobalTable", { DeletionPolicy: "Retain" });
  });

  it("declares exactly one GSI, named feed-by-day, keyed for a descending score read", () => {
    // NOTE the path. `AWS::DynamoDB::GlobalTable` puts KeySchema and Projection ONLY at
    // top-level Properties.GlobalSecondaryIndexes[i]; the Replicas[0] entry carries just
    // IndexName. Asserting through Replicas[0] does not fail — it THROWS on undefined.
    const gsis = Object.values(template().findResources("AWS::DynamoDB::GlobalTable"))[0]!
      .Properties.GlobalSecondaryIndexes;
    expect(gsis).toHaveLength(1);
    expect(gsis[0].IndexName).toBe("feed-by-day");
  });

  it("projects every attribute the feed card and cluster list need", () => {
    // INCLUDE not ALL: ALL duplicates every attribute into the index and doubles write cost.
    // The list is deliberately a little wider than spec §7's card fields. The asymmetry
    // decides it: over-projecting costs fractions of a cent per month, under-projecting costs
    // recreating the index and backfilling the archive, and a projection is IMMUTABLE after
    // creation. `url` in particular is load-bearing for the detail page's "also covered by…"
    // cluster list, and `scoreVersion` for spec §2's "new since last ranking" marker.
    const table = Object.values(template().findResources("AWS::DynamoDB::GlobalTable"))[0]!;
    const proj = table.Properties.GlobalSecondaryIndexes[0].Projection;
    expect(proj.ProjectionType).toBe("INCLUDE");
    expect([...proj.NonKeyAttributes].sort()).toEqual([
      "category", "clusterId", "corroborationToday", "imageUrl", "publishedAt",
      "score", "scoreVersion", "source", "sourceName", "summary", "title", "url",
      "whyItMatters",
    ]);
  });

  it("enables point-in-time recovery", () => {
    template().hasResourceProperties("AWS::DynamoDB::GlobalTable", {
      Replicas: [ { PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true } } ],
    });
  });
});
```

If the synthesized template nests these properties differently from the assertions above,
**fix the assertion to match the real template, not the construct to match the assertion** —
then say so in the task report. CDK's L1 shape for `TableV2` is the authority here.

- [ ] **Step 4: Run it to verify it fails**

Run: `pnpm vitest run tests/infra/table.test.ts`
Expected: FAIL — `infra/lib/ai-news-stack.ts` does not exist.

- [ ] **Step 5: Write `infra/lib/table.ts`**

```ts
import { RemovalPolicy } from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import { Construct } from "constructs";

/**
 * The feed-card attribute set, frozen at index creation.
 *
 * Spec §4 lists nine. Four more are here for reasons the spec did not anticipate:
 *   url, source   — the card links out and shows a source chip; without them every card
 *                   render costs a second read of the base table.
 *   score         — the ordering is already the sort key, but the UI shows relative weight.
 *   scoreVersion  — spec §2 requires a "new since last ranking" marker for articles a manual
 *                   refresh pulled in. That is exactly "scoreVersion is the degraded one",
 *                   and it is unimplementable from the index without this attribute.
 *
 * `points` and `pointsImputed` are here because spec §7 requires the detail page to show
 * "the signals behind the score — source weight, corroboration today, engagement where it
 * exists — shown plainly, so the ranking is inspectable rather than magic", and the spec
 * never says whether that page reads the base item or renders from the already-fetched day.
 * Under the second reading everything it shows must be projected. The question is genuinely
 * open and the projection is not: project both and the page works either way.
 *
 * `pointsImputed` travels with `points` and is not optional decoration. Spec §5 imputes a
 * neutral 0.5 for the ~9 sources that never carry engagement, so a projected `points` alone
 * would let the UI show a confident-looking number the system guessed. Showing an imputed
 * value as though it were measured is the same dishonesty spec §5 corrected when it renamed
 * `clusterSize` to `corroborationToday`.
 *
 * Deliberately NOT projected: publishedAtSource, llmImportance, firstSeenAt, hashVersion, v.
 *
 * Erring wide is deliberate. A projection cannot be altered after the index is created --
 * changing it means deleting and recreating the index, and recreating it on a table that
 * already holds the archive means a full backfill. Over-projecting costs fractions of a cent
 * a month at this volume. The costs are not symmetric, so this list is not minimal.
 */
export const FEED_CARD_ATTRIBUTES = [
  "title", "summary", "imageUrl", "url", "source", "sourceName", "category",
  "publishedAt", "clusterId", "corroborationToday", "whyItMatters", "score", "scoreVersion",
  "points", "pointsImputed",
];

export class ArticleTable extends Construct {
  readonly table: dynamodb.TableV2;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    this.table = new dynamodb.TableV2(this, "Table", {
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },

      // Spec §4. Never provisioned — see the [revised] block there for the arithmetic.
      billing: dynamodb.Billing.onDemand(),

      // This table is the archive. A stack delete must not take it.
      removalPolicy: RemovalPolicy.RETAIN,
      // `pointInTimeRecovery` is deprecated in current aws-cdk-lib (checked at 2.265.0).
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },

      globalSecondaryIndexes: [
        {
          indexName: "feed-by-day",
          partitionKey: { name: "gsi1pk", type: dynamodb.AttributeType.STRING },
          sortKey: { name: "gsi1sk", type: dynamodb.AttributeType.STRING },
          projectionType: dynamodb.ProjectionType.INCLUDE,
          nonKeyAttributes: FEED_CARD_ATTRIBUTES,
        },
      ],
    });
  }
}
```

PITR on a table this size costs roughly $0.02/month — it is cheap insurance on top of the spec's
off-AWS backup, not a replacement for it.

- [ ] **Step 6: Write `infra/lib/ai-news-stack.ts` and `infra/bin/ai-news.ts`**

```ts
// infra/lib/ai-news-stack.ts
import { Stack, type StackProps } from "aws-cdk-lib";
import type { Construct } from "constructs";
import { ArticleTable } from "./table.js";

export class AiNewsStack extends Stack {
  readonly articleTable: ArticleTable;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);
    this.articleTable = new ArticleTable(this, "Articles");
  }
}
```

```ts
// infra/bin/ai-news.ts
import { App } from "aws-cdk-lib";
import { AiNewsStack } from "../lib/ai-news-stack.js";

const app = new App();

// Account and region come from the environment so the stack is portable: deploying to a
// different account is a different profile, not a code change. Spec §2, portability.
new AiNewsStack(app, "AiNewsStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? "eu-central-1",
  },
});
```

- [ ] **Step 7: Verify the test passes and the app synthesizes**

Run: `pnpm vitest run tests/infra/table.test.ts`
Expected: PASS.

Run: `pnpm synth`
Expected: a CloudFormation template on stdout containing `AWS::DynamoDB::GlobalTable`.
**This does not deploy anything and makes no AWS API calls that create resources.**

- [ ] **Step 8: Commit**

```bash
git add cdk.json infra tests/infra package.json pnpm-lock.yaml .gitignore
git commit -m "feat: add the CDK app and the article table"
```

---

### Task 4: The Bedrock ranking call

One call per day. This is the only step in the system that costs real money, so its token
shape is a design decision, not an implementation detail.

**Cost arithmetic — read before changing anything here.** Sonnet 4.6 on Bedrock is $3/1M
input, $15/1M output, and thinking tokens bill as output.

| Choice | Tokens/run | $/month |
|---|---|---|
| Naive: 200 articles, full summaries, 64-char hashes echoed back | ~25k in / ~14.4k out | $11–16 |
| **This plan:** short ordinal ids, summaries truncated to 300 chars | ~21k in / ~9.6k out | **$10.50–16.50** |

The saving is almost entirely output: a 64-hex-character `urlHash` costs ~32 tokens **per
article, echoed back in full**. Sending `a0`…`a199` instead and translating locally costs
nothing and removes about a third of the output bill.

**The thinking-token component is an estimate, not a measurement.** `thinking: { type:
"adaptive" }` bills as output and its volume is not knowable in advance, which is why the
range above is wide and why spec §6 requires validating against a real batch with
`countTokens()` before deploying. Treat the low end as optimistic. If cost needs cutting, the
first lever is `thinking`, then `RANK_INPUT_CAP`, then `SUMMARY_CHARS_FOR_RANKING` — in that
order, because the first is pure overhead and the last two lose information.

**Three settings here are cost controls, not tuning knobs**, and all three come from spec §6:
`effort: "medium"` (its `high` default measured 150–500s on a 100-item clustering task, which
straddles any sane timeout); the `stop_reason === "max_tokens"` branch (a truncated run burns
the full 32k cap and returns near-worthless JSON — without the branch it is billed in full and
still reports success); and the abort/retry configuration in Task 8 (a hard Lambda kill leaves
the invocation eligible for Lambda's default **2× async retry**, re-billing the same ~$0.50
call up to three times with no record of the day at all).

**Files:**
- Create: `src/lib/rank/model.ts`, `src/lib/rank/prompt.ts`, `src/lib/rank/bedrock.ts`
- Test: `tests/rank/prompt.test.ts`, `tests/rank/bedrock.test.ts`

**Interfaces:**
- Consumes: `reconcile(inputHashes, response)` from `src/lib/rank/reconcile.js`, which expects
  `{ items: [{ urlHash, importance, clusterId, whyItMatters }] }` — match that shape exactly
- Produces:
  - `RANK_MODEL`, `RANK_INPUT_CAP`, `RANK_TOOL`
  - `buildRankPrompt(candidates: RankCandidate[]): { text: string; idToHash: Map<string, string> }`
  - `translateIds(response: unknown, idToHash: Map<string, string>): unknown`
  - `rankArticles(candidates: RankCandidate[], deps: RankDeps): Promise<RankOutcome>`

- [ ] **Step 1: Install the SDK and create `src/lib/rank/model.ts`**

```bash
pnpm add @anthropic-ai/bedrock-sdk
```

These four constants live in their own module because **`infra/lib/functions.ts` needs the
model id to write the IAM policy, and `scripts/smoke.ts` needs it too.** Importing them from
`bedrock.ts` would pull `@anthropic-ai/bedrock-sdk` into every `cdk synth` and every smoke run
— slower at best, and a synth-time failure mode if the SDK does credential or environment work
on import. A file with no imports cannot do that.

```ts
// src/lib/rank/model.ts — no imports, deliberately.

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
 */
export const RANK_INPUT_CAP = 200;

/** Caps thinking PLUS response text, not response text alone. Spec §6. */
export const MAX_TOKENS = 32_000;

/**
 * ~600s. Task 8 sets the rank Lambda's timeout to 900s so this fires with 300s to spare: a
 * Lambda timeout kills the environment with no catchable signal, so an abort at the same
 * moment as the timeout would never let the degraded-mode fallback run.
 */
export const BEDROCK_ABORT_MS = 600_000;
```

- [ ] **Step 2: Write the failing prompt tests**

`tests/rank/prompt.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { RANKING_SCHEMA, buildRankPrompt, translateIds } from "../../src/lib/rank/prompt.js";

const candidate = (n: number) => ({
  urlHash: String(n).padStart(64, "0"),
  title: `Title ${n}`,
  summary: "x".repeat(900),
  sourceName: "TechCrunch",
  category: "news" as const,
  publishedAt: "2026-08-18T09:00:00.000Z",
  points: 12,
});

describe("buildRankPrompt", () => {
  it("addresses articles by a short ordinal id, not by their 64-char hash", () => {
    const { text, idToHash } = buildRankPrompt([candidate(1), candidate(2)]);
    expect(text).toContain("a0");
    expect(text).toContain("a1");
    expect(text).not.toContain(candidate(1).urlHash);
    expect(idToHash.get("a0")).toBe(candidate(1).urlHash);
  });

  it("truncates summaries so one long article cannot dominate the token budget", () => {
    const { text } = buildRankPrompt([candidate(1)]);
    expect(text).not.toContain("x".repeat(400));
  });

  it("pins the response shape reconcile() reads", () => {
    // reconcile() looks for `items`. A rename here silently reconciles every article as
    // `missing`, which is indistinguishable from the model failing.
    expect(RANKING_SCHEMA.required).toContain("items");
    expect(RANKING_SCHEMA.properties.items.items.required).toContain("id");
  });
});

describe("translateIds", () => {
  const idToHash = new Map([["a0", "h0"], ["a1", "h1"]]);

  it("maps short ids back to hashes", () => {
    const out = translateIds({ items: [{ urlHash: "a0", importance: 90 }] }, idToHash) as any;
    expect(out.items[0].urlHash).toBe("h0");
  });

  it("passes an unrecognised id through unchanged, so reconcile still counts it as unknown", () => {
    // Silently dropping it here would hide a hallucinating model behind a clean run record.
    const out = translateIds({ items: [{ urlHash: "zz", importance: 90 }] }, idToHash) as any;
    expect(out.items[0].urlHash).toBe("zz");
  });

  it("returns a shape reconcile can read even when the model returns nothing usable", () => {
    expect(translateIds(null, idToHash)).toEqual({ items: [] });
    expect(translateIds({ items: "not an array" }, idToHash)).toEqual({ items: [] });
  });
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `pnpm vitest run tests/rank/prompt.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 4: Write `src/lib/rank/prompt.ts`**

```ts
export const SUMMARY_CHARS_FOR_RANKING = 300;

export interface RankCandidate {
  urlHash: string;
  title: string;
  summary: string;
  sourceName: string;
  category: string;
  publishedAt: string | null;
  points: number | null;
}

/**
 * Structured output schema, per spec §6.
 *
 * Spec §6 verified that the legacy `bedrock-runtime` path carries BOTH Sonnet 4.6 and
 * structured outputs (the Mantle endpoint carries neither), so `output_config.format` is the
 * documented path for this model and this client. The shape is pinned to what reconcile()
 * already parses — `{ items: [...] }` — so a change here without a matching change there
 * produces a run where every article reconciles as `missing`, which reads as a model failure.
 *
 * Fallback, if `output_config.format` is rejected by the installed SDK at implementation time:
 * a forced tool call (`tools: [{name, input_schema}]` + `tool_choice: {type:"tool", name}`)
 * carries the same schema and is supported on every Anthropic surface. Use it only if the
 * spec's path does not work, and record that in the task report — do not silently substitute.
 *
 * Note `maxItems` is deliberately absent: structured-output schemas do not support it, so the
 * model cannot be forced to return all 200 entries. That is exactly why reconcile() exists.
 */
export const RANKING_SCHEMA = {
  type: "object" as const,
  properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string", description: "The article id exactly as given, e.g. a7." },
            importance: {
              type: "number",
              description:
                "0-100. 90+ is a major model or capability release, a landmark result, or " +
                "a development that changes what practitioners do this week. 50 is routine " +
                "industry news. Below 20 is marketing, funding minutiae, or rehashed coverage.",
            },
            clusterId: {
              type: "string",
              description:
                "A short slug shared by every article covering the SAME underlying story, " +
                "e.g. gpt6-launch. Give an article its own unique slug if nothing else " +
                "covers the same story. Never reuse a slug across different stories.",
            },
            whyItMatters: {
              type: "string",
              description: "One sentence, under 200 characters, for a reader who has 5 seconds.",
            },
          },
          required: ["id", "importance", "clusterId", "whyItMatters"],
        },
      },
  },
  required: ["items"],
};

/** Ordinal ids keep 64-char hashes out of the token bill — see the cost table in the plan. */
export function buildRankPrompt(candidates: RankCandidate[]): {
  text: string;
  idToHash: Map<string, string>;
} {
  const idToHash = new Map<string, string>();
  const lines = candidates.map((c, i) => {
    const id = `a${i}`;
    idToHash.set(id, c.urlHash);
    const summary = c.summary.slice(0, SUMMARY_CHARS_FOR_RANKING);
    const points = c.points === null ? "" : ` | ${c.points} points`;
    return `${id} | ${c.sourceName} (${c.category})${points}\\n  ${c.title}\\n  ${summary}`;
  });

  const text =
    `Here are ${candidates.length} AI-related articles captured today. Score each one's ` +
    `importance to someone who follows AI closely, and group articles covering the same ` +
    `underlying story.\\n\\n` +
    `Return an entry for EVERY id below. Use the id exactly as written.\\n\\n` +
    lines.join("\\n\\n");

  return { text, idToHash };
}

/**
 * Rewrites the model's short ids back to url hashes, in the field name reconcile() reads.
 *
 * An id that is not in the map is passed through unchanged rather than dropped: reconcile()
 * counts it as `unknown`, which is how a hallucinating model becomes visible in the run
 * record. Dropping it here would make a broken run look clean.
 */
export function translateIds(response: unknown, idToHash: Map<string, string>): unknown {
  const items = (response as { items?: unknown })?.items;
  if (!Array.isArray(items)) return { items: [] };

  return {
    items: items.map((raw: Record<string, unknown>) => {
      const id = typeof raw?.id === "string" ? raw.id : "";
      return { ...raw, urlHash: idToHash.get(id) ?? id };
    }),
  };
}
```

- [ ] **Step 5: Run to verify the prompt tests pass**

Run: `pnpm vitest run tests/rank/prompt.test.ts`
Expected: PASS, all 7.

- [ ] **Step 6: Write `src/lib/rank/bedrock.ts`**

```ts
import AnthropicBedrock from "@anthropic-ai/bedrock-sdk";
import { MAX_TOKENS, RANK_INPUT_CAP, RANK_MODEL } from "./model.js";
import { RANKING_SCHEMA, buildRankPrompt, translateIds, type RankCandidate } from "./prompt.js";

export { MAX_TOKENS, RANK_INPUT_CAP, RANK_MODEL };

/**
 * Truncation is NOT an outage, and conflating them is the failure spec §6 calls out by name:
 * a `max_tokens` stop yields invalid or partial JSON which, caught as a generic Bedrock
 * failure, silently degrades the whole day while `llmStatus` still reports "ok". It also
 * means the full 32k cap was billed. It gets its own type so the caller can log it as its
 * own thing and so an alarm can distinguish "we asked for too much" from "Bedrock was down".
 */
export class TruncationError extends Error {
  constructor() {
    super("ranking response hit max_tokens; output is truncated and unusable");
    this.name = "TruncationError";
  }
}

export interface RankDeps {
  client?: {
    messages: { stream: (args: unknown) => { finalMessage: () => Promise<unknown> } };
  };
  signal?: AbortSignal;
}

export interface RankOutcome {
  response: unknown;
  inputHashes: string[];
  truncated: number;
}

export async function rankArticles(
  candidates: RankCandidate[],
  deps: RankDeps = {},
): Promise<RankOutcome> {
  const selected = candidates.slice(0, RANK_INPUT_CAP);
  const truncated = candidates.length - selected.length;
  if (selected.length === 0) return { response: { items: [] }, inputHashes: [], truncated: 0 };

  const { text, idToHash } = buildRankPrompt(selected);
  const client = deps.client ?? new AnthropicBedrock({ awsRegion: process.env.AWS_REGION });

  // Streamed, per spec §6. A multi-minute non-streaming request is what request timeouts
  // are for; streaming also lets the abort signal take effect mid-response.
  const stream = client.messages.stream({
    model: RANK_MODEL,
    max_tokens: MAX_TOKENS,
    thinking: { type: "adaptive" },
    output_config: {
      // NOT the `high` default: spec §6 measured `high` at 150-500s on a 100-item clustering
      // task, which straddles the Lambda timeout and multiplies the thinking-token bill.
      effort: "medium",
      format: { type: "json_schema", schema: RANKING_SCHEMA },
    },
    messages: [{ role: "user", content: text }],
    ...(deps.signal ? { signal: deps.signal } : {}),
  });

  const msg = (await stream.finalMessage()) as {
    stop_reason?: string;
    content?: { type: string; text?: string }[];
  };

  if (msg.stop_reason === "max_tokens") throw new TruncationError();

  // content[0] is a thinking block, not text — `thinking.display` defaults to "summarized"
  // on Sonnet 4.6, so indexing content[0] returns the wrong block. Spec §6.
  const raw = msg.content?.find((b) => b.type === "text")?.text;
  if (!raw) return { response: { items: [] }, inputHashes: selected.map((c) => c.urlHash), truncated };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Well-formed-but-unparseable is distinct from truncated: structured outputs should make
    // this unreachable, so if it happens the schema and the model have diverged.
    return { response: { items: [] }, inputHashes: selected.map((c) => c.urlHash), truncated };
  }

  return {
    response: translateIds(parsed, idToHash),
    inputHashes: selected.map((c) => c.urlHash),
    truncated,
  };
}
```

- [ ] **Step 7: Write `tests/rank/bedrock.test.ts`**

The client is injected, so no test touches AWS. Assert the request shape — these are the
values that cost money or silently break reconciliation if they drift:

```ts
import { describe, expect, it, vi } from "vitest";
import { MAX_TOKENS, RANK_INPUT_CAP, RANK_MODEL, TruncationError, rankArticles } from "../../src/lib/rank/bedrock.js";

const candidate = (n: number) => ({
  urlHash: String(n).padStart(64, "0"),
  title: `Title ${n}`, summary: "s", sourceName: "TechCrunch",
  category: "news", publishedAt: null, points: null,
});

/** Shaped like the streaming client: content[0] is a thinking block, exactly as spec §6 warns. */
const stub = (payload: unknown, stopReason = "end_turn") => {
  const finalMessage = vi.fn().mockResolvedValue({
    stop_reason: stopReason,
    content: [
      { type: "thinking", thinking: "..." },
      { type: "text", text: JSON.stringify(payload) },
    ],
  });
  return { messages: { stream: vi.fn().mockReturnValue({ finalMessage }) } };
};

describe("rankArticles", () => {
  it("uses the global inference profile, not the regional one", async () => {
    const client = stub({ items: [] });
    await rankArticles([candidate(1)], { client });
    const args = client.messages.stream.mock.calls[0]![0] as Record<string, unknown>;
    expect(args.model).toBe(RANK_MODEL);
    expect(RANK_MODEL.startsWith("global.")).toBe(true);
    expect(args.max_tokens).toBe(MAX_TOKENS);
  });

  it("constrains the response with a schema and keeps effort off the high default", async () => {
    const client = stub({ items: [] });
    await rankArticles([candidate(1)], { client });
    const args = client.messages.stream.mock.calls[0]![0] as any;
    expect(args.output_config.format.type).toBe("json_schema");
    // `high` measured 150-500s on this task shape and multiplies the thinking-token bill.
    expect(args.output_config.effort).toBe("medium");
  });

  it("throws TruncationError on max_tokens instead of degrading silently", async () => {
    // The single most important assertion in this file. Without the branch, a truncated run
    // is billed for the full 32k cap, returns unusable JSON, and still reports llmStatus ok —
    // indistinguishable from a Bedrock outage, which is what spec §6 forbids.
    const client = stub({ items: [] }, "max_tokens");
    await expect(rankArticles([candidate(1)], { client })).rejects.toThrow(TruncationError);
  });

  it("reads the text block by type, never by position", async () => {
    // content[0] is a thinking block: `thinking.display` defaults to "summarized" on
    // Sonnet 4.6, so content[0].text is undefined.
    const client = stub({ items: [{ id: "a0", importance: 90, clusterId: "c", whyItMatters: "w" }] });
    const out = await rankArticles([candidate(1)], { client });
    expect((out.response as any).items[0].urlHash).toBe(candidate(1).urlHash);
  });

  it("caps the input and reports how many it left out", async () => {
    const client = stub({ items: [] });
    const many = Array.from({ length: RANK_INPUT_CAP + 17 }, (_, i) => candidate(i));
    const out = await rankArticles(many, { client });
    expect(out.inputHashes).toHaveLength(RANK_INPUT_CAP);
    expect(out.truncated).toBe(17);
  });

  it("makes no call at all when there is nothing to rank", async () => {
    const client = stub({ items: [] });
    const out = await rankArticles([], { client });
    expect(client.messages.stream).not.toHaveBeenCalled();
    expect(out.response).toEqual({ items: [] });
  });

  it("returns an empty reconcilable shape when the model returns no text block", async () => {
    const finalMessage = vi.fn().mockResolvedValue({ stop_reason: "end_turn", content: [{ type: "thinking" }] });
    const client = { messages: { stream: vi.fn().mockReturnValue({ finalMessage }) } };
    const out = await rankArticles([candidate(1)], { client });
    expect(out.response).toEqual({ items: [] });
  });
});
```

- [ ] **Step 8: Run the full suite**

Run: `pnpm test && pnpm typecheck`
Expected: all pass. **No test may call Bedrock** — the single live call happens once, in
Task 10's smoke script, run by a human.

If `thinking: { type: "adaptive" }` is rejected by the installed SDK's types, check the SDK's
own documentation before changing it — `budget_tokens` is deprecated on this model family and
is rejected outright on newer ones. Record whatever you find in the task report.

- [ ] **Step 9: Commit**

```bash
git add src/lib/rank tests/rank package.json pnpm-lock.yaml
git commit -m "feat: add the daily Bedrock ranking call"
```

---

### Task 5: NDJSON backup to GitHub

Spec §8's durability story. DynamoDB holds the archive; this makes a copy that survives the
AWS account being closed, which is the failure mode a Free Plan account actually faces.

**Files:**
- Create: `src/lib/rank/backup.ts`
- Test: `tests/rank/backup.test.ts`

**Interfaces:**
- Produces: `backupDay(day: string, articles: Record<string, unknown>[], deps: BackupDeps): Promise<BackupResult>`

- [ ] **Step 1: Write the failing tests**

`tests/rank/backup.test.ts`. The security assertions are not decoration — a leaked PAT in a
CloudWatch log is the one mistake here that cannot be undone by redeploying:

```ts
import { describe, expect, it, vi } from "vitest";
import { backupDay } from "../../src/lib/rank/backup.js";

const deps = (fetchImpl: typeof fetch) => ({
  fetch: fetchImpl,
  getToken: async () => "ghp_secret_value",
  repo: "EienMosu/ai-news",
});

const ok = (body: unknown, status = 200) =>
  ({ ok: status < 300, status, json: async () => body }) as Response;

describe("backupDay", () => {
  it("writes one NDJSON line per article to a dated path", async () => {
    const calls: [string, RequestInit | undefined][] = [];
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push([url, init]);
      return url.includes("?ref=") || init?.method === undefined
        ? ok({}, 404)              // no existing file
        : ok({ content: { sha: "abc" } }, 201);
    }) as unknown as typeof fetch;

    await backupDay("2026-08-18", [{ urlHash: "h1" }, { urlHash: "h2" }], deps(f));

    const put = calls.find(([, i]) => i?.method === "PUT")!;
    expect(put[0]).toContain("/contents/archive/2026-08-18.ndjson");
    const body = JSON.parse(put[1]!.body as string);
    const decoded = Buffer.from(body.content, "base64").toString("utf8");
    expect(decoded.trimEnd().split("\n")).toHaveLength(2);
    expect(JSON.parse(decoded.split("\n")[0]!)).toEqual({ urlHash: "h1" });
  });

  it("sends the token in the Authorization header and nowhere else", async () => {
    const calls: [string, RequestInit | undefined][] = [];
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push([url, init]);
      return init?.method === "PUT" ? ok({}, 201) : ok({}, 404);
    }) as unknown as typeof fetch;

    await backupDay("2026-08-18", [{ a: 1 }], deps(f));

    for (const [url, init] of calls) {
      expect(url).not.toContain("ghp_secret_value");
      expect(init?.body ?? "").not.toContain("ghp_secret_value");
      if (init?.headers) {
        expect((init.headers as Record<string, string>).Authorization).toBe("Bearer ghp_secret_value");
      }
    }
  });

  it("passes the existing file sha on update, so a re-run overwrites instead of 409ing", async () => {
    const f = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "PUT" ? ok({}, 200) : ok({ sha: "existing-sha" }, 200),
    ) as unknown as typeof fetch;

    await backupDay("2026-08-18", [{ a: 1 }], deps(f));
    const put = (f as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls
      .find(([, i]) => i.method === "PUT")!;
    expect(JSON.parse(put[1].body as string).sha).toBe("existing-sha");
  });

  it("reports failure without throwing, so a backup problem never loses a ranked day", async () => {
    const f = vi.fn(async () => ok({ message: "Bad credentials" }, 401)) as unknown as typeof fetch;
    const result = await backupDay("2026-08-18", [{ a: 1 }], deps(f));
    expect(result.ok).toBe(false);
    expect(result.error).toContain("401");
    expect(result.error).not.toContain("ghp_secret_value");
  });
});
```

- [ ] **Step 2: Run to verify they fail, then write `src/lib/rank/backup.ts`**

```ts
export interface BackupDeps {
  fetch: typeof fetch;
  /** Reads the PAT from SSM. Injected so no test needs credentials. */
  getToken: () => Promise<string>;
  repo: string;
}

export interface BackupResult {
  ok: boolean;
  path: string;
  bytes: number;
  error?: string;
}

/**
 * Writes one day as NDJSON to `archive/<day>.ndjson` in the repo.
 *
 * Never throws. A failed backup must not fail the ranking run — the ranked day is already in
 * DynamoDB by the time this is called, and losing it to a GitHub outage would be a strictly
 * worse outcome than having no copy for a day.
 */
export async function backupDay(
  day: string,
  articles: Record<string, unknown>[],
  deps: BackupDeps,
): Promise<BackupResult> {
  const path = `archive/${day}.ndjson`;
  const url = `https://api.github.com/repos/${deps.repo}/contents/${path}`;
  const ndjson = articles.map((a) => JSON.stringify(a)).join("\n") + "\n";

  try {
    const token = await deps.getToken();
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };

    // A re-run of the same day must overwrite, which the Contents API only allows with the
    // current blob sha. Absent (404) means this is the first write for the day.
    const existing = await deps.fetch(url, { headers });
    const sha = existing.ok ? ((await existing.json()) as { sha?: string }).sha : undefined;

    const put = await deps.fetch(url, {
      method: "PUT",
      headers,
      body: JSON.stringify({
        message: `archive: ${day}`,
        content: Buffer.from(ndjson, "utf8").toString("base64"),
        ...(sha ? { sha } : {}),
      }),
    });

    if (!put.ok) return { ok: false, path, bytes: 0, error: `GitHub responded ${put.status}` };
    return { ok: true, path, bytes: Buffer.byteLength(ndjson, "utf8") };
  } catch (e) {
    // The message is built from the error's own text, never from the token.
    return { ok: false, path, bytes: 0, error: e instanceof Error ? e.message : "unknown" };
  }
}
```

- [ ] **Step 3: Run the suite and commit**

```bash
pnpm test && pnpm typecheck
git add src/lib/rank tests/rank
git commit -m "feat: back each ranked day up to GitHub as NDJSON"
```

---

### Task 6: The capture Lambda handler

Wiring only. Everything it calls is already tested; this task's job is to make the seams
visible and the failure modes reportable.

**Files:**
- Create: `src/lambda/capture.ts`
- Test: `tests/lambda/capture.test.ts`

**Interfaces:**
- Consumes: `captureAll`, `istanbulDay`, `computeScore`, `buildCaptureUpdate`,
  `buildLastRunPut`, `docClient`
- Produces: `handler(event?: unknown): Promise<CaptureSummary>`

- [ ] **Step 1: Write the failing tests**

```ts
import { UpdateCommand, PutCommand, DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ddb = mockClient(DynamoDBDocumentClient);

vi.mock("../../src/lib/ingest/capture.js", () => ({
  captureAll: vi.fn(),
}));

import { captureAll } from "../../src/lib/ingest/capture.js";
import { handler } from "../../src/lambda/capture.js";

const article = (n: number) => ({
  urlHash: String(n).padStart(64, "0"),
  url: `https://example.com/${n}`, title: `T${n}`, summary: "s", imageUrl: null,
  source: "techcrunch", sourceName: "TechCrunch", category: "news" as const,
  publishedAt: "2026-08-18T09:00:00.000Z", publishedAtSource: "feed" as const, points: null,
});

beforeEach(() => {
  ddb.reset();
  process.env.TABLE_NAME = "t";
  vi.mocked(captureAll).mockResolvedValue({
    articles: [article(1), article(2)],
    perSourceCounts: { techcrunch: 2, venturebeat: 0 },
    filtered: { venturebeat: 7 },
    quarantined: {},
    errors: [{ source: "reddit-ml", message: "HTTP 429" }],
  });
});

describe("capture handler", () => {
  it("writes every captured article", async () => {
    await handler();
    expect(ddb.commandCalls(UpdateCommand)).toHaveLength(2);
  });

  it("scores in degraded mode, so a captured article is never invisible in the feed", async () => {
    // Ranking has not run for these yet. They must still land in the day partition with a
    // real sort key, otherwise a day with no ranking run shows an empty feed.
    await handler();
    const values = ddb.commandCalls(UpdateCommand)[0]!.args[0].input.ExpressionAttributeValues!;
    expect(Object.values(values)).toContain("v1-degraded");
    expect(Object.values(values).some((v) => typeof v === "string" && /^\d{4}#/.test(v))).toBe(true);
  });

  it("records all three counters and the errors in META#lastRun", async () => {
    await handler();
    const item = ddb.commandCalls(PutCommand)[0]!.args[0].input.Item!;
    expect(item.pk).toBe("META#lastRun");
    expect(item.perSourceCounts.venturebeat).toBe(0);
    expect(item.filtered.venturebeat).toBe(7);
    expect(item.errors[0].source).toBe("reddit-ml");
    expect(item.itemsWritten).toBe(2);
  });

  it("still writes META#lastRun when an individual article write fails", async () => {
    ddb.on(UpdateCommand).rejectsOnce(new Error("throttled")).resolves({});
    const out = await handler();
    expect(out.itemsFailed).toBe(1);
    expect(out.itemsWritten).toBe(1);
    expect(ddb.commandCalls(PutCommand)).toHaveLength(1);
  });

  it("never calls Bedrock", async () => {
    // Spec §2: /api/ingest triggers this handler, so a stuck refresh button must not be able
    // to spend the credit balance.
    const mod = await import("../../src/lambda/capture.js");
    expect(JSON.stringify(Object.keys(mod))).not.toContain("rank");
  });
});
```

- [ ] **Step 2: Write `src/lambda/capture.ts`**

```ts
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

export async function handler(): Promise<CaptureSummary> {
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
```

Note the log line: it carries the hash and source, never the URL. Feed URLs carry query
strings, and this log is retained for two weeks.

- [ ] **Step 3: Run the suite and commit**

```bash
pnpm test && pnpm typecheck
git add src/lambda tests/lambda
git commit -m "feat: add the capture Lambda handler"
```

---

### Task 7: The rank Lambda handler

**Files:**
- Create: `src/lambda/rank.ts`, `src/lib/rank/corroboration.ts`
- Test: `tests/lambda/rank.test.ts`, `tests/rank/corroboration.test.ts`

**Interfaces:**
- Consumes: `queryDay`, `rankArticles`, `reconcile`, `computeScore`, `buildRankUpdate`,
  `buildDayMetaPut`, `backupDay`, `istanbulDay`
- Produces: `handler(event?: { day?: string }): Promise<RankSummary>`;
  `countCorroboration(byHash): Map<string, number>`

- [ ] **Step 1: `countCorroboration` — test first**

`tests/rank/corroboration.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { countCorroboration } from "../../src/lib/rank/corroboration.js";

describe("countCorroboration", () => {
  const item = (h: string, clusterId?: string) => ({ pk: `ART#${h}`, clusterId });

  it("counts how many articles share each article's cluster", () => {
    const counts = countCorroboration([
      item("h1", "2026-08-18#gpt6"),
      item("h2", "2026-08-18#gpt6"),
      item("h3", "2026-08-18#other"),
    ]);
    expect(counts.get("h1")).toBe(2);
    expect(counts.get("h2")).toBe(2);
    expect(counts.get("h3")).toBe(1);
  });

  it("gives a __self__ singleton a corroboration of exactly 1", () => {
    // Spec §4: __self__: is a reserved non-cluster. Treating it as a real cluster would merge
    // every unclustered article into one and fabricate corroboration.
    const counts = countCorroboration([item("h1", "__self__:h1"), item("h2", "__self__:h2")]);
    expect(counts.get("h1")).toBe(1);
    expect(counts.get("h2")).toBe(1);
  });

  it("gives an article with no cluster at all a corroboration of 1, not 0", () => {
    // A degraded run writes no clusterId. 0 would be a corroboration the scoring formula
    // never expects to see; 1 means "only this article covers it", which is the truth.
    expect(countCorroboration([item("h1")]).get("h1")).toBe(1);
  });

  it("is idempotent: recomputing from stored state gives the same answer twice", () => {
    // Spec §5 requires this. It is what makes a repeated manual trigger safe.
    const day = [item("h1", "2026-08-18#gpt6"), item("h2", "2026-08-18#gpt6")];
    expect([...countCorroboration(day)]).toEqual([...countCorroboration(day)]);
  });
});
```

`src/lib/rank/corroboration.ts`:

```ts
/**
 * How many of today's articles cover the same story as each article.
 *
 * Takes the day's STORED items, not the current run's reconcile map. Spec §5: "At the end of
 * each run the day partition is re-read once and corroborationToday recomputed for the whole
 * day, making it consistent and idempotent under repeated manual triggers." Deriving it from
 * the run's own map instead would give a second run a different answer than the first, and
 * would miss articles ranked on an earlier run of the same day.
 *
 * `__self__:`-prefixed ids are singletons by construction (spec §4) and each already contains
 * its own hash, so they never collide — but this counts them explicitly as 1 rather than
 * relying on that, because the invariant is what matters and a future change to the prefix
 * scheme should not silently inflate the signal.
 */
export function countCorroboration(items: Record<string, unknown>[]): Map<string, number> {
  const sizes = new Map<string, number>();
  for (const item of items) {
    const clusterId = typeof item.clusterId === "string" ? item.clusterId : "";
    if (clusterId) sizes.set(clusterId, (sizes.get(clusterId) ?? 0) + 1);
  }
  const out = new Map<string, number>();
  for (const item of items) {
    const hash = String(item.pk ?? "").slice("ART#".length);
    const clusterId = typeof item.clusterId === "string" ? item.clusterId : "";
    if (!clusterId || clusterId.startsWith("__self__:")) out.set(hash, 1);
    else out.set(hash, sizes.get(clusterId) ?? 1);
  }
  return out;
}
```

- [ ] **Step 2: Write `src/lambda/rank.ts`**

```ts
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
```

- [ ] **Step 3: Write `tests/lambda/rank.test.ts`**

Mock `queryDay` and `rankArticles`; assert the six behaviours that matter:

```ts
import { DynamoDBDocumentClient, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ddb = mockClient(DynamoDBDocumentClient);

vi.mock("../../src/lib/store/query.js", () => ({ queryDay: vi.fn(), listDays: vi.fn() }));
vi.mock("../../src/lib/rank/bedrock.js", () => ({ rankArticles: vi.fn() }));
vi.mock("../../src/lib/rank/backup.js", () => ({ backupDay: vi.fn() }));

import { queryDay } from "../../src/lib/store/query.js";
import { rankArticles } from "../../src/lib/rank/bedrock.js";
import { backupDay } from "../../src/lib/rank/backup.js";
import { handler, targetDay } from "../../src/lambda/rank.js";

const HASH = (n: number) => String(n).padStart(64, "0");

const stored = (n: number) => ({
  pk: `ART#${HASH(n)}`, sk: "A", title: `T${n}`, summary: "s", sourceName: "TechCrunch",
  category: "news", publishedAt: "2026-08-18T09:00:00.000Z", points: null,
  firstSeenAt: "2026-08-18T10:00:00.000Z",
});

beforeEach(() => {
  ddb.reset();
  vi.clearAllMocks();
  process.env.TABLE_NAME = "t";
  delete process.env.GITHUB_TOKEN_PARAM;
  delete process.env.BACKUP_REPO;
  vi.mocked(queryDay).mockResolvedValue([stored(1), stored(2)]);
  vi.mocked(rankArticles).mockResolvedValue({
    response: { items: [
      { urlHash: HASH(1), importance: 90, clusterId: "gpt6", whyItMatters: "Big." },
      { urlHash: HASH(2), importance: 40, clusterId: "gpt6", whyItMatters: "Also." },
    ] },
    inputHashes: [HASH(1), HASH(2)],
    truncated: 0,
  });
  vi.mocked(backupDay).mockResolvedValue({ ok: true, path: "p", bytes: 10 });
});

describe("targetDay", () => {
  it("ranks the previous day, not today", () => {
    // The schedule fires at 06:00 Europe/Istanbul, which is 03:00 UTC (constant UTC+3).
    expect(targetDay(new Date("2026-08-19T03:00:00Z"))).toBe("2026-08-18");
  });

  it("does not slip a day at the local midnight boundary", () => {
    // 00:30 Istanbul on the 19th is 21:30 UTC on the 18th. A naive UTC slice would answer
    // "2026-08-17" here and "2026-08-18" an hour later.
    expect(targetDay(new Date("2026-08-18T21:30:00Z"))).toBe("2026-08-18");
  });
});

describe("rank handler", () => {
  it("writes META#DAY last, after every article write", async () => {
    const order: string[] = [];
    ddb.on(UpdateCommand).callsFake(() => { order.push("update"); return {}; });
    ddb.on(PutCommand).callsFake(() => { order.push("put"); return {}; });

    await handler();

    // Spec §4: readers follow the META#DAY pointer, so a day must never become visible
    // before its articles are written.
    expect(order).toEqual(["update", "update", "put"]);
  });

  it("marks the day partial when an article write failed", async () => {
    ddb.on(UpdateCommand).rejectsOnce(new Error("throttled")).resolves({});
    const out = await handler();
    expect(out.status).toBe("partial");
    expect(out.ranked).toBe(1);
    expect(ddb.commandCalls(PutCommand)[0]!.args[0].input.Item!.status).toBe("partial");
  });

  it("keeps degraded scores and writes no null enrichment when Bedrock throws", async () => {
    vi.mocked(rankArticles).mockRejectedValue(new Error("AccessDeniedException"));
    const out = await handler();

    expect(out.llmStatus).toBe("failed");
    expect(out.ranked).toBe(2);
    for (const call of ddb.commandCalls(UpdateCommand)) {
      const values = call.args[0].input.ExpressionAttributeValues!;
      // A degraded run must refresh the score without destroying enrichment a previous
      // successful run wrote. Omitting the attribute is what makes that true.
      expect(JSON.stringify(values)).not.toContain("null");
      expect(Object.values(values)).toContain("v1-degraded");
    }
  });

  it("writes no META#DAY at all when the day is empty", async () => {
    vi.mocked(queryDay).mockResolvedValue([]);
    const out = await handler();
    expect(ddb.commandCalls(PutCommand)).toHaveLength(0);
    expect(out.status).toBe("partial");
  });

  it("still writes META#DAY when the GitHub backup fails", async () => {
    process.env.GITHUB_TOKEN_PARAM = "/ai-news/github-token";
    process.env.BACKUP_REPO = "EienMosu/ai-news";
    vi.mocked(backupDay).mockResolvedValue({ ok: false, path: "p", bytes: 0, error: "GitHub responded 401" });

    const out = await handler();
    // The ranked day is already in DynamoDB. Losing it to a GitHub outage would be strictly
    // worse than having no off-AWS copy for one day.
    expect(out.backedUp).toBe(false);
    expect(out.status).toBe("complete");
    expect(ddb.commandCalls(PutCommand)).toHaveLength(1);
  });

  it("gives clustered articles a corroboration above 1 and singletons exactly 1", async () => {
    vi.mocked(rankArticles).mockResolvedValue({
      response: { items: [
        { urlHash: HASH(1), importance: 90, clusterId: "gpt6", whyItMatters: "a" },
        { urlHash: HASH(2), importance: 40, clusterId: "", whyItMatters: "b" },
      ] },
      inputHashes: [HASH(1), HASH(2)],
      truncated: 0,
    });
    await handler();
    const corrs = ddb.commandCalls(UpdateCommand).map((c) =>
      Object.values(c.args[0].input.ExpressionAttributeValues!).find((v) => v === 1 || v === 2));
    // HASH(2) got no cluster, so reconcile made it __self__: — a singleton, never merged
    // with HASH(1) and never inflating its own corroboration.
    expect(corrs).toContain(1);
  });
});
```

- [ ] **Step 4: Run the suite and commit**

```bash
pnpm add @aws-sdk/client-ssm
pnpm test && pnpm typecheck
git add src tests package.json pnpm-lock.yaml
git commit -m "feat: add the daily rank Lambda handler"
```

---

### Task 8: CDK — the two functions, their IAM, and the schedules

**Files:**
- Create: `infra/lib/functions.ts`
- Modify: `infra/lib/ai-news-stack.ts`
- Test: `tests/infra/functions.test.ts`

- [ ] **Step 1: Write the failing IAM tests**

These are the assertions that keep a compromised function from draining the credit balance.
Write them before the construct:

```ts
it("gives the capture function no bedrock permission at all", () => {
  // Spec §2: /api/ingest triggers capture, so capture must be incapable of spending money.
  const policies = template().findResources("AWS::IAM::Policy");
  const capture = Object.values(policies).find((p) =>
    JSON.stringify(p).includes("CaptureFunction"))!;
  expect(JSON.stringify(capture)).not.toContain("bedrock");
});

it("scopes the rank function's bedrock permission to the one model", () => {
  const doc = rankPolicyDocument();
  const stmt = doc.Statement.find((s: any) => String(s.Action).includes("bedrock"))!;
  expect(JSON.stringify(stmt.Resource)).toContain("claude-sonnet-4-6");
  expect(JSON.stringify(stmt.Resource)).not.toBe('"*"');
});

it("gives neither function permission to delete table items", () => {
  for (const doc of [capturePolicyDocument(), rankPolicyDocument()]) {
    expect(JSON.stringify(doc)).not.toContain("dynamodb:DeleteItem");
    expect(JSON.stringify(doc)).not.toContain("dynamodb:Scan");
  }
});

it("gives only the rank function the github token", () => {
  expect(JSON.stringify(capturePolicyDocument())).not.toContain("ssm:GetParameter");
  expect(JSON.stringify(rankPolicyDocument())).toContain("ssm:GetParameter");
});

it("runs the rank schedule at 06:00 Europe/Istanbul", () => {
  template().hasResourceProperties("AWS::Scheduler::Schedule", {
    ScheduleExpression: "cron(0 6 * * ? *)",
    ScheduleExpressionTimezone: "Europe/Istanbul",
  });
});

it("runs capture hourly", () => {
  template().hasResourceProperties("AWS::Scheduler::Schedule", {
    ScheduleExpression: "rate(1 hour)",
  });
});
```

- [ ] **Step 2: Write `infra/lib/functions.ts`**

```ts
import { Duration, RemovalPolicy, Stack } from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { NodejsFunction, OutputFormat } from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as scheduler from "aws-cdk-lib/aws-scheduler";
import * as ssm from "aws-cdk-lib/aws-ssm";
import type * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import { Construct } from "constructs";
// Imported, never re-typed. Two independent string literals for the same model drift apart
// on the next model bump and the drift shows up as an IAM denial, not a compile error.
import { RANK_MODEL } from "../../src/lib/rank/model.js";

const BARE_MODEL = RANK_MODEL.replace(/^global\./, "");

export interface FunctionsProps {
  table: dynamodb.TableV2;
  backupRepo: string;
  githubTokenParam: string;
}

export class Functions extends Construct {
  readonly capture: NodejsFunction;
  readonly rank: NodejsFunction;
  readonly vercel: iam.User;

  constructor(scope: Construct, id: string, props: FunctionsProps) {
    super(scope, id);
    const { region, account } = Stack.of(this);

    // An explicit log group per function. CDK's default execution role attaches
    // AWSLambdaBasicExecutionRole, which grants logs on `arn:aws:logs:*:*:*`; spec §9 asks for
    // "the function's own log group". Declaring the group also makes retention a property of
    // the group rather than of the deprecated `logRetention` custom resource.
    const logGroup = (name: string) =>
      new logs.LogGroup(this, `${name}Logs`, {
        retention: logs.RetentionDays.TWO_WEEKS,
        removalPolicy: RemovalPolicy.DESTROY,
      });

    const common = {
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,   // cheaper per ms, identical code
      environment: { TABLE_NAME: props.table.tableName },
      bundling: { format: OutputFormat.ESM, target: "node22" },
      // Left at the default (externalize @aws-sdk/*, use the runtime-provided SDK). Note the
      // consequence: production runs whatever SDK version nodejs22.x ships, not the version
      // pinned in package.json and exercised by the tests. Set `bundleAwsSDK: true` if that
      // divergence ever matters more than the ~10 MB of bundle it costs.
    };

    this.capture = new NodejsFunction(this, "CaptureFunction", {
      ...common,
      entry: "src/lambda/capture.ts",
      timeout: Duration.minutes(3),
      memorySize: 512,
      logGroup: logGroup("Capture"),
      // Capture is reachable from a public route. Retrying a failed fetch pass costs nothing
      // and helps; it is set explicitly so it is a decision rather than a default.
      retryAttempts: 1,
    });

    this.rank = new NodejsFunction(this, "RankFunction", {
      ...common,
      entry: "src/lambda/rank.ts",
      // 900s, with the Bedrock call aborted at ~600s from inside the handler. Spec §6: a
      // Lambda timeout kills the execution environment with NO catchable signal, so a timeout
      // set equal to the abort point means the degraded-mode fallback can never run. The
      // margin between 600s and 900s is what lets the handler finish writing degraded scores.
      timeout: Duration.minutes(15),
      memorySize: 1024,
      logGroup: logGroup("Rank"),
      // Spec §9: reserved concurrency of 1, so a manual trigger and the schedule cannot
      // interleave and write two incompatible clusterings into one day partition.
      reservedConcurrentExecutions: 1,
      // ZERO, deliberately. Lambda's default of 2 async retries means a hard kill re-bills the
      // same ~$0.50 Bedrock call up to three times, with no META#DAY written for the day at
      // all. Ranking is safe to re-run manually; it is not safe to re-run invisibly.
      retryAttempts: 0,
      environment: {
        ...common.environment,
        BACKUP_REPO: props.backupRepo,
        GITHUB_TOKEN_PARAM: props.githubTokenParam,
      },
    });

    // --- DynamoDB, key-scoped ---
    // Without a LeadingKeys condition, `PutItem` on the table ARN lets a compromised function
    // overwrite ANY article wholesale — precisely the damage spec §4's "UpdateItem, never
    // PutItem" rule exists to prevent — and forge META#DAY. The condition binds each role to
    // the key prefixes its own code actually writes.
    //
    // VERIFY AT IMPLEMENTATION TIME: run capture once and confirm it writes. A LeadingKeys
    // condition that matches nothing denies silently, and a policy that denies everything
    // looks exactly like a policy that is working until you check the table.
    this.capture.addToRolePolicy(new iam.PolicyStatement({
      actions: ["dynamodb:UpdateItem"],
      resources: [props.table.tableArn],
      conditions: { "ForAllValues:StringLike": { "dynamodb:LeadingKeys": ["ART#*"] } },
    }));
    this.capture.addToRolePolicy(new iam.PolicyStatement({
      actions: ["dynamodb:PutItem"],
      resources: [props.table.tableArn],
      conditions: { "ForAllValues:StringEquals": { "dynamodb:LeadingKeys": ["META#lastRun"] } },
    }));

    this.rank.addToRolePolicy(new iam.PolicyStatement({
      actions: ["dynamodb:UpdateItem"],
      resources: [props.table.tableArn],
      conditions: { "ForAllValues:StringLike": { "dynamodb:LeadingKeys": ["ART#*"] } },
    }));
    this.rank.addToRolePolicy(new iam.PolicyStatement({
      actions: ["dynamodb:PutItem"],
      resources: [props.table.tableArn],
      conditions: { "ForAllValues:StringEquals": { "dynamodb:LeadingKeys": ["META#DAY", "META#lock"] } },
    }));
    this.rank.addToRolePolicy(new iam.PolicyStatement({
      // Query against the index needs the index ARN — spec §9 says "table ARN only", which is
      // true for WRITES (they propagate to GSIs automatically) but not for an index Query.
      actions: ["dynamodb:Query"],
      resources: [`${props.table.tableArn}/index/feed-by-day`],
      conditions: { "ForAllValues:StringLike": { "dynamodb:LeadingKeys": ["DAY#*"] } },
    }));

    // --- Bedrock, profile-scoped ---
    // The InferenceProfileArn condition is NOT optional. Without it the foundation-model ARN
    // in the resource list also authorises DIRECT on-demand invocation of the bare model,
    // bypassing the `global.` profile entirely — the permission fails OPEN, not closed. AWS's
    // own documentation uses this condition for exactly this global-profile scenario.
    const profileArn = `arn:aws:bedrock:${region}:${account}:inference-profile/${RANK_MODEL}`;
    this.rank.addToRolePolicy(new iam.PolicyStatement({
      actions: ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
      resources: [
        profileArn,
        // Every region the profile can route to. Omitting them produces INTERMITTENT
        // AccessDeniedException that fails only when a request happens to route to an
        // unlisted region — the non-determinism is what pushes people to attach
        // AmazonBedrockFullAccess. Spec §9.
        `arn:aws:bedrock:*::foundation-model/${BARE_MODEL}`,
      ],
      conditions: { StringEquals: { "bedrock:InferenceProfileArn": profileArn } },
    }));

    ssm.StringParameter.fromSecureStringParameterAttributes(this, "GithubToken", {
      parameterName: props.githubTokenParam,
    }).grantRead(this.rank);

    new scheduler.CfnSchedule(this, "CaptureSchedule", {
      flexibleTimeWindow: { mode: "OFF" },
      scheduleExpression: "rate(1 hour)",
      target: { arn: this.capture.functionArn, roleArn: this.schedulerRole(this.capture).roleArn },
    });

    new scheduler.CfnSchedule(this, "RankSchedule", {
      flexibleTimeWindow: { mode: "OFF" },
      scheduleExpression: "cron(0 6 * * ? *)",
      scheduleExpressionTimezone: "Europe/Istanbul",
      target: { arn: this.rank.functionArn, roleArn: this.schedulerRole(this.rank).roleArn },
    });

    this.vercel = this.vercelReader(props.table);
  }

  private schedulerRole(fn: lambda.IFunction): iam.Role {
    const role = new iam.Role(this, `${fn.node.id}SchedulerRole`, {
      assumedBy: new iam.ServicePrincipal("scheduler.amazonaws.com"),
    });
    fn.grantInvoke(role);
    return role;
  }

  private vercelReader(table: dynamodb.TableV2): iam.User {
    const user = new iam.User(this, "VercelReader");
    user.addToPolicy(new iam.PolicyStatement({
      actions: ["dynamodb:Query", "dynamodb:GetItem"],
      resources: [table.tableArn, `${table.tableArn}/index/*`],
    }));
    // Capture only, never rank. Spec §2: a refresh path that reaches ranking lets a stuck
    // finger — or a leaked secret — spend the credit balance.
    user.addToPolicy(new iam.PolicyStatement({
      actions: ["lambda:InvokeFunction"],
      resources: [this.capture.functionArn],
    }));
    return user;
  }
}
```

**No access key is created here, deliberately.** A `CfnAccessKey`'s secret is surfaced as a
stack Output, readable by anyone holding `cloudformation:DescribeStacks` — and it persists in
stack state long after the credential should have been rotated. (`GetTemplate` is *not* the
vector: it returns declarations, not resolved Output values.) The runbook has a human mint the
key in the console and paste it straight into Vercel.

**Consequence to carry into the runbook:** because the key is minted outside CDK, it is
invisible to `cdk diff`. Anything that forces replacement of the `VercelReader` user construct
silently destroys the key with no warning, and the site starts returning errors.

- [ ] **Step 3: Add the tests for the conditions and the Vercel user**

```ts
it("scopes each role to the key prefixes its own code writes", () => {
  // Without this, PutItem on the table ARN lets a compromised role overwrite any article
  // wholesale and forge META#DAY.
  const doc = capturePolicyDocument();
  const put = doc.Statement.find((s: any) => String(s.Action).includes("PutItem"))!;
  expect(JSON.stringify(put.Condition)).toContain("META#lastRun");
  const upd = doc.Statement.find((s: any) => String(s.Action).includes("UpdateItem"))!;
  expect(JSON.stringify(upd.Condition)).toContain("ART#");
});

it("binds the bedrock grant to the inference profile, so it cannot fail open", () => {
  // Without the condition the foundation-model ARN also authorises direct on-demand
  // invocation of the bare model, bypassing the global profile.
  const stmt = rankPolicyDocument().Statement.find((s: any) => String(s.Action).includes("bedrock"))!;
  expect(JSON.stringify(stmt.Condition)).toContain("bedrock:InferenceProfileArn");
});

it("gives each function its own log group rather than logs on every log group", () => {
  const template_ = template();
  expect(Object.keys(template_.findResources("AWS::Logs::LogGroup"))).toHaveLength(2);
});

it("caps rank at one concurrent execution and zero async retries", () => {
  // Concurrency: spec §9 — two interleaved runs write two incompatible clusterings into one
  // day. Retries: a hard kill would otherwise re-bill the same ~$0.50 Bedrock call 3x.
  template().hasResourceProperties("AWS::Lambda::Function", {
    ReservedConcurrentExecutions: 1,
  });
  template().hasResourceProperties("AWS::Lambda::EventInvokeConfig", {
    MaximumRetryAttempts: 0,
  });
});

it("leaves the rank timeout well above the in-handler abort point", () => {
  // 900s Lambda vs 600s abort. Equal values mean the degraded fallback never runs, because a
  // Lambda timeout kills the environment with no catchable signal.
  const fns = Object.values(template().findResources("AWS::Lambda::Function"));
  const rank = fns.find((f) => JSON.stringify(f).includes("rank"))!;
  expect(rank.Properties.Timeout).toBeGreaterThan(600);
});

it("gives the Vercel user no write and no bedrock permission", () => {
  const json = JSON.stringify(vercelPolicyDocument());
  for (const forbidden of ["bedrock", "dynamodb:PutItem", "dynamodb:UpdateItem",
                           "dynamodb:DeleteItem", "dynamodb:Scan"]) {
    expect(json, forbidden).not.toContain(forbidden);
  }
});

it("lets the Vercel user invoke capture but not rank", () => {
  const json = JSON.stringify(vercelPolicyDocument());
  expect(json).toContain("CaptureFunction");
  expect(json).not.toContain("RankFunction");
});

it("creates no access key in the template", () => {
  expect(Object.keys(template().findResources("AWS::IAM::AccessKey"))).toHaveLength(0);
});

it("gives neither function permission to delete table items", () => {
  for (const doc of [capturePolicyDocument(), rankPolicyDocument()]) {
    expect(JSON.stringify(doc)).not.toContain("dynamodb:DeleteItem");
    expect(JSON.stringify(doc)).not.toContain("dynamodb:Scan");
  }
});
```

- [ ] **Step 4: Wire everything into the stack**

The stack composition was previously left implicit. Write it out — and note that
`backupRepo` and `githubTokenParam` are required with no defaults, so they must be sourced
explicitly like `alertEmail` is:

```ts
// infra/lib/ai-news-stack.ts
import { Stack, type StackProps } from "aws-cdk-lib";
import type { Construct } from "constructs";
import { ArticleTable } from "./table.js";
import { Functions } from "./functions.js";

export interface AiNewsStackProps extends StackProps {
  alertEmail: string;
  backupRepo: string;
  githubTokenParam: string;
}

export class AiNewsStack extends Stack {
  readonly articleTable: ArticleTable;
  readonly functions: Functions;

  constructor(scope: Construct, id: string, props: AiNewsStackProps) {
    super(scope, id, props);

    this.articleTable = new ArticleTable(this, "Articles");

    this.functions = new Functions(this, "Functions", {
      table: this.articleTable.table,
      backupRepo: props.backupRepo,
      githubTokenParam: props.githubTokenParam,
    });

    // Monitoring is added by Task 9, which owns `monitoring.ts`. Do not import it here yet —
    // this task must compile and synth on its own.
  }
}
```

```ts
// infra/bin/ai-news.ts
import { App } from "aws-cdk-lib";
import { AiNewsStack } from "../lib/ai-news-stack.js";

const app = new App();

/** Fails loudly rather than deploying a stack with no alert subscriber or no backup target. */
function required(key: string): string {
  const v = app.node.tryGetContext(key);
  if (typeof v !== "string" || v.length === 0) {
    throw new Error(`missing required context: -c ${key}=<value>`);
  }
  return v;
}

new AiNewsStack(app, "AiNewsStack", {
  // Account and region come from the environment so moving accounts is a profile change,
  // not a code change. Spec §2, portability.
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? "eu-central-1",
  },
  alertEmail: required("alertEmail"),
  backupRepo: app.node.tryGetContext("backupRepo") ?? "EienMosu/ai-news",
  githubTokenParam: app.node.tryGetContext("githubTokenParam") ?? "/ai-news/github-token",
});
```

The `AiNewsStack` in Task 3's tests must be updated to pass the three new props.

- [ ] **Step 5: Run the tests and synth**

```bash
pnpm vitest run tests/infra
pnpm synth -c alertEmail=someone@example.com
```

- [ ] **Step 6: Commit**

```bash
git add infra tests/infra package.json pnpm-lock.yaml
git commit -m "feat: add both Lambdas, their least-privilege IAM, and the schedules"
```

---

### Task 9: CDK — alarms, SNS, and budgets

Spec §8. Sized so that every alarm firing means something, because an alarm that fires during
normal operation is ignored within a week and is worse than no alarm at all.

**Files:**
- Create: `infra/lib/monitoring.ts`
- Modify: `infra/lib/ai-news-stack.ts`, `infra/bin/ai-news.ts`
- Test: `tests/infra/monitoring.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
it("alarms only on our functions, never account-wide", () => {
  // The account already contains an unrelated HelloWorld function. An account-wide Lambda
  // Errors alarm would fire on someone else's experiment and teach us to ignore it.
  for (const alarm of Object.values(template().findResources("AWS::CloudWatch::Alarm"))) {
    const dims = alarm.Properties.Dimensions ?? alarm.Properties.Metrics?.[0]?.MetricStat?.Metric?.Dimensions;
    expect(dims, JSON.stringify(alarm.Properties.AlarmName)).toBeDefined();
  }
});

it("treats missing invocations as breaching, which is what catches a stopped schedule", () => {
  // The default (treatMissingData: notBreaching) makes this alarm silent in exactly the
  // failure it exists to detect: the schedule stops, so no datapoint is ever published.
  template().hasResourceProperties("AWS::CloudWatch::Alarm", {
    TreatMissingData: "breaching",
    Threshold: 1,
    ComparisonOperator: "LessThanThreshold",
  });
});

it("sets budget thresholds above expected spend, not at zero", () => {
  const budgets = Object.values(template().findResources("AWS::Budgets::Budget"));
  const limits = budgets.map((b) => Number(b.Properties.Budget.BudgetLimit.Amount)).sort((a, b) => a - b);
  expect(limits).toEqual([15, 30]);
});
```

- [ ] **Step 2: Write `infra/lib/monitoring.ts`**

```ts
import { Duration, Stack } from "aws-cdk-lib";
import * as budgets from "aws-cdk-lib/aws-budgets";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as actions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subs from "aws-cdk-lib/aws-sns-subscriptions";
import type { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Construct } from "constructs";

export interface MonitoringProps {
  capture: NodejsFunction;
  rank: NodejsFunction;
  alertEmail: string;
}

export class Monitoring extends Construct {
  constructor(scope: Construct, id: string, props: MonitoringProps) {
    super(scope, id);

    const topic = new sns.Topic(this, "Alerts", { displayName: "ai-news alerts" });
    topic.addSubscription(new subs.EmailSubscription(props.alertEmail));
    const notify = new actions.SnsAction(topic);

    for (const fn of [props.capture, props.rank]) {
      // Per-function metric, not the account-wide Lambda namespace.
      new cloudwatch.Alarm(this, `${fn.node.id}Errors`, {
        metric: fn.metricErrors({ period: Duration.hours(1) }),
        threshold: 1,
        evaluationPeriods: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      }).addAlarmAction(notify);
    }

    // The alarm that matters most. If EventBridge stops firing, no error is ever raised and
    // no datapoint is ever published — the system goes quiet and looks healthy. Only
    // treatMissingData: BREACHING turns that silence into a page.
    new cloudwatch.Alarm(this, "CaptureStopped", {
      metric: props.capture.metricInvocations({ period: Duration.hours(25) }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.BREACHING,
    }).addAlarmAction(notify);

    // Thresholds sit above expected spend (~$10/month, essentially all Bedrock). A $5 budget
    // would fire during normal operation. Spec §8.
    // Budget names are unique per ACCOUNT, not per stack, so a hardcoded name makes a second
    // deploy of this template into the same account fail. Derived from the stack name instead.
    const stackName = Stack.of(this).stackName;
    for (const [suffix, amount] of [["warning", 15], ["investigate", 30]] as const) {
      new budgets.CfnBudget(this, `Budget${suffix}`, {
        budget: {
          budgetName: `${stackName}-${suffix}`,
          // Deliberately NOT tag-scoped. A cost-allocation tag filter is more precise, but the
          // tag must first be activated by hand in the Billing console and takes up to 24h to
          // take effect — until then the filter matches nothing and the budget is silently
          // dead. A budget that does not fire is worse than one that is slightly broad, which
          // is the same principle that set these thresholds at $15/$30 instead of $5.
          // This account holds one unrelated resource (a HelloWorld Lambda costing ~$0), so
          // account-wide and stack-scoped are equivalent here in practice. Revisit if the
          // account ever runs a second real workload.
          budgetType: "COST",
          timeUnit: "MONTHLY",
          budgetLimit: { amount, unit: "USD" },
        },
        notificationsWithSubscribers: [{
          notification: {
            notificationType: "ACTUAL",
            comparisonOperator: "GREATER_THAN",
            threshold: 100,
            thresholdType: "PERCENTAGE",
          },
          subscribers: [{ subscriptionType: "EMAIL", address: props.alertEmail }],
        }],
      });
    }
  }
}
```

The alert email comes from CDK context (`-c alertEmail=...`), not from a literal in source.
Read it in `infra/bin/ai-news.ts` with `app.node.tryGetContext("alertEmail")` and fail loudly
if it is absent — a monitoring stack that silently deploys with no subscriber is worse than
one that refuses to deploy.

- [ ] **Step 3: Wire `Monitoring` into the stack**

Task 8 deliberately left this out so that it could compile and synth on its own. Add the
import and the construct to `infra/lib/ai-news-stack.ts`:

```ts
import { Monitoring } from "./monitoring.js";
```

and, at the end of the `AiNewsStack` constructor:

```ts
    new Monitoring(this, "Monitoring", {
      capture: this.functions.capture,
      rank: this.functions.rank,
      alertEmail: props.alertEmail,
    });
```

`AiNewsStackProps.alertEmail` and the `required("alertEmail")` call in
`infra/bin/ai-news.ts` already exist from Task 8 — do not duplicate them.

- [ ] **Step 4: Run tests, synth, commit**

```bash
pnpm vitest run tests/infra && pnpm synth -c alertEmail=someone@example.com
git add infra tests/infra
git commit -m "feat: add alarms, an SNS topic, and the two budget guards"
```

---

### Task 10: Smoke script and deployment runbook

The plan's deliverable is a system somebody can deploy, verify, and move. This task is what
makes that true. **No step in this task deploys anything** — the runbook is written for a
human to execute, and Task 10's own verification is the read-only smoke script.

**Files:**
- Create: `scripts/smoke.ts`, `docs/RUNBOOK.md`
- Test: `tests/scripts/smoke.test.ts`

- [ ] **Step 1: Write `scripts/smoke.ts`**

Read-only by default. Step 6 is the only step that spends anything (~$0.0001) and is the only
one that proves the Bedrock path end to end, so it sits behind `--with-bedrock`.

```ts
import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { DescribeTableCommand, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { SchedulerClient, ListSchedulesCommand } from "@aws-sdk/client-scheduler";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import { RANK_MODEL } from "../src/lib/rank/model.js";
import { docClient } from "../src/lib/store/client.js";
import { listDays } from "../src/lib/store/query.js";

const TABLE = process.env.TABLE_NAME ?? "";
const TOKEN_PARAM = process.env.GITHUB_TOKEN_PARAM ?? "/ai-news/github-token";
const withBedrock = process.argv.includes("--with-bedrock");

let failures = 0;
const ok = (m: string) => console.log(`  ok   ${m}`);
const fail = (m: string) => { failures += 1; console.log(`  FAIL ${m}`); };

async function check(name: string, fn: () => Promise<void>) {
  try { await fn(); } catch (e) { fail(`${name}: ${e instanceof Error ? e.message : e}`); }
}

await check("table", async () => {
  const t = (await new DynamoDBClient({}).send(
    new DescribeTableCommand({ TableName: TABLE }))).Table!;
  t.TableStatus === "ACTIVE" ? ok("table ACTIVE") : fail(`table ${t.TableStatus}`);
  t.BillingModeSummary?.BillingMode === "PAY_PER_REQUEST"
    ? ok("billing PAY_PER_REQUEST")
    : fail(`billing is ${t.BillingModeSummary?.BillingMode} -- provisioned costs ~$28/mo here`);
  const gsi = t.GlobalSecondaryIndexes?.find((g) => g.IndexName === "feed-by-day");
  gsi?.IndexStatus === "ACTIVE" ? ok("GSI feed-by-day ACTIVE") : fail("GSI missing or not ACTIVE");
});

await check("lastRun", async () => {
  const out = await docClient().send(new (await import("@aws-sdk/lib-dynamodb")).GetCommand({
    TableName: TABLE, Key: { pk: "META#lastRun", sk: "A" },
  }));
  const r = out.Item;
  if (!r) return fail("META#lastRun absent -- capture has never completed");
  const ageMin = Math.round((Date.now() - Date.parse(String(r.startedAt))) / 60000);
  ok(`last run ${ageMin}m ago, ${r.itemsWritten} written, ${r.itemsFailed} failed`);
  if (ageMin > 130) fail(`last run ${ageMin}m ago -- hourly schedule may have stopped`);

  // Spec §8: produced 0 AND filtered 0 AND quarantined 0 AND no error is the ONLY
  // signature that means dead. Anything else is quiet, rate-limited, or drifting.
  for (const [id, produced] of Object.entries(r.perSourceCounts ?? {})) {
    const filtered = (r.filtered ?? {})[id] ?? 0;
    const quarantined = (r.quarantined ?? {})[id] ?? 0;
    const errored = (r.errors ?? []).some((e: { source: string }) => e.source === id);
    if (quarantined > 0) fail(`${id}: ${quarantined} quarantined -- feed shape changed`);
    else if (produced === 0 && filtered === 0 && !errored) fail(`${id}: dead (nothing at all)`);
    else if (produced === 0 && errored) ok(`${id}: fetch error, not dead`);
    else if (produced === 0) ok(`${id}: quiet (${filtered} filtered)`);
  }
});

await check("days", async () => {
  for (const d of await listDays(docClient(), TABLE, 5)) {
    ok(`${d.day} ${d.status} ${d.articleCount} articles`);
  }
});

await check("github token", async () => {
  // WithDecryption is deliberately false. This proves the parameter exists without ever
  // materialising the PAT in this process or in a terminal scrollback.
  await new SSMClient({}).send(new GetParameterCommand({ Name: TOKEN_PARAM }));
  ok(`${TOKEN_PARAM} present (value not read)`);
});

await check("schedules", async () => {
  const out = await new SchedulerClient({}).send(new ListSchedulesCommand({}));
  const mine = (out.Schedules ?? []).filter((s) => (s.Name ?? "").includes("Schedule"));
  mine.length >= 2 ? ok(`${mine.length} schedules`) : fail(`only ${mine.length} schedules`);
  for (const s of mine) {
    s.State === "ENABLED" ? ok(`${s.Name} ENABLED`) : fail(`${s.Name} is ${s.State}`);
  }
});

if (withBedrock) {
  await check("bedrock", async () => {
    const t0 = Date.now();
    const out = await new BedrockRuntimeClient({}).send(new ConverseCommand({
      modelId: RANK_MODEL,
      messages: [{ role: "user", content: [{ text: "Reply with exactly: OK" }] }],
      inferenceConfig: { maxTokens: 16 },
    }));
    ok(`${RANK_MODEL} responded in ${Date.now() - t0}ms, ` +
       `${out.usage?.totalTokens} tokens (~$0.0001)`);
  });
} else {
  console.log("  skip bedrock (pass --with-bedrock to verify the ranking path)");
}

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
```

Add the script to `package.json` using the same loader hook as `dry-run`, and
`pnpm add -D @aws-sdk/client-scheduler @aws-sdk/client-bedrock-runtime`.

- [ ] **Step 2: Write `docs/RUNBOOK.md`**

Must contain, in order:

**Deploy (first time)**
1. `aws sts get-caller-identity` — confirm account `356117015048` before anything else.
2. `pnpm cdk bootstrap aws://356117015048/eu-central-1` — not currently bootstrapped.
3. **Create the GitHub PAT** — human only, never an agent. Scope: `contents:write` on
   `EienMosu/ai-news` only. Then:
   `aws ssm put-parameter --name /ai-news/github-token --type SecureString --value '<PAT>' --region eu-central-1`
   Note the shell-history caveat: prefix the command with a space, or use `--value file://`.
4. `pnpm cdk deploy -c alertEmail=<email>`
5. **Confirm the SNS subscription email.** Until this is clicked, every alarm is silent.
6. `pnpm smoke --with-bedrock`
7. `aws lambda invoke --function-name <CaptureFunction> /dev/stdout` — then re-run `pnpm smoke`
   and confirm `itemsWritten > 0`.
8. `aws lambda invoke --function-name <RankFunction> --payload '{"day":"<today>"}' /dev/stdout`
9. Confirm `archive/<day>.ndjson` exists in the GitHub repo.
10. **Mint the Vercel access key** — human only. IAM console → user `VercelReader` → create
    access key → paste directly into Vercel's environment variables. Do not write it to a
    file, and do not echo it. The CDK stack deliberately does not create it (see Task 8).

    ⚠️ **The key is invisible to CDK.** Because it is minted outside the stack, `cdk diff`
    will never mention it. Any change that forces replacement of the `VercelReader` user
    construct destroys the key silently, and the site begins returning errors with no
    deployment warning. If you ever rename or move that construct, re-mint the key and update
    Vercel in the same change.

**GO / NO-GO before step 4 — resolve the two pre-existing budgets**

This is a gate, not a footnote. Both will misfire *every month under normal operation*, and a
budget alert that cries wolf monthly is ignored within a week — which is exactly the state in
which a real overspend goes unnoticed.

- `My Zero-Spend Budget` ($1). Bedrock has **no always-free tier**, so this fires on the first
  ranked day, permanently.
- `My Monthly Cost Budget 10USD` ($10). This system is expected to cost **$12–18/month**, so
  this fires most months.

Decide for each: delete, raise, or knowingly accept the monthly noise. This plan deliberately
does not touch budgets it did not create — they are yours. Record the decision, then deploy.

An unrelated `HelloWorld` Lambda also exists. The CloudWatch alarms here are per-function and
ignore it; the budgets are account-wide and will include it (it costs ~$0).

**Rollback**
- `pnpm cdk destroy` removes the functions, schedules, alarms and budgets.
- **The table is `RETAIN` and survives on purpose.** It holds the archive. To remove it, delete
  it explicitly in the console after confirming the GitHub NDJSON copies are current.

**Moving to another AWS account**
1. `aws configure --profile new` and set the target credentials.
2. `pnpm cdk bootstrap --profile new aws://<new-account>/<region>`
3. Recreate the SSM parameter in the new account (step 3 above).
4. Request Bedrock model access for `anthropic.claude-sonnet-4-6` in the new account and
   confirm with `aws bedrock list-inference-profiles`. **This is the step most likely to
   block a migration** — model access is per-account and console-gated.
5. `pnpm cdk deploy --profile new -c alertEmail=<email>`
6. Backfill by replaying `archive/*.ndjson` into the new table.

Nothing in this list requires editing source. That is the portability requirement from
spec §2, and if a future change breaks it, this list is where it will show.

- [ ] **Step 3: Verify and commit**

Run: `pnpm test && pnpm typecheck && pnpm synth -c alertEmail=x@example.com`

```bash
git add scripts docs/RUNBOOK.md tests/scripts
git commit -m "feat: add the smoke script and the deployment runbook"
```

---

## What this plan does NOT do

- **It does not deploy.** Every task stops at `cdk synth`. Deployment is the runbook, run by
  a human who has confirmed the account.
- **It does not build the UI.** The feed, the day sections, the cards and the detail page are
  Plan 3. This plan's `queryDay` / `listDays` / `getLatestCompleteDay` are the interface it
  will read through.
- **It does not create the GitHub PAT or the Vercel IAM access key.** Both are secrets; both
  are human steps in the runbook.
- **It does not touch the two pre-existing budgets or the HelloWorld function.** They belong
  to the account owner.

## Constraints this plan places on Plan 3 (the UI)

1. `summary` may contain bracketed text that survived tag stripping (`<model>`, `<think>`).
   **Render it as text. Never `dangerouslySetInnerHTML`.**
2. An article whose `scoreVersion` is `v1-degraded` has not been ranked. Spec §2 requires it
   to be marked "new since last ranking" rather than mixed silently into the ranking.
3. `clusterId` starting with `__self__:` is not a cluster — show no cluster affordance.
4. The feed reads `META#DAY` → `queryDay`. It must never compute a date itself (spec §4).
5. `getLatestCompleteDay` may return a `partial` day when no complete one exists in the last
   30. Read `status`, `llmRanked` and `truncated` off the `META#DAY` item and say so in the UI
   rather than presenting a partial day as final.
6. **Spec §9's per-day run counter for `/api/ingest` cannot live in the Vercel layer.**
   `VercelReader` has no write permission at all, by design. The counter must be implemented
   inside the capture Lambda, which is the only thing on that path that can write.

---

## Revision 2 — what four independent reviews and one re-reading changed

Plan 2 was reviewed by four subagents on separate axes (CDK correctness, IAM/security,
operational correctness, cost) and re-read by its author against spec §6 line by line. Every
finding below was verified before it was accepted; several were verified by running something.

**Reverted to the spec.** Task 4 had drifted from spec §6 because it was written partly from
memory of the architecture rather than from the spec text: a forced tool call instead of
`output_config.format`, `.create()` instead of `.stream()`, no `stop_reason === "max_tokens"`
branch, and no `effort: "medium"`. The truncation branch is the serious one — without it a
truncated run is billed for the full 32k cap, returns unusable JSON, and still reports success,
which is precisely the "looks identical to an outage" failure spec §6 names. Two of these four
were found independently by the cost reviewer, from a different direction.

**The score-reversion defect.** `buildCaptureUpdate` wrote `score`/`gsi1sk` unconditionally, so
hourly capture reverted every already-ranked article's position back to its degraded score an
hour after ranking. Enrichment survived; the ordering did not. Task 2 had the `if_not_exists`
rules written correctly and then defeated them by putting score in the always-write group.

**Spec requirements that had been dropped entirely.** §9's reserved-concurrency-plus-lock;
§9's scoped log group; §5's `<ingestDay>#` cluster namespace; and §5's end-of-run re-read that
recomputes `corroborationToday` for the whole day — the last is the spec's actual idempotency
mechanism, and without it a second rank run on the same day silently produces different
corroboration for every article.

**IAM that failed open.** The Bedrock statement lacked a `bedrock:InferenceProfileArn`
condition, so the foundation-model ARN also authorised direct on-demand invocation of the bare
model, bypassing the `global.` profile. DynamoDB grants had no `LeadingKeys` condition, so a
compromised role could overwrite any article wholesale or forge `META#DAY`.

**Money.** `retryAttempts: 0` on rank, because Lambda's default 2× async retry re-bills the
same ~$0.50 Bedrock call up to three times after a hard kill. The Lambda timeout moved from
600s to 900s so it no longer equals the in-handler abort point — equal values mean the
degraded fallback can never run. And the cost table is now a range with the thinking-token
component labelled as the estimate it always was: **$12–18/month**, not the ~$10 first claimed.

**Two things verified and deliberately left alone.** The ESM/type-stripping toolchain was run
end to end and works. The spec's own "conditional put (`attribute_not_exists(pk)`)" line was
checked against AWS's documented billing behaviour and **would not save money even if
implemented** — so it should be deleted from the spec rather than built.

**Corrected in this document.** The `CfnAccessKey` rationale cited `cloudformation:GetTemplate`
as the exposure vector. That is wrong: `GetTemplate` returns declarations, not resolved Output
values, and `DescribeStacks` is the actual vector. The conclusion is unchanged; a plan that
argues from a false mechanism teaches the reader something untrue.
