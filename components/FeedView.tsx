import type { FeedResult } from "../src/lib/feed/read.js";
import type { Section } from "../src/types/article.js";
import { DaySection } from "./DaySection.js";

export interface FeedViewProps {
  section: Section;
  result: FeedResult;
  now: Date;
}

const SECTION_LABELS: Record<Section, string> = { ai: "AI", design: "design", cloud: "cloud" };

/**
 * The day-status line. `llmRankedInDay`/`truncatedInDay` are totals across every vertical (see
 * the doc comment on `FeedResult` in src/lib/feed/read.ts), so this sentence names the day
 * explicitly rather than reading like a count of the section list rendered beneath it -- "264
 * ranked" beside 40 AI cards would otherwise look like it described those 40.
 *
 * `status: "partial"` is worded as a plain fact, not an error: a partial day with some articles
 * truncated by the ranking cap (the live data's normal case -- 14 of 264 -- is exactly this) is
 * not a failure state and must not read like one. It is also never worded as "today's ranking":
 * the day this describes is whatever `getRecentDays`/`getDay` returned, which is
 * routinely yesterday (or, once a pipeline has been quietly broken for a while, weeks old) --
 * this function has no `now` and cannot know whether `day` is today, so it must never claim it
 * is. "That day's ranking was partial" names the fact without a claim it cannot back up.
 *
 * Takes `llmRankedInDay` as a definite `number`, not `number | null` -- the caller (`FeedView`)
 * only invokes this once the count is known, and omits the whole day-status line otherwise
 * rather than call this with a count it does not have. A `?? 0` fallback here would turn "we
 * don't know" into a confident, self-contradicting "0 stories ranked" printed directly above a
 * header that might read "1 story" -- pushing that decision into the type signature makes it
 * impossible to reintroduce by accident.
 *
 * Exported and pure (no JSX) so the wording can be checked directly, one clause at a time,
 * without going through a DOM render.
 */
export function dayStatusLine(
  status: FeedResult["status"],
  llmRankedInDay: number,
  truncatedInDay: number | null,
  day: string,
): string {
  const rankedPart =
    `${llmRankedInDay} ${llmRankedInDay === 1 ? "story" : "stories"} ranked across both sections on ${day}`;
  const truncatedPart =
    truncatedInDay !== null && truncatedInDay > 0
      ? `, ${truncatedInDay} truncated by the day's ranking cap`
      : "";
  const partialPart = status === "partial" ? "; that day's ranking was partial" : "";
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
 *
 * The day-status line above states 2 and 3 is skipped entirely when `llmRankedInDay` is `null`
 * -- reachable via `getDay()` (Task 6's `/day/[date]`) whenever the day's `META#DAY` record is
 * absent or malformed. There is nothing honest to say about a count that was never recorded, so
 * this omits the line rather than hand `dayStatusLine` a fallback `0` it would then report as
 * fact.
 */
export function FeedView({ section, result, now }: FeedViewProps) {
  const { day, articles, status, llmRankedInDay, truncatedInDay } = result;

  if (day === null) {
    return (
      <p data-testid="feed-empty-no-day" className="font-[family-name:var(--font-text)] text-[1.0625rem] italic opacity-80">
        The pipeline has not produced a ranked day yet. Check back soon.
      </p>
    );
  }

  return (
    <>
      {llmRankedInDay !== null ? (
        <p
          data-testid="day-status"
          className="apparatus mb-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 opacity-70"
          data-numeric
        >
          {/* Labelled because the number beside it in the sheet header is a DIFFERENT scope --
              that one counts this vertical, this one totals both. Unlabelled, 93 above 72 reads
              as an arithmetic error rather than two facts. */}
          <span className="stamp shrink-0">Day total</span>
          <span>{dayStatusLine(status, llmRankedInDay, truncatedInDay, day)}</span>
        </p>
      ) : null}

      {articles.length === 0 ? (
        <p data-testid="feed-empty-section" className="font-[family-name:var(--font-text)] text-[1.0625rem] italic opacity-80">
          No {SECTION_LABELS[section]} stories for {day}.
        </p>
      ) : (
        <DaySection day={day} articles={articles} now={now} />
      )}
    </>
  );
}
