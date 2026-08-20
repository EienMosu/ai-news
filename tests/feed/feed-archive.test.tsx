// @vitest-environment jsdom
//
// Opt-in per file -- see the docblock in tests/feed/card.test.tsx for why: this file needs a
// DOM and explicit `afterEach(cleanup)` because `test.globals` is false project-wide.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FeedArchive } from "../../components/FeedArchive.js";
import { MAX_ARCHIVE_DAYS } from "../../src/lib/feed/days.js";
import type { FeedResult } from "../../src/lib/feed/read.js";
import { toFeedArticle } from "../../src/lib/feed/shape.js";

afterEach(cleanup);

const rawArticle = (over: Record<string, unknown> = {}) => ({
  pk: `ART#${"a".repeat(64)}`, sk: "A", title: "T", summary: "s", imageUrl: null,
  url: "https://e.com/p", source: "techcrunch", sourceName: "TechCrunch",
  category: "news", section: "ai", publishedAt: "2026-08-18T09:00:00.000Z",
  clusterId: null, corroborationToday: null, whyItMatters: null, score: 500,
  scoreVersion: "v1", points: null, pointsImputed: true, llmImportance: null,
  firstSeenAt: "2026-08-18T10:00:00.000Z",
  ...over,
});

const dayResult = (over: Partial<FeedResult> = {}): FeedResult => ({
  articles: [],
  day: "2026-08-18",
  status: "complete",
  llmRankedInDay: 5,
  truncatedInDay: 0,
  ...over,
});

const NOW = new Date("2026-08-18T12:00:00.000Z");

describe("FeedArchive", () => {
  it("shows the no-ranked-day-at-all message when no days are returned", () => {
    const { container } = render(
      <FeedArchive section="ai" results={[]} failedDays={0} now={NOW} days={7} basePath="/" />,
    );
    expect(container.querySelector('[data-testid="feed-empty-no-day"]')).not.toBeNull();
  });

  it("renders one section per day, newest first", () => {
    const articles = [toFeedArticle(rawArticle())];
    render(
      <FeedArchive
        section="ai"
        results={[
          dayResult({ day: "2026-08-18", articles }),
          dayResult({ day: "2026-08-17", articles }),
        ]}
        failedDays={0} now={NOW}
        days={7}
        basePath="/"
      />,
    );
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(["2026-08-18", "2026-08-17"]);
  });

  it("shows the this-vertical-was-empty message for a day with nothing, without omitting it, while a sibling day with articles still renders its cards", () => {
    // Task 7 decision: a day empty for this vertical still gets its own section (Task 5's
    // per-section empty message, reused), it is not dropped from the list. This is the pin for
    // that decision -- both states must be visible in the same render, distinctly.
    const articles = [toFeedArticle(rawArticle({ section: "design" }))];
    render(
      <FeedArchive
        section="design"
        results={[
          dayResult({ day: "2026-08-18", articles: [] }),
          dayResult({ day: "2026-08-17", articles }),
        ]}
        failedDays={0} now={NOW}
        days={7}
        basePath="/design"
      />,
    );

    expect(screen.getByText("No design stories for 2026-08-18.")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "2026-08-17" })).toBeTruthy();
    expect(screen.queryByText("No design stories for 2026-08-17.")).toBeNull();
  });

  it("shows a load-more link when exactly `days` days came back and the cap has not been reached", () => {
    const results = Array.from({ length: 7 }, (_, i) => dayResult({ day: `2026-08-${18 - i}` }));
    render(<FeedArchive section="ai" results={results} failedDays={0} now={NOW} days={7} basePath="/" />);
    const link = screen.getByTestId("load-more-days");
    expect(link.getAttribute("href")).toBe("/?days=14");
  });

  it("uses basePath for the load-more link, so the design page never links back to /", () => {
    const results = Array.from({ length: 7 }, (_, i) => dayResult({ day: `2026-08-${18 - i}` }));
    render(<FeedArchive section="design" results={results} failedDays={0} now={NOW} days={7} basePath="/design" />);
    expect(screen.getByTestId("load-more-days").getAttribute("href")).toBe("/design?days=14");
  });

  it("clamps the load-more link's target to MAX_ARCHIVE_DAYS rather than overshooting it", () => {
    const days = MAX_ARCHIVE_DAYS - 2;
    const results = Array.from({ length: days }, (_, i) => dayResult({ day: `d${i}` }));
    render(<FeedArchive section="ai" results={results} failedDays={0} now={NOW} days={days} basePath="/" />);
    expect(screen.getByTestId("load-more-days").getAttribute("href")).toBe(`/?days=${MAX_ARCHIVE_DAYS}`);
  });

  it("omits the load-more link once `days` has already reached MAX_ARCHIVE_DAYS", () => {
    const results = Array.from({ length: MAX_ARCHIVE_DAYS }, (_, i) => dayResult({ day: `d${i}` }));
    render(
      <FeedArchive section="ai" results={results} failedDays={0} now={NOW} days={MAX_ARCHIVE_DAYS} basePath="/" />,
    );
    expect(screen.queryByTestId("load-more-days")).toBeNull();
  });

  it("omits the load-more link when fewer days came back than were requested -- the archive is exhausted", () => {
    const results = [dayResult({ day: "2026-08-18" }), dayResult({ day: "2026-08-17" })];
    render(<FeedArchive section="ai" results={results} failedDays={0} now={NOW} days={7} basePath="/" />);
    expect(screen.queryByTestId("load-more-days")).toBeNull();
  });

  describe("failedDays -- final review, M2", () => {
    it("shows a failure notice, and no failure notice at all when failedDays is zero", () => {
      const results = [dayResult({ day: "2026-08-18" })];
      const { container } = render(
        <FeedArchive section="ai" results={results} failedDays={0} now={NOW} days={7} basePath="/" />,
      );
      expect(container.querySelector('[data-testid="feed-days-failed"]')).toBeNull();
    });

    it("shows a failure notice naming the count when one or more days could not be loaded", () => {
      const results = [dayResult({ day: "2026-08-18" })];
      render(
        <FeedArchive section="ai" results={results} failedDays={2} now={NOW} days={7} basePath="/" />,
      );
      expect(screen.getByTestId("feed-days-failed").textContent).toContain("2 days");
    });

    it("still renders the days that did resolve alongside the failure notice", () => {
      const articles = [toFeedArticle(rawArticle())];
      const results = [dayResult({ day: "2026-08-18", articles })];
      render(
        <FeedArchive section="ai" results={results} failedDays={1} now={NOW} days={7} basePath="/" />,
      );
      expect(screen.getByRole("heading", { level: 2, name: "2026-08-18" })).toBeTruthy();
      expect(screen.getByTestId("feed-days-failed")).toBeTruthy();
    });

    it("shows the failure notice, not the no-ranked-day-at-all message, when every requested day failed", () => {
      // Distinct from `results.length === 0 && failedDays === 0` (no day has ever ranked): here
      // days were requested and at least one genuinely exists, but every one of them failed to
      // read just now -- a different fact, and the no-day message would misstate it.
      const { container } = render(
        <FeedArchive section="ai" results={[]} failedDays={3} now={NOW} days={7} basePath="/" />,
      );
      expect(container.querySelector('[data-testid="feed-empty-no-day"]')).toBeNull();
      expect(screen.getByTestId("feed-days-failed").textContent).toContain("3 days");
    });

    it("still shows a load-more link when a failed day, not history's own end, accounts for the shortfall", () => {
      // 6 results + 1 failedDays = 7 requested -- history is not exhausted, one read just failed.
      // Before this fix, `moreMayExist` compared only `results.length === days` (6 !== 7), which
      // would have hidden the link even though a real 7th day exists and simply failed to load.
      const results = Array.from({ length: 6 }, (_, i) => dayResult({ day: `2026-08-${18 - i}` }));
      render(
        <FeedArchive section="ai" results={results} failedDays={1} now={NOW} days={7} basePath="/" />,
      );
      expect(screen.getByTestId("load-more-days").getAttribute("href")).toBe("/?days=14");
    });
  });
});
