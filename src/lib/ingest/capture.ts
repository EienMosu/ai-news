import { normalizeUrl, titleHash, urlHash } from "../core/url.js";
import { NormalizedArticleSchema, type NormalizedArticle } from "../../types/article.js";
import { parseFeed, type FeedItem } from "./fetchers/rss.js";
import { parseHnResponse } from "./fetchers/hn.js";
import { parseHfPapers } from "./fetchers/hfPapers.js";
import { SOURCES, type SourceDef } from "./sources.js";

/** What captureAll needs from the outside world, injected so tests never touch the network. */
export interface CaptureDeps {
  fetchText: (url: string) => Promise<string>;
  now: Date;
}

/**
 * Everything a run produced, including the parts that look like nothing
 * happened. perSourceCounts and errors exist so a dead feed (zero items) is
 * distinguishable from a genuinely quiet news day; quarantined exists so a
 * source whose items all fail schema validation is distinguishable from
 * both — that failure mode also reports perSourceCounts 0, and without a
 * separate counter it is indistinguishable from a dead feed. filtered is a
 * third, disjoint reason perSourceCounts can undercount a source's raw feed:
 * items that passed validation fine but were excluded by the recency window
 * or the per-source cap (see filterToRecentWindow) — nothing wrong with
 * them, just out of scope for this run, which must not be confused with
 * quarantine (a real defect) or a dead feed (nothing at all).
 */
export interface CaptureResult {
  articles: NormalizedArticle[];
  perSourceCounts: Record<string, number>;
  quarantined: Record<string, number>;
  filtered: Record<string, number>;
  errors: { source: string; message: string }[];
}

/** Dispatches a fetched body to the adapter matching its source kind. */
function itemsFor(src: SourceDef, body: string): (FeedItem & { points?: number })[] {
  if (src.kind === "rss") return parseFeed(body);
  const json = JSON.parse(body);
  return src.kind === "hn" ? parseHnResponse(json) : parseHfPapers(json);
}

/**
 * Builds one NormalizedArticle from an adapter item, guaranteeing the two
 * fields DynamoDB depends on as index keys are never undefined: urlHash gets
 * a titleHash fallback for non-http links, and publishedAt falls back to the
 * run clock (marked as such) rather than being written empty.
 */
function toArticle(
  src: SourceDef,
  item: FeedItem & { points?: number },
  now: Date,
): NormalizedArticle | null {
  const normalized = normalizeUrl(item.link);
  const hash = normalized.startsWith("http")
    ? urlHash(normalized)
    : titleHash(item.title, src.name);

  const candidate = {
    urlHash: hash,
    url: normalized,
    title: item.title,
    summary: item.summary,
    imageUrl: item.imageUrl,
    source: src.id,
    sourceName: src.name,
    category: src.category,
    // Never leave a key attribute undefined — DynamoDB would silently drop the
    // item from the index rather than erroring.
    publishedAt: item.publishedAt ?? now.toISOString(),
    publishedAtSource: item.publishedAt ? ("feed" as const) : ("fallback" as const),
    points: item.points ?? null,
  };

  const parsed = NormalizedArticleSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

const RECENCY_WINDOW_DAYS = 7;
const DEFAULT_MAX_ITEMS = 50;

/**
 * Guards against a feed publishing its entire history rather than recent
 * items — observed live: OpenAI's RSS shipped 1132 items back to 2015,
 * Hugging Face's 843 back to 2020. Unchecked, that inflates the Bedrock
 * prompt ~23x past its budgeted size, can overflow the response token cap
 * outright, and floods the ingest day's corroboration window with
 * years-old posts.
 *
 * Two passes, in order:
 *  1. Drop anything older than the recency window, measured from the run
 *     clock. Seven days rather than one so a few missed runs in a row don't
 *     leave a permanent hole. Fallback-dated items (no date in the feed at
 *     all) are exempt from this check — they are new to us by definition,
 *     and a missing date must never be the reason an article is excluded.
 *  2. Cap what's left to maxItems, keeping the newest first. Feeds are
 *     conventionally reverse-chronological, but that's not relied on here —
 *     the survivors are explicitly sorted by publishedAt descending before
 *     slicing, so a feed in arbitrary order still yields its newest items.
 *
 * Both passes only ever remove articles that already passed schema
 * validation, so nothing here touches `quarantined` — it feeds the
 * separate `filtered` counter instead.
 */
function filterToRecentWindow(
  src: SourceDef,
  articles: NormalizedArticle[],
  now: Date,
): { kept: NormalizedArticle[]; filteredCount: number } {
  const cutoffMs = now.getTime() - RECENCY_WINDOW_DAYS * 24 * 60 * 60 * 1000;

  const inWindow = articles.filter((a) => {
    if (a.publishedAtSource === "fallback") return true;
    const ms = a.publishedAt ? Date.parse(a.publishedAt) : NaN;
    return Number.isFinite(ms) && ms >= cutoffMs;
  });

  // Fallback-dated items are window-exempt (see above) but must never
  // outrank a genuinely dated article for a capped slot — now.toISOString()
  // is the newest possible timestamp, so without this they'd sort first and
  // evict real news. Keyed off publishedAtSource rather than publishedAt
  // truthiness: publishedAt is always a string by this point (toArticle
  // fills it from the run clock when the feed gave none), so a truthiness
  // check on it can never distinguish a fallback item from a dated one.
  const sortTime = (a: NormalizedArticle) =>
    a.publishedAtSource === "fallback" ? -Infinity : Date.parse(a.publishedAt!);

  // Compared rather than subtracted: when every item is fallback-dated both
  // sides are -Infinity and the subtraction is NaN, which sort() reads as an
  // inconsistent comparator rather than "equal".
  const sorted = [...inWindow].sort((a, b) => {
    const [x, y] = [sortTime(a), sortTime(b)];
    return x === y ? 0 : y > x ? 1 : -1;
  });

  const maxItems = src.maxItems ?? DEFAULT_MAX_ITEMS;
  const kept = sorted.slice(0, maxItems);

  return { kept, filteredCount: articles.length - kept.length };
}

/**
 * Merges a newly-seen article into the dedup map. Content fields are
 * first-writer-wins in registry order (the primary publisher/lab has the
 * better summary and image), with one exception: points is the one field
 * only Hacker News produces, so if the record already stored has no points
 * and the incoming one does, the incoming points are backfilled onto the
 * stored record rather than being discarded.
 */
function mergeIntoSeen(bySeenHash: Map<string, NormalizedArticle>, article: NormalizedArticle) {
  const existing = bySeenHash.get(article.urlHash);
  if (!existing) {
    bySeenHash.set(article.urlHash, article);
  } else if (existing.points === null && article.points !== null) {
    bySeenHash.set(article.urlHash, { ...existing, points: article.points });
  }
}

/**
 * One failing source must never fail the run, but it must also never look like
 * a quiet news day — hence perSourceCounts and errors in the result. Sources
 * are fetched with allSettled so one dead feed cannot take down the others;
 * dedup by urlHash is first-writer-wins in registry order (SOURCES above),
 * except for points (see mergeIntoSeen).
 */
export async function captureAll(deps: CaptureDeps): Promise<CaptureResult> {
  const settled = await Promise.allSettled(
    SOURCES.map(async (src) => ({ src, body: await deps.fetchText(src.url) })),
  );

  const perSourceCounts: Record<string, number> = {};
  // Initialised for every source up front so a healthy source reads 0 rather
  // than being absent from the map.
  const quarantined: Record<string, number> = {};
  const filtered: Record<string, number> = {};
  for (const src of SOURCES) {
    quarantined[src.id] = 0;
    filtered[src.id] = 0;
  }
  const errors: { source: string; message: string }[] = [];
  const bySeenHash = new Map<string, NormalizedArticle>();

  settled.forEach((outcome, i) => {
    const src = SOURCES[i]!;
    if (outcome.status === "rejected") {
      perSourceCounts[src.id] = 0;
      errors.push({ source: src.id, message: String(outcome.reason?.message ?? outcome.reason) });
      return;
    }

    const validArticles: NormalizedArticle[] = [];
    try {
      for (const item of itemsFor(src, outcome.value.body)) {
        const article = toArticle(src, item, deps.now);
        if (!article) {
          // Failed NormalizedArticleSchema — quarantined rather than written
          // with holes, and counted separately so this doesn't read the same
          // as a dead feed that produced nothing at all.
          quarantined[src.id]!++;
          continue;
        }
        validArticles.push(article);
      }
    } catch (e) {
      errors.push({ source: src.id, message: String((e as Error).message) });
    }

    const { kept, filteredCount } = filterToRecentWindow(src, validArticles, deps.now);
    filtered[src.id] = filteredCount;
    for (const article of kept) mergeIntoSeen(bySeenHash, article);
    perSourceCounts[src.id] = kept.length;
  });

  return { articles: [...bySeenHash.values()], perSourceCounts, quarantined, filtered, errors };
}
