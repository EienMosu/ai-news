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
 * separate counter it is indistinguishable from a dead feed.
 */
export interface CaptureResult {
  articles: NormalizedArticle[];
  perSourceCounts: Record<string, number>;
  quarantined: Record<string, number>;
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
  for (const src of SOURCES) quarantined[src.id] = 0;
  const errors: { source: string; message: string }[] = [];
  const bySeenHash = new Map<string, NormalizedArticle>();

  settled.forEach((outcome, i) => {
    const src = SOURCES[i]!;
    if (outcome.status === "rejected") {
      perSourceCounts[src.id] = 0;
      errors.push({ source: src.id, message: String(outcome.reason?.message ?? outcome.reason) });
      return;
    }

    let produced = 0;
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
        produced++;
        mergeIntoSeen(bySeenHash, article);
      }
    } catch (e) {
      errors.push({ source: src.id, message: String((e as Error).message) });
    }
    perSourceCounts[src.id] = produced;
  });

  return { articles: [...bySeenHash.values()], perSourceCounts, quarantined, errors };
}
