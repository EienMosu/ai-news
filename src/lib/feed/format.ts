const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/**
 * Human-relative published time for a card. Takes `now` as a parameter rather than reading
 * `Date.now()` or calling argless `new Date()` internally -- this project's purity rule for
 * anything a test needs to hold still. `ArticleCard` takes the same `now` as a prop and passes
 * it straight through, so a whole render tree shares one instant instead of drifting mid-render.
 *
 * `publishedAt` is `null` on a fallback-dated or degraded-capture item (see
 * `FeedArticle.publishedAt`), and a value that fails to parse is possible too -- both render
 * "date unknown" rather than "Invalid Date" or a blank. An absent date is a fact worth stating
 * plainly, not hiding.
 *
 * A `now` earlier than the parsed date (clock skew, or a future-dated feed entry) clamps the
 * difference to zero and reads "just now", the same clamp `computeScore` already applies to an
 * identical situation (`Math.max(0, ...)` on `ageHours`) rather than a confusing negative
 * duration.
 */
export function relativeTime(iso: string | null, now: Date): string {
  if (iso === null) return "date unknown";
  const publishedMs = Date.parse(iso);
  if (Number.isNaN(publishedMs)) return "date unknown";

  const diffMs = Math.max(0, now.getTime() - publishedMs);
  if (diffMs < MINUTE_MS) return "just now";
  if (diffMs < HOUR_MS) return `${Math.floor(diffMs / MINUTE_MS)}m ago`;
  if (diffMs < DAY_MS) return `${Math.floor(diffMs / HOUR_MS)}h ago`;
  return `${Math.floor(diffMs / DAY_MS)}d ago`;
}

/**
 * A store day key (`YYYY-MM-DD`) as the reader sees it: `DD.MM.YYYY` (owner request,
 * 2026-08-21; dots are the Turkish convention his "dd,mm,yyyy" shorthand pointed at).
 * Pure string re-arrangement, deliberately: parsing through `Date` would re-introduce the
 * timezone class of bug for zero benefit, and the key's shape is already validated upstream.
 * URLs and `<time dateTime>` keep the ISO key; only rendered text goes through this.
 */
export function formatDayKey(day: string): string {
  const [y, m, d] = day.split("-");
  return `${d}.${m}.${y}`;
}

import type { Section } from "../../types/article.js";

/**
 * The canonical article URL, section-first: `/article/<section>/<urlHash>`.
 *
 * The section rides in the path for exactly one reason: `loading.tsx` files receive no params,
 * so a single dynamic article route could only ever show ONE world's loading shell -- and it
 * showed the AI blue on every vertical (owner report). Three literal section segments each
 * carry their own shell. `null` section (items stored before validation) files under ai, and
 * the page redirects to the canonical path when the stored section disagrees with the URL.
 */
export function articlePath(section: Section | null, urlHash: string): string {
  return `/article/${section ?? "ai"}/${urlHash}`;
}
