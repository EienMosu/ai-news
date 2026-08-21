import { ArticlePageImpl } from "../../article-page-impl.js";

export const dynamic = "force-dynamic";

/**
 * The ai vertical's article route. The section is a literal path segment for one reason:
 * loading.tsx receives no params, so only a literal segment can own a loading shell in its own
 * world -- the single dynamic route showed every vertical the AI blue while opening a story
 * (owner report, 2026-08-21). The implementation is shared; this file contributes the segment
 * and the claimed section, and the impl redirects to the canonical path if the store disagrees.
 */
export default async function ArticlePage(props: { params: Promise<{ urlHash: string }> }) {
  return ArticlePageImpl({ ...props, pathSection: "ai" });
}
