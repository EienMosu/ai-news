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

vi.mock("../../src/lib/feed/read.js", () => ({
  getRecentDays: vi.fn(),
}));

import DesignPage from "../../app/design/page.js";
import Home from "../../app/page.js";
import type { FeedResult } from "../../src/lib/feed/read.js";
import { getRecentDays } from "../../src/lib/feed/read.js";

afterEach(() => {
  cleanup();
  vi.mocked(getRecentDays).mockReset();
});

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
    vi.mocked(getRecentDays).mockResolvedValue([EMPTY_DAY_RESULT]);
    render(await Home({ searchParams: searchParams() }));
    expect(getRecentDays).toHaveBeenCalledWith("ai", 7);
  });

  it("marks the AI nav link current, not Design", async () => {
    vi.mocked(getRecentDays).mockResolvedValue([EMPTY_DAY_RESULT]);
    render(await Home({ searchParams: searchParams() }));
    expect(screen.getByRole("link", { name: "AI" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Design" }).getAttribute("aria-current")).toBeNull();
  });

  it("passes its own section through to the rendered day, not the other one", async () => {
    vi.mocked(getRecentDays).mockResolvedValue([EMPTY_DAY_RESULT]);
    render(await Home({ searchParams: searchParams() }));
    expect(screen.getByText("No AI stories for 2026-08-18.")).toBeTruthy();
  });

  it("reads `days` from the awaited searchParams (a Promise, not a plain object) and passes the parsed count to getRecentDays", async () => {
    // The Next 15+ trap: typing `searchParams` as a plain object instead of
    // `Promise<{ days?: ... }>` compiles and builds clean but serves `undefined` at runtime for
    // every request. A default-only assertion (days missing -> 7) cannot tell "awaited
    // correctly" apart from "never awaited at all, so .days read off the Promise is undefined
    // either way" -- both produce 7. Asserting on a specific, non-default requested value is
    // what actually pins the await.
    vi.mocked(getRecentDays).mockResolvedValue([EMPTY_DAY_RESULT]);
    render(await Home({ searchParams: searchParams({ days: "20" }) }));
    expect(getRecentDays).toHaveBeenCalledWith("ai", 20);
  });

  it("defaults to 7 days when no `days` param is given", async () => {
    vi.mocked(getRecentDays).mockResolvedValue([EMPTY_DAY_RESULT]);
    render(await Home({ searchParams: searchParams() }));
    expect(getRecentDays).toHaveBeenCalledWith("ai", 7);
  });

  it("clamps an out-of-range `days` value before calling getRecentDays, rather than passing the raw request through", async () => {
    vi.mocked(getRecentDays).mockResolvedValue([EMPTY_DAY_RESULT]);
    render(await Home({ searchParams: searchParams({ days: "1000" }) }));
    expect(getRecentDays).toHaveBeenCalledWith("ai", 30);
  });

  it("ignores a garbage `days` value, falling back to the default rather than rendering it as requested", async () => {
    vi.mocked(getRecentDays).mockResolvedValue([EMPTY_DAY_RESULT]);
    render(await Home({ searchParams: searchParams({ days: "banana" }) }));
    expect(getRecentDays).toHaveBeenCalledWith("ai", 7);
  });

  it("renders a section for every day getRecentDays returns, newest first", async () => {
    vi.mocked(getRecentDays).mockResolvedValue([
      { ...EMPTY_DAY_RESULT, day: "2026-08-18" },
      { ...EMPTY_DAY_RESULT, day: "2026-08-17" },
    ]);
    render(await Home({ searchParams: searchParams() }));
    expect(screen.getByText("No AI stories for 2026-08-18.")).toBeTruthy();
    expect(screen.getByText("No AI stories for 2026-08-17.")).toBeTruthy();
  });

  it("shows the no-ranked-day-at-all message, distinct from a per-day empty message, when getRecentDays returns no days", async () => {
    vi.mocked(getRecentDays).mockResolvedValue([]);
    const { container } = render(await Home({ searchParams: searchParams() }));
    expect(container.querySelector('[data-testid="feed-empty-no-day"]')).not.toBeNull();
    expect(screen.queryByText(/No AI stories for/)).toBeNull();
  });

  it("points its load-more link at /, not /design", async () => {
    const results = Array.from({ length: 7 }, (_, i) => ({
      ...EMPTY_DAY_RESULT,
      day: `2026-08-${18 - i}`,
    }));
    vi.mocked(getRecentDays).mockResolvedValue(results);
    render(await Home({ searchParams: searchParams() }));
    expect(screen.getByTestId("load-more-days").getAttribute("href")).toBe("/?days=14");
  });
});

describe("DesignPage (app/design/page.tsx)", () => {
  it("asks getRecentDays for the 'design' section", async () => {
    vi.mocked(getRecentDays).mockResolvedValue([EMPTY_DAY_RESULT]);
    render(await DesignPage({ searchParams: searchParams() }));
    expect(getRecentDays).toHaveBeenCalledWith("design", 7);
  });

  it("marks the Design nav link current, not AI", async () => {
    vi.mocked(getRecentDays).mockResolvedValue([EMPTY_DAY_RESULT]);
    render(await DesignPage({ searchParams: searchParams() }));
    expect(screen.getByRole("link", { name: "Design" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "AI" }).getAttribute("aria-current")).toBeNull();
  });

  it("passes its own section through to the rendered day, not the other one", async () => {
    vi.mocked(getRecentDays).mockResolvedValue([EMPTY_DAY_RESULT]);
    render(await DesignPage({ searchParams: searchParams() }));
    expect(screen.getByText("No design stories for 2026-08-18.")).toBeTruthy();
  });

  it("reads `days` from the awaited searchParams and passes the parsed count to getRecentDays", async () => {
    vi.mocked(getRecentDays).mockResolvedValue([EMPTY_DAY_RESULT]);
    render(await DesignPage({ searchParams: searchParams({ days: "20" }) }));
    expect(getRecentDays).toHaveBeenCalledWith("design", 20);
  });

  it("clamps an out-of-range `days` value before calling getRecentDays", async () => {
    vi.mocked(getRecentDays).mockResolvedValue([EMPTY_DAY_RESULT]);
    render(await DesignPage({ searchParams: searchParams({ days: "1000" }) }));
    expect(getRecentDays).toHaveBeenCalledWith("design", 30);
  });

  it("points its load-more link at /design, not /", async () => {
    const results = Array.from({ length: 7 }, (_, i) => ({
      ...EMPTY_DAY_RESULT,
      day: `2026-08-${18 - i}`,
    }));
    vi.mocked(getRecentDays).mockResolvedValue(results);
    render(await DesignPage({ searchParams: searchParams() }));
    expect(screen.getByTestId("load-more-days").getAttribute("href")).toBe("/design?days=14");
  });

  it("shows the no-ranked-day-at-all message when getRecentDays returns no days", async () => {
    vi.mocked(getRecentDays).mockResolvedValue([]);
    const { container } = render(await DesignPage({ searchParams: searchParams() }));
    expect(container.querySelector('[data-testid="feed-empty-no-day"]')).not.toBeNull();
  });
});
