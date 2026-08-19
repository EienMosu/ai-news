import { FeedView } from "../../components/FeedView.js";
import { SectionNav } from "../../components/SectionNav.js";
import { getFeed } from "../../src/lib/feed/read.js";

// See app/page.tsx for why this is required: without it, `pnpm build` prerenders this route
// statically, calling `getFeed` (and hitting DynamoDB) at build time with no TABLE_NAME set.
export const dynamic = "force-dynamic";

/**
 * The design vertical, at `/design`. Mirrors `app/page.tsx` exactly except for the section it
 * asks `getFeed` for and the `current` it hands `SectionNav` -- see that file's doc comment for
 * why the two pages share one query shape instead of a filter chip over a combined feed.
 */
export default async function DesignPage() {
  const result = await getFeed("design");
  const now = new Date();

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <SectionNav current="design" />
      <FeedView section="design" result={result} now={now} />
    </main>
  );
}
