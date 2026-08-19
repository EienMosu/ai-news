import { FeedView } from "../components/FeedView.js";
import { SectionNav } from "../components/SectionNav.js";
import { getFeed } from "../src/lib/feed/read.js";

// Without this, Next statically prerenders this page at build time -- it calls `getFeed`,
// which hits DynamoDB during `pnpm build` and fails with "TABLE_NAME environment variable is
// not set" (there is no table at build time). Forcing dynamic rendering defers the call to
// request time, same as `app/design/page.tsx`. Verified via `pnpm build`'s route table: this
// route must show `ƒ` (Dynamic), never `○` (Static).
export const dynamic = "force-dynamic";

/**
 * The AI vertical, at `/`. Both feed pages read the same day via `getFeed`, differing only by
 * `bySection` inside it (Task 5 Step 1) -- the two verticals are sibling nav destinations, not
 * a filter over one combined list, because their scores were never comparable (ranking
 * allocates its cap per section).
 *
 * `new Date()` here is the system's boundary for "now": the purity rule binds `shape.ts` and
 * `format.ts`, which both take `now` as a parameter, not the page that supplies it.
 */
export default async function Home() {
  const result = await getFeed("ai");
  const now = new Date();

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <SectionNav current="ai" />
      <FeedView section="ai" result={result} now={now} />
    </main>
  );
}
