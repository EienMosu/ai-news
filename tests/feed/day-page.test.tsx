// @vitest-environment jsdom
//
// Opt-in per file -- see the docblock in tests/feed/card.test.tsx for why: this file needs a
// DOM and explicit `afterEach(cleanup)` because `test.globals` is false project-wide.
//
// Mocks `src/lib/feed/read.js` (the module, not the AWS SDK underneath it -- read.test.ts
// already covers that layer), the same pattern tests/feed/pages.test.tsx and
// tests/feed/article-page.test.tsx use: `await` the page component directly and assert on what
// it does with the data, without a DynamoDB mock.
import { cleanup, render, screen } from "@testing-library/react";
import { isHTTPAccessFallbackError } from "next/dist/client/components/http-access-fallback/http-access-fallback.js";
import { afterEach, describe, expect, it, vi } from "vitest";

// Fix round 2: `RunStatusLine` moved out of this page entirely, into
// `app/(feed)/layout.tsx` (see tests/feed/feed-layout.test.tsx and
// tests/structure/page-groups.test.ts) -- the page itself no longer calls
// `getRunStatus`/`getArchive`, so this mock no longer needs to stub them.
vi.mock("../../src/lib/feed/read.js", () => ({
  getDay: vi.fn(),
}));

import DayPage from "../../app/(feed)/day/[date]/page.js";
import { getDay } from "../../src/lib/feed/read.js";
import { toFeedArticle } from "../../src/lib/feed/shape.js";

afterEach(() => {
  cleanup();
  vi.mocked(getDay).mockReset();
});

const rawArticle = (over: Record<string, unknown> = {}) => ({
  pk: `ART#${"a".repeat(64)}`, sk: "A", title: "T", summary: "s", imageUrl: null,
  url: "https://e.com/p", source: "techcrunch", sourceName: "TechCrunch",
  category: "news", section: "ai", publishedAt: "2026-08-18T09:00:00.000Z",
  clusterId: null, corroborationToday: null, whyItMatters: null, score: 500,
  scoreVersion: "v1", points: null, pointsImputed: true, llmImportance: null,
  firstSeenAt: "2026-08-18T10:00:00.000Z",
  ...over,
});

const params = (date: string) => Promise.resolve({ date });

describe("DayPage (app/day/[date]/page.tsx)", () => {
  it("reads date from the awaited params (a Promise, not a plain object) and passes it to getDay", async () => {
    // The Next 15+ trap the brief singles out, mirrored from tests/feed/article-page.test.tsx's
    // dedicated pin for the same hazard on `params`.
    vi.mocked(getDay).mockResolvedValue({
      articles: [toFeedArticle(rawArticle())],
      day: "2026-08-18",
      status: "complete",
      llmRankedInDay: 5,
      truncatedInDay: 0,
    });

    await DayPage({ params: params("2026-08-18") });

    expect(getDay).toHaveBeenCalledWith("2026-08-18");
  });

  it("triggers a real 404 (notFound), not merely any thrown error, for a malformed date", async () => {
    // A bare `.rejects.toThrow()` is satisfied by any thrown error. Checking
    // `isHTTPAccessFallbackError` pins this to a real 404, not just "the function rejected".
    let caught: unknown;
    try {
      await DayPage({ params: params("not-a-date") });
    } catch (err) {
      caught = err;
    }
    expect(isHTTPAccessFallbackError(caught)).toBe(true);
  });

  it("does not call getDay for a malformed date -- the shape check runs before any query", async () => {
    await expect(DayPage({ params: params("banana") })).rejects.toThrow();
    expect(getDay).not.toHaveBeenCalled();
  });

  it("triggers a real 404 when there is no META#DAY record and no articles -- an unknown day", async () => {
    // Fix round 1, F6: 404 requires BOTH no articles AND no META#DAY record (status === null).
    // This fixture represents "this date never happened" -- distinct from the next test, where
    // a record exists but the day ranked nothing.
    vi.mocked(getDay).mockResolvedValue({
      articles: [], day: "2026-01-01", status: null, llmRankedInDay: null, truncatedInDay: null,
    });

    let caught: unknown;
    try {
      await DayPage({ params: params("2026-01-01") });
    } catch (err) {
      caught = err;
    }
    expect(isHTTPAccessFallbackError(caught)).toBe(true);
  });

  it("does not 404, and shows an explanatory message, when a META#DAY record exists but the day has no articles in either vertical -- fix round 1, F6", async () => {
    // §4 added the META#DAY read precisely so a reader can tell a day that ran and legitimately
    // ranked nothing apart from a date that never happened. Collapsing both into one 404 (the
    // brief's literal wording) would throw away that signal -- my ruling, not the brief's.
    vi.mocked(getDay).mockResolvedValue({
      articles: [], day: "2026-01-02", status: "partial", llmRankedInDay: 0, truncatedInDay: 0,
    });

    let caught: unknown;
    try {
      render(await DayPage({ params: params("2026-01-02") }));
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeUndefined();
    expect(screen.getByTestId("day-empty")).toBeTruthy();
  });

  it("renders articles from both sections, unfiltered -- getDay's own contract, not a section filter this page adds", async () => {
    vi.mocked(getDay).mockResolvedValue({
      articles: [
        toFeedArticle(rawArticle({ pk: `ART#${"a".repeat(64)}`, title: "An AI story", section: "ai" })),
        toFeedArticle(rawArticle({ pk: `ART#${"b".repeat(64)}`, title: "A design story", section: "design" })),
      ],
      day: "2026-08-18",
      status: "complete",
      llmRankedInDay: 5,
      truncatedInDay: 0,
    });

    render(await DayPage({ params: params("2026-08-18") }));

    expect(screen.getByText("An AI story")).toBeTruthy();
    expect(screen.getByText("A design story")).toBeTruthy();
    expect(screen.getByText("2 stories")).toBeTruthy();
  });

  it("renders SectionNav with neither vertical current -- a date is not a link to one vertical", async () => {
    vi.mocked(getDay).mockResolvedValue({
      articles: [toFeedArticle(rawArticle())],
      day: "2026-08-18",
      status: "complete",
      llmRankedInDay: 5,
      truncatedInDay: 0,
    });

    render(await DayPage({ params: params("2026-08-18") }));

    expect(screen.getByRole("link", { name: "AI" }).getAttribute("aria-current")).toBeNull();
    expect(screen.getByRole("link", { name: "Design" }).getAttribute("aria-current")).toBeNull();
  });

  it("shows the day-status line when llmRankedInDay is known", async () => {
    vi.mocked(getDay).mockResolvedValue({
      articles: [toFeedArticle(rawArticle())],
      day: "2026-08-18",
      status: "partial",
      llmRankedInDay: 264,
      truncatedInDay: 14,
    });

    render(await DayPage({ params: params("2026-08-18") }));

    expect(screen.getByTestId("day-status").textContent).toContain(
      "264 stories ranked across all sections on 18.08.2026",
    );
  });

  it("omits the day-status line when llmRankedInDay is null (no META#DAY record for this day)", async () => {
    vi.mocked(getDay).mockResolvedValue({
      articles: [toFeedArticle(rawArticle())],
      day: "2026-08-18",
      status: null,
      llmRankedInDay: null,
      truncatedInDay: null,
    });

    render(await DayPage({ params: params("2026-08-18") }));

    expect(screen.queryByTestId("day-status")).toBeNull();
  });

  it("404s a calendar-impossible but shape-valid date WITHOUT ever calling getDay -- final review, L3", async () => {
    // This test used to assert the opposite (`getDay` called with "2026-02-30" verbatim) back
    // when this page validated only `/^\d{4}-\d{2}-\d{2}$/`: that regex accepts "2026-02-30" as
    // well-formed (four digits, two digits, two digits) even though no February reaches the
    // 30th, so the page paid a `queryDay` and a `GetItem` before 404ing -- verified live against
    // production (`/day/2026-02-30` -> 404 AFTER both reads). `isValidDay`
    // (src/lib/search/range.ts) is a full calendar check that still constructs no `Date`
    // anywhere in it -- Task 7 Step 3's "a string we look up, never a date we compute from"
    // holds exactly as strongly as it did when this test pinned the opposite call, and the point
    // of this fix is that the read never happens at all for a date like this one. Asserting the
    // call count, not just the eventual 404 status, is what actually pins that the skip happens
    // -- a page that still 404s AFTER calling getDay for an empty/absent day would pass a
    // status-only assertion just as well.
    let caught: unknown;
    try {
      await DayPage({ params: params("2026-02-30") });
    } catch (err) {
      caught = err;
    }
    expect(isHTTPAccessFallbackError(caught)).toBe(true);
    expect(getDay).not.toHaveBeenCalled();
  });

  it("uses the literal date string for the DaySection header, never a value derived from getDay's own (possibly stale) day field", async () => {
    // Task 7 Step 3: the date is a string we look up, never a date we compute from. This also
    // guards against a page that read `result.day` for display instead of the URL's own
    // `date` -- both happen to agree in most tests, so this fixture deliberately makes them
    // differ to prove which one the page actually renders.
    vi.mocked(getDay).mockResolvedValue({
      articles: [toFeedArticle(rawArticle())],
      day: "2099-12-31",
      status: "complete",
      llmRankedInDay: 1,
      truncatedInDay: 0,
    });

    render(await DayPage({ params: params("2026-08-18") }));

    expect(screen.getByRole("heading", { level: 2, name: "18.08.2026" })).toBeTruthy();
    expect(screen.queryByText("2099-12-31")).toBeNull();
  });

  // Fix round 1's F1 presence assertion lived here; fix round 2 removed it -- `DayPage` alone
  // no longer renders `RunStatusLine` (see the note on the mock above). The presence guarantee
  // now lives in tests/feed/feed-layout.test.tsx and tests/structure/page-groups.test.ts.
});
