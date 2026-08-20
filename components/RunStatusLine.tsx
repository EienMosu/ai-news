import { getArchive, getRunStatus } from "../src/lib/feed/read.js";
import { SOURCE_STATE_CLASS, SOURCE_STATE_LABEL, summarizeRunStatus } from "../src/lib/feed/runStatus.js";

export interface RunStatusLineProps {
  /** The instant to render "last run Xh ago" against. Threaded down from the caller, never read
   *  internally (`Date.now()`/argless `new Date()`) -- this project's purity rule for anything
   *  a test needs to hold still (see `relativeTime`'s own doc comment in `format.ts`, and
   *  `ArticleCard`/`DaySection`'s identical `now` prop), and what makes this component's own
   *  tests (`tests/feed/feed-layout.test.tsx`) able to hold "4h ago" still instead of depending
   *  on whenever the suite happens to run. As of fix round 2 the one caller is
   *  `app/(feed)/layout.tsx`, which computes its own `now` for this -- a layout and the page it
   *  wraps are separate Server Component render passes with no shared instant Next provides, so
   *  there is no page `now` to reuse here the way fix round 1's per-page call sites did. */
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
 * Rendered exactly once, from `app/(feed)/layout.tsx` (fix round 2) -- NOT from `app/layout.tsx`
 * (the root layout) and NOT from each of the five pages individually (fix round 1's original
 * shape). `app/(feed)/` is a route GROUP wrapping the five data-reading routes (`/`, `/design`,
 * `/day/[date]`, `/article/[urlHash]`, `/search`); the parenthesised segment is stripped from
 * the URL, so none of their paths changed. The root layout stays untouched on purpose: it still
 * performs no data read, so `/_not-found` and `/_global-error` (which render through the root
 * layout, never the group layout) stay in `scripts/check-routes.ts`'s `EXPECTED_STATIC` exactly
 * as before.
 *
 * Fix round 1 originally called this from all five pages individually and relied on a presence
 * test per page to catch a call site being deleted. Fix round 2 found the actual gap in that
 * shape: a presence test only fires when a call site that EXISTS is removed -- it has nothing to
 * say about a SIXTH page added later with no call site at all, and the review proved exactly
 * that (`app/zzscratchroute/page.tsx`, no `RunStatusLine`, every gate green). The route-group
 * layout closes it structurally: a page cannot render without passing through its enclosing
 * layout, so the only way to skip this component is to live outside `app/(feed)/` entirely --
 * which `tests/structure/page-groups.test.ts` asserts nothing does, apart from a small,
 * explicitly-commented allowlist.
 *
 * `getRunStatus` returns `null` for exactly one case -- the pipeline has never run -- rendered
 * as a plain statement rather than folded into any of spec §8's five per-source states: there
 * is no source data to classify yet.
 *
 * The one call site (`app/(feed)/layout.tsx`) writes `{await RunStatusLine({ now })}`, never
 * `<RunStatusLine now={now} />`. Both are valid JSX and Next's real RSC renderer accepts either
 * -- but `@testing-library/react`'s `render()` uses the plain client reconciler, which cannot
 * resolve an async function component left unresolved inside a tree (confirmed: React logs
 * "`<RunStatusLine>` is an async Client Component. Only Server Components can be async at the
 * moment" and the page renders as an empty `<div />`). Awaiting it explicitly resolves it to a
 * plain element before the layout's own `render(await FeedLayout({ children }))` test ever sees
 * it (`tests/feed/feed-layout.test.tsx`) -- identical output in production, but renderable in
 * this suite's tests too.
 */
export async function RunStatusLine({ now }: RunStatusLineProps) {
  const [statusResult, archiveResult] = await Promise.allSettled([getRunStatus(), getArchive(1)]);

  if (statusResult.status === "rejected") {
    return (
      <p data-testid="run-status-unavailable" className="apparatus mb-9 opacity-70">
        Run status unavailable.
      </p>
    );
  }

  const status = statusResult.value;
  if (status === null) {
    return (
      <p data-testid="run-status-empty" className="apparatus mb-9 opacity-70">
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
    <div data-testid="run-status">
      <p data-testid="run-status-summary" className="apparatus opacity-90" data-numeric>
        last run {summary.relativeTime} · {summary.itemsWritten} items ·{" "}
        {summary.producingCount}/{summary.totalSources} sources · {summary.llmLine}
      </p>
      {summary.notable.length > 0 ? (
        <ul data-testid="run-status-notable" className="mt-2.5 flex flex-wrap gap-2">
          {summary.notable.map(({ source, state }) => (
            <li key={source} className={SOURCE_STATE_CLASS[state]}>
              <span className="stamp">
                {source}: {SOURCE_STATE_LABEL[state]}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
