# The Day's Dossier

The visual world of ai-news, as built. Written from the shipped code, not from the brief — where
the two disagree, the code is right and this file is stale.

Pinned by the user from three references (Mosby's Files, Illoca, The Matter of Design), which
overrode the generated direction. The full direction contract, including what this build refused,
sits at the top of `app/layout.tsx`.

## The thesis

A day that was judged, shown as the file it was judged in.

This product's whole claim is that something read the day and ranked it. The default arrangement —
a white page of same-size cards sorted by recency — hides the ranking inside an order nobody can
see, so the design refuses it. Rank is visible as **position** (a numbered row) and as **ground**
(the lead entry leaves the paper), never as scale. Every entry keeps one type size, which is what
makes them comparable.

## Two colour worlds

Not tabs over one list. Ranking allocates its input cap per section, so AI scores and design scores
were never comparable — switching vertical is leaving one world for another, and it looks like it.

A route sets `--field` once on `<main data-field>`; everything else derives. No component
hard-codes a field colour, because every component has to survive on either ground.

| Token | Value | Role |
|---|---|---|
| `--color-field-ai` | `#16307f` | the AI world |
| `--color-field-design` | `#7e2412` | the design world |
| `--color-paper` | `#efe9dc` | the sheet laid on the field |
| `--color-ink` | `#151512` | type on paper; the status rail |
| `--on-field` | `#f3eee2` / `#f6ece7` | type on each field |

`--color-field-design` is deep for a reason: at the vermilion this build started from (`#a5301a`)
bone type topped out at 5.95:1, so every soft step measured 3.09–4.34:1 and failed the floor.
Deepening the field bought the hierarchy back instead of pushing every opacity to near-opaque,
which would have flattened it.

## The contrast floor

**No informational text below 70% opacity.** At the floor: AI field 5.83:1, design field 4.89:1,
paper 6.18:1, ink rail 7.82:1.

`tests/design/contrast.test.ts` computes these from `globals.css` and fails if any ground or any
component drops under 4.5:1. It exists because this defect is invisible to review by eye — the
vermilion shipped wrong and looked fine. One exemption, documented in the test: the loading
skeleton's `aria-hidden` rank digits carry no information.

## Status is never a hue

The spec talks in amber and red. Red is invisible on vermilion, so state ships as a **stamp** — a
boxed, letterspaced mono word — and the word is the signal. Colour-blind readers and the design
vertical get the same information. `SOURCE_STATE_CLASS` therefore maps states to stamp *weights*,
not colours.

The run-status rail is **ink**, deliberately outside both worlds: it reports the run, which spans
both verticals, and a layout above the routes cannot know which vertical it sits over.

## Three faces, three jobs

Self-hosted at build time by `next/font`.

- **Bricolage Grotesque** (600/800) — display. Dates, headlines, the masthead.
- **Literata** (400/600, italic) — prose. Every entry carries a summary; this is a face designed
  for reading at length.
- **JetBrains Mono** (400/500) — apparatus: filing times, counts, scores. Data in columns, not a
  costume for "technical". Everything numeric gets `tabular-nums`.

`.apparatus` is uppercase mono at 0.6875rem/0.09em. `.stamp` is the same voice, boxed.

## Structure

The masthead is **not a link** — a wordmark pointing at `/` would be a third control that silently
switches vertical. Switching worlds is the nav's job, visibly.

Two numbers appear near each other and mean different things: the sheet header's count is *this
vertical's* (`articles.length`, what the section renders), and the day-status line totals *both*.
The latter is labelled `DAY TOTAL` for that reason — unlabelled, 93 above 72 reads as an
arithmetic error rather than two facts.

`whyItMatters` sits **above** the scraped summary. It is the only line on the page the product
wrote itself; putting the borrowed text first buries the thing that makes this more than a reader.

The thumbnail is optional, fixed-size, and the row's layout does not depend on it — `imageUrl` is
absent on a large share of items, so a layout reserving a hero slot per entry ships a page full of
holes. The bare row is the design.

## The one authored moment

`app/(feed)/loading.tsx`. Every feed route is `force-dynamic` and reads DynamoDB per request, so
there is a real interval to fill, and the honest thing to show is the product's own mechanism: the
day being counted, then stamped. Not a spinner, which says only that something is happening.

Pure CSS by constraint and to its benefit — this app ships **no client components**, so the counter
is a strip of digits translated under a window by `steps()`. Three columns at different rates read
as a counter racing rather than three clocks in sync. It names no figure it does not have: the
digits cycle, the stamp names the act, and the real counts land with the real page.

`prefers-reduced-motion` collapses every animation in the build.

## Constraints this world lives under

- **Zero client components.** Anything needing state or effects is out of scope by construction.
- **Cost governs.** Server-rendered per request against one DynamoDB table; no image pipeline, no
  analytics, no third-party fonts at runtime.
- **Both device classes matter equally.** The thumbnail is `sm:` and up; the nav and day-status
  line wrap.

## Known gaps

- **Mobile rasters are unverified.** Neither available browser harness would produce a narrow
  layout viewport in this environment (the live tab pins `innerWidth` at 1512 regardless of window
  size; headless CDP `setDeviceMetricsOverride` applied to `/design` and was silently ignored on
  `/`). What *is* verified: both routes serve `width=device-width`, and at a confirmed 414px
  viewport `/design` reported `scrollWidth === innerWidth` with zero overflowing elements.
- SEO is deliberately deferred: `/article/` is blocked from indexes until a real domain exists.
