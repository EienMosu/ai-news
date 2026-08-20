import Link from "next/link";
import { notFound } from "next/navigation";
import { ScoreSignals } from "../../../../components/ScoreSignals.js";
import { SectionNav } from "../../../../components/SectionNav.js";
import { computeRecency } from "../../../../src/lib/core/score.js";
import { relativeTime } from "../../../../src/lib/feed/format.js";
import { getArticle, getDay } from "../../../../src/lib/feed/read.js";
import { clusterSiblings, isRealCluster, isUnranked, type FeedArticle } from "../../../../src/lib/feed/shape.js";

// Same reason as app/page.tsx and app/design/page.tsx: without this, Next prerenders the route
// at build time, calling `getArticle` (and, for an article with a real cluster, `getDay`)
// against DynamoDB with no TABLE_NAME set. Verified via `pnpm build`'s route table: this route
// must show `ƒ` (Dynamic) for /article/[urlHash], never `○` (Static).
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
 * published time, `whyItMatters`, our summary, the score's signals, the cluster's siblings) and
 * then sends the reader on to the original with a prominent outbound link. `whyItMatters` is
 * rendered BEFORE the scraped summary and given visual prominence (a left rule, larger italic
 * type) -- it is the one thing this app adds over the raw feed, so it leads rather than
 * following the boilerplate a reader could get from the original.
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
  // itself -- `getArticle` is a single base-table GetItem and never returns them. Two
  // conditions must both hold before that day is worth reading at all: `ingestDay !== null`
  // (a degraded capture, or rank never having run for it, has no day to query) AND
  // `isRealCluster(article.clusterId)` (a `null` or `__self__:`-prefixed id provably has no
  // siblings -- `clusterSiblings` would discard the day's ~650 items via this exact check
  // anyway, so checking it here first, on data already in hand from the `GetItem`, skips a
  // full day Query the result of which would only be thrown away). Fix round 1, finding F4.
  let siblings: FeedArticle[] = [];
  if (article.ingestDay !== null && isRealCluster(article.clusterId)) {
    const day = await getDay(article.ingestDay);
    // Compares by `urlHash`, not object identity -- `article` and `day.articles` come from two
    // separate reads (base-table GetItem vs. a day query) and are never the same object even
    // when they describe the same stored row. This is the exact scenario Task 2 fixed
    // `clusterSiblings` for.
    siblings = clusterSiblings(day.articles, article);
  }

  // One instant, shared by every time-dependent value this render computes (the published-time
  // byline below and `recency` here) -- never a second, later `new Date()` call, which would
  // let the two silently drift apart mid-render.
  const now = new Date();

  // Live, not the frozen value baked into the stored `score` -- see `computeRecency`'s doc
  // comment in src/lib/core/score.ts. `article.firstSeenAt` is exactly the `ingestedAt`
  // src/lambda/rank.ts passes `computeScore` (`item.firstSeenAt ?? runId`), so this is not an
  // approximation of the production fallback, it is the same fallback.
  const recency = computeRecency(article.publishedAt, article.firstSeenAt, now);

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
           *  substituted one -- Task 6's decision 6. `null` means we don't know WHICH of those
           *  happened, and fix round 1 (finding F3) requires that to render distinctly from
           *  both: showing no note at all here (the "feed" branch's behaviour) would present
           *  unknown provenance as reported provenance -- the same dishonesty already guarded
           *  against for engagement and the ranking. `"feed"` alone gets no note. */}
          {article.publishedAtSource === "fallback" ? (
            <span data-testid="published-guessed"> (date estimated, not reported by the source)</span>
          ) : article.publishedAtSource === null ? (
            <span data-testid="published-provenance-unknown"> (unknown whether this date was reported or estimated)</span>
          ) : null}
        </p>

        {/* `whyItMatters` is rendered BEFORE the scraped `summary`, not after: the brief calls
         *  for it to be "given prominence... it is the thing the app adds", and on a page read
         *  top-to-bottom, prominence means position at least as much as style. The summary is
         *  scraped text a reader could get from the original feed; the rationale is the one
         *  sentence only this app produces, so it leads. Visual weight (a left rule, larger
         *  italic type) still marks it as distinct from plain body text either way, but a
         *  reader who stops after the first paragraph now sees the app's own contribution, not
         *  boilerplate. See the fix-round-1 report for the full reasoning, including why the
         *  brief's own prose listing "summary... whyItMatters" in that order does not settle
         *  this: that sentence enumerates what the page shows, it does not mandate an order,
         *  and the very next clause is the one making the actual requirement. */}
        {article.whyItMatters !== null ? (
          <p
            data-testid="why-it-matters"
            className="mt-4 border-l-2 border-neutral-300 pl-3 text-lg italic text-neutral-800"
          >
            {article.whyItMatters}
          </p>
        ) : null}

        <p data-testid="summary" className="mt-4 text-neutral-700">{article.summary}</p>

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
          {/* `isUnranked` (scoreVersion === "v1-degraded") means the model never scored this
           *  article: 45% of its score by weight (llmImportance + the imputed-engagement
           *  default) is a neutral guess, not a measurement. `ArticleCard` already marks this
           *  exact case ("New since last ranking"); this panel is the one surface whose stated
           *  job is making the ranking inspectable, so it repeats the same marker rather than
           *  leaving a reader to infer "the ranking was never really performed" from a blank
           *  LLM-importance row alone. Fix round 1, finding F2. */}
          {isUnranked(article) ? (
            <p
              data-testid="ranking-degraded"
              className="mt-1 text-xs font-medium uppercase tracking-wide text-amber-600"
            >
              New since last ranking -- these signals are not a real score yet
            </p>
          ) : null}
          <div className="mt-2">
            <ScoreSignals
              category={article.category}
              llmImportance={article.llmImportance}
              corroborationToday={article.corroborationToday}
              points={article.points}
              pointsImputed={article.pointsImputed}
              recency={recency}
            />
          </div>
        </section>

        {siblings.length > 0 ? (
          <section data-testid="siblings" className="mt-8">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
              Also covered by
            </h2>
            <ul className="mt-2 flex flex-col gap-1.5">
              {/* §7's own worked example is source names ("also covered by The Verge, Ars
               *  Technica"), not sibling headlines -- a title reads ungrammatically after this
               *  heading. Falls back to the title only for the degraded case where
               *  `sourceName` is the coerced empty string (`asString` in shape.ts), so the
               *  link never renders empty, invisible text. Fix round 1, finding F5. */}
              {siblings.map((sibling) => (
                <li key={sibling.urlHash}>
                  <Link
                    href={`/article/${sibling.urlHash}`}
                    className="text-sm text-neutral-700 underline hover:text-neutral-900"
                  >
                    {sibling.sourceName !== "" ? sibling.sourceName : sibling.title}
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
