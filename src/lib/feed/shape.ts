import type { Category, Section } from "../../types/article.js";
import { DEGRADED_SCORE_VERSION } from "../core/score.js";

/**
 * A card's worth of data, derived from a raw DynamoDB item projected through the
 * `feed-by-day` GSI. Only fields that actually survive that projection belong here --
 * see `toFeedArticle` for the one exception (`urlHash`, recovered from the key).
 */
export interface FeedArticle {
  urlHash: string;
  url: string;
  title: string;
  summary: string;
  imageUrl: string | null;
  source: string;
  sourceName: string;
  category: Category;
  section: Section;
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
    urlHash: String(item.pk).slice("ART#".length),
    url: asString(item.url),
    title: asString(item.title),
    summary: asString(item.summary),
    imageUrl: asStringOrNull(item.imageUrl),
    source: asString(item.source),
    sourceName: asString(item.sourceName),
    category: item.category as Category,
    section: item.section as Section,
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

/** True exactly when the model never scored the article -- capture's degraded score stood in. */
export function isUnranked(article: FeedArticle): boolean {
  return article.scoreVersion === DEGRADED_SCORE_VERSION;
}

/** Filters to one vertical, preserving whatever order the caller already ranked them in. */
export function bySection(articles: FeedArticle[], section: Section): FeedArticle[] {
  return articles.filter((a) => a.section === section);
}

/**
 * The other articles covering the same story as `article`, never including `article` itself.
 *
 * Matching is plain equality on the stored `clusterId` string -- it is already day-namespaced,
 * so there is no day to parse back out. `__self__:<urlHash>` ids are excluded outright: they
 * mean the model assigned no cluster, and grouping by that value would fuse every unclustered
 * article of the day into one fake story.
 */
export function clusterSiblings(articles: FeedArticle[], article: FeedArticle): FeedArticle[] {
  const id = article.clusterId;
  if (id === null || id.startsWith("__self__:")) return [];
  return articles.filter((a) => a !== article && a.clusterId === id);
}
