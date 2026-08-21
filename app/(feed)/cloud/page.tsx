import { FeedArchive } from "../../../components/FeedArchive.js";
import { SectionNav } from "../../../components/SectionNav.js";
import { parseDaysParam } from "../../../src/lib/feed/days.js";
import { getRecentDays } from "../../../src/lib/feed/read.js";

// See app/page.tsx for why this is required: without it, `pnpm build` prerenders this route
// statically, calling `getRecentDays` (and hitting DynamoDB) at build time with no TABLE_NAME
// set.
export const dynamic = "force-dynamic";

interface CloudPageProps {
  searchParams: Promise<{ days?: string | string[] }>;
}

/**
 * The cloud vertical, at `/cloud`. The third world, deep pine: infrastructure and platform
 * coverage gets its own field rather than a filter chip over the other two, because ranking
 * allocates its input cap per section -- a shared list would let whichever vertical ships more
 * volume on a given day silently crowd the others out. Mirrors `app/page.tsx` and
 * `app/design/page.tsx` exactly except for the section it asks `getRecentDays` for, the
 * `current` it hands `SectionNav`, and the `basePath` it hands `FeedArchive` for the "load more"
 * link.
 */
export default async function CloudPage({ searchParams }: CloudPageProps) {
  const { days: rawDays } = await searchParams;
  const days = parseDaysParam(rawDays);
  const { results, failedDays } = await getRecentDays("cloud", days);
  const now = new Date();

  return (
    <main data-field="cloud" className="min-h-dvh bg-[var(--field)] px-5 py-10 sm:px-8 sm:py-14">
      <div className="mx-auto max-w-3xl">
      <SectionNav current="cloud" days={days} />
      <FeedArchive
        section="cloud"
        results={results}
        failedDays={failedDays}
        now={now}
        days={days}
        basePath="/cloud"
      />
      </div>
    </main>
  );
}
