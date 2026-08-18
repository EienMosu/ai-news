# ai-news Core Domain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build every piece of pure logic the pipeline needs — scoring, sort-key encoding, URL identity, day derivation, feed parsing, LLM-response reconciliation — and a dry-run script that fetches real feeds and prints a ranked list, with no AWS involved.

**Architecture:** Pure functions in `src/lib/core`, source adapters in `src/lib/ingest`, all TDD. No I/O in the core; fetchers are the only network boundary and are tested against saved fixtures. The dry-run script wires them together so the whole pipeline is observable before a single cloud resource exists.

**Tech Stack:** TypeScript 5, Vitest 4, Zod 4, pnpm 10.34, Node 24. `fast-xml-parser` for RSS/Atom. No framework yet — Next.js arrives in Plan 3.

**Spec:** `docs/superpowers/specs/2026-08-18-ai-news-design.md`

## Global Constraints

- Node 24, pnpm 10.34, TypeScript 5, Vitest 4, Zod 4. ESM (`"type": "module"`).
- **No network in tests.** Feed parsing is tested against fixtures committed under `tests/fixtures/`.
- **Score encoding:** `Math.round` then clamp to `[0, 9999]` then `padStart(4,'0')`. Both the rounding and the clamp are load-bearing — see spec §5.
- **Missing data is imputed, never zeroed and never renormalized** — spec §5. `points: null` → `pnorm = 0.5`. `llmImportance: null` → `50` + `scoreVersion = "v1-degraded"`. `publishedAt` missing → fall back to `ingestedAt`. `ageHours` clamped at `0`.
- **Weights sum to exactly 1.00:** llmImportance 0.30, sourceWeight 0.30, corroborationToday 0.15, pnorm 0.15, recency 0.10.
- Timezone for all day derivation: `Europe/Istanbul`, via `Intl.DateTimeFormat('en-CA', ...)`. Never `toISOString().slice(0,10)`.
- Commit after every task. No Claude attribution in commit messages.

---

### Task 1: Project scaffold and the sort-key encoder

The sort key goes first because it is the single highest-risk line in the codebase: the score is a float, and an unrounded float breaks lexicographic ordering silently (spec §5).

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`
- Create: `src/lib/core/sortKey.ts`
- Test: `tests/core/sortKey.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `buildSortKey(score: number, urlHash: string): string`

- [ ] **Step 1: Scaffold the project**

```bash
cd ~/Desktop/workspace/ai-news
pnpm init
pnpm add -D typescript vitest @types/node
pnpm add zod
```

`package.json` — set `"type": "module"` and the scripts:

```json
{
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  }
}
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["node"],
    "outDir": "dist"
  },
  "include": ["src", "tests", "scripts"]
}
```

`vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
});
```

- [ ] **Step 2: Write the failing tests**

`tests/core/sortKey.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildSortKey } from "../../src/lib/core/sortKey.js";

const HASH = "a".repeat(64);

describe("buildSortKey", () => {
  it("rounds a float score rather than letting it widen the field", () => {
    expect(buildSortKey(814.4, HASH)).toBe(`0814#${HASH}`);
  });

  it("pads to exactly four digits", () => {
    expect(buildSortKey(7, HASH)).toBe(`0007#${HASH}`);
    expect(buildSortKey(1000, HASH)).toBe(`1000#${HASH}`);
  });

  it("clamps out-of-range scores", () => {
    expect(buildSortKey(-5, HASH)).toBe(`0000#${HASH}`);
    expect(buildSortKey(99999, HASH)).toBe(`9999#${HASH}`);
  });

  it("never emits a key whose score field is not four characters", () => {
    for (const s of [0, 0.4, 9.9, 99.5, 999.99, 1000, 12345, -1, NaN]) {
      expect(buildSortKey(s, HASH).split("#")[0]).toHaveLength(4);
    }
  });

  // The property that the whole ranking depends on.
  it("orders lexicographically exactly as it orders numerically", () => {
    const scores = [814.4, 93.6, 9.87, 744.1, 704.1, 604.1, 468.7, 1000, 0, 55.5];
    const byString = [...scores]
      .map((s) => ({ s, k: buildSortKey(s, HASH) }))
      .sort((a, b) => (a.k < b.k ? 1 : a.k > b.k ? -1 : 0))
      .map((x) => Math.round(x.s));
    const byNumber = [...scores].map(Math.round).sort((a, b) => b - a);
    expect(byString).toEqual(byNumber);
  });

  it("holds the ordering property over random scores", () => {
    for (let run = 0; run < 200; run++) {
      const scores = Array.from({ length: 25 }, () => Math.random() * 1000);
      const byString = [...scores]
        .map((s) => ({ s, k: buildSortKey(s, HASH) }))
        .sort((a, b) => (a.k < b.k ? 1 : a.k > b.k ? -1 : 0))
        .map((x) => Math.round(x.s));
      const byNumber = [...scores].map(Math.round).sort((a, b) => b - a);
      expect(byString).toEqual(byNumber);
    }
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm test -- sortKey`
Expected: FAIL — cannot resolve `../../src/lib/core/sortKey.js`

- [ ] **Step 4: Write the implementation**

`src/lib/core/sortKey.ts`:

```ts
/**
 * GSI1 sort key. DynamoDB compares string sort keys lexicographically, so the
 * score field must be fixed-width — which means rounding an inherently float
 * score, and clamping so nothing can widen the field. See spec §5.
 */
export function buildSortKey(score: number, urlHash: string): string {
  const safe = Number.isFinite(score) ? score : 0;
  const bounded = Math.min(9999, Math.max(0, Math.round(safe)));
  return `${String(bounded).padStart(4, "0")}#${urlHash}`;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm test -- sortKey`
Expected: PASS, 6 tests

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml tsconfig.json vitest.config.ts src/lib/core/sortKey.ts tests/core/sortKey.test.ts
git commit -m "feat: add GSI sort-key encoder with ordering property test

Score is a float; padStart on an unrounded float leaves a five-character
field and lexicographic comparison then inverts the ranking. Round and
clamp before padding."
```

---

### Task 2: Istanbul day derivation

**Files:**
- Create: `src/lib/core/day.ts`
- Test: `tests/core/day.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `istanbulDay(at: Date): string` returning `YYYY-MM-DD`

- [ ] **Step 1: Write the failing tests**

`tests/core/day.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { istanbulDay } from "../../src/lib/core/day.js";

describe("istanbulDay", () => {
  // Turkey is a constant UTC+3, so 21:00Z is already the next local day.
  // This is the exact bug the design review caught: toISOString().slice(0,10)
  // would stamp the previous day here, every day.
  it("treats 21:00Z as the next Istanbul day", () => {
    expect(istanbulDay(new Date("2026-08-17T21:00:00Z"))).toBe("2026-08-18");
  });

  it("treats 20:59Z as still the same Istanbul day", () => {
    expect(istanbulDay(new Date("2026-08-17T20:59:00Z"))).toBe("2026-08-17");
  });

  it("handles the 23:59 local boundary", () => {
    expect(istanbulDay(new Date("2026-08-18T20:59:59Z"))).toBe("2026-08-18");
  });

  it("handles the 00:01 local boundary", () => {
    expect(istanbulDay(new Date("2026-08-18T21:01:00Z"))).toBe("2026-08-19");
  });

  it("crosses month and year boundaries", () => {
    expect(istanbulDay(new Date("2026-12-31T21:00:00Z"))).toBe("2027-01-01");
  });

  it("differs from the naive UTC derivation at the hours that matter", () => {
    const d = new Date("2026-08-17T22:00:00Z");
    expect(d.toISOString().slice(0, 10)).toBe("2026-08-17");
    expect(istanbulDay(d)).toBe("2026-08-18");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test -- day`
Expected: FAIL — cannot resolve `../../src/lib/core/day.js`

- [ ] **Step 3: Write the implementation**

`src/lib/core/day.ts`:

```ts
const FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Istanbul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * The single source of truth for "which day is this". Derived once during
 * capture and persisted as `ingestDay`; readers follow the stored pointer and
 * never compute a date. See spec §4.
 *
 * en-CA formats as YYYY-MM-DD, which is what we want for lexicographic keys.
 */
export function istanbulDay(at: Date): string {
  return FORMATTER.format(at);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test -- day`
Expected: PASS, 6 tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/core/day.ts tests/core/day.test.ts
git commit -m "feat: derive ingest day in Europe/Istanbul

Lambda and Vercel both default to TZ=UTC and Turkey is a constant UTC+3,
so the naive UTC derivation stamps the previous day for the first three
hours of every local day."
```

---

### Task 3: URL normalization and content hash

**Files:**
- Create: `src/lib/core/url.ts`
- Test: `tests/core/url.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `normalizeUrl(raw: string): string`, `urlHash(normalized: string): string` (sha256 hex, 64 chars), `titleHash(title: string, sourceName: string): string`

- [ ] **Step 1: Write the failing tests**

`tests/core/url.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { normalizeUrl, urlHash, titleHash } from "../../src/lib/core/url.js";

describe("normalizeUrl", () => {
  it("lowercases the host but preserves path case", () => {
    expect(normalizeUrl("https://TechCrunch.com/Some-Post")).toBe(
      "https://techcrunch.com/Some-Post",
    );
  });

  it("strips tracking parameters", () => {
    expect(
      normalizeUrl("https://x.com/a?utm_source=rss&utm_medium=feed&gclid=1&id=7"),
    ).toBe("https://x.com/a?id=7");
  });

  it("strips every documented tracking parameter", () => {
    const url =
      "https://x.com/a?utm_campaign=c&fbclid=f&mc_cid=m&mc_eid=e&igshid=i&ref=r&source=s&at_medium=a";
    expect(normalizeUrl(url)).toBe("https://x.com/a");
  });

  it("strips a trailing slash", () => {
    expect(normalizeUrl("https://x.com/a/")).toBe("https://x.com/a");
  });

  it("strips text-fragment hashes", () => {
    expect(normalizeUrl("https://x.com/a#:~:text=hello")).toBe("https://x.com/a");
  });

  it("returns the input unchanged when it cannot be parsed", () => {
    expect(normalizeUrl("not a url")).toBe("not a url");
  });
});

describe("urlHash", () => {
  it("is a 64-character hex digest", () => {
    expect(urlHash("https://x.com/a")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic", () => {
    expect(urlHash("https://x.com/a")).toBe(urlHash("https://x.com/a"));
  });

  it("collapses tracking variants of one article to a single hash", () => {
    const a = urlHash(normalizeUrl("https://x.com/a?utm_source=rss"));
    const b = urlHash(normalizeUrl("https://x.com/a/"));
    expect(a).toBe(b);
  });

  it("separates genuinely different URLs", () => {
    expect(urlHash("https://x.com/a")).not.toBe(urlHash("https://x.com/b"));
  });
});

describe("titleHash", () => {
  it("is case-insensitive on the title", () => {
    expect(titleHash("OpenAI Ships GPT-6", "TechCrunch")).toBe(
      titleHash("openai ships gpt-6", "TechCrunch"),
    );
  });

  it("separates identical titles from different sources", () => {
    expect(titleHash("Same", "A")).not.toBe(titleHash("Same", "B"));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test -- url`
Expected: FAIL — cannot resolve `../../src/lib/core/url.js`

- [ ] **Step 3: Write the implementation**

`src/lib/core/url.ts`:

```ts
import { createHash } from "node:crypto";

const TRACKING_PREFIXES = ["utm_", "at_"];
const TRACKING_EXACT = new Set([
  "fbclid",
  "gclid",
  "mc_cid",
  "mc_eid",
  "igshid",
  "ref",
  "source",
]);

/**
 * Canonical URL form. urlHash is the item's primary key, so two spellings of
 * the same article must normalize identically or the archive grows duplicates.
 */
export function normalizeUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return raw;
  }

  u.hostname = u.hostname.toLowerCase();
  u.protocol = u.protocol.toLowerCase();
  u.hash = "";

  for (const key of [...u.searchParams.keys()]) {
    const lower = key.toLowerCase();
    if (TRACKING_EXACT.has(lower) || TRACKING_PREFIXES.some((p) => lower.startsWith(p))) {
      u.searchParams.delete(key);
    }
  }

  let out = u.toString();
  if (out.endsWith("?")) out = out.slice(0, -1);
  if (out.endsWith("/") && new URL(out).pathname !== "/") out = out.slice(0, -1);
  return out;
}

function sha256(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

export function urlHash(normalized: string): string {
  return sha256(normalized);
}

/**
 * Identity fallback for sources whose links are opaque redirect wrappers we
 * failed to resolve — notably the Google News RSS fallback used for Anthropic
 * (spec §3).
 */
export function titleHash(title: string, sourceName: string): string {
  return sha256(`${title.trim().toLowerCase()}|${sourceName}`);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test -- url`
Expected: PASS, 12 tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/core/url.ts tests/core/url.test.ts
git commit -m "feat: add URL normalization and content hashing

urlHash is the primary key, so tracking-parameter variants of one article
must collapse to a single hash or re-ingest duplicates the archive."
```

---

### Task 4: Article types and validation

**Files:**
- Create: `src/types/article.ts`
- Test: `tests/types/article.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `Category` (`"news" | "lab" | "community" | "research"`), `NormalizedArticleSchema`, `type NormalizedArticle`, `SOURCE_WEIGHTS: Record<Category, number>`

- [ ] **Step 1: Write the failing tests**

`tests/types/article.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { NormalizedArticleSchema, SOURCE_WEIGHTS } from "../../src/types/article.js";

const valid = {
  urlHash: "a".repeat(64),
  url: "https://techcrunch.com/post",
  title: "OpenAI ships GPT-6",
  summary: "The model is available today.",
  imageUrl: null,
  source: "techcrunch",
  sourceName: "TechCrunch",
  category: "news" as const,
  publishedAt: "2026-08-18T09:00:00.000Z",
  publishedAtSource: "feed" as const,
  points: null,
};

describe("NormalizedArticleSchema", () => {
  it("accepts a well-formed article", () => {
    expect(NormalizedArticleSchema.parse(valid)).toMatchObject({ title: valid.title });
  });

  it("rejects an empty title", () => {
    expect(() => NormalizedArticleSchema.parse({ ...valid, title: "  " })).toThrow();
  });

  it("rejects a malformed urlHash", () => {
    expect(() => NormalizedArticleSchema.parse({ ...valid, urlHash: "short" })).toThrow();
  });

  it("rejects an unknown category", () => {
    expect(() => NormalizedArticleSchema.parse({ ...valid, category: "sports" })).toThrow();
  });

  it("rejects a non-ISO publishedAt", () => {
    expect(() => NormalizedArticleSchema.parse({ ...valid, publishedAt: "yesterday" })).toThrow();
  });

  it("allows a null publishedAt with a fallback marker", () => {
    const parsed = NormalizedArticleSchema.parse({
      ...valid,
      publishedAt: null,
      publishedAtSource: "fallback",
    });
    expect(parsed.publishedAt).toBeNull();
  });
});

describe("SOURCE_WEIGHTS", () => {
  it("ranks labs above news above research above community", () => {
    expect(SOURCE_WEIGHTS.lab).toBeGreaterThan(SOURCE_WEIGHTS.news);
    expect(SOURCE_WEIGHTS.news).toBeGreaterThan(SOURCE_WEIGHTS.research);
    expect(SOURCE_WEIGHTS.research).toBeGreaterThan(SOURCE_WEIGHTS.community);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test -- article`
Expected: FAIL — cannot resolve `../../src/types/article.js`

- [ ] **Step 3: Write the implementation**

`src/types/article.ts`:

```ts
import { z } from "zod";

export const CATEGORIES = ["news", "lab", "community", "research"] as const;
export type Category = (typeof CATEGORIES)[number];

/** Spec §5. Labs are primary sources; community is the noisiest. */
export const SOURCE_WEIGHTS: Record<Category, number> = {
  lab: 1.0,
  news: 0.7,
  research: 0.6,
  community: 0.5,
};

const isoString = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), { message: "not an ISO timestamp" });

export const NormalizedArticleSchema = z.object({
  urlHash: z.string().regex(/^[0-9a-f]{64}$/),
  url: z.string().url(),
  title: z.string().trim().min(1),
  summary: z.string(),
  imageUrl: z.string().url().nullable(),
  source: z.string().min(1),
  sourceName: z.string().min(1),
  category: z.enum(CATEGORIES),
  publishedAt: isoString.nullable(),
  publishedAtSource: z.enum(["feed", "fallback"]),
  points: z.number().int().nonnegative().nullable(),
});

export type NormalizedArticle = z.infer<typeof NormalizedArticleSchema>;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test -- article`
Expected: PASS, 7 tests

- [ ] **Step 5: Commit**

```bash
git add src/types/article.ts tests/types/article.test.ts
git commit -m "feat: add normalized article schema and source weights

Validation runs before any write so malformed items are quarantined rather
than stored with undefined key attributes, which DynamoDB would silently
omit from the index."
```

---

### Task 5: Scoring

The missing-data handling here is the difference between a ranking that works and one that quietly inverts. Every branch corresponds to a finding in spec §5.

**Files:**
- Create: `src/lib/core/score.ts`
- Test: `tests/core/score.test.ts`

**Interfaces:**
- Consumes: `SOURCE_WEIGHTS`, `Category` from `src/types/article.ts`
- Produces: `WEIGHTS`, `SCORE_VERSION`, `DEGRADED_SCORE_VERSION`, `computeScore(input: ScoreInput): ScoreResult`, `type ScoreInput`, `type ScoreResult`

- [ ] **Step 1: Write the failing tests**

`tests/core/score.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { computeScore, WEIGHTS } from "../../src/lib/core/score.js";

const NOW = new Date("2026-08-18T12:00:00.000Z");

const base = {
  llmImportance: 80,
  category: "news" as const,
  corroborationToday: 3,
  points: null,
  publishedAt: "2026-08-18T04:00:00.000Z", // 8h old
  ingestedAt: NOW.toISOString(),
  now: NOW,
};

describe("WEIGHTS", () => {
  it("sums to exactly 1", () => {
    const total = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 10);
  });
});

describe("computeScore", () => {
  it("returns a score within [0, 1000]", () => {
    const { score } = computeScore(base);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1000);
  });

  it("imputes a neutral pnorm when points are absent rather than scoring zero", () => {
    const withoutPoints = computeScore({ ...base, points: null });
    const withZeroPoints = computeScore({ ...base, points: 0 });
    expect(withoutPoints.score).toBeGreaterThan(withZeroPoints.score);
    expect(withoutPoints.pointsImputed).toBe(true);
    expect(withZeroPoints.pointsImputed).toBe(false);
  });

  // The inversion the review found: a lab announcement has no engagement data
  // by construction, so treating null as zero hands the top of the feed to HN.
  it("keeps a lab announcement above a high-scoring community post", () => {
    const lab = computeScore({ ...base, category: "lab", points: null });
    const hn = computeScore({ ...base, category: "community", points: 500 });
    expect(lab.score).toBeGreaterThan(hn.score);
  });

  it("falls back to ingestedAt when publishedAt is missing", () => {
    const { score } = computeScore({ ...base, publishedAt: null });
    expect(Number.isFinite(score)).toBe(true);
  });

  it("never lets a future publishedAt exceed the recency ceiling", () => {
    const future = computeScore({
      ...base,
      publishedAt: "2026-08-20T12:00:00.000Z",
    });
    const fresh = computeScore({ ...base, publishedAt: NOW.toISOString() });
    expect(future.score).toBeLessThanOrEqual(fresh.score);
    expect(future.score).toBeLessThanOrEqual(1000);
  });

  it("clamps an out-of-range llmImportance", () => {
    const over = computeScore({ ...base, llmImportance: 150 });
    const max = computeScore({ ...base, llmImportance: 100 });
    expect(over.score).toBe(max.score);
  });

  it("imputes neutral values in degraded mode instead of renormalizing", () => {
    const degraded = computeScore({
      ...base,
      llmImportance: null,
      corroborationToday: null,
    });
    expect(degraded.scoreVersion).toBe("v1-degraded");
    expect(degraded.score).toBeGreaterThan(0);
  });

  // Renormalizing would triple the weight of points, which is null on every RSS
  // source, so any modest HN post would outrank the day's biggest lab news.
  it("keeps a lab announcement above a mid-tier HN post even when degraded", () => {
    const lab = computeScore({
      ...base,
      category: "lab",
      points: null,
      llmImportance: null,
      corroborationToday: null,
    });
    const hn = computeScore({
      ...base,
      category: "community",
      points: 20,
      llmImportance: null,
      corroborationToday: null,
    });
    expect(lab.score).toBeGreaterThan(hn.score);
  });

  it("caps the corroboration contribution at five sources", () => {
    const five = computeScore({ ...base, corroborationToday: 5 });
    const fifty = computeScore({ ...base, corroborationToday: 50 });
    expect(five.score).toBe(fifty.score);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test -- score`
Expected: FAIL — cannot resolve `../../src/lib/core/score.js`

- [ ] **Step 3: Write the implementation**

`src/lib/core/score.ts`:

```ts
import { SOURCE_WEIGHTS, type Category } from "../../types/article.js";

/** Spec §5. Must sum to 1. */
export const WEIGHTS = {
  llmImportance: 0.3,
  sourceWeight: 0.3,
  corroborationToday: 0.15,
  engagement: 0.15,
  recency: 0.1,
} as const;

export const SCORE_VERSION = "v1";
export const DEGRADED_SCORE_VERSION = "v1-degraded";

const POINTS_CEILING = 500;
const CORROBORATION_CEILING = 5;
const RECENCY_HALF_LIFE_HOURS = 24;

export interface ScoreInput {
  llmImportance: number | null;
  category: Category;
  corroborationToday: number | null;
  points: number | null;
  publishedAt: string | null;
  ingestedAt: string;
  now: Date;
}

export interface ScoreResult {
  score: number;
  scoreVersion: string;
  pointsImputed: boolean;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function computeScore(input: ScoreInput): ScoreResult {
  const degraded = input.llmImportance === null || input.corroborationToday === null;

  // Degraded mode imputes neutral values and keeps the weights fixed.
  // Renormalizing would inflate whichever signals survive — and `points` is
  // null on every RSS source, so it would hand the feed to Hacker News.
  const importance = clamp(input.llmImportance ?? 50, 0, 100) / 100;
  const corroboration =
    clamp(input.corroborationToday ?? 1, 0, CORROBORATION_CEILING) / CORROBORATION_CEILING;

  // Absent engagement data means "unknown", not "nobody cared". Lab
  // announcements structurally never carry points.
  const pointsImputed = input.points === null;
  const engagement = pointsImputed
    ? 0.5
    : Math.log10(1 + clamp(input.points!, 0, POINTS_CEILING)) / Math.log10(1 + POINTS_CEILING);

  const publishedMs = input.publishedAt ? Date.parse(input.publishedAt) : NaN;
  const effectiveMs = Number.isNaN(publishedMs) ? Date.parse(input.ingestedAt) : publishedMs;
  const ageHours = Math.max(0, (input.now.getTime() - effectiveMs) / 3_600_000);
  const recency = 0.5 ** (ageHours / RECENCY_HALF_LIFE_HOURS);

  const raw =
    WEIGHTS.llmImportance * importance +
    WEIGHTS.sourceWeight * SOURCE_WEIGHTS[input.category] +
    WEIGHTS.corroborationToday * corroboration +
    WEIGHTS.engagement * engagement +
    WEIGHTS.recency * (Number.isFinite(recency) ? recency : 0);

  return {
    score: clamp(1000 * raw, 0, 1000),
    scoreVersion: degraded ? DEGRADED_SCORE_VERSION : SCORE_VERSION,
    pointsImputed,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test -- score`
Expected: PASS, 10 tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/core/score.ts tests/core/score.test.ts
git commit -m "feat: add scoring with neutral imputation for missing signals

Absent engagement data is imputed neutral rather than zeroed, and degraded
mode imputes rather than renormalizing. Both paths otherwise invert the
ranking in favour of community posts over primary sources."
```

---

### Task 6: RSS and Atom parsing

**Files:**
- Create: `src/lib/ingest/fetchers/rss.ts`
- Create: `tests/fixtures/techcrunch.xml`, `tests/fixtures/atom-no-date.xml`, `tests/fixtures/html-error.html`
- Test: `tests/ingest/rss.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `parseFeed(xml: string): FeedItem[]`, `type FeedItem = { title: string; link: string; summary: string; imageUrl: string | null; publishedAt: string | null }`

- [ ] **Step 1: Save real fixtures**

```bash
mkdir -p tests/fixtures
curl -sL "https://techcrunch.com/category/artificial-intelligence/feed/" -o tests/fixtures/techcrunch.xml
curl -sL "https://deepmind.google/blog/rss.xml" -o tests/fixtures/deepmind.xml
printf '<!DOCTYPE html><html><body><h1>503 Service Unavailable</h1></body></html>' > tests/fixtures/html-error.html
cat > tests/fixtures/atom-no-date.xml <<'XML'
<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>No Dates</title>
  <entry><title>Undated post</title><link href="https://example.com/a"/><summary>Body</summary></entry>
</feed>
XML
```

- [ ] **Step 2: Write the failing tests**

`tests/ingest/rss.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseFeed } from "../../src/lib/ingest/fetchers/rss.js";

const fixture = (n: string) => readFileSync(new URL(`../fixtures/${n}`, import.meta.url), "utf8");

describe("parseFeed", () => {
  it("parses an RSS 2.0 feed", () => {
    const items = parseFeed(fixture("techcrunch.xml"));
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]!.title).toBeTruthy();
    expect(items[0]!.link).toMatch(/^https?:\/\//);
  });

  it("parses an Atom feed", () => {
    const items = parseFeed(fixture("deepmind.xml"));
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]!.link).toMatch(/^https?:\/\//);
  });

  it("returns null publishedAt rather than an invalid date when the feed omits it", () => {
    const items = parseFeed(fixture("atom-no-date.xml"));
    expect(items).toHaveLength(1);
    expect(items[0]!.publishedAt).toBeNull();
  });

  // A dead feed that answers 200 with an HTML error page must look like a dead
  // feed, not like a quiet news day.
  it("returns an empty array for an HTML error body", () => {
    expect(parseFeed(fixture("html-error.html"))).toEqual([]);
  });

  it("returns an empty array for empty input", () => {
    expect(parseFeed("")).toEqual([]);
  });

  it("normalizes publishedAt to an ISO string when present", () => {
    const items = parseFeed(fixture("techcrunch.xml"));
    const dated = items.find((i) => i.publishedAt !== null);
    expect(dated).toBeDefined();
    expect(() => new Date(dated!.publishedAt!).toISOString()).not.toThrow();
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm test -- rss`
Expected: FAIL — cannot resolve `../../src/lib/ingest/fetchers/rss.js`

- [ ] **Step 4: Write the implementation**

```bash
pnpm add fast-xml-parser
```

`src/lib/ingest/fetchers/rss.ts`:

```ts
import { XMLParser } from "fast-xml-parser";

export interface FeedItem {
  title: string;
  link: string;
  summary: string;
  imageUrl: string | null;
  publishedAt: string | null;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  trimValues: true,
});

function text(v: unknown): string {
  if (typeof v === "string") return v;
  if (v && typeof v === "object" && "#text" in v) return String((v as any)["#text"]);
  return "";
}

function toIso(v: unknown): string | null {
  const raw = text(v);
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

/**
 * Handles RSS 2.0 and Atom. Anything unparseable — including an HTML error
 * page served with HTTP 200 — yields an empty array, which the caller records
 * as a zero-item source rather than a silent success.
 */
export function parseFeed(xml: string): FeedItem[] {
  if (!xml.trim()) return [];

  let doc: any;
  try {
    doc = parser.parse(xml);
  } catch {
    return [];
  }

  const rssItems = asArray(doc?.rss?.channel?.item);
  if (rssItems.length > 0) {
    return rssItems.map((it: any) => ({
      title: stripHtml(text(it.title)),
      link: text(it.link),
      summary: stripHtml(text(it.description) || text(it["content:encoded"])).slice(0, 600),
      imageUrl: it["media:content"]?.["@url"] ?? it.enclosure?.["@url"] ?? null,
      publishedAt: toIso(it.pubDate ?? it["dc:date"]),
    }));
  }

  const atomEntries = asArray(doc?.feed?.entry);
  if (atomEntries.length > 0) {
    return atomEntries.map((e: any) => {
      const links = asArray(e.link);
      const href = links.find((l: any) => !l?.["@rel"] || l["@rel"] === "alternate")?.["@href"];
      return {
        title: stripHtml(text(e.title)),
        link: href ?? text(e.id),
        summary: stripHtml(text(e.summary) || text(e.content)).slice(0, 600),
        imageUrl: null,
        publishedAt: toIso(e.published ?? e.updated),
      };
    });
  }

  return [];
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm test -- rss`
Expected: PASS, 6 tests

- [ ] **Step 6: Commit**

```bash
git add src/lib/ingest/fetchers/rss.ts tests/ingest/rss.test.ts tests/fixtures package.json pnpm-lock.yaml
git commit -m "feat: parse RSS 2.0 and Atom feeds

A feed answering 200 with an HTML error body yields zero items rather than
throwing, so the caller can distinguish a dead source from a quiet day."
```

---

### Task 7: Hacker News and HuggingFace adapters

**Files:**
- Create: `src/lib/ingest/fetchers/hn.ts`, `src/lib/ingest/fetchers/hfPapers.ts`
- Create: `tests/fixtures/hn.json`, `tests/fixtures/hf-papers.json`
- Test: `tests/ingest/hn.test.ts`, `tests/ingest/hfPapers.test.ts`

**Interfaces:**
- Consumes: `FeedItem` from `rss.ts`
- Produces: `parseHnResponse(json: unknown): HnItem[]` where `HnItem = FeedItem & { points: number }`; `parseHfPapers(json: unknown): FeedItem[]`

- [ ] **Step 1: Save fixtures**

```bash
curl -s "https://hn.algolia.com/api/v1/search?query=LLM%20OR%20OpenAI%20OR%20Anthropic&tags=story&numericFilters=points%3E50&hitsPerPage=10" -o tests/fixtures/hn.json
curl -s "https://huggingface.co/api/daily_papers?limit=10" -o tests/fixtures/hf-papers.json
```

- [ ] **Step 2: Write the failing tests**

`tests/ingest/hn.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseHnResponse } from "../../src/lib/ingest/fetchers/hn.js";

const hn = JSON.parse(readFileSync(new URL("../fixtures/hn.json", import.meta.url), "utf8"));

describe("parseHnResponse", () => {
  it("extracts title, link and points", () => {
    const items = parseHnResponse(hn);
    expect(items.length).toBeGreaterThan(0);
    expect(typeof items[0]!.points).toBe("number");
    expect(items[0]!.title).toBeTruthy();
  });

  it("falls back to the HN discussion URL when a story has no external link", () => {
    const items = parseHnResponse({
      hits: [{ objectID: "123", title: "Ask HN: something", url: null, points: 80, created_at: "2026-08-18T00:00:00Z" }],
    });
    expect(items[0]!.link).toBe("https://news.ycombinator.com/item?id=123");
  });

  it("returns an empty array for a malformed payload", () => {
    expect(parseHnResponse({})).toEqual([]);
    expect(parseHnResponse(null)).toEqual([]);
  });
});
```

`tests/ingest/hfPapers.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseHfPapers } from "../../src/lib/ingest/fetchers/hfPapers.js";

const hf = JSON.parse(readFileSync(new URL("../fixtures/hf-papers.json", import.meta.url), "utf8"));

describe("parseHfPapers", () => {
  it("extracts title and a paper link", () => {
    const items = parseHfPapers(hf);
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]!.link).toMatch(/^https:\/\/huggingface\.co\/papers\//);
  });

  it("returns an empty array for a malformed payload", () => {
    expect(parseHfPapers({})).toEqual([]);
    expect(parseHfPapers(null)).toEqual([]);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm test -- hn hfPapers`
Expected: FAIL — modules not found

- [ ] **Step 4: Write the implementations**

`src/lib/ingest/fetchers/hn.ts`:

```ts
import type { FeedItem } from "./rss.js";

export type HnItem = FeedItem & { points: number };

export function parseHnResponse(json: unknown): HnItem[] {
  const hits = (json as any)?.hits;
  if (!Array.isArray(hits)) return [];

  return hits
    .filter((h: any) => h?.title)
    .map((h: any) => ({
      title: String(h.title),
      link: h.url ?? `https://news.ycombinator.com/item?id=${h.objectID}`,
      summary: "",
      imageUrl: null,
      publishedAt: h.created_at ? new Date(h.created_at).toISOString() : null,
      points: Number(h.points ?? 0),
    }));
}
```

`src/lib/ingest/fetchers/hfPapers.ts`:

```ts
import type { FeedItem } from "./rss.js";

export function parseHfPapers(json: unknown): FeedItem[] {
  if (!Array.isArray(json)) return [];

  return json
    .filter((e: any) => e?.paper?.title)
    .map((e: any) => ({
      title: String(e.paper.title),
      link: `https://huggingface.co/papers/${e.paper.id}`,
      summary: String(e.paper.summary ?? "").slice(0, 600),
      imageUrl: null,
      publishedAt: e.publishedAt ? new Date(e.publishedAt).toISOString() : null,
    }));
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm test -- hn hfPapers`
Expected: PASS, 5 tests

- [ ] **Step 6: Commit**

```bash
git add src/lib/ingest/fetchers/hn.ts src/lib/ingest/fetchers/hfPapers.ts tests/ingest/hn.test.ts tests/ingest/hfPapers.test.ts tests/fixtures
git commit -m "feat: add Hacker News and HuggingFace Papers adapters"
```

---

### Task 8: Source registry and capture orchestration

**Files:**
- Create: `src/lib/ingest/sources.ts`, `src/lib/ingest/capture.ts`
- Test: `tests/ingest/capture.test.ts`

**Interfaces:**
- Consumes: `parseFeed`, `parseHnResponse`, `parseHfPapers`, `normalizeUrl`, `urlHash`, `titleHash`, `NormalizedArticleSchema`
- Produces: `SOURCES: SourceDef[]`, `captureAll(deps: { fetchText: (url: string) => Promise<string>; now: Date }): Promise<CaptureResult>` where `CaptureResult = { articles: NormalizedArticle[]; perSourceCounts: Record<string, number>; errors: { source: string; message: string }[] }`

- [ ] **Step 1: Write the failing tests**

`tests/ingest/capture.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { captureAll } from "../../src/lib/ingest/capture.js";
import { SOURCES } from "../../src/lib/ingest/sources.js";

const fixture = (n: string) => readFileSync(new URL(`../fixtures/${n}`, import.meta.url), "utf8");
const NOW = new Date("2026-08-18T12:00:00.000Z");

function stubFetch(overrides: Record<string, string> = {}) {
  return async (url: string) => {
    if (overrides[url] !== undefined) return overrides[url];
    if (url.includes("hn.algolia.com")) return fixture("hn.json");
    if (url.includes("daily_papers")) return fixture("hf-papers.json");
    return fixture("techcrunch.xml");
  };
}

describe("captureAll", () => {
  it("returns articles from every source", async () => {
    const r = await captureAll({ fetchText: stubFetch(), now: NOW });
    expect(r.articles.length).toBeGreaterThan(0);
    expect(Object.keys(r.perSourceCounts)).toHaveLength(SOURCES.length);
  });

  it("produces articles that pass schema validation", async () => {
    const r = await captureAll({ fetchText: stubFetch(), now: NOW });
    for (const a of r.articles) {
      expect(a.urlHash).toMatch(/^[0-9a-f]{64}$/);
      expect(a.title.length).toBeGreaterThan(0);
      expect(["news", "lab", "community", "research"]).toContain(a.category);
    }
  });

  it("deduplicates by urlHash across sources", async () => {
    const r = await captureAll({ fetchText: stubFetch(), now: NOW });
    const hashes = r.articles.map((a) => a.urlHash);
    expect(new Set(hashes).size).toBe(hashes.length);
  });

  // One dead source must not take the run down with it.
  it("keeps going when a single source throws", async () => {
    const failing = async (url: string) => {
      if (url.includes("techcrunch")) throw new Error("ECONNREFUSED");
      return stubFetch()(url);
    };
    const r = await captureAll({ fetchText: failing, now: NOW });
    expect(r.articles.length).toBeGreaterThan(0);
    expect(r.errors.some((e) => e.message.includes("ECONNREFUSED"))).toBe(true);
  });

  it("records a zero count for a source that returns an HTML error page", async () => {
    const tc = SOURCES.find((s) => s.id === "techcrunch")!;
    const r = await captureAll({
      fetchText: stubFetch({ [tc.url]: fixture("html-error.html") }),
      now: NOW,
    });
    expect(r.perSourceCounts["techcrunch"]).toBe(0);
  });

  it("marks publishedAt as fallback when the feed omits it", async () => {
    const tc = SOURCES.find((s) => s.id === "techcrunch")!;
    const r = await captureAll({
      fetchText: stubFetch({ [tc.url]: fixture("atom-no-date.xml") }),
      now: NOW,
    });
    const undated = r.articles.find((a) => a.source === "techcrunch");
    expect(undated?.publishedAtSource).toBe("fallback");
    expect(undated?.publishedAt).toBe(NOW.toISOString());
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test -- capture`
Expected: FAIL — modules not found

- [ ] **Step 3: Write the source registry**

`src/lib/ingest/sources.ts`:

```ts
import type { Category } from "../../types/article.js";

export type SourceKind = "rss" | "hn" | "hfPapers";

export interface SourceDef {
  id: string;
  name: string;
  kind: SourceKind;
  category: Category;
  url: string;
}

/** Spec §3. arXiv cs.AI is deliberately absent — 268 items/day would drown the feed. */
export const SOURCES: SourceDef[] = [
  { id: "techcrunch", name: "TechCrunch", kind: "rss", category: "news",
    url: "https://techcrunch.com/category/artificial-intelligence/feed/" },
  { id: "verge", name: "The Verge", kind: "rss", category: "news",
    url: "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml" },
  { id: "arstechnica", name: "Ars Technica", kind: "rss", category: "news",
    url: "https://arstechnica.com/ai/feed/" },
  { id: "venturebeat", name: "VentureBeat", kind: "rss", category: "news",
    url: "https://venturebeat.com/category/ai/feed/" },
  { id: "mittr", name: "MIT Technology Review", kind: "rss", category: "news",
    url: "https://www.technologyreview.com/feed/" },
  { id: "openai", name: "OpenAI", kind: "rss", category: "lab",
    url: "https://openai.com/news/rss.xml" },
  { id: "deepmind", name: "Google DeepMind", kind: "rss", category: "lab",
    url: "https://deepmind.google/blog/rss.xml" },
  { id: "huggingface", name: "Hugging Face", kind: "rss", category: "lab",
    url: "https://huggingface.co/blog/feed.xml" },
  // Anthropic publishes no RSS feed; Google News is the only keyless route.
  { id: "anthropic", name: "Anthropic", kind: "rss", category: "lab",
    url: "https://news.google.com/rss/search?q=site:anthropic.com&hl=en-US&gl=US&ceid=US:en" },
  { id: "hn", name: "Hacker News", kind: "hn", category: "community",
    url: "https://hn.algolia.com/api/v1/search?query=AI%20OR%20LLM%20OR%20OpenAI%20OR%20Anthropic&tags=story&numericFilters=points%3E50&hitsPerPage=30" },
  { id: "hfpapers", name: "HF Daily Papers", kind: "hfPapers", category: "research",
    url: "https://huggingface.co/api/daily_papers?limit=20" },
];
```

- [ ] **Step 4: Write the orchestrator**

`src/lib/ingest/capture.ts`:

```ts
import { normalizeUrl, titleHash, urlHash } from "../core/url.js";
import { NormalizedArticleSchema, type NormalizedArticle } from "../../types/article.js";
import { parseFeed, type FeedItem } from "./fetchers/rss.js";
import { parseHnResponse } from "./fetchers/hn.js";
import { parseHfPapers } from "./fetchers/hfPapers.js";
import { SOURCES, type SourceDef } from "./sources.js";

export interface CaptureDeps {
  fetchText: (url: string) => Promise<string>;
  now: Date;
}

export interface CaptureResult {
  articles: NormalizedArticle[];
  perSourceCounts: Record<string, number>;
  errors: { source: string; message: string }[];
}

function itemsFor(src: SourceDef, body: string): (FeedItem & { points?: number })[] {
  if (src.kind === "rss") return parseFeed(body);
  const json = JSON.parse(body);
  return src.kind === "hn" ? parseHnResponse(json) : parseHfPapers(json);
}

function toArticle(
  src: SourceDef,
  item: FeedItem & { points?: number },
  now: Date,
): NormalizedArticle | null {
  const normalized = normalizeUrl(item.link);
  const hash = normalized.startsWith("http")
    ? urlHash(normalized)
    : titleHash(item.title, src.name);

  const candidate = {
    urlHash: hash,
    url: normalized,
    title: item.title,
    summary: item.summary,
    imageUrl: item.imageUrl,
    source: src.id,
    sourceName: src.name,
    category: src.category,
    // Never leave a key attribute undefined — DynamoDB would silently drop the
    // item from the index rather than erroring.
    publishedAt: item.publishedAt ?? now.toISOString(),
    publishedAtSource: item.publishedAt ? ("feed" as const) : ("fallback" as const),
    points: item.points ?? null,
  };

  const parsed = NormalizedArticleSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

/**
 * One failing source must never fail the run, but it must also never look like
 * a quiet news day — hence perSourceCounts and errors in the result.
 */
export async function captureAll(deps: CaptureDeps): Promise<CaptureResult> {
  const settled = await Promise.allSettled(
    SOURCES.map(async (src) => ({ src, body: await deps.fetchText(src.url) })),
  );

  const perSourceCounts: Record<string, number> = {};
  const errors: { source: string; message: string }[] = [];
  const bySeenHash = new Map<string, NormalizedArticle>();

  settled.forEach((outcome, i) => {
    const src = SOURCES[i]!;
    if (outcome.status === "rejected") {
      perSourceCounts[src.id] = 0;
      errors.push({ source: src.id, message: String(outcome.reason?.message ?? outcome.reason) });
      return;
    }

    let produced = 0;
    try {
      for (const item of itemsFor(src, outcome.value.body)) {
        const article = toArticle(src, item, deps.now);
        if (!article) continue;
        produced++;
        if (!bySeenHash.has(article.urlHash)) bySeenHash.set(article.urlHash, article);
      }
    } catch (e) {
      errors.push({ source: src.id, message: String((e as Error).message) });
    }
    perSourceCounts[src.id] = produced;
  });

  return { articles: [...bySeenHash.values()], perSourceCounts, errors };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm test -- capture`
Expected: PASS, 6 tests

- [ ] **Step 6: Commit**

```bash
git add src/lib/ingest/sources.ts src/lib/ingest/capture.ts tests/ingest/capture.test.ts
git commit -m "feat: add source registry and capture orchestration

Sources are fetched with allSettled so one dead feed cannot fail the run,
and per-source counts are returned so a dead feed is distinguishable from
a quiet news day."
```

---

### Task 9: LLM response reconciliation

The model may return fewer items than it was given, or ids that were never sent. Structured-output schemas cannot enforce array length or numeric ranges (spec §6), so reconciliation is code, not schema.

**Files:**
- Create: `src/lib/rank/reconcile.ts`
- Test: `tests/rank/reconcile.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `reconcile(inputHashes: string[], response: unknown): ReconcileResult` where `ReconcileResult = { byHash: Map<string, { clusterId: string; importance: number; whyItMatters: string }>; matched: number; missing: number; unknown: number }`

- [ ] **Step 1: Write the failing tests**

`tests/rank/reconcile.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { reconcile } from "../../src/lib/rank/reconcile.js";

const h = (n: number) => String(n).padStart(64, "0");

const item = (hash: string, extra: Record<string, unknown> = {}) => ({
  urlHash: hash,
  clusterId: "c1",
  importance: 80,
  whyItMatters: "Because.",
  ...extra,
});

describe("reconcile", () => {
  it("matches returned items to input hashes", () => {
    const r = reconcile([h(1), h(2)], { items: [item(h(1)), item(h(2))] });
    expect(r.matched).toBe(2);
    expect(r.missing).toBe(0);
    expect(r.byHash.get(h(1))?.importance).toBe(80);
  });

  it("counts inputs the model omitted", () => {
    const r = reconcile([h(1), h(2), h(3)], { items: [item(h(1))] });
    expect(r.matched).toBe(1);
    expect(r.missing).toBe(2);
    expect(r.byHash.has(h(2))).toBe(false);
  });

  it("drops hashes that were never sent", () => {
    const r = reconcile([h(1)], { items: [item(h(1)), item(h(9))] });
    expect(r.unknown).toBe(1);
    expect(r.byHash.has(h(9))).toBe(false);
  });

  it("clamps importance outside 0-100", () => {
    const r = reconcile([h(1), h(2)], {
      items: [item(h(1), { importance: 150 }), item(h(2), { importance: -20 })],
    });
    expect(r.byHash.get(h(1))?.importance).toBe(100);
    expect(r.byHash.get(h(2))?.importance).toBe(0);
  });

  it("skips entries with a non-numeric importance", () => {
    const r = reconcile([h(1)], { items: [item(h(1), { importance: "high" })] });
    expect(r.matched).toBe(0);
    expect(r.missing).toBe(1);
  });

  it("treats a malformed response as a total miss rather than throwing", () => {
    expect(reconcile([h(1)], null).missing).toBe(1);
    expect(reconcile([h(1)], { items: "nope" }).missing).toBe(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test -- reconcile`
Expected: FAIL — cannot resolve `../../src/lib/rank/reconcile.js`

- [ ] **Step 3: Write the implementation**

`src/lib/rank/reconcile.ts`:

```ts
export interface RankingEntry {
  clusterId: string;
  importance: number;
  whyItMatters: string;
}

export interface ReconcileResult {
  byHash: Map<string, RankingEntry>;
  matched: number;
  missing: number;
  unknown: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * The model is not obliged to return one entry per input: structured-output
 * schemas support neither maxItems nor numeric ranges. Everything unmatched is
 * reported so the run record can show it, rather than silently imputed.
 */
export function reconcile(inputHashes: string[], response: unknown): ReconcileResult {
  const expected = new Set(inputHashes);
  const byHash = new Map<string, RankingEntry>();
  let unknown = 0;

  const items = (response as any)?.items;
  if (Array.isArray(items)) {
    for (const raw of items) {
      const hash = typeof raw?.urlHash === "string" ? raw.urlHash : null;
      if (!hash) continue;
      if (!expected.has(hash)) {
        unknown++;
        continue;
      }
      if (typeof raw.importance !== "number" || Number.isNaN(raw.importance)) continue;
      if (byHash.has(hash)) continue;

      byHash.set(hash, {
        clusterId: String(raw.clusterId ?? ""),
        importance: clamp(Math.round(raw.importance), 0, 100),
        whyItMatters: String(raw.whyItMatters ?? ""),
      });
    }
  }

  return {
    byHash,
    matched: byHash.size,
    missing: inputHashes.length - byHash.size,
    unknown,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test -- reconcile`
Expected: PASS, 6 tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/rank/reconcile.ts tests/rank/reconcile.test.ts
git commit -m "feat: reconcile LLM ranking response against input hashes

Structured-output schemas enforce neither array length nor numeric ranges,
so unmatched inputs, unknown ids and out-of-range importance are handled in
code and counted for the run record."
```

---

### Task 10: Dry-run script

The deliverable that makes the whole plan verifiable by eye: real feeds in, ranked list out, no AWS.

**Files:**
- Create: `scripts/dry-run.ts`
- Modify: `package.json` (add the `dry-run` script)

**Interfaces:**
- Consumes: `captureAll`, `computeScore`, `buildSortKey`, `istanbulDay`, `SOURCE_WEIGHTS`
- Produces: nothing importable — an executable script

- [ ] **Step 1: Write the script**

`scripts/dry-run.ts`:

```ts
import { captureAll } from "../src/lib/ingest/capture.js";
import { computeScore } from "../src/lib/core/score.js";
import { buildSortKey } from "../src/lib/core/sortKey.js";
import { istanbulDay } from "../src/lib/core/day.js";

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "user-agent": "ai-news/1.0 (personal reader)" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

const now = new Date();
const { articles, perSourceCounts, errors } = await captureAll({ fetchText, now });

// No Bedrock in this plan: every article scores in degraded mode, which is
// exactly the path worth eyeballing — it is what a Bedrock outage produces.
const ranked = articles
  .map((a) => {
    const { score, scoreVersion, pointsImputed } = computeScore({
      llmImportance: null,
      category: a.category,
      corroborationToday: null,
      points: a.points,
      publishedAt: a.publishedAt,
      ingestedAt: now.toISOString(),
      now,
    });
    return { ...a, score, scoreVersion, pointsImputed, sk: buildSortKey(score, a.urlHash) };
  })
  .sort((x, y) => (x.sk < y.sk ? 1 : x.sk > y.sk ? -1 : 0));

console.log(`\ningestDay: ${istanbulDay(now)}   articles: ${ranked.length}\n`);
console.log("per-source counts:");
for (const [id, n] of Object.entries(perSourceCounts)) {
  console.log(`  ${n === 0 ? "!" : " "} ${id.padEnd(14)} ${n}`);
}
if (errors.length) {
  console.log("\nerrors:");
  for (const e of errors) console.log(`  ${e.source}: ${e.message}`);
}

console.log("\ntop 20:");
for (const a of ranked.slice(0, 20)) {
  console.log(
    `  ${String(Math.round(a.score)).padStart(4)}  ${a.sourceName.padEnd(22)} ${a.title.slice(0, 70)}`,
  );
}
```

- [ ] **Step 2: Add the script entry**

In `package.json`:

```json
"dry-run": "node --experimental-strip-types scripts/dry-run.ts"
```

- [ ] **Step 3: Run it against live feeds**

Run: `pnpm dry-run`

Expected: a per-source count table with a non-zero count for most sources, and a top-20 list ordered by descending score. Check three things by eye:
- Scores descend monotonically down the list. If they do not, the sort-key encoder is wrong.
- Lab sources (OpenAI, DeepMind, Anthropic, Hugging Face) appear high despite having no points. If they cluster at the bottom, the engagement imputation is wrong.
- Any source showing `0` is either genuinely quiet or broken — check it against a browser before assuming it is fine.

- [ ] **Step 4: Run the full test suite and typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: all tests pass, no type errors.

- [ ] **Step 5: Commit**

```bash
git add scripts/dry-run.ts package.json
git commit -m "feat: add dry-run script for the local pipeline

Fetches live feeds, scores in degraded mode and prints the ranked list, so
the whole pipeline is observable before any cloud resource exists."
```

---

## Self-Review

**Spec coverage.** §3 sources → Task 8 registry (all 11 sources, arXiv correctly absent). §4 `urlHash` identity and the never-undefined key-attribute rule → Tasks 3 and 8. §5 scoring, all five missing-data rows, degraded mode, sort-key encoding → Tasks 1 and 5. §6 reconciliation and importance clamping → Task 9; the Bedrock call itself is Plan 2. §7 UI → Plan 3. §8 `perSourceCounts` for the run record → Task 8. §10 testing — the sort-key property test, score formula, URL determinism, day boundaries, fixture-based parsing including the HTML-error case, and reconciliation — all covered.

**Deferred to Plan 2, deliberately:** DynamoDB access, the `UpdateItem` write path, the Bedrock call, the GitHub NDJSON export, CDK, IAM, CloudWatch alarms. Deferred to Plan 3: all Next.js work.

**Placeholder scan.** No TBD/TODO, no "add error handling", no "similar to Task N". Every code step carries real code.

**Type consistency.** `FeedItem` is defined in Task 6 and consumed unchanged by Tasks 7 and 8. `NormalizedArticle` is defined in Task 4 and produced by Task 8. `Category` and `SOURCE_WEIGHTS` are defined in Task 4 and consumed by Tasks 5 and 8. `computeScore` takes `category` (not a pre-resolved weight) in both its definition and both call sites. `buildSortKey(score, urlHash)` has one signature throughout.

**One gap found and closed during review:** `captureAll` originally had no way to report a source that parsed successfully but yielded nothing. `perSourceCounts` now records a zero, and Task 8 has a test for the HTML-error-page case specifically, since that is the failure the review ranked as least detectable.
