import { getRunStatus } from "../src/lib/feed/read.js";
import { SOURCE_STATE_CLASS, SOURCE_STATE_LABEL, summarizeRunStatus } from "../src/lib/feed/runStatus.js";

export interface RunStatusProps {
  /** The instant to render "last run Xh ago" against. Threaded down from the page, never read
   *  internally (`Date.now()`/argless `new Date()`) -- this project's purity rule for anything
   *  a test needs to hold still (see `relativeTime`'s own doc comment in `format.ts`, and
   *  `ArticleCard`/`DaySection`'s identical `now` prop). Every call site already computes one
   *  `now` for its own time-dependent rendering; this reuses it rather than taking a second,
   *  independent instant that could drift from the page's own by a render tick. */
  now: Date;
}

/**
 * Spec §8's highest-value UI element: "last run 4h ago · 229 items · 21/21 sources · LLM ok".
 * Without it a feed that has quietly stopped updating is indistinguishable from a quiet news
 * week -- the failure this whole system is most likely to have.
 *
 * An async server component that reads `getRunStatus()` itself, rather than taking the result
 * as a prop -- every page that renders it gets its own `META#lastRun` `GetItem`. It is embedded
 * in the five routes that already read data and are already `force-dynamic`
 * (`/`, `/design`, `/day/[date]`, `/article/[urlHash]`, `/search`), not in `app/layout.tsx`.
 * `app/layout.tsx` today performs no data read and wraps every route including the default
 * `/_not-found` and `/_global-error` pages, which `pnpm check:routes` asserts are statically
 * prerendered (`scripts/check-routes.ts`'s `EXPECTED_STATIC`). A data read in the layout would
 * make those pages dynamic too -- correctly, since Next infers dynamic rendering from the read
 * itself, not from a directive -- which would require loosening or rewriting that gate for a
 * benefit (showing ingest health on a 404 page) nobody asked for. Rendering from the pages
 * keeps the protected static set exactly as it is and adds no read cost to routes that were
 * never part of the reading experience this component serves.
 *
 * `getRunStatus` returns `null` for exactly one case -- the pipeline has never run -- rendered
 * as a plain statement rather than folded into any of spec §8's five per-source states: there
 * is no source data to classify yet.
 *
 * Every call site writes `{await RunStatus({ now })}`, never `<RunStatus now={now} />`. Both
 * are valid JSX and Next's real RSC renderer accepts either -- but `@testing-library/react`'s
 * `render()` uses the plain client reconciler, which cannot resolve an async function component
 * left unresolved inside a tree (confirmed: React logs "`<RunStatus>` is an async Client
 * Component. Only Server Components can be async at the moment" and the page renders as an
 * empty `<div />`). Awaiting it explicitly, the same way every page already awaits `getDay`/
 * `getArticle`/`getRecentDays` before building its returned JSX, resolves it to a plain element
 * before the parent page's own `render(await Page(...))` test ever sees it -- identical output
 * in production, but renderable in this suite's tests too.
 */
export async function RunStatus({ now }: RunStatusProps) {
  const status = await getRunStatus();

  if (status === null) {
    return (
      <p data-testid="run-status-empty" className="mb-6 text-xs text-neutral-400">
        No ingest run recorded yet.
      </p>
    );
  }

  const summary = summarizeRunStatus(status, now);

  return (
    <div data-testid="run-status" className="mb-6 text-xs text-neutral-500">
      <p data-testid="run-status-summary">
        last run {summary.relativeTime} · {summary.itemsWritten} items ·{" "}
        {summary.producingCount}/{summary.totalSources} sources · LLM {summary.llmLabel}
      </p>
      {summary.notable.length > 0 ? (
        <ul data-testid="run-status-notable" className="mt-1 space-y-0.5">
          {summary.notable.map(({ source, state }) => (
            <li key={source} className={SOURCE_STATE_CLASS[state]}>
              {source}: {SOURCE_STATE_LABEL[state]}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
