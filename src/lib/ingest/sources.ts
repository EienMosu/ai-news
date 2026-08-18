import type { Category, Section } from "../../types/article.js";

/** The three adapter shapes captureAll knows how to dispatch to. */
export type SourceKind = "rss" | "hn" | "hfPapers";

/** One entry in the registry: everything captureAll needs to fetch and label a source. */
export interface SourceDef {
  id: string;
  name: string;
  kind: SourceKind;
  category: Category;
  /**
   * The topic vertical this source belongs to. Required rather than defaulted to "ai": a
   * new source added without a section is a mistake worth catching at compile time, not a
   * silent "ai".
   */
  section: Section;
  url: string;
  /**
   * Cap on in-window items kept per run, applied after the recency filter,
   * newest-first. Defaults to 50 in captureAll — most feeds never need this,
   * but a source that ships its entire history (observed: OpenAI 1132 items
   * back to 2015, Hugging Face 843 back to 2020) must be tunable here without
   * touching the orchestrator.
   */
  maxItems?: number;
  /**
   * How this source's primary key is derived. Defaults to "url".
   *
   * "title" exists for exactly one reason: Google News wrapper links. Spec §3 records the
   * measurement — the wrapper cannot be resolved to a publisher URL server-side (Google
   * resolves it in client-side JavaScript), and the wrapper token is opaque, so hashing it
   * risks re-keying the same article onto a later day and duplicating it in the archive.
   * A title hash is deterministic; its failure mode (two posts sharing a title) collapses
   * to a dedup rather than a duplicate, which is the safe direction.
   *
   * Requires publisherSuffix handling — see below. Do not set one without the other.
   */
  hashStrategy?: "url" | "title";
  /**
   * This source's titles carry a trailing " - <Publisher>" label that must be stripped
   * before the title is stored or hashed, and whose removal can leave nothing behind.
   */
  publisherSuffix?: boolean;
}

/** Spec §3. arXiv cs.AI is deliberately absent — 268 items/day would drown the feed. */
export const SOURCES: SourceDef[] = [
  { id: "techcrunch", name: "TechCrunch", kind: "rss", category: "news", section: "ai",
    url: "https://techcrunch.com/category/artificial-intelligence/feed/" },
  { id: "verge", name: "The Verge", kind: "rss", category: "news", section: "ai",
    url: "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml" },
  { id: "arstechnica", name: "Ars Technica", kind: "rss", category: "news", section: "ai",
    url: "https://arstechnica.com/ai/feed/" },
  { id: "venturebeat", name: "VentureBeat", kind: "rss", category: "news", section: "ai",
    url: "https://venturebeat.com/category/ai/feed/" },
  { id: "mittr", name: "MIT Technology Review", kind: "rss", category: "news", section: "ai",
    url: "https://www.technologyreview.com/feed/" },
  { id: "openai", name: "OpenAI", kind: "rss", category: "lab", section: "ai",
    url: "https://openai.com/news/rss.xml" },
  { id: "deepmind", name: "Google DeepMind", kind: "rss", category: "lab", section: "ai",
    url: "https://deepmind.google/blog/rss.xml" },
  { id: "huggingface", name: "Hugging Face", kind: "rss", category: "lab", section: "ai",
    url: "https://huggingface.co/blog/feed.xml" },
  // Anthropic publishes no RSS feed; Google News is the only keyless route.
  { id: "anthropic", name: "Anthropic", kind: "rss", category: "lab", section: "ai",
    hashStrategy: "title", publisherSuffix: true,
    url: "https://news.google.com/rss/search?q=site:anthropic.com&hl=en-US&gl=US&ceid=US:en" },
  // Algolia's /search endpoint is relevance-sorted, not date-sorted, so its
  // results span 2023-2026 interleaved -- our recency window filtered the
  // whole feed. /search_by_date is static and date-sorted; points>20 keeps
  // quality up while our own window/cap do the recency work. Also: Algolia's
  // query param does not support boolean OR, so the old "AI OR LLM OR
  // OpenAI OR Anthropic" was always treated as a literal phrase.
  { id: "hn", name: "Hacker News", kind: "hn", category: "community", section: "ai",
    url: "https://hn.algolia.com/api/v1/search_by_date?query=AI&tags=story&numericFilters=points%3E20&hitsPerPage=50" },
  // Reddit's JSON endpoints 403 without OAuth; the .rss route needs no key.
  { id: "reddit-localllama", name: "r/LocalLLaMA", kind: "rss", category: "community", section: "ai",
    url: "https://www.reddit.com/r/LocalLLaMA/hot.rss" },
  { id: "reddit-ml", name: "r/MachineLearning", kind: "rss", category: "community", section: "ai",
    url: "https://www.reddit.com/r/MachineLearning/hot.rss" },
  { id: "hfpapers", name: "HF Daily Papers", kind: "hfPapers", category: "research", section: "ai",
    url: "https://huggingface.co/api/daily_papers?limit=20" },

  // Design vertical (Part 1). All eight probed live and confirmed parsing cleanly through the
  // existing parseFeed -- nothing in the ingest layer changes for these.
  //
  // No design source qualifies as `lab`: Figma, Google Design, Material, Airbnb, Adobe and
  // Spotify design blogs all 404 or return zero items. That absence is real, not an oversight
  // to "fix" by inventing one -- it is why the ranking cap is allocated per section rather than
  // by a single global sort (design's ceiling is the 0.7 `news` weight, never the 1.0 `lab`
  // weight an AI source can reach).
  { id: "smashing", name: "Smashing Magazine", kind: "rss", category: "news", section: "design",
    url: "https://www.smashingmagazine.com/feed/" },
  { id: "alistapart", name: "A List Apart", kind: "rss", category: "news", section: "design",
    // Uses <dc:date> instead of <pubDate>; parseFeed already handles it.
    url: "https://alistapart.com/main/feed/" },
  { id: "csstricks", name: "CSS-Tricks", kind: "rss", category: "news", section: "design",
    url: "https://css-tricks.com/feed/" },
  { id: "creativebloq", name: "Creative Bloq", kind: "rss", category: "news", section: "design",
    url: "https://www.creativebloq.com/feeds/all" },
  { id: "nngroup", name: "Nielsen Norman Group", kind: "rss", category: "research", section: "design",
    url: "https://www.nngroup.com/feed/rss/" },
  { id: "uxcollective", name: "UX Collective", kind: "rss", category: "community", section: "design",
    url: "https://uxdesign.cc/feed" },
  { id: "sidebar", name: "Sidebar", kind: "rss", category: "community", section: "design",
    url: "https://sidebar.io/feed.xml" },
  { id: "awwwards", name: "Awwwards", kind: "rss", category: "community", section: "design",
    url: "https://www.awwwards.com/blog/feed" },
];
