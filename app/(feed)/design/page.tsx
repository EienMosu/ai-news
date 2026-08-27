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

interface DesignPageProps {
  searchParams: Promise<{ days?: string | string[]; f?: string | string[]; others?: string | string[] }>;
}

/** See app/page.tsx's identical helper -- only the first value of a repeated search param is
 *  ever a deliberate value from a link or form this app renders. */
function firstOf(raw: string | string[] | undefined): string | undefined {
  return Array.isArray(raw) ? raw[0] : raw;
}

/**
 * The design vertical, at `/design`. Mirrors `app/page.tsx` exactly except for the section it
 * asks `getRecentDays` for, the `current` it hands `SectionNav`, and the `basePath` it hands
 * `FeedArchive` for the "load more" link -- see that file's doc comment for why the two pages
 * share one query shape instead of a filter chip over a combined feed.
 */
export default async function DesignPage({ searchParams }: DesignPageProps) {
  const { days: rawDays, f: rawF } = await searchParams;
  const days = parseDaysParam(rawDays);
  const activeF = sanitizeFilterParam(firstOf(rawF));
  const filterDef = activeF !== null ? resolveFilter("design", activeF) : null;
  const { results, failedDays } = await getRecentDays("design", days);
  const now = new Date();
  const { subline, chipCounts } = feedHeaderData("design", results);

  return (
    <main className="min-h-dvh bg-[var(--ground)] px-5 py-8 sm:px-8 sm:py-14">
      <div className="mx-auto max-w-3xl">
      <SectionNav current="design" days={days} subline={subline} />
      <FilterRow section="design" basePath="/design" activeF={activeF} chipCounts={chipCounts} days={days} />
      <FeedArchive
        section="design"
        results={results}
        failedDays={failedDays}
        now={now}
        days={days}
        basePath="/design"
        filterDef={filterDef}
      />
      </div>
    </main>
  );
}
