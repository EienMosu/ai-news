import Link from "next/link";
import { hasCorroboration, isUnranked, type FeedArticle } from "../src/lib/feed/shape.js";
import { relativeTime } from "../src/lib/feed/format.js";

export interface ArticleCardProps {
  article: FeedArticle;
  now: Date;
  /** Position within its day, 1-based. Rank order is the information this product exists to
   *  produce, so the number is content, not ornament. */
  rank?: number;
  /** The day's top entry. It leaves the paper and sits on the field instead — rank shows as
   *  ground, never as a larger headline, so every entry keeps one type size. */
  lead?: boolean;
}

/**
 * One entry in the day's file.
 *
 * Not a card: a row on the sheet. Cards would make every entry the same weight and hide the
 * ranking inside an order nobody can see, which is the arrangement this design refuses.
 *
 * `whyItMatters` sits ABOVE the scraped summary. It is the only line on the page the product
 * wrote itself, and putting the borrowed text first buries the thing that makes this more than
 * an RSS reader.
 *
 * The thumbnail is optional and fixed-size, and the row's layout does not depend on it: spec §7
 * notes `imageUrl` is absent on a large share of items, so a layout that reserves a hero slot
 * per entry ships a page full of holes. The bare row is the design; the image is an addition to
 * it.
 */
export function ArticleCard({ article, now, rank, lead = false }: ArticleCardProps) {
  const others = hasCorroboration(article) ? article.corroborationToday - 1 : 0;
  const showCorroboration = others > 0;

  return (
    <Link
      href={`/article/${article.urlHash}`}
      data-lead={lead ? "" : undefined}
      className={[
        "group relative block no-underline transition-[background-color,color] duration-200",
        lead
          ? "-mx-4 px-4 py-5 sm:-mx-7 sm:px-7"
          : "border-t border-[color-mix(in_oklab,var(--color-ink)_14%,transparent)] py-5 first:border-t-0",
      ].join(" ")}
      style={lead ? { background: "var(--field)", color: "var(--on-field)" } : undefined}
    >
      <article className="flex gap-4 sm:gap-6">
        {rank !== undefined ? (
          <span
            aria-hidden="true"
            data-numeric
            className="apparatus mt-[0.35rem] w-6 shrink-0 opacity-70 sm:w-8"
          >
            {String(rank).padStart(2, "0")}
          </span>
        ) : null}

        <div className="min-w-0 flex-1">
          {/* Same ink-overflow class as the summary below: a scraped title with no break
              opportunity in a long run paints past this box without ever making the box
              itself measure wider, invisible to a rect sweep, and inflates the mobile layout
              viewport (the 745px defect A4 diagnosed on the summary paragraph). break-words is
              the same one-class guard, applied here because the input is exactly as hostile. */}
          <h3
            className="break-words font-[family-name:var(--font-display)] text-[1.0625rem] font-semibold leading-[1.25] tracking-[-0.011em] underline-offset-[0.22em] group-hover:underline sm:text-[1.1875rem]"
            style={{ textWrap: "balance" }}
          >
            {article.title}
          </h3>

          {/* `sourceName` is coerced to "" (never undefined/null) when a stored item is missing
              it, so the separator has to share the same condition or a degraded entry prints a
              leading dot with nothing before it. */}
          <p data-testid="meta" className="apparatus mt-2 opacity-70">
            {article.sourceName !== "" ? `${article.sourceName} · ` : null}
            <time dateTime={article.publishedAt ?? undefined}>
              {relativeTime(article.publishedAt, now)}
            </time>
          </p>

          {isUnranked(article) ? (
            <p data-testid="unranked-marker" className="mt-3">
              <span className="stamp">New since last ranking</span>
            </p>
          ) : null}

          {article.whyItMatters !== null ? (
            <p
              data-testid="why-it-matters"
              className="mt-3 break-words border-l border-current pl-3 font-[family-name:var(--font-text)] text-[0.9375rem] italic leading-[1.5]"
            >
              {article.whyItMatters}
            </p>
          ) : null}

          {/* Scraped summaries sometimes carry a raw pasted URL with no space to break on (a
              Reddit post body copying a link twice, for example). Without break-words that
              single unbroken run overflows this box's own width without ever making the box
              itself wider, so it is invisible to any check that only measures element rects; it
              still inflates the document's scrollWidth and, on mobile, the layout viewport
              itself. break-words lets the browser break the token instead of pushing past it. */}
          <p className="mt-3 max-w-[68ch] break-words font-[family-name:var(--font-text)] text-[0.9375rem] leading-[1.6] opacity-80">
            {article.summary}
          </p>

          {showCorroboration ? (
            <p data-testid="corroboration" className="apparatus mt-3 opacity-70">
              Also covered by {others} {others === 1 ? "other" : "others"}
            </p>
          ) : null}
        </div>

        {article.imageUrl !== null ? (
          <img
            src={article.imageUrl}
            alt=""
            loading="lazy"
            className="mt-1 hidden h-20 w-20 shrink-0 object-cover sm:block"
          />
        ) : null}
      </article>
    </Link>
  );
}
