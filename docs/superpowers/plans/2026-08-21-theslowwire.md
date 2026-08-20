# The Slow Wire Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to
> implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the product to The Slow Wire, add the Cloud vertical with its own colour world,
add per-section quick filters, and develop the Day's Dossier design (primary section switch,
tagline, logo, clean paper), with mobile correctness verified by measurement.

**Architecture:** Three sequential PRs on feature branches off main. A: identity and design
development. B: Cloud vertical (types, sources, ranking budget, route, world). C: quick filters
(one query-param mechanism, zero client components). Vercel deploys main; the agent merges each
PR itself after full verification (explicit grant, 2026-08-21, this repo only).

**Tech Stack:** Next.js 16 (webpack), React 19 server components only, Tailwind 4, TypeScript 5.9
ESM with `.js` specifiers, Vitest 4, CDK v2 for the Lambda side.

**Spec:** docs/superpowers/specs/2026-08-21-theslowwire-design.md

## Global Constraints

- No em dash (U+2014) in any produced text: UI copy, comments, commits, docs.
- Zero client components; the Others form is a plain GET form.
- No Claude attribution in commits, PRs, or files.
- Contrast floor 4.5:1 at 0.70 opacity for every ground; `tests/design/contrast.test.ts` extends,
  never weakens. No informational text below `opacity-70`.
- `pnpm typecheck` (three configs), `pnpm test`, `pnpm build` green before every merge.
- Every new guard test is mutation-tested in review: reintroduce the defect, watch it fail,
  restore, verify md5.
- ESM `.js` import specifiers everywhere; webpack build, never Turbopack.
- The ingest secret stays out of the browser bundle (no change in this plan touches it; the
  bundle grep gate still runs before each merge).

## Design brief (binds every UI task in this plan)

**Job:** one reader, phone and desktop equally, scans first and opens second. The masthead zone
is overhead paid on every visit: it must read as one compact instrument panel, then get out of
the way.

**Hierarchy, top to bottom:** ink status rail (unchanged), then on the field: brand row (mark +
wordmark + tagline left, Search right), the full-width section switch, the filter row (C), then
a clear 28 to 36px break before the first day sheet. The three control rows sit tight (10 to
12px gaps) so they group; the break before content is what makes the panel read as one unit.

**The switch is the primary axis.** Three equal cells, full width, mono uppercase, min-height
44px. Selection grammar stays the product's own: selected = paper background + field text.
Inactive cells: transparent, on-field text at opacity-70, 1px shared border on-field at 35%.
**World preview on hover:** each cell already carries `data-field` for its target section, so
`--field` and `--on-field` re-derive inside it; an inactive cell's hover background is its own
world's field colour with its own on-field text. The control shows the world it leads to, with
zero JS. `transition-colors duration-200`, collapsed by `prefers-reduced-motion`.

**Masthead scale drops one step** so the switch gains primacy: wordmark `text-[2.5rem]` mobile
(fits 390px at ~270px), `sm:text-[3rem]` desktop (was 3.5rem). Tagline under it in apparatus
voice at opacity-70 minimum, max-width 42ch: `Each day's news, ranked by importance, not
recency.` The mark sits left of the wordmark at 26px, `aria-hidden`, stroke `currentColor`.

**Chips reuse the selection grammar:** active chip = paper background + field text; inactive =
1px border current at 35%, opacity-70, hover opacity-100. Tap targets: `@media (pointer:coarse)`
raises chip and switch padding-block so boxes reach 44px on touch devices without bloating
desktop.

**Paper is clean:** the two graph-grid gradient layers on `[data-surface="paper"]` are deleted
(user request); the shadow stays; nothing is added to compensate.

**Cloud world:** field `#1a432b`, on-field `#eef2e9` (5.69:1 at 0.70, measured). Same grammar
everywhere; the loading shell waits in pine.

**Filter states:** under an active filter, day sheets keep original rank numbers (the rank is a
fact about the day, not the filter), the highest-ranked match still inverts, the day header
count reads `n of m stories`, and the day-status line is replaced by a filter line in the same
apparatus voice with a `FILTER` stamp. A zero-match day keeps its sheet and says
`No matches this day.` at opacity-70.

**Anti-goals:** no client components, no runtime theme switch, no new animation beyond the
existing loader and colour transitions, no texture added back to paper, `/day` and `/search`
stay in the AI field (documented gap).

---

## PR A: identity and design development (branch `feat/identity`)

### Task A1: clean paper and masthead scale

**Files:**
- Modify: `app/globals.css`
- Modify: `components/SectionNav.tsx` (MASTHEAD_CLASS only, in this task)
- Test: existing suites must stay green (no new tests; visual-only deltas covered by A2/A4 tests)

**Interfaces:**
- Produces: `[data-surface="paper"]` with no background-image; MASTHEAD_CLASS at 2.5rem/3rem.

- [ ] **Step 1:** In `app/globals.css`, delete the `background-image` and `background-size`
  declarations from `[data-surface="paper"]` and the comment sentence referencing the graph
  tint/Illoca; keep `background-color` and `color`. Update the block comment to: "The paper
  panel. A clean sheet laid on the field; the shadow does the lifting."
- [ ] **Step 2:** In `components/SectionNav.tsx`, change `MASTHEAD_CLASS` from
  `text-[2.5rem] ... sm:text-[3.5rem]` to `text-[2.5rem] ... sm:text-[3rem]`.
- [ ] **Step 3:** Run `pnpm test` and `pnpm typecheck`. Expected: all green (nothing pinned the
  grid or the 3.5rem).
- [ ] **Step 4:** Commit `design: clean paper sheet, drop masthead one step`.

### Task A2: brand block with mark and tagline; full-width switch with world preview

**Files:**
- Modify: `components/SectionNav.tsx` (full rework)
- Modify: `app/globals.css` (touch-target media query)
- Test: `tests/feed/nav.test.tsx`

**Interfaces:**
- Consumes: `Section` type; `DEFAULT_ARCHIVE_DAYS`.
- Produces: `SectionNav({ current, days, asHeading })` unchanged signature. New DOM contract:
  a `data-testid="brand"` block containing the wordmark text `The Slow Wire` and
  `data-testid="tagline"`; a `nav[aria-label="Sections"]` containing exactly three links AI,
  Design, Cloud with `data-field` attributes and `aria-current="page"` on the active one.
  NOTE: the Cloud link ships in A pointing at `/cloud`, which 404s until B merges. To avoid a
  dead link in production, A renders the Cloud cell only when `SECTIONS.includes("cloud")`;
  since A does not add it to SECTIONS, A ships a two-cell switch and B's SECTIONS change makes
  the third cell appear with zero further nav edits. The links array derives from SECTIONS.

- [ ] **Step 1:** Write the failing tests in `tests/feed/nav.test.tsx` (replacing assertions that
  pin the old layout): brand block renders `The Slow Wire` and the tagline text exactly
  `Each day's news, ranked by importance, not recency.`; the switch renders one link per entry
  of `SECTIONS` labelled AI/Design (and Cloud when present) deriving labels from a
  `SECTION_LABEL` map; active link carries `aria-current` and `data-field={section}`; masthead
  is still `<h1>` when `asHeading` and `<p>` otherwise; the mark svg is `aria-hidden`.
- [ ] **Step 2:** Run the tests, expect failures naming missing testids.
- [ ] **Step 3:** Rework `SectionNav.tsx`:

```tsx
import Link from "next/link";
import { DEFAULT_ARCHIVE_DAYS } from "../src/lib/feed/days.js";
import { SECTIONS, type Section } from "../src/types/article.js";

export const SECTION_LABEL: Record<Section, string> = {
  ai: "AI",
  design: "Design",
  ...(Object.fromEntries([]) as Record<never, never>),
} as Record<Section, string>;
// NOTE to implementer: write the literal map { ai: "AI", design: "Design" } in A; B adds
// cloud: "Cloud". A test asserts every SECTIONS entry has a label so B cannot forget.
```

  Brand block: flex row, mark svg (26px, the folded-corner file:
  `<svg viewBox="0 0 26 26" aria-hidden="true" className="mt-1 h-[26px] w-[26px] shrink-0"><path d="M4 3h11l7 7v13H4z" fill="none" stroke="currentColor" strokeWidth="2"/><path d="M15 3v7h7" fill="none" stroke="currentColor" strokeWidth="2"/></svg>`),
  then a column: Masthead (existing h1/p logic) and
  `<p data-testid="tagline" className="apparatus mt-1.5 max-w-[42ch] opacity-70">Each day's news, ranked by importance, not recency.</p>`
  (write the apostrophe as `&rsquo;` or a JS string, never a bare `'` that JSX escapes rules
  flag). Search link stays right-aligned in this row.
  Switch below the brand row:

```tsx
<nav aria-label="Sections" className="mt-4 flex w-full border border-current/35">
  {SECTIONS.map((section) => {
    const isCurrent = section === current;
    return (
      <Link
        key={section}
        href={`${section === "ai" ? "/" : `/${section}`}${suffix}`}
        aria-current={isCurrent ? "page" : undefined}
        data-field={section}
        className={[
          "apparatus min-w-0 flex-1 border-current/35 px-2 py-3 text-center font-bold",
          "no-underline transition-colors duration-200 [&+a]:border-l",
          isCurrent ? "" : "opacity-70 hover:opacity-100 hover:bg-[var(--field)] hover:text-[var(--on-field)]",
        ].join(" ")}
        style={isCurrent ? { background: "var(--color-paper)", color: "var(--field)" } : undefined}
      >
        {SECTION_LABEL[section]}
      </Link>
    );
  })}
</nav>
```

  The hover classes work because `data-field` on the link re-derives `--field`/`--on-field` for
  that subtree; verify by serving and hovering, and record what was actually observed.
- [ ] **Step 4:** In `globals.css` add:

```css
@media (pointer: coarse) {
  nav[aria-label="Sections"] a { padding-block: 0.85rem; }
}
```

- [ ] **Step 5:** Run tests, typecheck, `pnpm build`. Expected green.
- [ ] **Step 6:** Commit `design: brand block with mark and tagline, primary section switch`.

### Task A3: name sweep, favicon, metadata

**Files:**
- Create: `app/icon.svg`
- Modify: `app/layout.tsx`, `package.json`, `README.md`, `PRODUCT.md`
- Test: `tests/feed/nav.test.tsx` already pins the wordmark; add a metadata assertion to
  `tests/feed/pages.test.tsx` if it imports metadata, else a new small test importing
  `metadata` from `app/layout.tsx` and asserting title and description.

- [ ] **Step 1:** `app/icon.svg`, exactly:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="2" fill="#151512"/>
  <path d="M8 6h11l7 7v13H8z" fill="none" stroke="#efe9dc" stroke-width="2.4"/>
  <path d="M19 6v7h7" fill="none" stroke="#efe9dc" stroke-width="2.4"/>
</svg>
```

- [ ] **Step 2:** `app/layout.tsx` metadata: title `The Slow Wire`, description
  `Each day's news, ranked by importance, not recency.` Update the direction contract comment's
  THESIS block header line to name The Slow Wire and note the clean-paper amendment and the
  masthead step-down, dated 2026-08-21.
- [ ] **Step 3:** `package.json` name `theslowwire`. README title and intro. PRODUCT.md: replace
  the "name is undecided" Brand Commitments paragraph: name is The Slow Wire (2026-08-21),
  tagline fixed, mark is the folded-corner file.
- [ ] **Step 4:** Grep gates:
  `grep -ri "ai news" app components src --include="*.ts" --include="*.tsx"` returns only
  section-label or historical-comment hits, none of them the site name (list each hit in the
  report); `grep -i "ai-news" package.json README.md` returns nothing.
- [ ] **Step 5:** Full suite + typecheck + build. Commit `feat: The Slow Wire identity`.

### Task A4: mobile probe script and the root-route overflow investigation

**Files:**
- Create: `scripts/mobile-probe.mjs`
- Test: the script self-validates (it aborts on override-not-applied and reports overflow
  causes); acceptance is a clean run against local build for `/` and `/design`.

- [ ] **Step 1:** Write `scripts/mobile-probe.mjs`: no dependencies, Node global WebSocket, CDP.
  Behaviour: navigate, wait, apply `Emulation.setDeviceMetricsOverride` (mobile true, dsf 2),
  re-evaluate; report JSON `{ url, requested, innerWidth, scrollWidth, widest: [up to 8 elements
  wider than requested, each "px tag.class text"] }`. Exit 1 only when the override never
  applied AND nothing overflowed (indeterminate); exit 0 with `overflow: true` when the
  viewport expanded (that is a finding, not a failure of the probe). Base it on the session's
  proven cdp.mjs sequence: navigate first, then override, then re-assert up to 4 times.
- [ ] **Step 2:** Run against a local `next start` for `/`, `/design`, `/day/<latest>`,
  `/article/<any>`, `/search` at 390. Record results verbatim in the task report.
- [ ] **Step 3:** If `/` reports genuine overflow, identify the widest element and fix it in this
  task (likely candidates: an unwrapped long token in a title or the status rail's source list;
  the fix is content-level CSS like `overflow-wrap` or `min-w-0` on the flex child, never a
  viewport hack). If the probe is indeterminate on `/` while `/design` is clean, document that
  the two routes serve identical layout shells and file the discrepancy as a probe limitation
  in the report; do not ship speculative CSS.
- [ ] **Step 4:** Commit `test: mobile viewport probe; root overflow finding`.

### Task A5: PR A gate and merge

- [ ] **Step 1:** Full suite, typecheck, `pnpm build`. Bundle secret grep gate (ten patterns,
  count files and bytes first so an empty directory cannot pass).
- [ ] **Step 2:** Push branch, open PR titled `The Slow Wire: identity and design development`,
  body summarising the design brief deltas and A4 findings.
- [ ] **Step 3:** Task reviewer verdict on the whole branch diff; fix findings.
- [ ] **Step 4:** Merge the PR (squash or merge per repo default), pull main, verify live after
  Vercel deploys: wordmark, tagline, switch, clean paper, favicon (`curl -s <site>/icon.svg`),
  and the mobile probe against production `/` and `/design` at 390.

## PR B: the Cloud vertical (branch `feat/cloud`)

### Task B1: type, budget, prompt

**Files:**
- Modify: `src/types/article.ts`, `src/lib/rank/model.ts`, the prompt string in `src/lib/rank/`
  (implementer locates it in `bedrock.ts` or a sibling; it is the text naming the sections)
- Modify: `components/SectionNav.tsx` (SECTION_LABEL gains cloud)
- Test: `tests/rank/allocate.test.ts` (or the existing allocate suite), `tests/feed/nav.test.tsx`
  (label-completeness test now covers three), new prompt assertion test in the rank suite

**Interfaces:**
- Produces: `SECTIONS = ["ai", "design", "cloud"]`; `RANK_INPUT_CAP = 375`;
  `SECTION_LABEL.cloud = "Cloud"`.

- [ ] **Step 1:** Failing tests first: allocate splits 375 across three sections of 200
  candidates as 125 each; the ranking prompt contains every entry of `SECTIONS`
  (`SECTIONS.every(s => prompt.includes(s))` style, using however the prompt is exported; if it
  is not exported, export the const for the test); nav renders three cells with Cloud last.
- [ ] **Step 2:** Run, expect failures. **Step 3:** Make the changes: SECTIONS + zod enum follows
  automatically; cap 375; prompt gains
  `cloud: cloud platforms and infrastructure (AWS, Azure, GCP, Kubernetes, CDN and edge, cloud economics, major outages)`
  phrased to match the surrounding prompt style; SECTION_LABEL cloud.
- [ ] **Step 4:** Green. **Step 5:** Commit `feat: cloud section in type, budget 375, prompt`.

### Task B2: cloud sources, verified

**Files:**
- Modify: `src/lib/ingest/sources.ts`
- Test: existing sources suite (count and shape assertions updated: 30 total, 8 cloud)

- [ ] **Step 1:** For each of the eight spec URLs (spec 5.2), fetch with
  `curl -sL --max-time 15 -o /dev/null -w "%{http_code} %{content_type}"` and record results in
  the report. A URL that is not 200 or not feed-like gets replaced with a working alternative
  for the same property (note the swap) or dropped to keep only verified entries; minimum six.
- [ ] **Step 2:** Add the entries with `section: "cloud"`, `category` chosen from the values the
  registry type already allows (inspect the type; do not invent a new category value).
- [ ] **Step 3:** Update source-count tests. Green. Commit `feat: cloud sources (verified)`.

### Task B3: cloud route, world, shells, guards

**Files:**
- Create: `app/(feed)/cloud/page.tsx`, `app/(feed)/cloud/loading.tsx`
- Modify: `app/globals.css`, `scripts/check-routes.ts` (if it pins the route set),
  `tests/design/contrast.test.ts`, `tests/feed/loading-world.test.tsx`, `tests/feed/pages.test.tsx`
  (mirror whatever the design page's route test asserts)

- [ ] **Step 1:** Failing tests: contrast grounds table gains
  `["cloud field", "--color-field-cloud", "#eef2e9"]`; loading-world gains the pine case with
  the no-other-field assertion; pages suite asserts `/cloud` renders with
  `data-field="cloud"`.
- [ ] **Step 2:** `globals.css`: `--color-field-cloud: #1a432b;` in `:root`;
  `[data-field="cloud"] { --field: var(--color-field-cloud); --on-field: #eef2e9; }`.
- [ ] **Step 3:** `cloud/page.tsx` mirrors `design/page.tsx` with section `cloud` (copy the file,
  change the section literal, the data-field, and the doc comment; the comment explains cloud
  is the third world, pine). `cloud/loading.tsx` mirrors design's:
  `export default function Loading() { return <FeedLoading field="cloud" />; }` with the
  routing-fact comment.
- [ ] **Step 4:** Green suite. Mutation checks (review will repeat them): pine to `#2e7d4f`
  fails contrast at 3.02:1; cloud loading field to `ai` fails loading-world.
- [ ] **Step 5:** Commit `feat: the cloud world`.

### Task B4: PR B gate, merge, Lambda deploy

- [ ] **Step 1:** Full gate as A5 step 1. Push, open PR `Cloud vertical`, merge after review.
- [ ] **Step 2:** `cdk deploy` from `infra/` (carries RANK_INPUT_CAP 375, new sources, prompt,
  and the previously pending constants-only noop). Record the diff CloudFormation shows before
  confirming. This deploy implements the user-approved budget decision.
- [ ] **Step 3:** Live checks: `/cloud` 200 with pine field and the empty-day state rendered
  honestly (no ranked cloud day exists until the next scheduled run; the page must say so with
  the existing no-data state, not error). Probe `/cloud` at 390. Report that first cloud
  content lands with the next scheduled ingest+rank cycle.

## PR C: quick filters (branch `feat/filters`)

### Task C1: filter core

**Files:**
- Create: `src/lib/feed/filter.ts`
- Test: `tests/feed/filter.test.ts`

**Interfaces:**
- Produces:

```ts
export interface FilterDef { id: string; label: string; synonyms: (string | RegExp)[]; }
export const FILTERS: Record<Section, FilterDef[]>;
export function sanitizeFilterParam(raw: string | undefined): string | null;
export function resolveFilter(section: Section, f: string): FilterDef; // known id or free-text def
export function matchesFilter(article: FeedArticle, def: FilterDef): boolean;
```

- [ ] **Step 1:** Failing tests: every synonym row from spec 6.2; word-boundary negatives
  (`metadata` does not match meta, `framework` does not match framer, `pineapple` does not
  match apple, `awsome`-style token does not match aws); free text matches literally and
  case-insensitively; sanitize trims, strips control chars, caps at 40, returns null for
  empty; resolveFilter falls back to a free-text def whose label is the sanitized input.
- [ ] **Step 2:** Implement: haystack
  `` `${article.title} ${article.summary} ${article.sourceName}`.toLowerCase() ``;
  string synonyms via `includes`, RegExp synonyms (authored with `\b` and the `i` flag) via
  `test`. FILTERS per spec 6.2 with RegExp for meta, framer, apple, aws, lambda, workers, gcp.
- [ ] **Step 3:** Green. Commit `feat: filter core with synonym tables`.

### Task C2: DaySection carries ranks explicitly

**Files:**
- Modify: `components/DaySection.tsx`, its callers (`components/FeedView.tsx`,
  `app/(feed)/day/[date]/page.tsx` if it uses DaySection)
- Test: `tests/feed/day-page.test.tsx`, `tests/feed/feed-view.test.tsx` updates

**Interfaces:**
- Produces: `DaySection({ day, entries, totalInDay, now })` where
  `entries: { article: FeedArticle; rank: number }[]`; header count renders
  `entries.length === totalInDay ? "N stories" : "K of N stories"`; lead = `entries[0]`.

- [ ] **Step 1:** Failing tests: unfiltered day renders `93 stories` and ranks 01..N; a
  filtered shape (entries with ranks 1,4,7 and totalInDay 9) renders `3 of 9 stories`, prints
  01, 04, 07, and inverts only the first entry.
- [ ] **Step 2:** Refactor DaySection; callers map
  `articles.map((article, i) => ({ article, rank: i + 1 }))`.
- [ ] **Step 3:** Green suite (card testids unchanged). Commit
  `refactor: DaySection takes ranked entries`.

### Task C3: filter row, Others form, page integration

**Files:**
- Create: `components/FilterRow.tsx`
- Modify: `app/(feed)/page.tsx`, `app/(feed)/design/page.tsx`, `app/(feed)/cloud/page.tsx`,
  `components/FeedView.tsx`
- Test: `tests/feed/filter-row.test.tsx`, `tests/feed/feed-view.test.tsx`

**Interfaces:**
- Produces: `FilterRow({ section, basePath, activeF, othersOpen, days })`, rendered by the three
  feed pages between SectionNav and FeedView. Pages read
  `searchParams` (a Promise: `const { f, others, days } = await searchParams;` per the Next 15+
  trap already documented), sanitize `f`, resolve the def, filter each day's articles keeping
  `(article, originalRank)` pairs, and pass FeedView the filter context
  `{ label, shown, total } | null`.

- [ ] **Step 1:** Failing tests: row renders the section's five names + Others; active chip gets
  the paper/field inline style and links to the bare path (clears f); inactive chips link to
  `?f=<id>` preserving days; `others=1` renders a GET form with action=basePath, a text input
  named `f` (maxLength 40) and hidden `days` input when days is non-default; a
  `<script>alert(1)</script>` f value renders inert (assert the serialized output contains
  `&lt;script&gt;`); FeedView with filter context renders the FILTER stamp line
  `Filtered by "anthropic": 12 of 93 stories in view.` and hides the day-status line; a
  zero-match day renders `No matches this day.`
- [ ] **Step 2:** Implement. FilterRow chip grammar per the design brief (selection = paper bg +
  field text via inline style, exactly like the switch). The filter line's numbers: shown and
  total summed over the rendered days of this section only.
- [ ] **Step 3:** Green. Commit `feat: quick filters with Others free text`.

### Task C4: route-level fixtures and the C gate

- [ ] **Step 1:** Route test: with a fixture store, `/design?f=figma` renders only matching
  cards and composes with `days=1`. Full suite, typecheck, build, bundle grep.
- [ ] **Step 2:** Mutation checks in review: remove the `\b` from the meta RegExp and a test
  fails; remove sanitization length cap and a test fails.
- [ ] **Step 3:** Push, PR `Quick filters`, review, merge. Live: `/?f=anthropic`,
  `/design?f=figma`, `/cloud?f=aws`, an Others free-text round trip, probe all three at 390.

### Task C5: DESIGN.md, direction contract, PRODUCT.md, ledger close

- [ ] **Step 1:** Rewrite DESIGN.md from shipped code: three worlds table (pine row), clean
  paper (grid removed, why), switch-as-primary-axis with the hover world preview, tagline,
  the mark, filter grammar (selection = paper, original ranks under filter), updated
  known-gaps. Update the layout.tsx contract comment to match. PRODUCT.md: three verticals,
  filters exist, routes list gains `/cloud`.
- [ ] **Step 2:** Commit to main directly (docs only) or fold into PR C if it is still open.
  Update the SDD ledger with every ruling made during the plan.

## Execution notes

- Branch per PR; merges by the agent after each gate (explicit grant for this repo).
- After PR A merges, the user performs the GitHub repo rename and the Vercel project rename per
  spec 4.5; the agent inventories external references to the old domain BEFORE prompting the
  user to rename, then re-verifies live URLs after. This is the only user-blocking step and B/C
  do not depend on it; proceed with B/C regardless and re-run live checks when the domain moves.
- Model selection per SDD defaults: cheap tier for transcription-grade tasks (A1, A3, B3 copy),
  mid tier for reworks with judgment (A2, C2, C3), review seats scaled to diff risk.
