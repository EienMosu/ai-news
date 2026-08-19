import type { FeedResult } from "../src/lib/feed/read.js";
import type { Section } from "../src/types/article.js";
import { DaySection } from "./DaySection.js";

export interface FeedViewProps {
  section: Section;
  result: FeedResult;
  now: Date;
}

const SECTION_LABELS: Record<Section, string> = { ai: "AI", design: "design" };

/**
 * The day-status line. `llmRankedInDay`/`truncatedInDay` are totals across BOTH verticals (see
 * the doc comment on `FeedResult` in src/lib/feed/read.ts), so this sentence names the day
 * explicitly rather than reading like a count of the section list rendered beneath it -- "264
 * ranked" beside 40 AI cards would otherwise look like it described those 40.
 *
 * `status: "partial"` is worded as a plain fact, not an error: a partial day with some articles
 * truncated by the ranking cap (the live data's normal case -- 14 of 264 -- is exactly this) is
 * not a failure state and must not read like one.
 *
 * Exported and pure (no JSX) so the wording can be checked directly, one clause at a time,
 * without going through a DOM render.
 */
export function dayStatusLine(
  status: FeedResult["status"],
  llmRankedInDay: number | null,
  truncatedInDay: number | null,
  day: string,
): string {
  const ranked = llmRankedInDay ?? 0;
  const rankedPart =
    `${ranked} ${ranked === 1 ? "story" : "stories"} ranked across both sections on ${day}`;
  const truncatedPart =
    truncatedInDay !== null && truncatedInDay > 0
      ? `, ${truncatedInDay} truncated by the day's ranking cap`
      : "";
  const partialPart = status === "partial" ? " -- today's ranking is partial" : "";
  return `${rankedPart}${truncatedPart}${partialPart}.`;
}

/**
 * The three states Task 5 Step 3 requires be told apart, worded so they cannot be confused with
 * one another:
 *
 * 1. `day === null` -- no ranked day exists at all (what a fresh deploy legitimately shows).
 * 2. `day` set, `articles` empty -- that day ranked fine, this vertical just had nothing.
 * 3. `articles` present -- the normal case, handed to `DaySection`.
 *
 * A spinner, a blank page, or one generic message for all three would collapse distinctions a
 * reader needs to tell "nothing has run yet" apart from "nothing today, in this vertical".
 */
export function FeedView({ section, result, now }: FeedViewProps) {
  const { day, articles, status, llmRankedInDay, truncatedInDay } = result;

  if (day === null) {
    return (
      <p data-testid="feed-empty-no-day" className="text-neutral-600">
        The pipeline has not produced a ranked day yet. Check back soon.
      </p>
    );
  }

  return (
    <>
      <p data-testid="day-status" className="mb-4 text-xs text-neutral-500">
        {dayStatusLine(status, llmRankedInDay, truncatedInDay, day)}
      </p>

      {articles.length === 0 ? (
        <p data-testid="feed-empty-section" className="text-neutral-600">
          No {SECTION_LABELS[section]} stories for {day}.
        </p>
      ) : (
        <DaySection day={day} articles={articles} now={now} />
      )}
    </>
  );
}
