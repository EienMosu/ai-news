// @vitest-environment jsdom
//
// Opt-in per file -- see the docblock in tests/feed/card.test.tsx for why: this file needs a
// DOM and explicit `afterEach(cleanup)` because `test.globals` is false project-wide.
//
// `app/page.tsx` and `app/design/page.tsx` are a hand-copy of each other with four coupled
// strings changed (the `getRecentDays` section argument, `SectionNav`'s `current`,
// `FeedArchive`'s `section`, and `FeedArchive`'s `basePath`) -- the classic copy-paste seam, and
// nothing else in this suite pins any of the four. Mocking `getRecentDays` (the module, not the
// AWS SDK underneath it -- read.test.ts already covers that layer) lets these tests `await`
// each page component directly and assert on exactly that seam, without a DynamoDB mock. See
// task-5-review.md finding 3: the reviewer rewrote `app/design/page.tsx` to serve the AI
// vertical entirely and the suite stayed green with nothing here to catch it -- these tests are
// what closes that gap, now extended to Task 7's `?days=` search param and the day-list it
// renders.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Fix round 2: `RunStatusLine` moved out of these two pages entirely, into
// `app/(feed)/layout.tsx` (see tests/feed/feed-layout.test.tsx and
// tests/structure/page-groups.test.ts) -- neither page calls `getRunStatus`/`getArchive` any
// more, so this mock no longer needs to stub them.
vi.mock("../../src/lib/feed/read.js", () => ({
  getRecentDays: vi.fn(),
}));

import DesignPage from "../../app/(feed)/design/page.js";
import CloudPage from "../../app/(feed)/cloud/page.js";
import Home from "../../app/(feed)/page.js";
import type { FeedResult, RecentDaysOutcome } from "../../src/lib/feed/read.js";
import { getRecentDays } from "../../src/lib/feed/read.js";
import { toFeedArticle } from "../../src/lib/feed/shape.js";

/** A minimal, fully-typed raw article -- only the fields the fixture-driven filter tests below
 *  actually vary (`pk` for a unique `urlHash`, `title`) need overriding per call. Mirrors the
 *  identical helper in `tests/feed/feed-view.test.tsx`. */
const rawArticle = (over: Record<string, unknown> = {}) => ({
  pk: `ART#${"a".repeat(64)}`, sk: "A", title: "T", summary: "s", imageUrl: null,
  url: "https://e.com/p", source: "techcrunch", sourceName: "TechCrunch",
  category: "news", section: "design", publishedAt: "2026-08-18T09:00:00.000Z",
  clusterId: null, corroborationToday: null, whyItMatters: null, score: 500,
  scoreVersion: "v1", points: null, pointsImputed: true, llmImportance: null,
  firstSeenAt: "2026-08-18T10:00:00.000Z",
  ...over,
});

afterEach(() => {
  cleanup();
  vi.mocked(getRecentDays).mockReset();
});

/** `getRecentDays` now resolves a `RecentDaysOutcome` (final review, M2), not a bare
 *  `FeedResult[]` -- this helper is the one place every test in this file builds that shape, so
 *  a future change to it only has to happen here. */
const outcome = (results: FeedResult[] = [], failedDays = 0): RecentDaysOutcome => ({ results, failedDays });

// A single day that ranked fine but has nothing for whichever section asks. The empty-section
// message names the section it was given, which is what makes the FeedArchive/FeedView-prop
// assertions below possible without inspecting props directly.
const EMPTY_DAY_RESULT: FeedResult = {
  articles: [],
  day: "2026-08-18",
  status: "complete",
  llmRankedInDay: 5,
  truncatedInDay: 0,
};

const searchParams = (params: Record<string, string | string[]> = {}) => Promise.resolve(params);

describe("Home (app/page.tsx)", () => {
  it("asks getRecentDays for the 'ai' section", async () => {
    vi.mocked(getRecentDays).mockResolvedValue(outcome([EMPTY_DAY_RESULT]));
    render(await Home({ searchParams: searchParams() }));
    expect(getRecentDays).toHaveBeenCalledWith("ai", 7);
  });

  it("marks the AI nav link current, not Design", async () => {
    vi.mocked(getRecentDays).mockResolvedValue(outcome([EMPTY_DAY_RESULT]));
    render(await Home({ searchParams: searchParams() }));
    expect(screen.getByRole("link", { name: "AI" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Design" }).getAttribute("aria-current")).toBeNull();
  });

  it("passes its own section through to the rendered day, not the other one", async () => {
    vi.mocked(getRecentDays).mockResolvedValue(outcome([EMPTY_DAY_RESULT]));
    render(await Home({ searchParams: searchParams() }));
    expect(screen.getByText("No AI stories for 18.08.2026.")).toBeTruthy();
  });

  it("reads `days` from the awaited searchParams (a Promise, not a plain object) and passes the parsed count to getRecentDays", async () => {
    // The Next 15+ trap: typing `searchParams` as a plain object instead of
    // `Promise<{ days?: ... }>` compiles and builds clean but serves `undefined` at runtime for
    // every request. A default-only assertion (days missing -> 7) cannot tell "awaited
    // correctly" apart from "never awaited at all, so .days read off the Promise is undefined
    // either way" -- both produce 7. Asserting on a specific, non-default requested value is
    // what actually pins the await.
    vi.mocked(getRecentDays).mockResolvedValue(outcome([EMPTY_DAY_RESULT]));
    render(await Home({ searchParams: searchParams({ days: "20" }) }));
    expect(getRecentDays).toHaveBeenCalledWith("ai", 20);
  });

  it("defaults to 7 days when no `days` param is given", async () => {
    vi.mocked(getRecentDays).mockResolvedValue(outcome([EMPTY_DAY_RESULT]));
    render(await Home({ searchParams: searchParams() }));
    expect(getRecentDays).toHaveBeenCalledWith("ai", 7);
  });

  it("clamps an out-of-range `days` value before calling getRecentDays, rather than passing the raw request through", async () => {
    vi.mocked(getRecentDays).mockResolvedValue(outcome([EMPTY_DAY_RESULT]));
    render(await Home({ searchParams: searchParams({ days: "1000" }) }));
    expect(getRecentDays).toHaveBeenCalledWith("ai", 30);
  });

  it("ignores a garbage `days` value, falling back to the default rather than rendering it as requested", async () => {
    vi.mocked(getRecentDays).mockResolvedValue(outcome([EMPTY_DAY_RESULT]));
    render(await Home({ searchParams: searchParams({ days: "banana" }) }));
    expect(getRecentDays).toHaveBeenCalledWith("ai", 7);
  });

  it("renders a section for every day getRecentDays returns, newest first", async () => {
    // Fix round 1, F11: this previously only asserted both days' text was present, not their
    // order -- "newest first" in the name was uncashed. `feed-archive.test.tsx` pins the order
    // via heading order at the component-unit level; this asserts it here too, at the page
    // wiring level, via document order in the rendered DOM.
    vi.mocked(getRecentDays).mockResolvedValue(outcome([
      { ...EMPTY_DAY_RESULT, day: "2026-08-18" },
      { ...EMPTY_DAY_RESULT, day: "2026-08-17" },
    ]));
    render(await Home({ searchParams: searchParams() }));
    const newer = screen.getByText("No AI stories for 18.08.2026.");
    const older = screen.getByText("No AI stories for 17.08.2026.");
    expect(newer.compareDocumentPosition(older) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows the no-ranked-day-at-all message, distinct from a per-day empty message, when getRecentDays returns no days", async () => {
    vi.mocked(getRecentDays).mockResolvedValue(outcome());
    const { container } = render(await Home({ searchParams: searchParams() }));
    expect(container.querySelector('[data-testid="feed-empty-no-day"]')).not.toBeNull();
    expect(screen.queryByText(/No AI stories for/)).toBeNull();
  });

  it("passes getRecentDays' failedDays through to FeedArchive, surfacing a failure notice -- final review, M2", async () => {
    vi.mocked(getRecentDays).mockResolvedValue(outcome([EMPTY_DAY_RESULT], 2));
    render(await Home({ searchParams: searchParams() }));
    expect(screen.getByTestId("feed-days-failed").textContent).toContain("2 days");
  });

  it("points its load-more link at /, not /design", async () => {
    const results = Array.from({ length: 7 }, (_, i) => ({
      ...EMPTY_DAY_RESULT,
      day: `2026-08-${18 - i}`,
    }));
    vi.mocked(getRecentDays).mockResolvedValue(outcome(results));
    render(await Home({ searchParams: searchParams() }));
    expect(screen.getByTestId("load-more-days").getAttribute("href")).toBe("/?days=14");
  });

  it("passes the parsed/clamped `days` value to FeedArchive, not a raw coercion of the request -- fix round 1, F5", async () => {
    // "-5" fails parseDaysParam's digit-only shape check, so the correct day count is the
    // DEFAULT (7) -- it is garbage, not merely "a number below the minimum". A page that instead
    // fed FeedArchive's `days` prop from something like `Number(rawDays) || days` still calls
    // getRecentDays correctly (so tests asserting only that call would stay green), but
    // `Number("-5")` is `-5`, a truthy value that survives the `||` fallback intact and reaches
    // FeedArchive as `-5` instead of `7`. With exactly 7 days mocked back (matching the true,
    // correctly-parsed count), `moreMayExist` (`results.length === days`) is `7 === 7` when the
    // real clamped value reaches the component, and `7 === -5` -- silently false, hiding a real
    // load-more link -- when the raw coercion does.
    const results = Array.from({ length: 7 }, (_, i) => ({
      ...EMPTY_DAY_RESULT,
      day: `2026-08-${18 - i}`,
    }));
    vi.mocked(getRecentDays).mockResolvedValue(outcome(results));
    render(await Home({ searchParams: searchParams({ days: "-5" }) }));
    expect(getRecentDays).toHaveBeenCalledWith("ai", 7);
    expect(screen.getByTestId("load-more-days").getAttribute("href")).toBe("/?days=14");
  });

  it("carries a non-default `days` value into the SectionNav links -- fix round 1, F9", async () => {
    const results = Array.from({ length: 14 }, (_, i) => ({
      ...EMPTY_DAY_RESULT,
      day: `2026-08-${18 - i}`,
    }));
    vi.mocked(getRecentDays).mockResolvedValue(outcome(results));
    render(await Home({ searchParams: searchParams({ days: "14" }) }));
    expect(screen.getByRole("link", { name: "Design" }).getAttribute("href")).toBe("/design?days=14");
  });

  // Fix round 1's F1 presence assertion lived here; fix round 2 removed it. `Home` alone no
  // longer renders `RunStatusLine` at all -- that call site moved to `app/(feed)/layout.tsx`,
  // which this test imports the bare page component around, never through Next's real routing.
  // Asserting `run-status-empty` here would now assert something this page genuinely doesn't
  // do, which is a worse gap than the one it used to fill: a passing-but-untrue test. The
  // presence guarantee now lives in two other places that actually can give it:
  // tests/feed/feed-layout.test.tsx (the layout renders RunStatusLine) and
  // tests/structure/page-groups.test.ts (every page.tsx, including this one, is forced under
  // that layout or is on an explicit, empty-by-default allowlist).
});

describe("DesignPage (app/design/page.tsx)", () => {
  it("asks getRecentDays for the 'design' section", async () => {
    vi.mocked(getRecentDays).mockResolvedValue(outcome([EMPTY_DAY_RESULT]));
    render(await DesignPage({ searchParams: searchParams() }));
    expect(getRecentDays).toHaveBeenCalledWith("design", 7);
  });

  it("marks the Design nav link current, not AI", async () => {
    vi.mocked(getRecentDays).mockResolvedValue(outcome([EMPTY_DAY_RESULT]));
    render(await DesignPage({ searchParams: searchParams() }));
    expect(screen.getByRole("link", { name: "Design" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "AI" }).getAttribute("aria-current")).toBeNull();
  });

  it("passes its own section through to the rendered day, not the other one", async () => {
    vi.mocked(getRecentDays).mockResolvedValue(outcome([EMPTY_DAY_RESULT]));
    render(await DesignPage({ searchParams: searchParams() }));
    expect(screen.getByText("No design stories for 18.08.2026.")).toBeTruthy();
  });

  it("reads `days` from the awaited searchParams and passes the parsed count to getRecentDays", async () => {
    vi.mocked(getRecentDays).mockResolvedValue(outcome([EMPTY_DAY_RESULT]));
    render(await DesignPage({ searchParams: searchParams({ days: "20" }) }));
    expect(getRecentDays).toHaveBeenCalledWith("design", 20);
  });

  it("clamps an out-of-range `days` value before calling getRecentDays", async () => {
    vi.mocked(getRecentDays).mockResolvedValue(outcome([EMPTY_DAY_RESULT]));
    render(await DesignPage({ searchParams: searchParams({ days: "1000" }) }));
    expect(getRecentDays).toHaveBeenCalledWith("design", 30);
  });

  it("points its load-more link at /design, not /", async () => {
    const results = Array.from({ length: 7 }, (_, i) => ({
      ...EMPTY_DAY_RESULT,
      day: `2026-08-${18 - i}`,
    }));
    vi.mocked(getRecentDays).mockResolvedValue(outcome(results));
    render(await DesignPage({ searchParams: searchParams() }));
    expect(screen.getByTestId("load-more-days").getAttribute("href")).toBe("/design?days=14");
  });

  it("shows the no-ranked-day-at-all message when getRecentDays returns no days", async () => {
    vi.mocked(getRecentDays).mockResolvedValue(outcome());
    const { container } = render(await DesignPage({ searchParams: searchParams() }));
    expect(container.querySelector('[data-testid="feed-empty-no-day"]')).not.toBeNull();
  });

  it("passes getRecentDays' failedDays through to FeedArchive, surfacing a failure notice -- final review, M2", async () => {
    vi.mocked(getRecentDays).mockResolvedValue(outcome([EMPTY_DAY_RESULT], 1));
    render(await DesignPage({ searchParams: searchParams() }));
    expect(screen.getByTestId("feed-days-failed").textContent).toContain("1 day");
  });

  it("carries a non-default `days` value into the SectionNav links -- fix round 1, F9", async () => {
    const results = Array.from({ length: 14 }, (_, i) => ({
      ...EMPTY_DAY_RESULT,
      day: `2026-08-${18 - i}`,
    }));
    vi.mocked(getRecentDays).mockResolvedValue(outcome(results));
    render(await DesignPage({ searchParams: searchParams({ days: "14" }) }));
    expect(screen.getByRole("link", { name: "AI" }).getAttribute("href")).toBe("/?days=14");
  });

  // See the identical note at the end of the `Home` describe block above -- the same removal,
  // same reason, same replacement.

  // Branch review I1: spec 6.4's own route bullet ("/design?f=figma returns 200 and contains
  // only matching cards, fixture-driven") had no test anywhere in the suite. This is that test.
  describe("quick filters -- branch review I1", () => {
    it("filters to only matching cards for /design?f=figma (spec 6.4), and composes with days=1", async () => {
      const matching = toFeedArticle(
        rawArticle({ pk: `ART#${"a".repeat(64)}`, title: "Figma ships new prototyping tools" }),
      );
      const nonMatching = toFeedArticle(
        rawArticle({ pk: `ART#${"b".repeat(64)}`, title: "Adobe updates its suite" }),
      );
      vi.mocked(getRecentDays).mockResolvedValue(
        outcome([{ ...EMPTY_DAY_RESULT, articles: [matching, nonMatching] }]),
      );
      render(await DesignPage({ searchParams: searchParams({ f: "figma", days: "1" }) }));

      // Composes with days: the same request also asked for a 1-day archive.
      expect(getRecentDays).toHaveBeenCalledWith("design", 1);
      expect(screen.getByText("Figma ships new prototyping tools")).toBeTruthy();
      expect(screen.queryByText("Adobe updates its suite")).toBeNull();
      expect(screen.getByTestId("filter-status").textContent).toContain(
        'Filtered by "Figma": 1 of 2 stories in view.',
      );
    });
  });
});

describe("CloudPage (app/cloud/page.tsx)", () => {
  it("asks getRecentDays for the 'cloud' section", async () => {
    vi.mocked(getRecentDays).mockResolvedValue(outcome([EMPTY_DAY_RESULT]));
    render(await CloudPage({ searchParams: searchParams() }));
    expect(getRecentDays).toHaveBeenCalledWith("cloud", 7);
  });

  it("marks the Cloud nav link current, not AI or Design", async () => {
    vi.mocked(getRecentDays).mockResolvedValue(outcome([EMPTY_DAY_RESULT]));
    render(await CloudPage({ searchParams: searchParams() }));
    expect(screen.getByRole("link", { name: "Cloud" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "AI" }).getAttribute("aria-current")).toBeNull();
    expect(screen.getByRole("link", { name: "Design" }).getAttribute("aria-current")).toBeNull();
  });

  it("passes its own section through to the rendered day, not either other one", async () => {
    vi.mocked(getRecentDays).mockResolvedValue(outcome([EMPTY_DAY_RESULT]));
    render(await CloudPage({ searchParams: searchParams() }));
    expect(screen.getByText("No cloud stories for 18.08.2026.")).toBeTruthy();
  });

  it("reads `days` from the awaited searchParams and passes the parsed count to getRecentDays", async () => {
    vi.mocked(getRecentDays).mockResolvedValue(outcome([EMPTY_DAY_RESULT]));
    render(await CloudPage({ searchParams: searchParams({ days: "20" }) }));
    expect(getRecentDays).toHaveBeenCalledWith("cloud", 20);
  });

  it("clamps an out-of-range `days` value before calling getRecentDays", async () => {
    vi.mocked(getRecentDays).mockResolvedValue(outcome([EMPTY_DAY_RESULT]));
    render(await CloudPage({ searchParams: searchParams({ days: "1000" }) }));
    expect(getRecentDays).toHaveBeenCalledWith("cloud", 30);
  });

  it("points its load-more link at /cloud, not / or /design", async () => {
    const results = Array.from({ length: 7 }, (_, i) => ({
      ...EMPTY_DAY_RESULT,
      day: `2026-08-${18 - i}`,
    }));
    vi.mocked(getRecentDays).mockResolvedValue(outcome(results));
    render(await CloudPage({ searchParams: searchParams() }));
    expect(screen.getByTestId("load-more-days").getAttribute("href")).toBe("/cloud?days=14");
  });

  it("shows the no-ranked-day-at-all message when getRecentDays returns no days", async () => {
    vi.mocked(getRecentDays).mockResolvedValue(outcome());
    const { container } = render(await CloudPage({ searchParams: searchParams() }));
    expect(container.querySelector('[data-testid="feed-empty-no-day"]')).not.toBeNull();
  });

  it("passes getRecentDays' failedDays through to FeedArchive, surfacing a failure notice", async () => {
    vi.mocked(getRecentDays).mockResolvedValue(outcome([EMPTY_DAY_RESULT], 1));
    render(await CloudPage({ searchParams: searchParams() }));
    expect(screen.getByTestId("feed-days-failed").textContent).toContain("1 day");
  });

  it("carries a non-default `days` value into the SectionNav links", async () => {
    const results = Array.from({ length: 14 }, (_, i) => ({
      ...EMPTY_DAY_RESULT,
      day: `2026-08-${18 - i}`,
    }));
    vi.mocked(getRecentDays).mockResolvedValue(outcome(results));
    render(await CloudPage({ searchParams: searchParams({ days: "14" }) }));
    expect(screen.getByRole("link", { name: "AI" }).getAttribute("href")).toBe("/?days=14");
  });

  // Branch review I1: "PR C widens [the copy-paste] seam from four coupled strings to six per
  // page: `resolveFilter("cloud", ...)` and `<FilterRow section="cloud" ...>`. Neither is
  // pinned." Both mutations were proven, by hand, to survive the full 930-test suite. These
  // three tests close that gap for CloudPage; DesignPage's analogous fixture test lives above.
  describe("quick filters -- branch review I1", () => {
    it("resolves f against the cloud filter table, not ai's -- kills a resolveFilter(section) mutation", async () => {
      // "Amazon Web Services" is a synonym of cloud's known "aws" filter (a plain string, spec
      // 6.2) but contains no literal "aws" substring anywhere in it. Resolved against "ai"
      // instead of "cloud" (the mutation), "aws" is not a known ai id, so it becomes a free-text
      // def whose only synonym is the literal string "aws" -- which this title does not match at
      // all, and whose label reads lowercase "aws" rather than the known chip's "AWS".
      const matching = toFeedArticle(
        rawArticle({ pk: `ART#${"c".repeat(64)}`, title: "Amazon Web Services adds a feature" }),
      );
      vi.mocked(getRecentDays).mockResolvedValue(
        outcome([{ ...EMPTY_DAY_RESULT, articles: [matching] }]),
      );
      render(await CloudPage({ searchParams: searchParams({ f: "aws" }) }));
      expect(screen.getByText("Amazon Web Services adds a feature")).toBeTruthy();
      expect(screen.getByTestId("filter-status").textContent).toContain('Filtered by "AWS"');
    });

    it("renders the cloud section's own chips in FilterRow, not ai's -- kills a FilterRow section prop mutation", async () => {
      vi.mocked(getRecentDays).mockResolvedValue(outcome([EMPTY_DAY_RESULT]));
      render(await CloudPage({ searchParams: searchParams() }));
      expect(screen.getByRole("link", { name: "AWS" })).toBeTruthy();
      expect(screen.queryByRole("link", { name: "Anthropic" })).toBeNull();
    });

    it("opens the Others form when others=1 is in searchParams", async () => {
      vi.mocked(getRecentDays).mockResolvedValue(outcome([EMPTY_DAY_RESULT]));
      render(await CloudPage({ searchParams: searchParams({ others: "1" }) }));
      expect(screen.getByRole("textbox", { name: "Filter by any word" })).toBeTruthy();
      expect(screen.queryByRole("link", { name: "Others" })).toBeNull();
    });
  });
});
