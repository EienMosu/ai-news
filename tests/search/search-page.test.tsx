// @vitest-environment jsdom
//
// Opt-in per file -- see the docblock in tests/feed/card.test.tsx for why: this file needs a
// DOM and explicit `afterEach(cleanup)` because `test.globals` is false project-wide.
//
// Mocks `src/lib/search/read.js` (the module, not DynamoDB or `fetch` underneath it) -- the
// same pattern tests/feed/pages.test.tsx and tests/feed/day-page.test.tsx use for
// `src/lib/feed/read.js`: `await` the page component directly and assert on what it does with
// the data and with `searchParams`, without a network call or an AWS SDK mock anywhere in this
// file. The system clock is frozen (`vi.setSystemTime`) so the page's own `new Date()` /
// `istanbulDay` call resolves to a fixed, known day and the exact day arrays this page hands to
// `searchRecentDays`/`searchArchiveDays` are assertable rather than dependent on whenever this
// suite happens to run.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/lib/search/read.js", () => ({
  searchRecentDays: vi.fn(),
  searchArchiveDays: vi.fn(),
}));

// Fix round 2: `RunStatusLine` moved out of this page entirely, into
// `app/(feed)/layout.tsx` (see tests/feed/feed-layout.test.tsx and
// tests/structure/page-groups.test.ts) -- the page no longer imports anything from
// `src/lib/feed/read.js` at all, so this file no longer mocks that module.

import SearchPage, { dynamic } from "../../app/(feed)/search/page.js";
import { toFeedArticle, type FeedArticle } from "../../src/lib/feed/shape.js";
import { MAX_ARCHIVE_SEARCH_DAYS, RECENT_WINDOW_DAYS, subtractDays } from "../../src/lib/search/range.js";
import type { ArchiveSearchOutcome, DayMatches, DayMatchesOutcome } from "../../src/lib/search/read.js";
import { searchArchiveDays, searchRecentDays } from "../../src/lib/search/read.js";

const TODAY = "2026-08-19";

/** `searchArchiveDays` now resolves an `ArchiveSearchOutcome` (fix round 1, finding 5), not a
 *  bare `DayMatches[]` -- this helper is the one place every test in this file builds that
 *  shape, so a future change to it only has to happen here. */
const archiveOutcome = (days: DayMatches[] = [], failedDays = 0): ArchiveSearchOutcome => ({ days, failedDays });

/** `searchRecentDays` now resolves a `DayMatchesOutcome` too (final review, M2), the identical
 *  shape `archiveOutcome` above builds for the archive half -- this is the recent half's own
 *  copy of that same helper, named for its own call site. */
const recentOutcome = (days: DayMatches[] = [], failedDays = 0): DayMatchesOutcome => ({ days, failedDays });

beforeEach(() => {
  vi.setSystemTime(new Date("2026-08-19T12:00:00Z")); // noon UTC = 15:00 Istanbul, same calendar day
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.mocked(searchRecentDays).mockReset();
  vi.mocked(searchArchiveDays).mockReset();
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

const article = (over: Record<string, unknown> = {}): FeedArticle => toFeedArticle(rawArticle(over));

const searchParams = (
  params: Record<string, string | string[]> = {},
): Promise<{ q?: string | string[]; section?: string | string[]; since?: string | string[] }> =>
  Promise.resolve(params);

describe("SearchPage dynamic export", () => {
  it("forces dynamic rendering, so the route is not statically prerendered at build time", () => {
    expect(dynamic).toBe("force-dynamic");
  });
});

describe("SearchPage -- renders SectionNav (fix round 1, finding 7)", () => {
  // Modern Classic (owner, 2026-08-27) renamed the departments-bar cells to the full "... News"
  // labels (`SECTION_LABEL` in components/SectionNav.tsx) -- the words themselves are the
  // affordance now. The contract this block guards is unchanged, only its spelling: /search
  // belongs to no vertical, so SectionNav gets `current={null}` and NO department cell may
  // carry `aria-current="page"` -- current-ness is announced via that attribute (and styled
  // via `.dept[aria-current]` in CSS), so its absence is the honest "you are on neither" state.
  it("renders SectionNav with no department current, even on the blank-query form", async () => {
    render(await SearchPage({ searchParams: searchParams() }));
    expect(screen.getByRole("link", { name: "AI News" }).getAttribute("aria-current")).toBeNull();
    expect(screen.getByRole("link", { name: "Design News" }).getAttribute("aria-current")).toBeNull();
    expect(screen.getByRole("link", { name: "Cloud News" }).getAttribute("aria-current")).toBeNull();
  });

  it("renders SectionNav with all three departments reachable on a results page too", async () => {
    vi.mocked(searchRecentDays).mockResolvedValue(recentOutcome());
    vi.mocked(searchArchiveDays).mockResolvedValue(archiveOutcome());
    render(await SearchPage({ searchParams: searchParams({ q: "claude" }) }));
    expect(screen.getByRole("link", { name: "AI News" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Design News" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Cloud News" })).toBeTruthy();
  });
});

describe("SearchPage -- blank query (decision 7)", () => {
  it("renders only the search form and runs no search for a missing q", async () => {
    render(await SearchPage({ searchParams: searchParams() }));
    expect(searchRecentDays).not.toHaveBeenCalled();
    expect(searchArchiveDays).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Search" })).toBeTruthy();
  });

  it("renders only the search form and runs no search for a whitespace-only q", async () => {
    render(await SearchPage({ searchParams: searchParams({ q: "   " }) }));
    expect(searchRecentDays).not.toHaveBeenCalled();
    expect(searchArchiveDays).not.toHaveBeenCalled();
  });

  it("does not render a results-empty message for a blank query -- that is a distinct state from a real zero-result search", async () => {
    render(await SearchPage({ searchParams: searchParams() }));
    expect(screen.queryByTestId("search-empty")).toBeNull();
  });

  // Fix round 1's F1 presence assertion (blank-query branch) lived here; fix round 2 removed
  // it -- see the note on the mock above.
});

describe("SearchPage -- reads searchParams as a Promise (Next 15+ trap)", () => {
  it("awaits searchParams and passes the parsed, trimmed q through to searchRecentDays", async () => {
    vi.mocked(searchRecentDays).mockResolvedValue(recentOutcome());
    vi.mocked(searchArchiveDays).mockResolvedValue(archiveOutcome());

    await SearchPage({ searchParams: searchParams({ q: "  claude  " }) });

    expect(searchRecentDays).toHaveBeenCalledWith(expect.any(Array), "ai", "claude");
  });
});

describe("SearchPage -- section scope (decision 3)", () => {
  it("defaults to the 'ai' vertical when no ?section= is given", async () => {
    vi.mocked(searchRecentDays).mockResolvedValue(recentOutcome());
    vi.mocked(searchArchiveDays).mockResolvedValue(archiveOutcome());
    await SearchPage({ searchParams: searchParams({ q: "claude" }) });
    expect(searchRecentDays).toHaveBeenCalledWith(expect.any(Array), "ai", "claude");
  });

  it("passes 'design' through when ?section=design", async () => {
    vi.mocked(searchRecentDays).mockResolvedValue(recentOutcome());
    vi.mocked(searchArchiveDays).mockResolvedValue(archiveOutcome());
    await SearchPage({ searchParams: searchParams({ q: "claude", section: "design" }) });
    expect(searchRecentDays).toHaveBeenCalledWith(expect.any(Array), "design", "claude");
  });

  it("passes 'both' through when ?section=both -- brief Step 3's way to search both verticals", async () => {
    vi.mocked(searchRecentDays).mockResolvedValue(recentOutcome());
    vi.mocked(searchArchiveDays).mockResolvedValue(archiveOutcome());
    await SearchPage({ searchParams: searchParams({ q: "claude", section: "both" }) });
    expect(searchRecentDays).toHaveBeenCalledWith(expect.any(Array), "both", "claude");
  });

  it("passes 'cloud' through when ?section=cloud, instead of silently collapsing to the default 'ai' -- branch review C1", async () => {
    vi.mocked(searchRecentDays).mockResolvedValue(recentOutcome());
    vi.mocked(searchArchiveDays).mockResolvedValue(archiveOutcome());
    await SearchPage({ searchParams: searchParams({ q: "claude", section: "cloud" }) });
    expect(searchRecentDays).toHaveBeenCalledWith(expect.any(Array), "cloud", "claude");
  });

  it("offers a Cloud option in the section select, not just AI/Design/Both -- branch review C1", async () => {
    render(await SearchPage({ searchParams: searchParams() }));
    const select = screen.getByLabelText("Section") as HTMLSelectElement;
    const values = [...select.options].map((o) => o.value);
    expect(values).toContain("cloud");
    // The option's visible label now comes from `SECTION_LABEL` (the same source as the
    // departments bar, so the dropdown and the nav can never drift apart), which the Modern
    // Classic redesign renamed to the full "Cloud News". The C1 contract itself is untouched:
    // the option's submitted VALUE stays the bare "cloud" the server parses -- asserted above.
    expect(screen.getByRole("option", { name: "Cloud News" })).toBeTruthy();
  });
});

describe("SearchPage -- recent/archive split (decisions 1 and 2)", () => {
  it("asks searchRecentDays for exactly RECENT_WINDOW_DAYS days, newest first, when since is left at its default", async () => {
    vi.mocked(searchRecentDays).mockResolvedValue(recentOutcome());
    vi.mocked(searchArchiveDays).mockResolvedValue(archiveOutcome());

    await SearchPage({ searchParams: searchParams({ q: "claude" }) });

    const [days] = vi.mocked(searchRecentDays).mock.calls[0]!;
    expect(days).toHaveLength(RECENT_WINDOW_DAYS);
    expect(days[0]).toBe(TODAY);
  });

  it("does not call searchArchiveDays at all when since is left at its default (no archive days requested)", async () => {
    vi.mocked(searchRecentDays).mockResolvedValue(recentOutcome());
    await SearchPage({ searchParams: searchParams({ q: "claude" }) });
    expect(searchArchiveDays).not.toHaveBeenCalled();
  });

  it("calls searchArchiveDays with the older days when ?since= reaches past the recent window, within the archive bound", async () => {
    vi.mocked(searchRecentDays).mockResolvedValue(recentOutcome());
    vi.mocked(searchArchiveDays).mockResolvedValue(archiveOutcome());

    const since = subtractDays(TODAY, RECENT_WINDOW_DAYS + 4); // 30 recent + 5 archive
    await SearchPage({ searchParams: searchParams({ q: "claude", since }) });

    expect(searchArchiveDays).toHaveBeenCalledWith(expect.any(Array), "ai", "claude");
    const [days] = vi.mocked(searchArchiveDays).mock.calls[0]!;
    expect(days).toHaveLength(5);
  });

  it("refuses the archive branch and shows a message when the requested range exceeds the archive bound, without calling searchArchiveDays", async () => {
    vi.mocked(searchRecentDays).mockResolvedValue(recentOutcome());

    const since = subtractDays(TODAY, RECENT_WINDOW_DAYS + MAX_ARCHIVE_SEARCH_DAYS); // one past the bound
    render(await SearchPage({ searchParams: searchParams({ q: "claude", since }) }));

    expect(searchArchiveDays).not.toHaveBeenCalled();
    expect(screen.getByTestId("search-archive-refused")).toBeTruthy();
  });

  it("still runs and shows the recent-window results when the archive branch is refused -- refusal does not block the whole search", async () => {
    vi.mocked(searchRecentDays).mockResolvedValue(
      recentOutcome([{ day: TODAY, articles: [article({ title: "A recent match" })] }]),
    );

    const since = subtractDays(TODAY, RECENT_WINDOW_DAYS + MAX_ARCHIVE_SEARCH_DAYS);
    render(await SearchPage({ searchParams: searchParams({ q: "claude", since }) }));

    expect(screen.getByText("A recent match")).toBeTruthy();
    expect(screen.getByTestId("search-archive-refused")).toBeTruthy();
  });

  it("does not show the archive-refused message for a range within the bound", async () => {
    vi.mocked(searchRecentDays).mockResolvedValue(recentOutcome());
    vi.mocked(searchArchiveDays).mockResolvedValue(archiveOutcome());
    render(await SearchPage({ searchParams: searchParams({ q: "claude" }) }));
    expect(screen.queryByTestId("search-archive-refused")).toBeNull();
  });

  describe("an absurd but calendar-valid since renders the refusal page, not a crash -- fix round 2", () => {
    // Task 8 fix round 2: `?since=0000-01-01` is calendar-valid (isValidDay correctly does not
    // reject a real, if extreme, date), and the archive portion of that range is enormous -- the
    // decision must be made cheaply, before any day-by-day walk, or this exact request throws an
    // unhandled error instead of rendering the refusal page every other too-long range already
    // gets. Awaiting `SearchPage` directly (not wrapped in a try/catch) is itself the assertion:
    // if the page throws, this test fails with that error, same as any other unexpected throw.
    it("renders the refusal message instead of throwing", async () => {
      vi.mocked(searchRecentDays).mockResolvedValue(recentOutcome());
      const rendered = render(await SearchPage({
        searchParams: searchParams({ q: "claude", since: "0000-01-01" }),
      }));
      expect(rendered.getByTestId("search-archive-refused")).toBeTruthy();
      expect(searchArchiveDays).not.toHaveBeenCalled();
    });

    it("still asks searchRecentDays for exactly RECENT_WINDOW_DAYS days -- the recent half is unaffected by how extreme since is", async () => {
      vi.mocked(searchRecentDays).mockResolvedValue(recentOutcome());
      await SearchPage({ searchParams: searchParams({ q: "claude", since: "0000-01-01" }) });
      const [days] = vi.mocked(searchRecentDays).mock.calls[0]!;
      expect(days).toHaveLength(RECENT_WINDOW_DAYS);
      expect(days[0]).toBe(TODAY);
    });
  });

  describe("?since= narrows the recent half too -- fix round 1, finding 4", () => {
    it("asks searchRecentDays for fewer than RECENT_WINDOW_DAYS days when since is inside the recent window", async () => {
      // Task 8 review's mutation M10 rewired the page so the recent half always asked for the
      // full RECENT_WINDOW_DAYS regardless of `?since=`, and every existing test (which only
      // ever exercised the default `since` or a `since` reaching *past* the window) stayed
      // green. `since = yesterday` is inside the window either way, so only a page that actually
      // threads `since` into the recent half's own day list -- not a hardcoded `RECENT_WINDOW_DAYS`
      // -- produces exactly 2 recent days here.
      vi.mocked(searchRecentDays).mockResolvedValue(recentOutcome());
      const since = subtractDays(TODAY, 1); // today and yesterday: 2 days
      await SearchPage({ searchParams: searchParams({ q: "claude", since }) });

      const [days] = vi.mocked(searchRecentDays).mock.calls[0]!;
      expect(days).toEqual([TODAY, subtractDays(TODAY, 1)]);
    });

    it("asks searchRecentDays for exactly one day when since equals today", async () => {
      vi.mocked(searchRecentDays).mockResolvedValue(recentOutcome());
      await SearchPage({ searchParams: searchParams({ q: "claude", since: TODAY }) });
      const [days] = vi.mocked(searchRecentDays).mock.calls[0]!;
      expect(days).toEqual([TODAY]);
    });
  });

  describe("a hard archive failure degrades to partial results -- fix round 1, finding 5", () => {
    it("still renders the recent-window results that already resolved when the archive half reports failed days", async () => {
      vi.mocked(searchRecentDays).mockResolvedValue(
        recentOutcome([{ day: TODAY, articles: [article({ title: "A recent match" })] }]),
      );
      vi.mocked(searchArchiveDays).mockResolvedValue(archiveOutcome([], 1));

      const since = subtractDays(TODAY, RECENT_WINDOW_DAYS + 4);
      render(await SearchPage({ searchParams: searchParams({ q: "claude", since }) }));

      expect(screen.getByText("A recent match")).toBeTruthy();
    });

    it("shows a distinct failed-archive-days notice, not the refused-range notice, when the archive call reports failures", async () => {
      vi.mocked(searchRecentDays).mockResolvedValue(recentOutcome());
      vi.mocked(searchArchiveDays).mockResolvedValue(archiveOutcome([], 2));

      const since = subtractDays(TODAY, RECENT_WINDOW_DAYS + 4);
      render(await SearchPage({ searchParams: searchParams({ q: "claude", since }) }));

      expect(screen.getByTestId("search-archive-failed").textContent).toContain("2 archive days");
      expect(screen.queryByTestId("search-archive-refused")).toBeNull();
    });

    it("shows no failed-archive-days notice when failedDays is zero", async () => {
      vi.mocked(searchRecentDays).mockResolvedValue(recentOutcome());
      vi.mocked(searchArchiveDays).mockResolvedValue(archiveOutcome([], 0));

      const since = subtractDays(TODAY, RECENT_WINDOW_DAYS + 4);
      render(await SearchPage({ searchParams: searchParams({ q: "claude", since }) }));

      expect(screen.queryByTestId("search-archive-failed")).toBeNull();
    });

    it("still renders the archive days that did resolve alongside the failure notice", async () => {
      vi.mocked(searchRecentDays).mockResolvedValue(recentOutcome());
      vi.mocked(searchArchiveDays).mockResolvedValue(
        archiveOutcome([{ day: "2026-07-01", articles: [article({ title: "An archive match" })] }], 1),
      );

      const since = subtractDays(TODAY, RECENT_WINDOW_DAYS + 4);
      render(await SearchPage({ searchParams: searchParams({ q: "claude", since }) }));

      expect(screen.getByText("An archive match")).toBeTruthy();
      expect(screen.getByTestId("search-archive-failed")).toBeTruthy();
    });
  });

  describe("a hard recent-window failure degrades to partial results -- final review, M2", () => {
    // The mirror of the archive-failure block above, now that searchRecentDays reports failures
    // the same way instead of rejecting the whole call (src/lib/search/read.ts).
    it("still renders the archive results that already resolved when the recent half reports failed days", async () => {
      vi.mocked(searchRecentDays).mockResolvedValue(recentOutcome([], 1));
      vi.mocked(searchArchiveDays).mockResolvedValue(
        archiveOutcome([{ day: "2026-07-01", articles: [article({ title: "An archive match" })] }]),
      );

      const since = subtractDays(TODAY, RECENT_WINDOW_DAYS + 4);
      render(await SearchPage({ searchParams: searchParams({ q: "claude", since }) }));

      expect(screen.getByText("An archive match")).toBeTruthy();
    });

    it("shows a distinct failed-recent-days notice, separate from the archive one, when searchRecentDays reports failures", async () => {
      vi.mocked(searchRecentDays).mockResolvedValue(recentOutcome([], 3));
      vi.mocked(searchArchiveDays).mockResolvedValue(archiveOutcome());

      render(await SearchPage({ searchParams: searchParams({ q: "claude" }) }));

      expect(screen.getByTestId("search-recent-failed").textContent).toContain("3 recent days");
      expect(screen.queryByTestId("search-archive-failed")).toBeNull();
    });

    it("shows no failed-recent-days notice when failedDays is zero", async () => {
      vi.mocked(searchRecentDays).mockResolvedValue(recentOutcome([], 0));
      vi.mocked(searchArchiveDays).mockResolvedValue(archiveOutcome());

      render(await SearchPage({ searchParams: searchParams({ q: "claude" }) }));

      expect(screen.queryByTestId("search-recent-failed")).toBeNull();
    });
  });
});

describe("SearchPage -- rendering results", () => {
  it("shows the no-results message when both searches return nothing", async () => {
    vi.mocked(searchRecentDays).mockResolvedValue(recentOutcome());
    vi.mocked(searchArchiveDays).mockResolvedValue(archiveOutcome());
    render(await SearchPage({ searchParams: searchParams({ q: "nonexistent" }) }));
    expect(screen.getByTestId("search-empty").textContent).toContain("nonexistent");
  });

  it("renders a DaySection per matching day from the recent results", async () => {
    vi.mocked(searchRecentDays).mockResolvedValue(
      recentOutcome([{ day: "2026-08-19", articles: [article({ title: "Recent story" })] }]),
    );
    vi.mocked(searchArchiveDays).mockResolvedValue(archiveOutcome());
    render(await SearchPage({ searchParams: searchParams({ q: "story" }) }));
    expect(screen.getByText("Recent story")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "19.08.2026" })).toBeTruthy();
  });

  it("renders recent-day results before archive-day results, in document order", async () => {
    const since = subtractDays(TODAY, RECENT_WINDOW_DAYS + 4);
    vi.mocked(searchRecentDays).mockResolvedValue(
      recentOutcome([
        { day: "2026-08-19", articles: [article({ pk: `ART#${"a".repeat(64)}`, title: "Recent story" })] },
      ]),
    );
    vi.mocked(searchArchiveDays).mockResolvedValue(
      archiveOutcome([{ day: "2026-07-01", articles: [article({ pk: `ART#${"b".repeat(64)}`, title: "Archive story" })] }]),
    );

    render(await SearchPage({ searchParams: searchParams({ q: "story", since }) }));

    const recent = screen.getByText("Recent story");
    const older = screen.getByText("Archive story");
    expect(recent.compareDocumentPosition(older) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  // Fix round 1's F1 presence assertion (results branch) lived here; fix round 2 removed it --
  // see the note on the mock above.
});

describe("SearchPage -- since input min/max (fix round 1, finding 8)", () => {
  it("sets max to today and min to today minus the full recent+archive window", async () => {
    render(await SearchPage({ searchParams: searchParams() }));
    const input = screen.getByLabelText("Since") as HTMLInputElement;
    expect(input.max).toBe(TODAY);
    expect(input.min).toBe(subtractDays(TODAY, RECENT_WINDOW_DAYS + MAX_ARCHIVE_SEARCH_DAYS - 1));
  });
});
