import Link from "next/link";
import type { FeedArticle } from "../src/lib/feed/shape.js";
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
 * One day, as the sheet it was judged on.
 *
 * The count is `articles.length` -- what this section actually renders. Never
 * `META#DAY.articleCount` and never `llmRankedInDay`, both of which total across every vertical; a day
 * total printed beside a section-filtered list is a number that matches nothing on screen.
 *
 * The first entry is the day's lead and renders inverted, on the field rather than the paper.
 * That is the whole ranking device: no entry is set larger than another, so the reader's eye is
 * pulled by ground, and every other row stays comparable at one size.
 */
export function DaySection({ day, articles, now }: DaySectionProps) {
  return (
    <section className="mb-10 sm:mb-14">
      <div
        data-surface="paper"
        className="px-4 pb-2 pt-5 shadow-[0_18px_40px_-24px_rgba(0,0,0,0.55)] sm:px-7 sm:pb-4 sm:pt-7"
      >
        <header className="mb-5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 sm:mb-6">
          <h2 className="font-[family-name:var(--font-display)] text-[1.75rem] font-extrabold leading-none tracking-[-0.028em] sm:text-[2.25rem]">
            <Link href={`/day/${day}`} className="no-underline hover:underline" data-numeric>
              {day}
            </Link>
          </h2>
          <span className="apparatus opacity-70" data-numeric>
            {articles.length} {articles.length === 1 ? "story" : "stories"}
          </span>
        </header>

        {articles.map((article, i) => (
          <ArticleCard
            key={article.urlHash}
            article={article}
            now={now}
            rank={i + 1}
            lead={i === 0}
          />
        ))}
      </div>
    </section>
  );
}
