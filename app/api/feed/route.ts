import { NextResponse } from "next/server";
import { parseDaysParam } from "../../../src/lib/feed/days.js";
import { getRecentDays } from "../../../src/lib/feed/read.js";
import { SECTIONS, type Section } from "../../../src/types/article.js";

export const dynamic = "force-dynamic";

/**
 * The mobile app's feed gate: `GET /api/feed?section=ai|design|cloud&days=1..30`.
 *
 * Read-only JSON over data that is already public on the site and in the archive repo, so an
 * unauthenticated endpoint adds no security surface (audit, 2026-08-21). It reuses the SAME
 * validators and cached reads as the pages: `parseDaysParam` clamps exactly like the web
 * (garbage falls back, 1000 becomes 30), and the day-keyed data cache means an app refresh
 * costs DynamoDB nothing the site has not already paid this hour.
 *
 * The v1 contract is the `FeedResult`/`FeedArticle` shape as-is; the app's `Codable` structs
 * mirror it. Breaking that shape breaks the app in the field: extend, never rename.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const rawSection = url.searchParams.get("section") ?? "ai";
  if (!(SECTIONS as readonly string[]).includes(rawSection)) {
    return NextResponse.json(
      { error: `unknown section; expected one of: ${SECTIONS.join(", ")}` },
      { status: 400 },
    );
  }
  const section = rawSection as Section;
  const days = parseDaysParam(url.searchParams.get("days") ?? undefined);

  const { results, failedDays } = await getRecentDays(section, days);
  return NextResponse.json(
    { section, days, failedDays, results },
    {
      headers: {
        // The data layer caches for an hour; the CDN may hold the JSON for five minutes so a
        // burst of app refreshes never reaches the function at all.
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
      },
    },
  );
}
