# The Day's Dossier

The visual world of The Slow Wire, as built. Written from the shipped code, not from the brief:
where the two disagree, the code is right and this file is stale.

Pinned by the user from two references (Mosby's Files, The Matter of Design), which overrode the
generated direction. The full direction contract, including what this build refused, sits at the
top of `app/layout.tsx`.

## The thesis

A day that was judged, shown as the file it was judged in.

This product's whole claim is that something read the day and ranked it. The default
arrangement, a white page of same-size cards sorted by recency, hides the ranking inside an order
nobody can see, so the design refuses it. Rank is visible as **position** (a numbered row) and as
**ground** (the lead entry leaves the paper), never as scale. Every entry keeps one type size,
which is what makes them comparable.

## Three colour worlds

Not tabs over one list. Ranking splits its 375-article cap fairly across sections
(`allocateRankingCap`, `src/lib/rank/allocate.ts`, roughly 125 per section with a
water-filling remainder), so AI, design and cloud scores were never comparable on one scale.
Switching vertical is leaving one world for another, and it looks like it.

A route sets `--field` once on `<main data-field>`; everything else derives. No component
hard-codes a field colour, because every component has to survive on any of the three grounds.

| Token | Value | Role |
|---|---|---|
| `--color-field-ai` | `#16307f` | the AI world |
| `--color-field-design` | `#7e2412` | the design world |
| `--color-field-cloud` | `#1a432b` | the cloud world |
| `--color-paper` | `#efe9dc` | the sheet laid on the field |
| `--color-ink` | `#151512` | type on paper; the status rail |
| `--on-field` | `#f3eee2` (ai) / `#f6ece7` (design) / `#eef2e9` (cloud) | type on each field |

`--color-field-design` is deep for a reason: at the vermilion this build started from
(`#a5301a`) bone type topped out at 5.95:1, so every soft step measured 3.09 to 4.34:1 and
failed the floor. Deepening the field bought the hierarchy back instead of pushing every opacity
to near-opaque, which would have flattened it. Cloud's pine (`#1a432b`) was picked with the same
floor in mind from the start: its on-field colour measures 5.69:1 at 0.70 opacity, clear of the
line with room to spare.

## Clean paper

The two `background-image` gradient layers that used to tint `[data-surface="paper"]` with a
faint graph grid are gone (2026-08-21), everywhere the surface appears, including the loading
skeleton. Plain bone `--color-paper` remains; the shadow every sheet already carries
(`shadow-[0_18px_40px_-24px_rgba(0,0,0,0.55)]`, `DaySection.tsx`, `FeedView.tsx`'s zero-match
sheet, `FeedLoading.tsx`) does the lifting on its own, and nothing was added to compensate. Why:
the user found the grid notebook-like and wanted the sheet to read modern and serious, a
deliberate amendment to the direction the specimen panel had won with. The specimen that carried
the grid is retired along with it, which is also why it no longer appears among the pinned
references above.

## The switch is the primary axis

The section switch (`nav[aria-label="Sections"]`, `SectionNav.tsx`) is full width, three equal
cells, mono uppercase, at least 44px tall on coarse pointers (`@media (pointer: coarse)`,
`globals.css`). The masthead dropped one type step to make room for it as the page's primary
control: `text-[2.5rem]` mobile, `sm:text-[3rem]` desktop, down from `3.5rem`.

**World preview on hover.** Every cell already carries `data-field` for the section it leads to,
so `--field` and `--on-field` re-derive on it directly from the `[data-field="ai"]` /
`[data-field="design"]` / `[data-field="cloud"]` rules in `globals.css`; an inactive cell's hover
state (`hover:bg-[var(--field)] hover:text-[var(--on-field)]`) paints in the world it leads to,
with zero JavaScript. Every world needs its own explicit rule here rather than relying on
inheritance from the ambient `<main data-field>`: a custom property only re-derives on an element
a selector matches directly, so on `/design` (ambient vermilion), an AI cell's hover would show
vermilion instead of its own blue without its own rule to re-derive it.

## Tagline and the mark

The tagline sits under the wordmark in apparatus voice, opacity-70, max-width 42ch: "Each day's
news, ranked by importance, not recency." (`SectionNav.tsx`, `data-testid="tagline"`). The mark
is the folded-corner file: a 26px stroke-only rectangle with a folded top-right corner, stroke
`currentColor`, `aria-hidden` since the wordmark beside it already names the product. It also
ships as `app/icon.svg`, the browser favicon, hard-coded bone-on-ink so it survives both browser
themes; a single `currentColor` stroke on transparent would not.

## The selection grammar

Selected reads the same way everywhere it appears: paper background, field-coloured text
(`background: var(--color-paper)`, `color: var(--field)`), one inline style object used verbatim
in two places, the switch's current cell (`SectionNav.tsx`) and every active filter chip
(`FilterRow.tsx`'s `ACTIVE_STYLE`). Inactive stays transparent, on-field text at opacity-70, with
a shared 1px on-field border at 35%; hover raises that to full opacity. One consequence: because
`currentColor` inside an inverted cell or chip is `var(--field)`, the global `:focus-visible`
ring (`2px solid currentColor`) would draw field on field there, invisible at 1.00:1.
`FilterRow`'s `.filter-active-chip:focus-visible` overrides just the outline colour to
`var(--color-paper)` to fix that on chips; the switch's current cell carries the same defect,
documented but not yet fixed.

## The filter grammar

One mechanism, `?f=` (`src/lib/feed/filter.ts`), drives every section's quick filters.
`sanitizeFilterParam` cleans the raw query value (strips control and format characters, trims,
caps at 40 Unicode code points, counted by code point so a trailing emoji is never split).
`resolveFilter` maps the cleaned value to a `FilterDef`: one of `FILTERS[section]`'s five named
chips, matched case-insensitively against the chip's id, or a free-text def built from the value
itself when it matches none of them. `matchesFilter` tests each synonym, plain strings by
lowercased substring, regexes (used where a short or common word risks a false match, such as
`meta`, `apple`, `aws`, `lambda`, `framer`, `gcp`) with a `\b` word boundary, against the
article's title, summary and source name. One accepted false positive is left in on purpose:
`workers` (Cloudflare) still matches ordinary English like "co-workers", called out in the source
rather than solved.

**Original ranks survive a filter.** `FeedView` builds every entry's rank off the day's full,
unfiltered article list before any filter narrows it, then filters that already-ranked list down
to matches, so a survivor keeps the day-wide rank it always had (01, 04, 07), never renumbered
from 1. Why: rank is a fact about the day, not about whatever filter is currently narrowing what
is shown, so a filtered sheet's ranks have to stay comparable to the same day unfiltered.

**The FILTER line renders once per section**, not once per day. `FeedArchive` sums shown and
total across every rendered day and prints one `FILTER` stamp and sentence above the whole day
list; `FeedView` suppresses its own per-day day-status line under an active filter rather than
render a second, competing line.

**A zero-match day still keeps its sheet.** When a filter is active and nothing in a day matches
it, `FeedView` still renders the paper frame and day header (`0 of N stories`), plus "No matches
this day." at opacity-70, instead of hiding the day or leaving a blank panel that looks broken.

## The contrast floor

No informational text below 70% opacity. At that floor: AI field 5.83:1, design field 4.89:1,
cloud field 5.69:1, paper 6.18:1, ink rail 7.82:1. `tests/design/contrast.test.ts` computes these
from `globals.css` itself and fails if any ground, or any component, drops under 4.5:1. It exists
because this defect is invisible to review by eye: the vermilion shipped wrong once and looked
fine. One exemption, documented in the test: the loading skeleton's `aria-hidden` rank digits
carry no information.

There is a second, opposite pairing to guard: paper background with field-coloured text at full
opacity, the exact inversion the switch's current cell and every active chip use. Measured: ai
9.84:1, design 8.08:1, cloud 9.23:1, comfortable headroom on all three, guarded so a future field
lightening, or a paper darkening, that eats into that headroom fails the test rather than passing
silently until it actually crosses the floor.

## Status is never a hue

The spec talks in amber and red. Red is invisible on vermilion, so state ships as a **stamp**, a
boxed, letterspaced mono word, and the word is the signal. Colour-blind readers and every
vertical get the same information. `SOURCE_STATE_CLASS` therefore maps states to stamp
*weights*, not colours.

The run-status rail is **ink**, deliberately outside all three worlds: it reports the run, which
spans every vertical, and a layout above the routes cannot know which vertical it sits over.

## Three faces, three jobs

Self-hosted at build time by `next/font`.

- **Bricolage Grotesque** (600/800), display. Dates, headlines, the masthead.
- **Literata** (400/600, italic), prose. Every entry carries a summary; this is a face designed
  for reading at length.
- **JetBrains Mono** (400/500), apparatus: filing times, counts, scores. Data in columns, not a
  costume for "technical". Everything numeric gets `tabular-nums`.

`.apparatus` is uppercase mono at 0.6875rem/0.09em. `.stamp` is the same voice, boxed.

## Structure

The masthead is **not a link**: a wordmark pointing at `/` would be a third control that
silently switches vertical. Switching worlds is the switch's job, visibly.

Two numbers appear near each other and mean different things: the sheet header's count is *this
vertical's* (or, under a filter, `K of N` for this vertical), and the day-status line, shown only
unfiltered, totals *every* vertical. The latter is labelled `DAY TOTAL` for that reason:
unlabelled, 93 above 72 reads as an arithmetic error rather than two facts.

`whyItMatters` sits **above** the scraped summary. It is the only line on the page the product
wrote itself; putting the borrowed text first buries the thing that makes this more than a
reader.

The thumbnail is optional, fixed-size, and the row's layout does not depend on it: `imageUrl` is
absent on a large share of items, so a layout reserving a hero slot per entry ships a page full of
holes. The bare row is the design.

## Loader worlds

Every feed route is `force-dynamic` and reads DynamoDB per request, so there is a real interval to
fill, and the honest thing to show is the product's own mechanism: the day being counted, then
stamped, not a spinner that says only that something is happening. `components/FeedLoading.tsx`
carries that device, parameterised by a `field` prop rather than fixed to one vertical, and three
thin `loading.tsx` files, one per route group, each just supply their own world: `ai` at
`app/(feed)/loading.tsx`, `design` at `app/(feed)/design/loading.tsx`, `cloud` at
`app/(feed)/cloud/loading.tsx`. Next resolves `loading.tsx` to the nearest one above a route, so
without the design and cloud files those verticals would inherit the AI-coloured shell and flash
the wrong world on every navigation.

Pure CSS by constraint and to its benefit: this app ships **no client components**, so the counter
is a strip of digits translated under a window by `steps()`. Three columns at different rates
read as a counter racing rather than three clocks in sync. It names no figure it does not have:
the digits cycle, the stamp names the act, and the real counts land with the real page.
`prefers-reduced-motion` collapses every animation in the build.

## Constraints this world lives under

- **Zero client components.** Anything needing state or effects is out of scope by construction;
  the quick-filter Others box is a plain GET form, not an exception.
- **Cost governs.** Server-rendered per request against one DynamoDB table; no image pipeline, no
  analytics, no third-party fonts at runtime.
- **Both device classes matter equally.** The thumbnail is `sm:` and up; the nav, the switch and
  the day-status line wrap.

## Known gaps

- **`/day/[date]` and `/search` still render in the AI field.** Both pass `SectionNav
  current={null}`, so the switch shows no vertical selected, and `data-field="ai"` regardless of
  which vertical the reader came from. Documented, out of scope.
- **`/search` still renumbers ranks after searching.** Its entries are built as
  `r.articles.map((article, i) => ({ article, rank: i + 1 }))` off the search results
  themselves, not off a day's full article list, the exact shape `DaySection`'s own contract
  says a filtered render must never produce (rank is a fact about the day, not about whatever
  query narrowed what is shown). Pre-existing, deferred.
- **The zero-match filter sheet duplicates `DaySection`'s frame by hand** (the paper surface, the
  shadow, the header) instead of sharing it, so nothing pins the two in sync; a future change to
  `DaySection`'s own markup will not automatically reach this second copy. Accepted.
