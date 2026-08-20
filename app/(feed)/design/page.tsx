import { FeedArchive } from "../../../components/FeedArchive.js";
import { SectionNav } from "../../../components/SectionNav.js";
import { parseDaysParam } from "../../../src/lib/feed/days.js";
import { getRecentDays } from "../../../src/lib/feed/read.js";

// See app/page.tsx for why this is required: without it, `pnpm build` prerenders this route
// statically, calling `getRecentDays` (and hitting DynamoDB) at build time with no TABLE_NAME
// set.
export const dynamic = "force-dynamic";

interface DesignPageProps {
  searchParams: Promise<{ days?: string | string[] }>;
}

/**
 * The design vertical, at `/design`. Mirrors `app/page.tsx` exactly except for the section it
 * asks `getRecentDays` for, the `current` it hands `SectionNav`, and the `basePath` it hands
 * `FeedArchive` for the "load more" link -- see that file's doc comment for why the two pages
 * share one query shape instead of a filter chip over a combined feed.
 */
export default async function DesignPage({ searchParams }: DesignPageProps) {
  const { days: rawDays } = await searchParams;
  const days = parseDaysParam(rawDays);
  const results = await getRecentDays("design", days);
  const now = new Date();

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <SectionNav current="design" days={days} />
      <FeedArchive section="design" results={results} now={now} days={days} basePath="/design" />
    </main>
  );
}
