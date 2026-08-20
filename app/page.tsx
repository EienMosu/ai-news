import { FeedArchive } from "../components/FeedArchive.js";
import { RunStatusLine } from "../components/RunStatusLine.js";
import { SectionNav } from "../components/SectionNav.js";
import { parseDaysParam } from "../src/lib/feed/days.js";
import { getRecentDays } from "../src/lib/feed/read.js";

// Without this, Next statically prerenders this page at build time -- it calls `getRecentDays`,
// which hits DynamoDB during `pnpm build` and fails with "TABLE_NAME environment variable is
// not set" (there is no table at build time). Forcing dynamic rendering defers the call to
// request time, same as `app/design/page.tsx`. Verified via `pnpm build`'s route table: this
// route must show `ƒ` (Dynamic), never `○` (Static).
export const dynamic = "force-dynamic";

/**
 * Next 15+ makes `searchParams` a Promise, not a plain object, exactly like `params` on a
 * dynamic segment. Typing this as a plain `{ days?: string }` and reading `searchParams.days`
 * directly compiles and builds clean but serves `undefined` at runtime for every request,
 * regardless of the actual URL -- the same trap `app/article/[urlHash]/page.tsx` documents for
 * `params`, on the sibling prop Next also promise-wraps.
 */
interface HomeProps {
  searchParams: Promise<{ days?: string | string[] }>;
}

/**
 * The AI vertical, at `/`. Task 7 Step 2: the initial render is seven day sections (Spec §7);
 * `?days=<n>` (parsed and clamped by `parseDaysParam`) raises that count for "older days on
 * demand" -- a plain link, not a client "load more" component, since everything in this app is
 * server-rendered and a client boundary here would pull the whole card tree across it.
 *
 * `getRecentDays` issues exactly one `listDays` call plus one `queryDay` per day, all
 * concurrently -- see its doc comment in src/lib/feed/read.ts. Both feed pages read the same
 * days via `getRecentDays`, differing only by `bySection` inside it -- the two verticals are
 * sibling nav destinations, not a filter over one combined list.
 */
export default async function Home({ searchParams }: HomeProps) {
  const { days: rawDays } = await searchParams;
  const days = parseDaysParam(rawDays);
  const results = await getRecentDays("ai", days);
  const now = new Date();

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      {await RunStatusLine({ now })}
      <SectionNav current="ai" days={days} />
      <FeedArchive section="ai" results={results} now={now} days={days} basePath="/" />
    </main>
  );
}
