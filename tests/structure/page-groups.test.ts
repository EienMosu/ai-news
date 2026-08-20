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
  // The five evasion shapes the review actually tried against the real tree, plus the plain
  // case. Each must be recognised as ungrouped -- Next routes all of them, and none of them
  // passes through app/(feed)/layout.tsx.
  it.each([
    "app/plain/page.tsx",
    "app/_private/page.tsx",
    "app/[slug]/page.tsx",
    "app/@slot/page.tsx",
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
