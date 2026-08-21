import type { ReactNode } from "react";
import { RunStatusLine } from "../../components/RunStatusLine.js";

// Final review, N4. Every one of the five pages this layout wraps already has its own
// `export const dynamic = "force-dynamic"`, which is what has kept `pnpm build` from ever
// statically prerendering any of them with no `TABLE_NAME` set. This layout reads DynamoDB too
// (via `RunStatusLine`), on every one of those routes, and had no such directive of its own --
// unlike the pages, it was relying entirely on ITS CHILDREN already being forced dynamic, not on
// anything of its own. The reviewer proved that reliance does not generalise into a safety net:
// `RunStatusLine`'s own `Promise.allSettled` (deliberately, so a transient read failure degrades
// the status line rather than the page -- see that file's doc comment) swallows the throw a
// misconfigured build would otherwise produce, so `pnpm build` does not fail loudly here the way
// it does for a page missing this same directive; only `pnpm check:routes`' route-table
// assertion would eventually catch a regression, and only because it happens to also check this.
// Costs nothing to state explicitly rather than depend on a gate firing for a reason nobody
// wrote down.
export const dynamic = "force-dynamic";

/**
 * Fix round 2. Renders spec §8's highest-value UI element -- the run-status line -- exactly
 * once, above every route in this group, instead of at each of the five call sites fix round 1
 * added individually. This is the route-group layout fix round 1's F7 costed out and declined
 * for that round; the coordinator's fix round 2 asked for it specifically because presence
 * tests (fix round 1's F1 fix) only protect a call site that already exists -- they say nothing
 * about a SIXTH page added later with no call site at all. A layout that every grouped route is
 * forced through by Next's own routing, plus the structural test in
 * `tests/structure/page-groups.test.ts` that fails if a `page.tsx` exists outside this group and
 * isn't explicitly allowlisted, is what actually closes that hole -- no page under `(feed)` can
 * render without going through this layout first, by construction, not by a convention someone
 * has to remember.
 *
 * `app/(feed)/` is a route GROUP: the parenthesised segment is stripped from the URL, so `/`,
 * `/design`, `/day/[date]`, `/article/[urlHash]` and `/search` are unchanged -- verified via
 * `pnpm build`'s route table and `pnpm check:routes`, both of which must show the same six
 * routes as before this move.
 *
 * The ROOT layout (`app/layout.tsx`) is untouched, on purpose: it still performs no data read,
 * so `/_not-found` and `/_global-error` (which render through the root layout, not this one)
 * stay in `scripts/check-routes.ts`'s `EXPECTED_STATIC` exactly as before. This group layout
 * sits BETWEEN the root layout and the five pages, so only routes that actually pass through it
 * -- the five feed/search/article/day routes -- pick up the read; the two Next-internal pages
 * never do.
 *
 * `now` is computed here, once, for this layout's own render -- not threaded down from a page,
 * since a layout and the page it wraps are separate Server Component render passes with no
 * shared instant Next provides. A few milliseconds' difference between this and a page's own
 * `now` is not the hazard the "one `now` per render" rule (see `format.ts`) protects against;
 * that rule is about not calling `new Date()` twice inside the SAME component's own render pass,
 * and this layout and its child page are not the same render pass.
 */
export default async function FeedLayout({ children }: { children: ReactNode }) {
  const now = new Date();

  return (
    <>
      {/* A rail, not an orphan. This renders above <main>, outside every page's container, so it
          supplies its own: full-bleed field with an inner width matching the pages' max-w-3xl, or
          it sits jammed against the viewport edge while the content below is centred. The live
          mono readout across the top is the Illoca move in the pinned direction — the surface
          telling you the state of the thing it is showing you.

          It is ink, not the field's colour, and deliberately so. This layout renders above the
          page, so it cannot know which vertical is below it: painting it `var(--field)` gave the
          design feed a blue bar over a vermilion page. Guessing was the wrong repair — the run
          status is a fact about the pipeline, not about the vertical you happen to be reading, so
          sitting outside both colour worlds is what it actually means. */}
      <a href="#stories" className="skip-link apparatus">Skip to the stories</a>
      <div className="bg-[var(--color-ink)] px-5 py-2.5 text-[color:var(--color-paper)] sm:px-8">
        <div className="mx-auto max-w-3xl">{await RunStatusLine({ now })}</div>
      </div>
      {children}
    </>
  );
}
