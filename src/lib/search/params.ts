import { SECTIONS, type Section } from "../../types/article.js";
import { RECENT_WINDOW_DAYS, isValidDay, subtractDays } from "./range.js";

/**
 * Trims a `?q=` value down to the string the reader actually searches for. Missing or a
 * repeated `?q=` (an array, from a duplicated query param) both read as "no query" -- the same
 * "unparseable input -> a safe, unsurprising default" discipline `parseDaysParam`
 * (src/lib/feed/days.ts) applies to `?days=`, applied here to a text field instead of a number.
 * Never trims to `undefined`/`null`: the search page's "is this blank?" check (decision 7) is a
 * single `=== ""` against this function's return value, not a second null check layered on top.
 */
export function parseQueryParam(raw: string | string[] | undefined): string {
  return typeof raw === "string" ? raw.trim() : "";
}

/** The vertical a search runs against -- either one real `Section`, or `"both"` (brief Step
 *  3's "a way to search both"). Not `Section | null`: unlike `FeedArticle.section` (a stored
 *  fact that can be absent), this is a request parameter with an actual default to fall back
 *  to, so there is no "we don't know" state to represent. */
export type SearchScope = Section | "both";

/**
 * Parses `?section=` into a `SearchScope`. Anything other than `"both"` or a real member of
 * `SECTIONS` -- missing, a repeated param, or garbage -- falls back to `fallback`, which the
 * page passes as its own notion of "the current vertical" (decision 3: search runs against the
 * current vertical by default). There is no vertical-specific default baked into this function
 * itself, on purpose: this file has no idea which page linked here.
 *
 * Checked against `SECTIONS` rather than a hand-written list of literals (branch review, C1):
 * `SearchScope = Section | "both"` widens automatically whenever `SECTIONS` gains a vertical,
 * but a hardcoded `raw === "ai" || raw === "design"` does not widen with it -- the compiler
 * cannot catch that gap because this is a runtime string comparison, not an exhaustive check.
 * That is exactly how `?section=cloud` silently collapsed to `fallback` until this fix: cloud
 * shipped in `SECTIONS`, `SectionNav` already links `/search?section=cloud` from `/cloud`, and
 * this function still only recognised the first two verticals. Deriving the check from
 * `SECTIONS` means a fifth vertical cannot regress this the same way.
 */
export function parseSectionParam(raw: string | string[] | undefined, fallback: Section): SearchScope {
  if (raw === "both") return "both";
  if (typeof raw === "string" && (SECTIONS as readonly string[]).includes(raw)) return raw as Section;
  return fallback;
}

/**
 * The oldest day (`YYYY-MM-DD`) a search should reach back to -- Task 8 decision 2's `since`
 * control, the thing a reader narrows when the archive branch refuses a too-long range.
 * Missing, not a real calendar date (`isValidDay`, not a bare shape check -- fix round 1,
 * finding F3), or a date after `today` all fall back to the same safe default: `today` minus
 * `RECENT_WINDOW_DAYS - 1`, i.e. "the last 30 days including today and no archive days at all"
 * -- never a `since` that would make `splitSearchRange`'s `from > to` branch fire, and never a
 * bare pass-through of unvalidated user input into a range that gets walked one day at a time.
 *
 * A calendar-valid `since` that is merely far in the past (e.g. `?since=1990-01-01`) is passed
 * through unclamped, on purpose: `exceedsArchiveBoundForRange` already turns that
 * into the correct, user-visible "too far back, narrow your range" refusal (Spec §8 decision 2),
 * and silently clamping it here to the widest runnable window would replace an honest refusal
 * with an answer the reader never asked for and is not told was narrowed -- the same
 * silently-partial outcome decision 2 exists to rule out, just moved one step earlier. The
 * *validity* check above and `splitSearchRange`'s own independent iteration cap are what keep an
 * extreme `since` (`?since=0000-01-01`, still calendar-valid) cheap to reject; this function does
 * not additionally narrow a merely-old-but-real date.
 */
export function parseSinceParam(raw: string | string[] | undefined, today: string): string {
  const fallback = subtractDays(today, RECENT_WINDOW_DAYS - 1);
  if (typeof raw !== "string" || !isValidDay(raw)) return fallback;
  return raw <= today ? raw : fallback;
}
