// Fix round 2, F7-residual. Presence tests (fix round 1's F1 fix, and now
// tests/feed/feed-layout.test.tsx) only protect a call site that already exists: they fail if
// someone DELETES the line that renders spec §8's run-status line from a page that already has
// it. They cannot fail on OMISSION -- a sixth route added later with no such call site, and no
// test written for it, leaves nothing here to trip. The review proved exactly this: it added
// `app/zzscratchroute/page.tsx` with no `RunStatusLine` anywhere in it, and `pnpm test`,
// `pnpm typecheck`, `pnpm build` and `pnpm check:routes` all stayed green.
//
// This is the mechanism that actually closes that hole. `app/(feed)/layout.tsx` forces every
// route nested under it through one `RunStatusLine` call, by Next's own routing -- a page
// cannot render without going through its enclosing layout. So the only way a new page can ship
// without the status line is to live OUTSIDE `app/(feed)/` entirely. This test enumerates every
// `page.tsx` under `app/` and fails if one exists outside that group and is not on the small,
// explicitly-commented allowlist below -- proven by mutation the same way the review found the
// gap: add a page outside the group, watch this test fail by name, remove it.
import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const APP_DIR = "app";
// POSIX form, matching the normalised paths `findPageFiles` returns below (it joins with "/"
// regardless of `node:path`'s platform-specific `sep`, so this suite reads the same on any OS).
const FEED_GROUP = "app/(feed)/";

/**
 * Pages allowed to exist outside `app/(feed)/` -- i.e., pages that deliberately do NOT render
 * spec §8's run-status line. Empty on purpose: every `page.tsx` in this app today is a
 * feed-reading page that belongs under the group. Add an entry here ONLY alongside a comment
 * explaining why that specific page has no business showing ingest health (e.g. a legal/static
 * page with no data read at all) -- an empty list is the loud, restrictive default this test
 * enforces; a list that silently grows defeats the entire point of having it.
 */
const ALLOWED_OUTSIDE_FEED_GROUP: string[] = [];

/** Every `page.tsx` under `dir`, recursively, as paths relative to the repo root (POSIX
 *  separators, so this reads the same on any OS this suite runs on). */
function findPageFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...findPageFiles(full));
    } else if (entry === "page.tsx") {
      found.push(relative(".", full).split(sep).join("/"));
    }
  }
  return found;
}

/**
 * Whether `page` is a page that would ship WITHOUT the run-status line.
 *
 * Extracted from the filter it used to be inline, for one reason: the suite below runs against
 * the real filesystem, which on a correct tree contains no offenders -- so breaking this
 * predicate (returning `false` unconditionally, say) left that suite green. The guard that is
 * now the only thing between a new page and a missing status line was itself unpinned. The
 * fixture cases below pin it without touching the filesystem.
 */
export function isUngrouped(page: string): boolean {
  return !page.startsWith(FEED_GROUP) && !ALLOWED_OUTSIDE_FEED_GROUP.includes(page);
}

describe("the offender predicate discriminates, independently of what is on disk", () => {
  // Final review, L15: this file previously claimed "Next routes all of them, and none of them
  // passes through app/(feed)/layout.tsx" for all six fixtures below -- that is true of the four
  // in THIS block, but false of the two in the next one. `app/_private/page.tsx` and
  // `app/@slot/page.tsx` used to be in this same list; the review confirmed neither is a route
  // Next creates at all (see the next describe block), so grouping them here as "evasion shapes
  // Next routes" was partly fictional evidence, in the one test whose entire claim to authority
  // is that it was proved by mutation. Two more real, routed shapes (a catch-all segment and a
  // multi-level nested path) replace them below, so this block still covers the same number of
  // genuinely exploitable "ships outside the group" shapes it did before the correction, not
  // fewer.
  it.each([
    "app/plain/page.tsx",
    "app/[slug]/page.tsx",
    "app/[...catchAll]/page.tsx",
    "app/deeply/nested/page.tsx",
    "app/(.)intercepted/page.tsx",
    "app/(other)/page.tsx",
  ])("treats %s as ungrouped", (page) => {
    expect(isUngrouped(page)).toBe(true);
  });

  it.each([
    "app/(feed)/page.tsx",
    "app/(feed)/design/page.tsx",
    "app/(feed)/day/[date]/page.tsx",
  ])("treats %s as grouped", (page) => {
    expect(isUngrouped(page)).toBe(false);
  });
});

describe("two shapes Next does not route as pages at all -- corrected from the original claim", () => {
  // Final review, L15: the previous version of this file asserted these two paths belonged among
  // the "evasion shapes... Next routes all of them" fixtures above. They do not. Next's own
  // documented routing conventions say so directly, not something this suite can probe by
  // rendering a route table:
  //
  // - A folder prefixed with `_` is a "Private Folder": Next's docs state this "opts the folder
  //   and all its subfolders out of routing" entirely, so `app/_private/page.tsx` is never
  //   reachable at any URL.
  // - A folder prefixed with `@` is a parallel-route "named slot": its `page.tsx` is passed as a
  //   prop to the enclosing layout, not exposed at a URL of its own (the slot's content renders
  //   at the PARENT segment's path, never at literally `/@slot`).
  //
  // Neither carries a real omission risk on its own -- there is no route for a status line to be
  // missing from -- so this is not the safety-critical property the earlier claim implied.
  // `isUngrouped` is still asserted against them below, but for a narrower and honest reason:
  // it is a pure string-prefix check with no knowledge of Next's routing semantics, so it
  // (harmlessly) flags these two the same as any other non-`(feed)` path, and that is worth
  // pinning as deliberate, specified behaviour rather than leaving it silently unverified.
  it.each([
    "app/_private/page.tsx",
    "app/@slot/page.tsx",
  ])("still (harmlessly) flags %s as ungrouped, though Next never routes it as a page", (page) => {
    expect(isUngrouped(page)).toBe(true);
  });
});

describe("every app/**/page.tsx renders spec §8's run-status line, by construction", () => {
  it("lives under app/(feed)/, or is named on the explicit (and currently empty) allowlist", () => {
    const pages = findPageFiles(APP_DIR);
    // Sanity check on the walker itself: if this ever comes back empty, the test below would
    // pass vacuously (no offenders because nothing was found at all, not because everything is
    // correctly grouped) -- exactly the kind of green-but-vacuous check this project has been
    // burned by before.
    expect(pages.length).toBeGreaterThan(0);

    expect(pages.filter(isUngrouped)).toEqual([]);
  });
});
