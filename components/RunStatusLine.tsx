import { getArchive, getRunStatus } from "../src/lib/feed/read.js";
import { SOURCE_STATE_CLASS, SOURCE_STATE_LABEL, summarizeRunStatus } from "../src/lib/feed/runStatus.js";

export interface RunStatusLineProps {
  /** The instant to render "last run Xh ago" against. Threaded down from the page, never read
   *  internally (`Date.now()`/argless `new Date()`) -- this project's purity rule for anything
   *  a test needs to hold still (see `relativeTime`'s own doc comment in `format.ts`, and
   *  `ArticleCard`/`DaySection`'s identical `now` prop). Every call site already computes one
   *  `now` for its own time-dependent rendering; this reuses it rather than taking a second,
   *  independent instant that could drift from the page's own by a render tick. */
  now: Date;
}

/**
 * Spec §8's highest-value UI element: "last run 4h ago · 229 items · 21/21 sources · LLM ok
 * (ranked through 2026-08-19)". Without it a feed that has quietly stopped updating is
 * indistinguishable from a quiet news week -- the failure this whole system is most likely to
 * have.
 *
 * Named `RunStatusLine`, not `RunStatus` (fix round 1, F10): the data interface
 * `src/lib/feed/read.ts` already exports as `RunStatus` (the `META#lastRun` shape) predates this
 * component by two tasks, and the two sharing a name forced an import alias at every test site
 * that needed both. This component is the one that moved.
 *
 * An async server component that reads its own data -- `getRunStatus()` (`META#lastRun`) and,
 * as of fix round 1 F2, `getArchive(1)` (the latest `META#DAY`) -- rather than taking either as
 * a prop, so every page that renders it gets its own reads. Both run concurrently via
 * `Promise.allSettled`, not `Promise.all`: a transient failure on either must degrade this
 * component's own output, never propagate out and take down the whole page it sits on top of
 * (fix round 1, F6 -- the same reasoning `getDay` in `read.ts` already uses for its own two
 * concurrent reads). `getRunStatus` failing leaves nothing to classify, so the whole line
 * degrades to "status unavailable"; `getArchive(1)` failing degrades only the "LLM ..." clause
 * (see `llmLine`'s doc comment in `runStatus.ts`), leaving the per-source summary intact.
 *
 * It is embedded in the five routes that already read data and are already `force-dynamic`
 * (`/`, `/design`, `/day/[date]`, `/article/[urlHash]`, `/search`), not in `app/layout.tsx`.
 * `app/layout.tsx` today performs no data read and wraps every route including the default
 * `/_not-found` and `/_global-error` pages, which `pnpm check:routes` asserts are statically
 * prerendered (`scripts/check-routes.ts`'s `EXPECTED_STATIC`). A data read in the layout would
 * make those pages dynamic too -- correctly, since Next infers dynamic rendering from the read
 * itself, not from a directive -- which would require loosening or rewriting that gate for a
 * benefit (showing ingest health on a 404 page) nobody asked for. Rendering from the pages
 * keeps the protected static set exactly as it is and adds no read cost to routes that were
 * never part of the reading experience this component serves. (Fix round 1, F7 considered a
 * route-group layout, `app/(feed)/layout.tsx`, as a way to de-duplicate the six call sites
 * without touching the root layout; see the Task 9 report for why it was not taken this round.)
 *
 * `getRunStatus` returns `null` for exactly one case -- the pipeline has never run -- rendered
 * as a plain statement rather than folded into any of spec §8's five per-source states: there
 * is no source data to classify yet.
 *
 * Every call site writes `{await RunStatusLine({ now })}`, never `<RunStatusLine now={now} />`.
 * Both are valid JSX and Next's real RSC renderer accepts either -- but
 * `@testing-library/react`'s `render()` uses the plain client reconciler, which cannot resolve
 * an async function component left unresolved inside a tree (confirmed: React logs
 * "`<RunStatusLine>` is an async Client Component. Only Server Components can be async at the
 * moment" and the page renders as an empty `<div />`). Awaiting it explicitly, the same way
 * every page already awaits `getDay`/`getArticle`/`getRecentDays` before building its returned
 * JSX, resolves it to a plain element before the parent page's own `render(await Page(...))`
 * test ever sees it -- identical output in production, but renderable in this suite's tests
 * too. Fix round 1, F1 pins that every page actually does this, on the page's own test file --
 * see the presence assertions added there.
 */
export async function RunStatusLine({ now }: RunStatusLineProps) {
  const [statusResult, archiveResult] = await Promise.allSettled([getRunStatus(), getArchive(1)]);

  if (statusResult.status === "rejected") {
    return (
      <p data-testid="run-status-unavailable" className="mb-6 text-xs text-neutral-400">
        Run status unavailable.
      </p>
    );
  }

  const status = statusResult.value;
  if (status === null) {
    return (
      <p data-testid="run-status-empty" className="mb-6 text-xs text-neutral-400">
        No ingest run recorded yet.
      </p>
    );
  }

  // `undefined` (the archive read failed) is a distinct third state from `null` (the read
  // succeeded and there is genuinely no ranked day yet) -- see `llmLine`'s doc comment in
  // runStatus.ts for why collapsing the two would render a transient blip as a false claim.
  const latestDay = archiveResult.status === "fulfilled" ? archiveResult.value[0] ?? null : undefined;
  const summary = summarizeRunStatus(status, latestDay, now);

  return (
    <div data-testid="run-status" className="mb-6 text-xs text-neutral-500">
      <p data-testid="run-status-summary">
        last run {summary.relativeTime} · {summary.itemsWritten} items ·{" "}
        {summary.producingCount}/{summary.totalSources} sources · {summary.llmLine}
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
