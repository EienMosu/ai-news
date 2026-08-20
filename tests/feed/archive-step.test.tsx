// @vitest-environment jsdom
//
// Lives in its own file because it mocks `src/lib/feed/days.js` module-wide, and the other
// archive tests need the real constants.
//
// DEFAULT_ARCHIVE_DAYS and ARCHIVE_STEP_DAYS both equal 7 today, so swapping which one
// `nextDays` reads changes nothing observable and the split reads as cosmetic. Mocking them to
// divergent values makes the choice observable, which is the only way this test can fail when
// the decoupling is undone -- the whole point of splitting them was that changing the initial
// count must not silently change how far "Load older days" steps.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/lib/feed/days.js", () => ({
  MAX_ARCHIVE_DAYS: 30,
  MIN_ARCHIVE_DAYS: 1,
  DEFAULT_ARCHIVE_DAYS: 99,
  ARCHIVE_STEP_DAYS: 3,
  parseDaysParam: () => 99,
}));

const { FeedArchive } = await import("../../components/FeedArchive.js");
const { toFeedArticle } = await import("../../src/lib/feed/shape.js");

afterEach(cleanup);

const raw = (over: Record<string, unknown> = {}) => ({
  pk: `ART#${"a".repeat(64)}`, sk: "A", title: "T", summary: "s", imageUrl: null,
  url: "https://e.com/p", source: "techcrunch", sourceName: "TechCrunch", category: "news",
  section: "ai", publishedAt: "2026-08-18T09:00:00.000Z", clusterId: "2026-08-18#gpt6",
  corroborationToday: 1, whyItMatters: null, score: 812, scoreVersion: "v1", points: null,
  pointsImputed: true, llmImportance: 88, firstSeenAt: "2026-08-18T10:00:00.000Z", ...over,
});

const dayResult = (day: string) => ({
  articles: [toFeedArticle(raw({ pk: `ART#${day.replace(/-/g, "")}${"a".repeat(56)}` }))],
  day, status: "complete" as const, llmRankedInDay: 1, truncatedInDay: 0,
});

describe("the load-more step is ARCHIVE_STEP_DAYS, not DEFAULT_ARCHIVE_DAYS", () => {
  it("steps by the step constant even when the default is a different number", () => {
    render(
      <FeedArchive
        section="ai"
        basePath="/"
        days={2}
        results={[dayResult("2026-08-18"), dayResult("2026-08-17")]}
        failedDays={0}
        now={new Date("2026-08-19T09:00:00.000Z")}
      />,
    );

    // 2 + ARCHIVE_STEP_DAYS(3) = 5. Reading DEFAULT_ARCHIVE_DAYS(99) instead would clamp to 30.
    const link = screen.getByRole("link", { name: /older/i });
    expect(link.getAttribute("href")).toBe("/?days=5");
  });
});
