import type { MetadataRoute } from "next";

/**
 * Task 8 fix round 1, finding 7. `/search` is now linked from `SectionNav` (every page), which
 * means it is crawlable for the first time -- and every crawler hit costs the same as a real
 * search: up to `RECENT_WINDOW_DAYS` `queryDay` Queries plus, once `?since=` is in the URL, an
 * archive fetch. All five routes are `force-dynamic` with no `revalidate`, so a crawler
 * systematically working through every `?q=`/`?since=` combination it can find would pay that
 * cost on every single request. Disallowing `/search` specifically (not the whole site -- the
 * feed and story pages are exactly what this app wants indexed) is the cheap, standard way to
 * keep a well-behaved crawler out of the one route where a hit is not just a cache-free read but
 * a multi-Query search.
 *
 * `/article/` is disallowed too, on Özkan's decision of 2026-08-20: there is no reason for these
 * pages to be in a search index while the app has no real domain. It also stops a crawler paying
 * for the cluster lookup -- a story page belonging to a cluster Queries its whole day partition
 * (~50 RRU), so walking one day's articles costs roughly nine times a single `/search`. The money
 * is negligible (about two cents to crawl a day); the reason is that the work is pointless.
 *
 * REVISIT WHEN A REAL DOMAIN IS SET UP. He asked to be reminded at that point: un-block whichever
 * of these should be indexed, and fix the two things that would make indexing worth anything --
 * every route currently serves the same `<title>AI News</title>`, and `/`, `/design` and
 * `/day/[date]` have no `<h1>` (final review, L11).
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      disallow: ["/search", "/article/"],
    },
  };
}
