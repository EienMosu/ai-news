import Link from "next/link";
import { hasCorroboration, isUnranked, type FeedArticle } from "../src/lib/feed/shape.js";
import { relativeTime } from "../src/lib/feed/format.js";

export interface ArticleCardProps {
  article: FeedArticle;
  /** The instant to render relative times against. Threaded down from the page, never read
   *  internally (`Date.now()`/argless `new Date()`), so a render is reproducible in a test. */
  now: Date;
}

/**
 * One story's card. Presentational only -- no data fetching, no `server-only` import, no
 * import from `read.ts`. Built imageless-and-rationale-less first: spec §7 and the live data
 * agree that `imageUrl` is absent on a large share of items (HN, research papers, several RSS
 * feeds) and `whyItMatters` is absent on every article of a degraded day, so those two blocks
 * are additive enhancements that simply don't render when the data isn't there -- never a
 * placeholder box, never a broken image icon.
 *
 * The whole card is one link to the story's own detail page (`/article/[urlHash]`), never to
 * the source URL directly -- spec §7: the detail page is what this app adds over the raw feed,
 * so the outbound link to the source lives there, not here.
 *
 * `summary` and `whyItMatters` are rendered as plain JSX text, never `dangerouslySetInnerHTML`.
 * That is deliberate, not an oversight: the ingest pipeline's `stripTags` heuristic
 * (src/lib/ingest/fetchers/rss.ts) intentionally leaves bracketed prose like `<model>` or
 * `<think>` untouched in stored summaries, because it cannot tell that prose apart from real
 * markup after entity-decoding. Rendering as text is what makes that safe: React escapes text
 * content, so `<model>` displays as the literal characters a reader expects and a stray
 * `<script>` in a summary can never become a live DOM node.
 */
export function ArticleCard({ article, now }: ArticleCardProps) {
  // `hasCorroboration` is a type predicate, so inside the true branch the compiler knows
  // `corroborationToday` is a number -- no assertion, and no way for a later change in
  // shape.ts to loosen the guarantee without breaking this line.
  const others = hasCorroboration(article) ? article.corroborationToday - 1 : 0;
  const showCorroboration = others > 0;

  return (
    <Link
      href={`/article/${article.urlHash}`}
      className="block rounded-lg border border-neutral-200 p-4 no-underline transition-colors hover:border-neutral-400"
    >
      <article>
        {article.imageUrl !== null ? (
          <img
            src={article.imageUrl}
            alt=""
            loading="lazy"
            className="mb-3 h-40 w-full rounded object-cover"
          />
        ) : null}

        <h3 className="text-lg font-semibold text-neutral-900">{article.title}</h3>

        {/* `sourceName` is coerced to "" (never undefined/null) when a stored item is missing
         *  it -- see `asString` in shape.ts -- so a fully degraded article reaches this line
         *  with an empty string. The separator is part of the same conditional as the name
         *  itself, so a missing name never leaves a bare leading "·" with nothing before it. */}
        <p data-testid="meta" className="mt-1 text-sm text-neutral-500">
          {article.sourceName !== "" ? `${article.sourceName} · ` : null}
          <time dateTime={article.publishedAt ?? undefined}>
            {relativeTime(article.publishedAt, now)}
          </time>
        </p>

        {isUnranked(article) ? (
          <p
            data-testid="unranked-marker"
            className="mt-1 text-xs font-medium uppercase tracking-wide text-amber-600"
          >
            New since last ranking
          </p>
        ) : null}

        <p className="mt-2 text-sm text-neutral-700">{article.summary}</p>

        {article.whyItMatters !== null ? (
          <p data-testid="why-it-matters" className="mt-2 text-sm italic text-neutral-600">
            {article.whyItMatters}
          </p>
        ) : null}

        {showCorroboration ? (
          <p data-testid="corroboration" className="mt-2 text-xs text-neutral-400">
            Also covered by {others} {others === 1 ? "other" : "others"}
          </p>
        ) : null}
      </article>
    </Link>
  );
}
