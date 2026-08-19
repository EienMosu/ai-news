// @vitest-environment jsdom
//
// Opt-in per file -- see the docblock in tests/feed/card.test.tsx for why: this file needs a
// DOM and explicit `afterEach(cleanup)` because `test.globals` is false project-wide.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { dayStatusLine, FeedView } from "../../components/FeedView.js";
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
    expect(screen.getByText("No design stories for 2026-08-18.")).toBeTruthy();
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
    expect(screen.getByText(/264 stories ranked across both sections on 2026-08-18/)).toBeTruthy();
  });
});

describe("dayStatusLine", () => {
  it("uses singular 'story' for exactly one ranked article", () => {
    expect(dayStatusLine("complete", 1, 0, "2026-08-18"))
      .toBe("1 story ranked across both sections on 2026-08-18.");
  });

  it("uses plural 'stories' for any count other than one", () => {
    expect(dayStatusLine("complete", 264, 0, "2026-08-18"))
      .toBe("264 stories ranked across both sections on 2026-08-18.");
  });

  it("omits the truncated clause when truncatedInDay is 0", () => {
    expect(dayStatusLine("complete", 264, 0, "2026-08-18")).not.toContain("truncated");
  });

  it("includes the truncated count when truncatedInDay is greater than 0", () => {
    expect(dayStatusLine("partial", 264, 14, "2026-08-18")).toContain("14 truncated");
  });

  it("states a partial day plainly, without error/failure wording", () => {
    const line = dayStatusLine("partial", 264, 14, "2026-08-18");
    expect(line).toContain("today's ranking is partial");
    expect(line).not.toMatch(/error|fail|broken/i);
  });

  it("says nothing about partial status for a complete day", () => {
    expect(dayStatusLine("complete", 264, 14, "2026-08-18")).not.toContain("partial");
  });
});
