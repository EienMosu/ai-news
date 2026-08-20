# The Slow Wire: rename, Cloud vertical, quick filters, evolved Dossier

Date: 2026-08-21. Status: approved direction, pending user review of this document.
Supersedes nothing; extends `2026-08-18-ai-news-design.md`, which remains the authority for
ingest, ranking mechanics, storage and the API. Where the two disagree on naming or the visual
world, this document wins.

## 1. What is being built, in one paragraph

The product is renamed to **The Slow Wire**. It gains a third vertical, **Cloud**, with its own
colour world (deep pine green) inside the existing Day's Dossier design, which stays and gets
developed rather than replaced. Each vertical gains **quick filters**: five named chips plus an
Others free-text box, resolved at query time with zero model cost. The section switch becomes the
page's primary axis (full width), a tagline explains the product under the wordmark, a logo and
favicon ship, and mobile correctness becomes a verified deliverable instead of an assumption.

## 2. Decisions already made (do not reopen)

| Decision | Value | Owner |
|---|---|---|
| Theme | The Day's Dossier, evolved. Telegraph Ledger shelved. | user |
| Cloud world colour | Deep pine `#1a432b`, on-field `#eef2e9` (5.69:1 at 0.70 opacity, measured) | user picked family, exact value measured |
| Ranking budget | `RANK_INPUT_CAP` 250 to 375, so each of three verticals keeps ~125 | user |
| Rename depth | Site copy + GitHub repo + Vercel project. AWS resource names unchanged. | user |
| AI filters | Anthropic, OpenAI, Google, Meta, Qwen + Others | user |
| Design filters | Figma, Adobe, Apple, Google, Framer + Others | user |
| Cloud filters | AWS, Azure, GCP, Cloudflare, Kubernetes + Others | user |
| Others behaviour | Inline GET mini form on the feed, no navigation away | user |
| Tagline | "Each day's news, ranked by importance, not recency." | user approved in specimen |
| Filter mechanism | Query-time keyword matching, no Bedrock, no backfill | approved recommendation |

## 3. Global constraints (bind every task)

- **No em dash (U+2014) in any text**: UI copy, comments, commit messages, docs. Hard rule.
- **Zero client components.** Others' mini form is a plain GET `<form>`; no JS.
- **No Claude attribution anywhere** (commits, PRs, files).
- **Never merge PRs**; open them and stop. Merging is the user's.
- The ingest secret never reaches the browser bundle; comparison stays hash-then-`timingSafeEqual`.
- Contrast floor: no informational text under 70% opacity, every ground clears 4.5:1 at 0.70;
  `tests/design/contrast.test.ts` is extended, never weakened.
- Webpack, not Turbopack (`--webpack`; extensionAlias trap from the UI plan still applies).
- ESM with `.js` import specifiers; three tsconfigs must stay green via `pnpm typecheck`.
- Every green check must be mutation-proof or cite what it actually asserts. A test that cannot
  fail is a defect.

## 4. Sub-project A: identity (rename, masthead, logo, tagline)

### 4.1 Naming sweep
- `package.json` name: `theslowwire`.
- `app/layout.tsx` `metadata.title`: `The Slow Wire`. Add `metadata.description`:
  `Each day's news, ranked by importance, not recency.`
- `SectionNav` masthead text: `The Slow Wire` (keep `asHeading` behaviour and the not-a-link rule).
- README title and first paragraph; PRODUCT.md name field; DESIGN.md rewritten (see 4.4).
- Grep gate: after the sweep, `grep -ri "ai news" app components src` returns only the AI section
  label itself, nowhere the site name. `grep -ri "ai-news" package.json README.md` returns nothing.

### 4.2 Masthead layout (from specimen panel 01, user-approved)
- Wordmark + tagline block: tagline in `.apparatus` voice under the wordmark, max width 42ch,
  opacity 0.72 minimum (floor applies; on-field it measures above 4.5:1 only at >= 0.70).
- Section switch becomes **full width**: three equal cells (AI, Design, Cloud), mono uppercase,
  the active cell carries the paper background + field text exactly as the current nav does, plus
  a 3px inset bottom rule. On narrow screens the three cells stay in one row (they fit at 390px;
  verified in the specimen at 414). The switch sits under the masthead row, above quick filters.
- The Search link stays, right-aligned in the masthead row.
- The `days` query param carry-through behaviour is preserved.

### 4.3 Paper surface cleanup (user request, 2026-08-21)
The graph-grid tint on `[data-surface="paper"]` (the two `linear-gradient` background-image
layers in globals.css) is removed everywhere it appears, including the loading skeleton sheet.
Plain bone `--color-paper` remains; the shadow stays. Rationale: the user finds the grid
notebook-like and wants the sheet to read modern and serious. The specimen panel that won carried
the grid, so this is a deliberate amendment to the chosen direction. DESIGN.md's Illoca
drafting-canvas reference is deleted with it.

### 4.3b Logo and favicon
- Mark: the folded-corner file (dossier), as drawn in the specimen: a rectangle with a folded
  top-right corner, stroke `currentColor`, 2px at 26px box. Reads at 16px without cropping.
- Ship as `app/icon.svg` (Next serves it as favicon automatically). Dark-safe: single
  `currentColor` stroke on transparent does not survive both browser themes, so the icon file
  hard-codes bone stroke `#efe9dc` on ink `#151512` rounded-2px ground.
- The mark also renders inline in the masthead at 26px, left of the wordmark, `aria-hidden`.
- No PNG pipeline, no additional sizes. If a real domain arrives later, revisit (SEO reminder
  already recorded in memory).

### 4.4 DESIGN.md rewrite
(Also records the grid removal from 4.3.)
Rewritten from the shipped code after A+B+C land: three worlds table (add pine row), the
full-width switch rationale (categories are the primary axis), the tagline, the filter row, the
logo. The direction contract comment in `app/layout.tsx` gets the same additions. Known-gaps
section updated: `/day` and `/search` still render in the AI field; that stays out of scope and
stays documented.

### 4.5 Repo and Vercel rename (user actions, sequenced)
1. I open the identity PR; user merges.
2. User renames the GitHub repo `EienMosu/ai-news` to `EienMosu/theslowwire`
   (Settings, Rename). GitHub redirects the old URL. I then run
   `git remote set-url origin git@github.com:EienMosu/theslowwire.git` and verify with a fetch.
3. **Before** renaming the Vercel project: I inventory every external reference to
   `ai-news-ten-bice.vercel.app` (Lambda env vars via infra repo values, GitHub secrets, memory
   docs, monitoring). Finding: the rank Lambda pings the site after a run if any env var carries
   the URL; this must be confirmed by reading `infra/` before the rename, and updated in the same
   change if present.
4. User renames the Vercel project to `theslowwire`. The default domain becomes
   `theslowwire-<hash>.vercel.app`; the old URL dies. I update `BACKUP_REPO`-adjacent references,
   memory, and re-run the live smoke checks against the new domain.

## 5. Sub-project B: the Cloud vertical

### 5.1 Type and data
- `src/types/article.ts`: `SECTIONS = ["ai", "design", "cloud"] as const`. The zod enum follows.
  Stored items are untouched; old items simply never carry `section: "cloud"`.
- `src/lib/rank/model.ts`: `RANK_INPUT_CAP = 375`. `allocateRankingCap` already splits fairly by
  section; no change there. A test pins: with three sections of 200 candidates each, each section
  gets 125 of the 375.
- Bedrock ranking prompt: wherever the prompt describes the two sections, add the cloud
  description: `cloud: cloud platforms and infrastructure (AWS, Azure, GCP, Kubernetes, CDN and
  edge, cloud economics, major outages)`. The implementer locates the exact prompt string in
  `src/lib/rank/` and extends it; the section list in the prompt must be generated from or
  asserted against `SECTIONS` so a fourth section cannot silently miss the prompt.

### 5.2 Sources (candidates, each verified by fetch before commit)
Eight new entries in `src/lib/ingest/sources.ts`, `section: "cloud"`:

| id | name | kind | category | url (verify at implementation time) |
|---|---|---|---|---|
| aws-news | AWS News Blog | rss | vendor | https://aws.amazon.com/blogs/aws/feed/ |
| azure | Microsoft Azure Blog | rss | vendor | https://azure.microsoft.com/en-us/blog/feed/ |
| gcp | Google Cloud Blog | rss | vendor | https://cloudblog.withgoogle.com/rss/ |
| cloudflare | Cloudflare Blog | rss | vendor | https://blog.cloudflare.com/rss/ |
| cncf | CNCF | rss | community | https://www.cncf.io/feed/ |
| hashicorp | HashiCorp Blog | rss | vendor | https://www.hashicorp.com/blog/feed.xml |
| newstack | The New Stack | rss | news | https://thenewstack.io/feed/ |
| hn-cloud | Hacker News (cloud) | hn | community | https://hn.algolia.com/api/v1/search_by_date?query=cloud&tags=story&numericFilters=points%3E20&hitsPerPage=50 |

Rule carried from the source registry: a fetch that 404s or serves non-feed content at
implementation time gets replaced or dropped in the same task with a note, never committed
broken. `category` values must be ones the registry type already allows; if `vendor` is not among
them, use the nearest existing value and note it.

### 5.3 Routes and shells
- `app/(feed)/cloud/page.tsx`: mirrors `design/page.tsx` with `section="cloud"`,
  `<main data-field="cloud">`.
- `app/(feed)/cloud/loading.tsx`: `<FeedLoading field="cloud" />`.
- `globals.css`: `--color-field-cloud: #1a432b` in `:root`;
  `[data-field="cloud"] { --field: ...; --on-field: #eef2e9; }`.
- `tests/design/contrast.test.ts`: add the cloud ground to the grounds table. Mutation check in
  review: lightening the pine to `#2e7d4f` measures 3.02:1 at 0.70 opacity, under the floor,
  so the suite must fail on that value; the reviewer performs this mutation and restores it.
- `tests/feed/loading-world.test.tsx`: third case, cloud waits in pine, and the design case's
  `not.toContain('data-field="ai"')` pattern is applied to cloud too.
- `scripts/check-routes.ts` and any route-set assertions gain `/cloud`.
- `SOURCE_STATE_CLASS` / run status: no change; the rail is ink and section-agnostic.

### 5.4 Deploy order
`RANK_INPUT_CAP` and sources live in Lambda code: `cdk deploy` after merge (this also carries the
pending constants-only refactor noop from the previous plan). The FE change is independent; no
ordering hazard, but the first ranked cloud day appears only after the next scheduled run
completes with the new Lambda.

## 6. Sub-project C: quick filters

### 6.1 One mechanism
A single query param `f` on the three feed routes: `/?f=x`, `/design?f=x`, `/cloud?f=x`.
`days` composes with it. Named chips are plain links with canned `f` values; Others is a GET form
posting to the same route with a text input named `f`. There is exactly one code path.

### 6.2 Matching semantics
- `src/lib/feed/filter.ts` exports `FILTERS: Record<Section, FilterDef[]>` and
  `matchesFilter(article, f): boolean`.
- A `FilterDef` is `{ id, label, synonyms: string[] }`. Matching: case-insensitive substring test
  of each synonym against `title + " " + summary + " " + sourceName`. Free text (an `f` that is
  no known id) matches its own literal text the same way.
- Synonym sets (word-boundary regex where a bare substring would false-positive, noted inline):
  - anthropic: anthropic, claude
  - openai: openai, chatgpt, gpt- (hyphen kept: bare "gpt" hits "egpt" class words)
  - google (ai): google, gemini, deepmind
  - meta: meta (word-boundary: "metadata" must not match), llama
  - qwen: qwen, alibaba
  - figma: figma
  - adobe: adobe, photoshop, illustrator
  - apple (design): apple (word-boundary), ios, human interface
  - google (design): google, material design, android
  - framer: framer (word-boundary: "framework" must not match)
  - aws: aws (word-boundary), amazon web services, bedrock, lambda (word-boundary)
  - azure: azure, microsoft
  - gcp: gcp, google cloud
  - cloudflare: cloudflare, workers (word-boundary, lowercase-sensitive risk accepted)
  - kubernetes: kubernetes, k8s, cncf
- Sanitisation: `f` trimmed, max 40 chars, control characters stripped; an empty result after
  trimming means no filter. `f` is never echoed into HTML unescaped (React escapes by default;
  the test asserts a `<script>` payload renders inert).

### 6.3 Presentation
- Filter row under the section switch: label `Inside AI` / `Inside Design` / `Inside Cloud` in
  apparatus voice, then the five chips, then `Others`.
- Active chip: paper background, field text (same inversion grammar as the switch). Chips are
  links; clicking the active chip's link clears `f` (links back to the bare route).
- `Others` is a link with `aria-expanded` semantics faked by URL state: `?others=1` renders the
  inline GET form (input + submit, apparatus styling) in the row; submitting sends `?f=<text>`.
  No JS, two server renders, honest URLs.
- Under an active filter: day sheets keep only matching entries and **keep their original rank
  numbers** (01, 04, 07), because the rank is a fact about the day, not about the filter. The
  first matching entry still inverts onto the field (it is the highest-ranked match). Day header
  count shows `n of m stories`. The day-wide status line is replaced by a filter line:
  `Filtered by "anthropic": 12 of 93 stories shown.` A day with zero matches renders its sheet
  with the header and an apparatus line `No matches this day.` so the archive depth stays visible.
- Feed metadata (title) is unchanged by filters; robots stay blocked, so no SEO surface.

### 6.4 Tests
- Unit: `matchesFilter` synonym table, word-boundary cases (metadata, framework, egpt),
  free-text path, sanitisation (length, controls, empty), case-insensitivity.
- Component: filter row renders per section with its own five names; active chip inversion;
  Others form appears only with `others=1`; zero-match day renders the sheet with the notice.
- Route: `/design?f=figma` returns 200 and contains only matching cards (fixture-driven);
  `f` composes with `days`.
- Mutation gate at review: deleting the word-boundary guard on `meta` must fail a test.

## 7. Mobile and responsive (first-class, not a checkbox)

- Build `scripts/mobile-probe.mjs` (CDP over Node WebSocket, no deps): navigates, applies
  `Emulation.setDeviceMetricsOverride`, re-asserts, and reports `innerWidth`, `scrollWidth`, and
  the widest elements against the requested width. It must distinguish the three known outcomes:
  clean, genuine overflow (viewport expanded), and override-not-applied (abort). The prior
  session's finding: `/` expanded to 745 and 675 depending on content while `/design` held 390;
  root cause unknown, listed as the first investigation task.
- Acceptance: all three verticals, the article page, day page and search at 390px report
  `scrollWidth === innerWidth` with zero elements wider than 390, measured by the probe against
  production after each sub-project ships.
- Layout hardening while investigating: `overflow-wrap:anywhere` is already on headlines; the
  probe decides whether more is needed. No speculative CSS.
- Touch targets: switch cells and chips get min-height 44px tap boxes (padding, not font size).

## 8. Verification, sequencing, and PR shape

Three PRs, in order, each fully green before the next: **A identity**, **B cloud**, **C filters**.
Mobile probe work rides with A (script) and gates B and C (acceptance runs). Each PR: full test
suite, `pnpm typecheck` (three configs), `pnpm build --webpack`, contrast suite, and for B and C
a live-domain smoke after the user merges and Vercel deploys. The ledger records every ruling.
User actions are called out in 4.5 and never performed by the agent: repo rename, Vercel rename,
all merges, `cdk deploy` approval (deploy itself may be run by agent after explicit ok, per the
existing pattern).

## 9. Out of scope, stated

- `/day` and `/search` remain in the AI field (documented known gap).
- SEO work stays deferred until a real domain (memory reminder exists).
- No runtime theme switcher, no client components.
- AWS resource renames.
- The smoke script's quarantine severity mismatch (parked previously, still parked).
