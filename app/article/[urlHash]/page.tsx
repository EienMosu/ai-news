import Link from "next/link";
import { notFound } from "next/navigation";
import { ScoreSignals } from "../../../components/ScoreSignals.js";
import { SectionNav } from "../../../components/SectionNav.js";
import { relativeTime } from "../../../src/lib/feed/format.js";
import { getArticle, getDay } from "../../../src/lib/feed/read.js";
import { clusterSiblings, type FeedArticle } from "../../../src/lib/feed/shape.js";

// Same reason as app/page.tsx and app/design/page.tsx: without this, Next prerenders the route
// at build time, calling `getArticle` (and, for a clustered article, `getDay`) against
// DynamoDB with no TABLE_NAME set. Verified via `pnpm build`'s route table: this route must
// show `ƒ` (Dynamic) for /article/[urlHash], never `○` (Static).
export const dynamic = "force-dynamic";

/**
 * Next 15+ makes a dynamic segment's `params` a Promise, not a plain object. Typing this as
 * `{ urlHash: string }` and reading `params.urlHash` directly compiles and builds clean --
 * `pnpm typecheck` and `pnpm build` both pass -- but serves `undefined` at runtime, because
 * nothing in the type system catches a plain object being handed a Promise it never awaits.
 * The only way to catch it is to type the prop as `Promise<{ urlHash: string }>` and `await`
 * it, which is what makes a wrong `urlHash` (and so a missing article) an error this file's own
 * types can be trusted to route to -- not a silent `undefined` deep in a template string.
 */
interface ArticlePageProps {
  params: Promise<{ urlHash: string }>;
}

/**
 * The story page each card links to. Spec §7: this app never fetches article bodies, so this
 * is not a reader view -- it shows what the pipeline already knows (title, hero image, source,
 * published time, our summary, the score's signals, the cluster's siblings) and then sends the
 * reader on to the original with a prominent outbound link. `whyItMatters` gets visual
 * prominence over the plain summary because it is the one thing this app adds over the raw
 * feed -- the summary is scraped, the rationale is not.
 *
 * A missing `urlHash` -- a stale link, a bad guess, a crawler probing dead URLs -- is a real
 * 404 via `notFound()`, not a rendered "not found" page of this component's own; a URL this
 * shareable needs the real HTTP status, not a 200 with sad text in it.
 */
export default async function ArticlePage({ params }: ArticlePageProps) {
  const { urlHash } = await params;
  const article = await getArticle(urlHash);
  if (article === null) {
    notFound();
  }

  // Cluster siblings live in the article's own day partition, not alongside the article
  // itself -- `getArticle` is a single base-table GetItem and never returns them. When
  // `ingestDay` is null there is no day to read (a degraded capture, or rank never having run
  // for it), so this renders no siblings rather than guessing a date to query.
  let siblings: FeedArticle[] = [];
  if (article.ingestDay !== null) {
    const day = await getDay(article.ingestDay);
    // Compares by `urlHash`, not object identity -- `article` and `day.articles` come from two
    // separate reads (base-table GetItem vs. a day query) and are never the same object even
    // when they describe the same stored row. This is the exact scenario Task 2 fixed
    // `clusterSiblings` for.
    siblings = clusterSiblings(day.articles, article);
  }

  const now = new Date();

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <SectionNav current={null} />

      <article>
        {article.imageUrl !== null ? (
          <img
            src={article.imageUrl}
            alt=""
            className="mb-4 w-full rounded object-cover"
          />
        ) : null}

        <h1 className="text-2xl font-bold text-neutral-900">{article.title}</h1>

        <p data-testid="meta" className="mt-2 text-sm text-neutral-500">
          {article.sourceName !== "" ? `${article.sourceName} · ` : null}
          <time dateTime={article.publishedAt ?? undefined}>
            {relativeTime(article.publishedAt, now)}
          </time>
          {/* `publishedAtSource === "fallback"` means the feed gave no date and capture
           *  substituted one -- Task 6's decision 6. `null` means we don't know which and is
           *  treated as unknown, not as measured, so it gets no note here either. */}
          {article.publishedAtSource === "fallback" ? (
            <span data-testid="published-guessed"> (date estimated, not reported by the source)</span>
          ) : null}
        </p>

        <p className="mt-4 text-neutral-700">{article.summary}</p>

        {article.whyItMatters !== null ? (
          <p
            data-testid="why-it-matters"
            className="mt-4 border-l-2 border-neutral-300 pl-3 text-lg italic text-neutral-800"
          >
            {article.whyItMatters}
          </p>
        ) : null}

        {/* Plain `<a>`, not `next/link`: this leaves the app for the original source, which is
         *  exactly the case `next/link`'s soft-navigation model does not apply to (decision 8).
         *  `rel="noopener noreferrer"` -- `target="_blank"` opens the source without handing it
         *  a `window.opener` reference back into this app. */}
        <a
          href={article.url}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="original-link"
          className="mt-6 inline-block rounded bg-neutral-900 px-4 py-2 text-sm font-semibold text-white no-underline hover:bg-neutral-700"
        >
          Read the original{article.sourceName !== "" ? ` at ${article.sourceName}` : ""}
        </a>

        <section className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
            Ranking signals
          </h2>
          <div className="mt-2">
            <ScoreSignals
              category={article.category}
              corroborationToday={article.corroborationToday}
              points={article.points}
              pointsImputed={article.pointsImputed}
            />
          </div>
        </section>

        {siblings.length > 0 ? (
          <section data-testid="siblings" className="mt-8">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
              Also covered by
            </h2>
            <ul className="mt-2 flex flex-col gap-1.5">
              {siblings.map((sibling) => (
                <li key={sibling.urlHash}>
                  <Link
                    href={`/article/${sibling.urlHash}`}
                    className="text-sm text-neutral-700 underline hover:text-neutral-900"
                  >
                    {sibling.title}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </article>
    </main>
  );
}
