import { CATEGORIES, SECTIONS, type Category, type Section } from "../../types/article.js";
import { DEGRADED_SCORE_VERSION } from "../core/score.js";

/**
 * A card's worth of data, derived from a raw DynamoDB item projected through the
 * `feed-by-day` GSI. Only fields that actually survive that projection belong here --
 * see `toFeedArticle` for the one exception (`urlHash`, recovered from the key).
 */
export interface FeedArticle {
  urlHash: string;
  /** `""` when the stored value is missing or is not an absolute `http:`/`https:` URL -- see
   *  `asHttpUrl`. Becomes an `<a href>` on the story page (`app/(feed)/article/[urlHash]/page.tsx`),
   *  which renders that link only when this is non-empty and shows an unlinked notice otherwise,
   *  rather than handing a browser a scheme it should never navigate to on a click. */
  url: string;
  title: string;
  summary: string;
  /** `null` when the stored value is missing or is not an absolute `http:`/`https:` URL -- see
   *  `asHttpUrl`. Becomes an `<img src>`; the existing `!== null` render guard (already required
   *  for the common "no image" case) is what keeps a rejected value from ever reaching the DOM. */
  imageUrl: string | null;
  source: string;
  sourceName: string;
  /** `null` when the stored value is missing or is not one of `CATEGORIES` -- an unchecked cast
   *  would let a bad write silently mislabel an article instead of surfacing as an absence. */
  category: Category | null;
  /** `null` when the stored value is missing or is not one of `SECTIONS`. `bySection` takes a
   *  real `Section` to filter by, so a `null` article simply matches no vertical -- never guess
   *  one, since a wrong guess (e.g. defaulting to "ai") is worse than the article being absent. */
  section: Section | null;
  publishedAt: string | null;
  /** Day-namespaced (`${day}#${slug}`) or `__self__:<urlHash>` when the model assigned none.
   *  Null on a degraded day, when rank never ran. */
  clusterId: string | null;
  corroborationToday: number | null;
  whyItMatters: string | null;
  score: number;
  scoreVersion: string;
  points: number | null;
  pointsImputed: boolean;
  llmImportance: number | null;
  firstSeenAt: string;
}

const asString = (v: unknown): string => (typeof v === "string" ? v : "");
const asStringOrNull = (v: unknown): string | null => (typeof v === "string" ? v : null);
const asNumber = (v: unknown): number => (typeof v === "number" ? v : 0);
const asNumberOrNull = (v: unknown): number | null => (typeof v === "number" ? v : null);

/** `null` for anything that is not a member of `values` -- the validating counterpart to an
 *  unchecked `as` cast, for the two narrow-union fields where a wrong guess cannot be represented
 *  safely. */
const memberOrNull = <T extends string>(values: readonly T[], v: unknown): T | null =>
  typeof v === "string" && (values as readonly string[]).includes(v) ? (v as T) : null;

/**
 * `null` unless `v` is a string that parses as an absolute URL with an `http:`/`https:` scheme --
 * the read-boundary counterpart to `NormalizedArticleSchema`'s `z.httpUrl()` (src/types/article.ts),
 * for the two fields that become a DOM attribute a browser will act on: `url` (an `<a href>`) and
 * `imageUrl` (an `<img src>`). Final review, L9: `category`/`section` were already re-validated
 * here with the stated rationale that "an unchecked cast would let a bad write silently mislabel
 * an article" -- `url`/`imageUrl` got a bare string coercion instead, even though a scheme other
 * than http(s) reaching either attribute is a worse outcome than a mislabelled category. Not
 * exploitable through ordinary ingest (the Zod schema constrains both at the write side), but
 * `fetchArchiveDay` (src/lib/search/archive.ts) is a second writer's worth of data -- NDJSON off
 * unauthenticated `raw.githubusercontent.com` -- that reaches `toFeedArticle` with no schema
 * validation at all, so this is the only check either field gets on that path.
 *
 * `new URL(v)` throws on a relative path or an unparseable string (caught, returns `null`); it
 * does NOT throw on `javascript:alert(1)` or `data:text/html,...` -- those parse fine and are
 * rejected by the explicit protocol check instead, which is why the check cannot be "does this
 * throw" alone.
 */
function asHttpUrl(v: unknown): string | null {
  if (typeof v !== "string") return null;
  let protocol: string;
  try {
    protocol = new URL(v).protocol;
  } catch {
    return null;
  }
  return protocol === "http:" || protocol === "https:" ? v : null;
}

/**
 * Turns a raw item from the `feed-by-day` GSI into the shape the UI renders.
 *
 * `urlHash` is not a projected attribute -- it is recovered from `pk`, which DynamoDB always
 * carries into a query result regardless of the index's projection type. Every other field is
 * read defensively: a degraded capture-only item, or a day rank never reached, is missing most
 * of the optional attributes, and a card that requires them is a card that breaks daily.
 */
export function toFeedArticle(item: Record<string, unknown>): FeedArticle {
  return {
    urlHash: String(item.pk ?? "").slice("ART#".length),
    url: asHttpUrl(item.url) ?? "",
    title: asString(item.title),
    summary: asString(item.summary),
    imageUrl: asHttpUrl(item.imageUrl),
    source: asString(item.source),
    sourceName: asString(item.sourceName),
    category: memberOrNull(CATEGORIES, item.category),
    section: memberOrNull(SECTIONS, item.section),
    publishedAt: asStringOrNull(item.publishedAt),
    clusterId: asStringOrNull(item.clusterId),
    corroborationToday: asNumberOrNull(item.corroborationToday),
    whyItMatters: asStringOrNull(item.whyItMatters),
    score: asNumber(item.score),
    scoreVersion: asString(item.scoreVersion),
    points: asNumberOrNull(item.points),
    pointsImputed: item.pointsImputed === true,
    llmImportance: asNumberOrNull(item.llmImportance),
    firstSeenAt: asString(item.firstSeenAt),
  };
}

const PUBLISHED_AT_SOURCES = ["feed", "fallback"] as const;

/**
 * The story detail page's shape -- `FeedArticle` plus the two attributes that exist only on
 * the base-table item, never on the `feed-by-day` GSI's projection: `ingestDay` (how the page
 * locates its own day partition, the only way `clusterSiblings` can be looked up at all) and
 * `publishedAtSource` (whether `publishedAt` is a reported date or a guessed fallback). The
 * other non-projected item attributes (`hashVersion`, `gsi1pk`, `gsi1sk`, `v`) are internal
 * plumbing the UI never reads and are deliberately left out.
 */
export interface ArticleDetail extends FeedArticle {
  ingestDay: string | null;
  publishedAtSource: "feed" | "fallback" | null;
}

/**
 * Turns a raw item from the base table -- a `GetItem` on `ART#<urlHash>` / `A`, never the GSI
 * -- into the story detail page's shape. Reuses `toFeedArticle` for the 18 fields shared with a
 * card rather than re-deriving them, so the two mappings can never drift from each other's
 * coercion rules.
 */
export function toArticleDetail(item: Record<string, unknown>): ArticleDetail {
  return {
    ...toFeedArticle(item),
    ingestDay: asStringOrNull(item.ingestDay),
    publishedAtSource: memberOrNull(PUBLISHED_AT_SOURCES, item.publishedAtSource),
  };
}

/** True exactly when the model never scored the article -- capture's degraded score stood in. */
export function isUnranked(article: FeedArticle): boolean {
  return article.scoreVersion === DEGRADED_SCORE_VERSION;
}

/** Filters to one vertical, preserving whatever order the caller already ranked them in. */
export function bySection(articles: FeedArticle[], section: Section): FeedArticle[] {
  return articles.filter((a) => a.section === section);
}

/**
 * True when `clusterId` denotes a real, shared cluster -- not absent (`null`, e.g. a degraded
 * day when clustering never ran) and not a `__self__:`-prefixed placeholder, which means the
 * model considered the article and deliberately assigned it no cluster. Grouping by a
 * `__self__:` id would fuse every unclustered article of the day into one fake story, since
 * several articles can carry the same placeholder.
 *
 * Shared by `clusterSiblings` and `hasCorroboration` so "what counts as a real cluster" is
 * defined in exactly one place -- a UI predicate must never reimplement it. Exported (Task 6
 * fix round 1, finding F4) so `app/article/[urlHash]/page.tsx` can check this BEFORE issuing
 * the day's `getDay` query, rather than issuing it unconditionally and discarding the result
 * via `clusterSiblings`'s own internal check -- the same guard, run one step earlier, on data
 * (`clusterId`) already in hand from the `GetItem` that fetched the article itself.
 */
export function isRealCluster(clusterId: string | null): boolean {
  return clusterId !== null && !clusterId.startsWith("__self__:");
}

const TITLE_STOP_WORDS = new Set([
  "a", "an", "and", "at", "by", "for", "from", "in", "is", "of", "on", "the", "to", "with",
]);
const FUZZY_TITLE_MIN_TOKENS = 4;
const FUZZY_TITLE_MIN_OVERLAP = 4;
const FUZZY_TITLE_DICE_THRESHOLD = 0.9;
const FUZZY_PUBLISHED_AT_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

function titleTokens(title: string): Set<string> {
  const words = title.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return new Set(words.filter((word) => !TITLE_STOP_WORDS.has(word)));
}

function numericTokens(tokens: Set<string>): string[] {
  return [...tokens].filter((token) => /^\d+$/.test(token)).sort();
}

function sameNumbers(left: Set<string>, right: Set<string>): boolean {
  const a = numericTokens(left);
  const b = numericTokens(right);
  return a.length === b.length && a.every((token, index) => token === b[index]);
}

function publishedCloseTogether(left: string | null, right: string | null): boolean {
  if (left === null || right === null) return false;
  const a = Date.parse(left);
  const b = Date.parse(right);
  return (
    Number.isFinite(a) &&
    Number.isFinite(b) &&
    Math.abs(a - b) <= FUZZY_PUBLISHED_AT_WINDOW_MS
  );
}

function areLikelySameUnclusteredStory(left: FeedArticle, right: FeedArticle): boolean {
  if (
    left.source === "" ||
    right.source === "" ||
    left.source === right.source ||
    left.section === null ||
    left.section !== right.section
  ) {
    return false;
  }
  if (!publishedCloseTogether(left.publishedAt, right.publishedAt)) return false;

  const a = titleTokens(left.title);
  const b = titleTokens(right.title);
  if (
    a.size < FUZZY_TITLE_MIN_TOKENS ||
    b.size < FUZZY_TITLE_MIN_TOKENS ||
    !sameNumbers(a, b)
  ) {
    return false;
  }

  let overlap = 0;
  for (const token of a) if (b.has(token)) overlap += 1;
  const dice = (2 * overlap) / (a.size + b.size);
  return overlap >= FUZZY_TITLE_MIN_OVERLAP && dice >= FUZZY_TITLE_DICE_THRESHOLD;
}

/**
 * Keeps one card per story while preserving the caller's score order. Ranked real clusters
 * are authoritative. Missing and `__self__:` cluster ids use a conservative title fallback:
 * only different sources in the same section, within three days, with high token overlap and
 * identical numeric markers can collapse. The first article remains the representative because
 * day queries are score-descending.
 */
export function deduplicateStories(articles: FeedArticle[]): FeedArticle[] {
  const seenClusters = new Set<string>();
  const unclusteredRepresentatives: FeedArticle[] = [];
  return articles.filter((article) => {
    const clusterId = article.clusterId;
    if (clusterId !== null && isRealCluster(clusterId)) {
      if (seenClusters.has(clusterId)) return false;
      seenClusters.add(clusterId);
      return true;
    }

    if (
      unclusteredRepresentatives.some((kept) => areLikelySameUnclusteredStory(kept, article))
    ) {
      return false;
    }
    unclusteredRepresentatives.push(article);
    return true;
  });
}

/**
 * The other articles covering the same story as `article`, never including `article` itself.
 *
 * Matching is plain equality on the stored `clusterId` string -- it is already day-namespaced,
 * so there is no day to parse back out.
 *
 * Self-exclusion compares `urlHash`, not object identity. A story detail page fetches one
 * article by `urlHash` and the day's list separately -- two distinct fetches produce two
 * distinct objects for the same stored article, and object-reference comparison would let the
 * subject leak into its own sibling list.
 */
export function clusterSiblings(articles: FeedArticle[], article: FeedArticle): FeedArticle[] {
  if (!isRealCluster(article.clusterId)) return [];
  return articles.filter((a) => a.urlHash !== article.urlHash && a.clusterId === article.clusterId);
}

/**
 * True exactly when a card should show its "also covered by N others" marker: `article`
 * belongs to a real cluster (`isRealCluster` -- not `null`, not a `__self__:` placeholder) AND
 * more than one article shares it. `corroborationToday` counts the cluster's total size
 * including `article` itself (see `countCorroboration` in rank/corroboration.ts), so `> 1`
 * means "at least one other" -- the marker's "N others" text is `corroborationToday - 1`.
 *
 * Declared as a type predicate so the caller does not need a non-null assertion: the
 * guarantee this function makes about `corroborationToday` is then enforced by the compiler
 * rather than by a comment the next edit can quietly invalidate.
 */
export function hasCorroboration(
  article: FeedArticle,
): article is FeedArticle & { corroborationToday: number } {
  return isRealCluster(article.clusterId) && (article.corroborationToday ?? 0) > 1;
}
