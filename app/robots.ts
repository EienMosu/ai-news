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
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      disallow: "/search",
    },
  };
}
