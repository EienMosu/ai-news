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

const SUMMARY_MAX_CODE_POINTS = 600;

function text(v: unknown): string {
  if (typeof v === "string") return v;
  if (v && typeof v === "object" && "#text" in v) return String((v as any)["#text"]);
  return "";
}

/**
 * Safely converts an unknown value to an ISO datetime string, guarding against
 * RangeError from invalid dates. Returns null for unparseable or empty input.
 * Used by feed adapters to prevent malformed timestamps from crashing batch ingestion.
 */
export function toIso(v: unknown): string | null {
  const raw = text(v);
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

/**
 * Tag names actually seen in feed bodies. Anything not on this list — a
 * literal `<model>`, `<think>`, `<tool_use>`, or `x<y` from ordinary prose —
 * is left as text rather than stripped.
 */
const ALLOWED_TAGS = [
  "p", "br", "a", "img", "div", "span", "strong", "b", "em", "i", "u",
  "ul", "ol", "li", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote",
  "figure", "figcaption", "iframe", "pre", "code", "table", "thead",
  "tbody", "tr", "td", "th", "hr", "small", "sub", "sup", "video",
  "audio", "source", "script", "style",
];

// `(?![a-zA-Z0-9])` after the tag name stops "th" from matching inside
// "think", "i" from matching inside "if", etc. — without it, an allowed
// tag name that happens to prefix a real word would still eat that word.
const TAG_RE = new RegExp(`<\\/?(?:${ALLOWED_TAGS.join("|")})(?![a-zA-Z0-9])[^>]*>`, "gi");

/**
 * Removes comments and only recognised HTML tags (see ALLOWED_TAGS), without
 * eating literal `<`/`>` used as less-than/greater-than in ordinary prose
 * (AI coverage is full of "accuracy < 0.5"-shaped sentences) or as
 * pseudo-tags like `<model>`/`<think>` that some feeds quote verbatim. A
 * bare `<[^>]*>` would match from any literal `<` to the next literal `>`
 * regardless of what's between them, silently deleting real words — the
 * allowlist fixes that without needing a full HTML parser.
 */
function stripTags(s: string): string {
  return s.replace(/<!--[\s\S]*?-->/g, "").replace(TAG_RE, "");
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/**
 * Decodes the entities that actually appear in feed body text. The XML
 * parser never touches text inside CDATA (correct per spec — CDATA is
 * verbatim), so an author-typed `&#8230;` or `&amp;`, or a defanged
 * `&lt;script&gt;`, reaches us undecoded unless something does it here.
 * This can reassemble a live-looking tag out of entities that were inert
 * text before decoding (most visibly in CDATA bodies — TechCrunch,
 * VentureBeat, the Verge, every WordPress feed), so cleanText runs
 * stripTags again after this, not just before.
 */
function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (match, ent: string) => {
    if (ent[0] === "#") {
      const isHex = ent[1] === "x" || ent[1] === "X";
      const code = isHex ? Number.parseInt(ent.slice(2), 16) : Number.parseInt(ent.slice(1), 10);
      if (!Number.isFinite(code)) return match;
      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    }
    return NAMED_ENTITIES[ent] ?? match;
  });
}

function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Truncates by Unicode code point rather than UTF-16 code unit, so a cut
 * never lands inside a surrogate pair (which would otherwise turn an emoji
 * into a lone high surrogate — rendered as U+FFFD when written as UTF-8).
 * Must run last: truncating before decodeEntities can also cut an entity
 * reference in half (e.g. "...&am"), a second way to produce garbage text.
 * Exported for use by feed adapters that need safe truncation.
 */
export function truncate(s: string, max: number): string {
  const codePoints = Array.from(s);
  return codePoints.length <= max ? s : codePoints.slice(0, max).join("");
}

/**
 * Tags/comments stripped, entities decoded, whitespace collapsed — no
 * length limit. stripTags runs both before and after decodeEntities: once
 * for tags that were already live text (e.g. non-CDATA content, where the
 * XML parser itself decodes `&lt;model&gt;` into `<model>` before this
 * pipeline runs), and once more for tags that only became live once
 * decodeEntities reassembled them (e.g. a CDATA body's `&lt;script&gt;`).
 */
function cleanText(raw: string): string {
  return collapseWhitespace(stripTags(decodeEntities(stripTags(raw))));
}

/** Same cleanup as `cleanText`, then truncated to the summary length budget. */
function summarize(raw: string): string {
  return truncate(cleanText(raw), SUMMARY_MAX_CODE_POINTS);
}

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

function isImageType(type: unknown): boolean {
  return typeof type === "string" && type.startsWith("image/");
}

/**
 * Only accepts media explicitly declared as an image. Without this check, an
 * RSS `<enclosure>` pointing at a podcast MP3 passes straight through — it's
 * a valid URL, so nothing downstream catches it, and an audio file would
 * render as the article's hero image.
 */
function extractImageUrl(it: any): string | null {
  for (const media of asArray(it["media:content"])) {
    const url = media?.["@url"];
    if (url && (media?.["@medium"] === "image" || isImageType(media?.["@type"]))) {
      return url;
    }
  }
  for (const enclosure of asArray(it.enclosure)) {
    const url = enclosure?.["@url"];
    if (url && isImageType(enclosure?.["@type"])) {
      return url;
    }
  }
  return null;
}

const HTTP_URL_RE = /^https?:\/\//;

/**
 * Atom `id` is an opaque IRI (often a `tag:` URI), not necessarily a
 * dereferenceable link — it must only be used as a link fallback when it
 * happens to be an http(s) URL. Otherwise the entry has no usable link and is
 * dropped rather than stored with a value nothing can open.
 */
function resolveAtomLink(e: any): string | null {
  const links = asArray(e.link);
  const alternate = links.find((l: any) => !l?.["@rel"] || l["@rel"] === "alternate")?.["@href"];
  if (alternate) return alternate;
  const id = text(e.id);
  return HTTP_URL_RE.test(id) ? id : null;
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
      title: cleanText(text(it.title)),
      link: text(it.link),
      summary: summarize(text(it.description) || text(it["content:encoded"])),
      imageUrl: extractImageUrl(it),
      publishedAt: toIso(it.pubDate ?? it["dc:date"]),
    }));
  }

  const atomEntries = asArray(doc?.feed?.entry);
  if (atomEntries.length > 0) {
    const items: FeedItem[] = [];
    for (const e of atomEntries) {
      const link = resolveAtomLink(e);
      // No usable http(s) link (e.g. only a rel=self link plus a tag: id) —
      // nothing to store or show, so the entry is dropped rather than kept
      // with a link nothing can open.
      if (link === null) continue;
      items.push({
        title: cleanText(text(e.title)),
        link,
        summary: summarize(text(e.summary) || text(e.content)),
        imageUrl: null,
        publishedAt: toIso(e.published ?? e.updated),
      });
    }
    return items;
  }

  return [];
}
