// @vitest-environment jsdom
//
// Opt-in per file -- see the docblock in tests/feed/card.test.tsx for why: this file needs a
// DOM and explicit `afterEach(cleanup)` because `test.globals` is false project-wide.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { dayStatusLine, FeedView } from "../../components/FeedView.js";
import { resolveFilter } from "../../src/lib/feed/filter.js";
import type { FeedResult } from "../../src/lib/feed/read.js";
import { toFeedArticle } from "../../src/lib/feed/shape.js";

afterEach(cleanup);

const NOW = new Date("2026-08-18T12:00:00.000Z");

const rawArticle = (over: Record<string, unknown> = {}) => ({
  pk: `ART#${"a".repeat(64)}`, sk: "A", title: "T", summary: "s", imageUrl: null,
  url: "https://e.com/p", source: "techcrunch", sourceName: "TechCrunch",
  category: "news", section: "ai", publishedAt: "2026-08-18T09:00:00.000Z",
  clusterId: null, corroborationToday: null, whyItMatters: null, score: 500,
  scoreVersion: "v1", points: null, pointsImputed: true, llmImportance: null,
  firstSeenAt: "2026-08-18T10:00:00.000Z",
  ...over,
});

const feedResult = (over: Partial<FeedResult> = {}): FeedResult => ({
  articles: [],
  day: "2026-08-18",
  status: "complete",
  llmRankedInDay: 264,
  truncatedInDay: 14,
  ...over,
});

describe("FeedView", () => {
  it("shows the no-ranked-day message when day is null", () => {
    const result = feedResult({ day: null, status: null, llmRankedInDay: null, truncatedInDay: null });
    const { container } = render(<FeedView section="ai" result={result} now={NOW} />);
    expect(container.querySelector('[data-testid="feed-empty-no-day"]')).not.toBeNull();
  });

  it("does not show the empty-section message when day is null", () => {
    const result = feedResult({ day: null, status: null, llmRankedInDay: null, truncatedInDay: null });
    const { container } = render(<FeedView section="ai" result={result} now={NOW} />);
    expect(container.querySelector('[data-testid="feed-empty-section"]')).toBeNull();
  });

  it("does not show the day-status line when day is null -- there is no day to describe", () => {
    const result = feedResult({ day: null, status: null, llmRankedInDay: null, truncatedInDay: null });
    const { container } = render(<FeedView section="ai" result={result} now={NOW} />);
    expect(container.querySelector('[data-testid="day-status"]')).toBeNull();
  });

  it("names the vertical and the date when the day ranked fine but this section is empty", () => {
    render(<FeedView section="design" result={feedResult({ articles: [] })} now={NOW} />);
    expect(screen.getByText("No design stories for 18.08.2026.")).toBeTruthy();
  });

  it("does not show the no-ranked-day message when this section is merely empty", () => {
    const { container } = render(
      <FeedView section="design" result={feedResult({ articles: [] })} now={NOW} />,
    );
    expect(container.querySelector('[data-testid="feed-empty-no-day"]')).toBeNull();
  });

  it("renders the day's cards, not either empty message, when articles are present", () => {
    const articles = [toFeedArticle(rawArticle())];
    const { container } = render(
      <FeedView section="ai" result={feedResult({ articles })} now={NOW} />,
    );
    expect(container.querySelector('[data-testid="feed-empty-no-day"]')).toBeNull();
    expect(container.querySelector('[data-testid="feed-empty-section"]')).toBeNull();
  });

  it("shows the DaySection header (article count) when articles are present", () => {
    const articles = [toFeedArticle(rawArticle())];
    render(<FeedView section="ai" result={feedResult({ articles })} now={NOW} />);
    expect(screen.getByText("1 story")).toBeTruthy();
  });

  it("shows the day-wide status line above the list, distinct from the per-section count", () => {
    render(
      <FeedView
        section="ai"
        result={feedResult({ llmRankedInDay: 264, truncatedInDay: 14, status: "partial" })}
        now={NOW}
      />,
    );
    expect(screen.getByText(/264 stories ranked across all sections on 18.08.2026/)).toBeTruthy();
  });

  it("omits the day-status line entirely when llmRankedInDay is null, rather than print a confident '0'", () => {
    // Reachable via getDay() (Task 6's /day/[date]) whenever the day's META#DAY record is
    // absent or malformed -- day is still known, but the count is not, and "0 stories ranked"
    // printed directly above a "1 story" header would be self-contradicting.
    const articles = [toFeedArticle(rawArticle())];
    const result = feedResult({ articles, llmRankedInDay: null });
    const { container } = render(<FeedView section="ai" result={result} now={NOW} />);
    expect(container.querySelector('[data-testid="day-status"]')).toBeNull();
  });
});

describe("FeedView -- quick filters", () => {
  /** `n` articles, unfiltered order, where every index in `matchAt` gets a title the
   *  "anthropic" filter matches (so 1-based rank `i + 1` is the fact under test) and every
   *  other index gets a title that matches nothing in FILTERS.ai. Each article carries its own
   *  64-char hex `pk` (`ART#` + the index left-padded with zeros) so no two share a `urlHash` --
   *  a shared default `pk` across every entry would make `entries.map(...key=...)` collide. */
  const buildArticles = (n: number, matchAt: ReadonlySet<number>) =>
    Array.from({ length: n }, (_, i) =>
      toFeedArticle(
        rawArticle({
          pk: `ART#${String(i).padStart(64, "0")}`,
          title: matchAt.has(i) ? `Anthropic story ${i + 1}` : `Generic story ${i + 1}`,
        }),
      ),
    );

  // Branch review M6: the FILTER stamp line is a SECTION-wide summary (its own numbers are
  // already "summed over the rendered days of this section", task-C3-brief.md), so it renders
  // once, above the whole day list -- in `FeedArchive`, not once per day here. `FeedView` still
  // suppresses its own per-day day-status line under a filter (the section-wide line above the
  // list already covers "what is filtered"), but never renders a filter-status line itself --
  // see `tests/feed/feed-archive.test.tsx` for the FILTER stamp's own render-once and
  // summed-shown/total tests.
  it("hides the day-status line under an active filter, without rendering its own filter-status line", () => {
    const matchAt = new Set(Array.from({ length: 12 }, (_, i) => i));
    const articles = buildArticles(93, matchAt);
    const def = resolveFilter("ai", "anthropic");
    const { container } = render(
      <FeedView section="ai" result={feedResult({ articles })} now={NOW} filterDef={def} />,
    );
    expect(container.querySelector('[data-testid="day-status"]')).toBeNull();
    expect(container.querySelector('[data-testid="filter-status"]')).toBeNull();
  });

  it("keeps only the matching entries and their original day ranks (1, 4, 7 of 9), not renumbered", () => {
    const matchAt = new Set([0, 3, 6]);
    const articles = buildArticles(9, matchAt);
    const def = resolveFilter("ai", "anthropic");
    const { container } = render(
      <FeedView section="ai" result={feedResult({ articles })} now={NOW} filterDef={def} />,
    );
    const rankTexts = Array.from(
      container.querySelectorAll('[aria-hidden="true"][data-numeric]'),
    ).map((el) => el.textContent);
    expect(rankTexts).toEqual(["01", "04", "07"]);
  });

  it("renders 'No matches this day.' for a day with articles but zero matches", () => {
    const articles = buildArticles(5, new Set());
    const def = resolveFilter("ai", "anthropic");
    render(
      <FeedView section="ai" result={feedResult({ articles })} now={NOW} filterDef={def} />,
    );
    expect(screen.getByText("No matches this day.")).toBeTruthy();
  });

  it("keeps the day header link and count frame for a zero-match day (the sheet, not a bare message)", () => {
    const articles = buildArticles(5, new Set());
    const def = resolveFilter("ai", "anthropic");
    render(
      <FeedView section="ai" result={feedResult({ articles, day: "2026-08-18" })} now={NOW} filterDef={def} />,
    );
    expect(screen.getByRole("link", { name: "18.08.2026" }).getAttribute("href")).toBe(
      "/day/2026-08-18",
    );
  });

  it("does nothing extra when filterDef is not given -- day-status stays, no filter-status appears", () => {
    const articles = buildArticles(3, new Set([0]));
    const { container } = render(
      <FeedView section="ai" result={feedResult({ articles })} now={NOW} />,
    );
    expect(container.querySelector('[data-testid="filter-status"]')).toBeNull();
    expect(container.querySelector('[data-testid="day-status"]')).not.toBeNull();
  });

  it("keeps the existing empty-section message, not a filter message, when this section had zero articles that day", () => {
    const def = resolveFilter("ai", "anthropic");
    render(
      <FeedView section="design" result={feedResult({ articles: [] })} now={NOW} filterDef={def} />,
    );
    expect(screen.getByText("No design stories for 18.08.2026.")).toBeTruthy();
    expect(screen.queryByTestId("filter-status")).toBeNull();
  });
});

describe("dayStatusLine", () => {
  it("uses singular 'story' for exactly one ranked article", () => {
    expect(dayStatusLine("complete", 1, 0, "2026-08-18"))
      .toBe("1 story ranked across all sections on 18.08.2026.");
  });

  it("uses plural 'stories' for any count other than one", () => {
    expect(dayStatusLine("complete", 264, 0, "2026-08-18"))
      .toBe("264 stories ranked across all sections on 18.08.2026.");
  });

  it("omits the truncated clause when truncatedInDay is 0", () => {
    expect(dayStatusLine("complete", 264, 0, "2026-08-18")).not.toContain("truncated");
  });

  it("includes the truncated count when truncatedInDay is greater than 0", () => {
    expect(dayStatusLine("partial", 264, 14, "2026-08-18")).toContain("14 truncated");
  });

  it("states a partial day plainly, without error/failure wording", () => {
    const line = dayStatusLine("partial", 264, 14, "2026-08-18");
    expect(line).toContain("that day's ranking was partial");
    expect(line).not.toMatch(/error|fail|broken/i);
  });

  it("says nothing about partial status for a complete day", () => {
    expect(dayStatusLine("complete", 264, 14, "2026-08-18")).not.toContain("partial");
  });

  it("never calls a ranked day 'today' -- the function has no `now` and cannot know", () => {
    // The day shown is routinely yesterday (or, on a quietly-broken pipeline, weeks old --
    // the archive reaches 30 days back). A day named "2020-01-01" makes the point
    // regardless of when this test happens to run.
    const line = dayStatusLine("partial", 264, 14, "2020-01-01");
    expect(line).not.toMatch(/\btoday\b/i);
  });
});
