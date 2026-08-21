import { NextResponse } from "next/server";
import { getArticle, getDay } from "../../../../src/lib/feed/read.js";
import { clusterSiblings, isRealCluster } from "../../../../src/lib/feed/shape.js";
import { isValidUrlHash } from "../../../../src/types/article.js";

export const dynamic = "force-dynamic";

/**
 * One story for the app's reading room: `GET /api/article/<urlHash>`.
 *
 * Returns the article detail plus its cluster siblings, composed exactly the way the story page
 * composes them (same guards: no ingest day or no real cluster means no sibling read at all),
 * so the app and the web can never disagree about what "also covered by" means.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ urlHash: string }> },
): Promise<NextResponse> {
  const { urlHash } = await params;
  if (!isValidUrlHash(urlHash)) {
    return NextResponse.json({ error: "malformed urlHash" }, { status: 400 });
  }
  const article = await getArticle(urlHash);
  if (article === null) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const siblings =
    article.ingestDay !== null && isRealCluster(article.clusterId)
      ? clusterSiblings((await getDay(article.ingestDay)).articles, article)
      : [];

  return NextResponse.json(
    { article, siblings },
    { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } },
  );
}
