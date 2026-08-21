import { notFound, redirect } from "next/navigation";
import { articlePath } from "../../../../src/lib/feed/format.js";
import { getArticle } from "../../../../src/lib/feed/read.js";
import { isValidUrlHash } from "../../../../src/types/article.js";

export const dynamic = "force-dynamic";

/**
 * The pre-2026-08-21 article URL, kept alive as a redirect: robots are blocked but links were
 * shared with friends. It reads the article once (cached) to learn the section, then sends the
 * reader to the canonical `/article/<section>/<urlHash>`.
 */
export default async function LegacyArticlePage({
  params,
}: {
  params: Promise<{ urlHash: string }>;
}) {
  const { urlHash } = await params;
  if (!isValidUrlHash(urlHash)) notFound();
  const article = await getArticle(urlHash);
  if (article === null) notFound();
  redirect(articlePath(article.section, urlHash));
}
