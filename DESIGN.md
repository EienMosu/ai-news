# Modern Classic

The visual world of The Slow Wire, as built. Written from the shipped code, not from the brief:
where the two disagree, the code is right and this file is stale.

Chosen by the owner (2026-08-27) from a 25-direction gallery and three refinement rounds; the
visual contract is the direction gallery's "final-design" version. This document replaced "The
Day's Dossier", whose three colour worlds are retired on the web.

## The thesis

A day that was judged, set like a luxury journal.

The product's whole claim is that something read the day and ranked it. Rank is visible as
**position** (a numbered row, the numeral a display-serif folio figure, never zero-padded) and
as the **lead's announcement** (the gold double-rule and THE LEAD tag opening each day, plus the
only full-gold numeral) — never as scale. Every entry keeps one type size, which is what makes
them comparable.

## One page, two lights

One ivory page; ink type; gold as the single accent. No fields, no paper sheets on grounds —
the sheet IS the page. Sections are departments of one journal, not worlds.

| Token | Light | Dark | Role |
|---|---|---|---|
| `--ground` | `#f6f1e6` | `#17130d` | the page |
| `--ink` | `#191512` | `#ece3ce` | type; the inverted rail/chips/buttons |
| `--ink-soft` | `#575043` | `#cdc1a6` | why-lines in rows |
| `--muted` | `#766c5b` | `#a79c85` | meta, counts, inactive departments |
| `--gold` | `#7d600e` | `#d8ac52` | gold that carries TEXT (labels, lead numeral) |
| `--gold-soft` | `#a6811f` | `#d8ac52` | gold that carries RULES (double-rule, underline) |
| `--hair` / `--hair-mid` / `--hair-soft` | `#c9bc9c` / `#d8cdb4` / `#e2d8c2` | `#4a4230` / `#40392a` / `#2e2819` | hairlines, borders |

Light `--muted` is `#766c5b`, one step deeper than the mock's `#7c7260`, because it carries real
text and the mock's value measured 4.21:1; `--gold` is likewise deeper than the decorative
`--gold-soft` for the same reason. `tests/design/contrast.test.ts` computes the floor (4.5:1)
from this file's own tokens for both themes and fails the build on regressions.

**Theming.** Three viewer states: an explicit choice stamps `data-theme="light"/"dark"` on
`<html>`; the default stamps nothing and `prefers-color-scheme` decides. Tokens are defined in
full on bare `:root` (light), redefined under the media query guarded with
`:not([data-theme="light"])`, and redefined again under `[data-theme="dark"]` so the toggle wins
in both directions; the two dark blocks are asserted identical by test. The toggle itself is a
labeled pill (`☾ Dark` / `☀ Light`) in the util row: a plain `<button data-theme-toggle>` whose
click is owned by a ~20-line inline vanilla script in `layout.tsx` — the app's one deliberate
exception to "zero client components", and it is not a component. The two labels are CSS-picked
per theme, so SSR is honest before any script runs. Legacy dossier-era token names
(`--color-ink`, `--color-paper`, `--field`, `--on-field`) alias to the new tokens so nothing can
render a retired colour.

## Three faces, three jobs

Self-hosted at build time by `next/font`.

- **Playfair Display** (600/700/800), display: the masthead, headlines, department cells, the
  folio numerals. The high-contrast Didone IS the Modern Classic voice.
- **Literata** (400/600, italic), prose: why-lines and summaries — a face designed for reading.
- **JetBrains Mono** (400/500), apparatus: counts, sources, dates-as-data. Everything numeric
  gets `tabular-nums`.

`.apparatus` is uppercase mono at 0.6875rem/0.09em. `.stamp` is the same voice, boxed — state
still never depends on hue; the word is the signal.

## The masthead zone

Top to bottom: the util row ("RANKED BY IMPORTANCE" kick left, the theme pill right); the
centered masthead (not a link — switching sections is the departments bar's job, visibly); the
subline (`26.08.2026 · 99 stories` on the feeds — the newest resolved day and its own count,
computed by `feedHeaderData`; the tagline elsewhere); then the **departments bar**.

The bar is the one control that changes section: `AI News · Design News · Cloud News` (full
names, no counts — owner's calls), hairline rules above and below framing it as a control zone,
cells in bold letterspaced display caps, the current cell ink-at-full-strength on a 2px gold
baseline, `aria-current="page"`. On phones the bar eats 14px of each side padding (`-mx-3.5`)
to stand apart from the content column.

## Filters and the search field

Five named chips per section (mechanism unchanged: `?f=`, `src/lib/feed/filter.ts`), each
carrying its match count over the rendered days — the chip names its effect before it is
pressed. The active chip presses in: ink fill, ground text, an `aria-hidden ×`, and it links to
the clear URL. A free-text `f` still gets its own active chip.

The old two-step Others link/form is replaced by an always-visible **search field** under the
chips: a hairline box, mono placeholder "Search these days" (its aria-label too), a stamped Go,
a plain GET form — no JS, honest URLs. It searches the loaded days, which is why the ARCHIVE
link to `/search` (DynamoDB for the recent window + the public GitHub NDJSON archive beyond)
sits right beside it.

**Original ranks survive a filter.** `FeedView` still builds every entry's rank off the day's
full list before any narrowing (repeat-folding, then the filter), so a survivor keeps the
day-wide number it always had. A zero-match day keeps its frame (hairline block, `0 of N
stories`) rather than vanishing.

## The day and its entries

Each day: a small display-serif date (a link to `/day/<date>`), the count (`N stories`, or
`K of N stories` when narrowed) — then the gold double-rule and the letterspaced THE LEAD tag,
then the entries under hairline dividers.

An entry is a row, not a card: the folio numeral (italic display serif; full `--gold` on the
lead, soft gold at reduced presence elsewhere), the title (Playfair, hover-underline), the
why-line (italic Literata — the only line the product wrote itself), and one apparatus meta
line: **source · N points · +K more** (each part conditional; `+K` is the cluster's other
sources). The scraped summary, the timestamp and the thumbnail left the rows with this
redesign — they live on the story page, where reading happens.

## The story page

The document under its own gold double-rule on the page ground: title, provenance meta,
why-it-matters ahead of the summary (a gold left rule marks it), the summary at reading
measure, and the outbound link as the closing action — ink fill, ground text, the same pressed
grammar as the active chip. The instruments (ranking signals, siblings) follow below.

## The loader

One shell for every route (the per-world shells retired with the worlds): masthead, "Opening
the edition", the gold rule, and the counting odometer with italic-serif skeleton numerals.
Pure CSS; `prefers-reduced-motion` collapses every animation in the build.

## Constraints this world lives under

- **Zero client React components.** The theme script is inline vanilla JS, documented above;
  everything else is server-rendered with plain GET forms.
- **Cost governs.** Server-rendered per request against one DynamoDB table; no image pipeline;
  self-hosted fonts only.
- **Both device classes matter equally.** 44px tap targets on coarse pointers; the bar, chips
  and search wrap.

## Known gaps

- **`opengraph-image` still wears the dossier brand** (ink ground, three world blocks,
  Bricolage raw bytes for satori). Deliberately untouched this round; the share card is its own
  follow-up.
- **`/search` still renumbers ranks after searching** — pre-existing, deferred.
- The search input opts out of the global focus ring; the box shows focus via
  `.search-field:focus-within` instead. The placeholder sits at 60% opacity with the aria-label
  carrying the accessible name — exempted in the contrast test.
- The iOS app still speaks the previous (world-field) language; its Modern Classic pass is the
  next phase.
