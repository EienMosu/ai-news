# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

One user: the owner. He reads it on a phone and on a desktop **equally** — neither is the
primary case, and he does not adapt his habits to the device.

His job: find out what actually mattered in AI and design today without reading every headline
published. The pipeline captures roughly 250 articles a day across 21 sources; he wants the top
of that, not the whole of it.

## Product Purpose

An LLM ranks each day's captured articles by importance, so the reader sees a judged day rather
than a firehose. Success is that opening it answers "what happened today" in under a minute, and
that the answer can be trusted — including when the system does not know something.

## Positioning

Two things an RSS reader structurally cannot do, and most aggregators do not:

1. **A judgment layer.** Every article gets an importance score, a one-line "why it matters", and
   a cluster id grouping the articles covering the same story. That is a model's reading of the
   day, not a sort by recency.
2. **Honesty about its own gaps, as a product rule rather than a nicety.** An engagement figure
   that was imputed rather than measured says so. A day whose ranking was cut short says so. An
   article the model never scored carries a marker instead of being silently mixed into a ranking
   it was not part of. A source that quarantined an item is shown as drift, not as failure.

## Operating Context

**Reading is two-stage, and this is the load-bearing fact about how the product is used.** He
scans the list first, then opens a few. So the list exists to be scanned — many items, compared
quickly — and the story page is where reading actually happens. Neither surface should try to be
both.

Days are the organising unit, not an infinite stream: the feed shows seven day sections and can
reach thirty. The day is closed and stamped once ranked, so what he read yesterday does not
reshuffle under him.

## Capabilities and Constraints

- **Two verticals**, `ai` and `design`, as sibling destinations (`/`, `/design`), not a filter.
  Their scores were never comparable — ranking allocates its input cap per section — so
  interleaving them would rank design news last by construction.
- **Routes:** the two feeds, `/day/[date]`, `/article/[urlHash]`, `/search`, plus `/api/ingest`
  as a manual capture trigger capped at 20 per day.
- **The story page never fetches the article body.** It shows what the system knows — summary,
  why-it-matters, the score's signals, the other articles on the same story — and sends the
  reader to the original. This is a deliberate product and legal boundary.
- **Server-rendered only. There are no client components anywhere**, and every data route is
  dynamic. Any design must work without client-side state.
- **Search** covers the last 30 days from the live store and older ranges from a public NDJSON
  archive, a month at a time; a longer range is refused rather than silently truncated.
- **Cost is a governing constraint**, not a preference: the account runs on finite credit and the
  ceiling is roughly $20–30/month. A design that multiplies reads or requests is a product
  problem here, not just a performance one.

## Brand Commitments

**The name is undecided.** The current `AI News` is placeholder; the owner is considering
something else and has not chosen it. Nothing should be built that depends on a final wordmark,
and no name should be invented on his behalf.

No logo, no existing palette, no typographic commitment, no prior identity to preserve.

## Evidence on Hand

The live product at `ai-news-ten-bice.vercel.app`, backed by real data. The binding design and
architecture spec is `docs/superpowers/specs/2026-08-18-ai-news-design.md` — §7 governs the
reader-facing surface and §8 the monitoring line in the header.
