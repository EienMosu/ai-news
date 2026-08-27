import { FeedArchive } from "../../../components/FeedArchive.js";
import { FilterRow } from "../../../components/FilterRow.js";
import { SectionNav } from "../../../components/SectionNav.js";
import { parseDaysParam } from "../../../src/lib/feed/days.js";
import { resolveFilter, sanitizeFilterParam } from "../../../src/lib/feed/filter.js";
import { feedHeaderData } from "../../../src/lib/feed/header.js";
import { getRecentDays } from "../../../src/lib/feed/read.js";

// See app/page.tsx for why this is required: without it, `pnpm build` prerenders this route
// statically, calling `getRecentDays` (and hitting DynamoDB) at build time with no TABLE_NAME
// set.
export const dynamic = "force-dynamic";

interface CloudPageProps {
  searchParams: Promise<{ days?: string | string[]; f?: string | string[]; others?: string | string[] }>;
}

/** See app/page.tsx's identical helper -- only the first value of a repeated search param is
 *  ever a deliberate value from a link or form this app renders. */
function firstOf(raw: string | string[] | undefined): string | undefined {
  return Array.isArray(raw) ? raw[0] : raw;
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
  const { days: rawDays, f: rawF } = await searchParams;
  const days = parseDaysParam(rawDays);
  const activeF = sanitizeFilterParam(firstOf(rawF));
  const filterDef = activeF !== null ? resolveFilter("cloud", activeF) : null;
  const { results, failedDays } = await getRecentDays("cloud", days);
  const now = new Date();
  const { subline, chipCounts } = feedHeaderData("cloud", results);

  return (
    <main className="min-h-dvh bg-[var(--ground)] px-5 py-8 sm:px-8 sm:py-14">
      <div className="mx-auto max-w-3xl">
      <SectionNav current="cloud" days={days} subline={subline} />
      <FilterRow section="cloud" basePath="/cloud" activeF={activeF} chipCounts={chipCounts} days={days} />
      <FeedArchive
        section="cloud"
        results={results}
        failedDays={failedDays}
        now={now}
        days={days}
        basePath="/cloud"
        filterDef={filterDef}
      />
      </div>
    </main>
  );
}
