import Link from "next/link";
import { hasCorroboration, isUnranked, type FeedArticle } from "../src/lib/feed/shape.js";
import { articlePath } from "../src/lib/feed/format.js";

export interface ArticleCardProps {
  article: FeedArticle;
  now: Date;
  /** Position within its day, 1-based. Rank order is the information this product exists to
   *  produce, so the number is content, not ornament. */
  rank?: number;
  /** The day's top entry AS RENDERED (first in the server's list) — sets the data-lead marker
   *  only. The full-gold numeral treatment is position-driven CSS on `.folio` (globals.css),
   *  keyed to the first VISIBLE entry, so live search re-derives it without touching this. */
  lead?: boolean;
}

/**
 * One entry in the day's journal.
 *
 * Not a card: a row on the page. The row is title, the product's own why-line, and one
 * apparatus meta line (source · points · +N more) — the mock's exact anatomy. The scraped
 * summary and the thumbnail moved out of the feed rows with the Modern Classic redesign
 * (owner-approved final mock); both still live on the story page, where reading happens.
 *
 * `whyItMatters` is the only line on the page the product wrote itself; it is the row's prose.
 * The rank numeral is display-serif italic — a folio number, not a counter — gold at full
 * strength on the lead, soft gold elsewhere.
 */
export function ArticleCard({ article, now: _now, rank, lead = false }: ArticleCardProps) {
  const others = hasCorroboration(article) ? article.corroborationToday - 1 : 0;

  // Each part knows whether it is the source — the bold treatment belongs to the source
  // name itself, never to whichever part happens to come first.
  const metaParts: { text: string; isSource: boolean }[] = [];
  if (article.sourceName !== "") metaParts.push({ text: article.sourceName, isSource: true });
  if (article.points !== null) metaParts.push({ text: `${article.points} points`, isSource: false });
  if (others > 0) metaParts.push({ text: `+${others} more`, isSource: false });

  return (
    <Link
      href={articlePath(article.section, article.urlHash)}
      data-lead={lead ? "" : undefined}
      className="group block py-5 no-underline"
    >
      <article className="flex gap-4 sm:gap-6">
        {/* Size and colour live in globals.css (.folio + the [data-entry] sibling rule), keyed
            to VISIBLE position, not to the `lead` prop: when live search hides the lead, the
            first entry still showing inherits the full-gold treatment, exactly as the iOS list
            re-derives its lead. Only layout (width, alignment, face) stays inline. */}
        {rank !== undefined ? (
          <span
            aria-hidden="true"
            data-numeric
            className="folio w-8 shrink-0 text-right font-[family-name:var(--font-display)] italic leading-none sm:w-10"
          >
            {rank}
          </span>
        ) : null}

        <div className="min-w-0 flex-1">
          {/* break-words: a scraped title with no break opportunity paints past this box
              without ever making it measure wider (the 745px mobile-viewport defect), so the
              browser must be allowed to break the token. */}
          <h3
            className="break-words font-[family-name:var(--font-display)] text-[1.0625rem] font-bold leading-[1.28] tracking-[-0.012em] underline-offset-[0.22em] group-hover:underline sm:text-[1.1875rem]"
            style={{ textWrap: "balance" }}
          >
            {article.title}
          </h3>

          {isUnranked(article) ? (
            <p data-testid="unranked-marker" className="mt-2.5">
              <span className="stamp">New since last ranking</span>
            </p>
          ) : null}

          {article.whyItMatters !== null ? (
            <p
              data-testid="why-it-matters"
              className="mt-2 break-words font-[family-name:var(--font-text)] text-[0.875rem] italic leading-[1.5] text-[color:var(--ink-soft)]"
            >
              {article.whyItMatters}
            </p>
          ) : null}

          {metaParts.length > 0 ? (
            <p data-testid="meta" className="apparatus mt-2.5 text-[color:var(--muted)]">
              {metaParts.map((part, i) => (
                <span key={i}>
                  {i > 0 ? " · " : null}
                  {part.isSource ? (
                    <b className="font-medium text-[color:var(--ink)]">{part.text}</b>
                  ) : (
                    part.text
                  )}
                </span>
              ))}
            </p>
          ) : null}
        </div>
      </article>
    </Link>
  );
}
