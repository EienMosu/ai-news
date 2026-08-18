import { XMLParser } from "fast-xml-parser";

/**
 * The shape every feed adapter normalizes to, before dedup/scoring/category
 * tagging happens downstream. Kept intentionally close to the raw feed
 * vocabulary — no URL hashing or category inference here, that's Task 7's job.
 */
export interface FeedItem {
  title: string;
  link: string;
  summary: string;
  imageUrl: string | null;
  publishedAt: string | null;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  trimValues: true,
});

function text(v: unknown): string {
  if (typeof v === "string") return v;
  if (v && typeof v === "object" && "#text" in v) return String((v as any)["#text"]);
  return "";
}

function toIso(v: unknown): string | null {
  const raw = text(v);
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

/**
 * Handles RSS 2.0 and Atom. Anything unparseable — including an HTML error
 * page served with HTTP 200 — yields an empty array, which the caller records
 * as a zero-item source rather than a silent success.
 */
export function parseFeed(xml: string): FeedItem[] {
  if (!xml.trim()) return [];

  let doc: any;
  try {
    doc = parser.parse(xml);
  } catch {
    return [];
  }

  const rssItems = asArray(doc?.rss?.channel?.item);
  if (rssItems.length > 0) {
    return rssItems.map((it: any) => ({
      title: stripHtml(text(it.title)),
      link: text(it.link),
      summary: stripHtml(text(it.description) || text(it["content:encoded"])).slice(0, 600),
      imageUrl: it["media:content"]?.["@url"] ?? it.enclosure?.["@url"] ?? null,
      publishedAt: toIso(it.pubDate ?? it["dc:date"]),
    }));
  }

  const atomEntries = asArray(doc?.feed?.entry);
  if (atomEntries.length > 0) {
    return atomEntries.map((e: any) => {
      const links = asArray(e.link);
      const href = links.find((l: any) => !l?.["@rel"] || l["@rel"] === "alternate")?.["@href"];
      return {
        title: stripHtml(text(e.title)),
        link: href ?? text(e.id),
        summary: stripHtml(text(e.summary) || text(e.content)).slice(0, 600),
        imageUrl: null,
        publishedAt: toIso(e.published ?? e.updated),
      };
    });
  }

  return [];
}
