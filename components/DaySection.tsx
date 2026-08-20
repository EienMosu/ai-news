import Link from "next/link";
import {
  deduplicateStories,
  type FeedArticle,
} from "../src/lib/feed/shape.js";
import { ArticleCard } from "./ArticleCard.js";

export interface DaySectionProps {
  /** The store's day key (`YYYY-MM-DD`), shown as-is -- no locale formatting here. */
  day: string;
  /** Already in score order (GSI1's sort order); this component renders them as given and
   *  never re-sorts. */
  articles: FeedArticle[];
  now: Date;
}

/**
 * One day's worth of cards. Presentational only -- no data fetching.
 *
 * The header count is `stories.length`, the de-duplicated array this component actually renders --
 * never `META#DAY.articleCount`, and never a `FeedResult`'s `llmRankedInDay`/`truncatedInDay`.
 * All three of those are day totals across BOTH sections (ai + design), because ranking and
 * corroboration run once per day, not once per vertical (see the doc comment on `FeedResult`
 * in src/lib/feed/read.ts). Showing one of those next to a single-section list would print a
 * number that matches nothing on screen -- a live misreporting hazard, not a cosmetic slip.
 *
 * The header date links to `/day/${day}` (fix round 1, F3) -- before this, nothing inside the
 * app pointed at that route at all, so it was reachable only by typing a URL. The link is a
 * property of the date, not of which vertical is showing it, so this is unconditional: a
 * `DaySection` rendered on the day page itself simply links to its own URL, the same as any
 * other same-page anchor would.
 */
export function DaySection({ day, articles, now }: DaySectionProps) {
  const stories = deduplicateStories(articles);

  return (
    <section className="mb-8">
      <header className="mb-3 flex items-baseline justify-between">
        <h2 className="text-xl font-bold text-neutral-900">
          <Link href={`/day/${day}`} className="hover:underline">{day}</Link>
        </h2>
        <span className="text-sm text-neutral-500">
          {stories.length} {stories.length === 1 ? "story" : "stories"}
        </span>
      </header>

      <div className="flex flex-col gap-4">
        {stories.map((article) => (
          <ArticleCard key={article.urlHash} article={article} now={now} />
        ))}
      </div>
    </section>
  );
}
