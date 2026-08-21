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
  { id: "hn-local", name: "Hacker News (local models)", kind: "hn", category: "community", section: "ai",
    // Replaces reddit-localllama (2026-08-21): same Reddit datacenter block. The local-model
    // community signal via the HN firehose instead; dedupe keys on urlHash, so overlap with the
    // main hn query stores once under whichever captured first.
    maxItems: 25,
    url: "https://hn.algolia.com/api/v1/search_by_date?query=llama&tags=story&numericFilters=points%3E20&hitsPerPage=25" },
  { id: "simonwillison", name: "Simon Willison", kind: "rss", category: "community", section: "ai",
    // Replaces reddit-ml (2026-08-21): Reddit 403s datacenter IPs, zero items ever landed from
    // the Lambda. Same community seat, a feed that answers from AWS.
    maxItems: 15,
    url: "https://simonwillison.net/atom/everything/" },
  { id: "meta-ai", name: "Meta AI (Engineering)", kind: "rss", category: "lab", section: "ai",
    maxItems: 15,
    url: "https://engineering.fb.com/category/ai-research/feed/" },
  { id: "qwen", name: "Qwen", kind: "rss", category: "lab", section: "ai",
    maxItems: 10,
    url: "https://qwenlm.github.io/blog/index.xml" },
  { id: "mistral", name: "Mistral AI", kind: "rss", category: "lab", section: "ai",
    maxItems: 10,
    url: "https://mistral.ai/rss.xml" },
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
  { id: "apple-newsroom", name: "Apple Newsroom", kind: "rss", category: "news", section: "design",
    maxItems: 15,
    url: "https://www.apple.com/newsroom/rss-feed.rss" },
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

  // Cloud vertical. All eight probed live and confirmed parsing cleanly through the
  // existing parseFeed -- nothing in the ingest layer changes for these.
  //
  // aws-news/azure/gcp keep the 1.0 lab weight (branch review, I5 ruling): the big-three
  // platform announcements are this vertical's primary sources for its owner, an AWS solutions
  // architect, and the LLM importance weight still separates marketing from substance within
  // that weight class. cloudflare and hashicorp drop to news (0.7) instead -- vendor blogs one
  // step removed from that primary-platform role, the same distinction design's own sources
  // draw above.
  { id: "aws-news", name: "AWS News Blog", kind: "rss", category: "lab", section: "cloud",
    url: "https://aws.amazon.com/blogs/aws/feed/" },
  { id: "azure", name: "Microsoft Azure Blog", kind: "rss", category: "lab", section: "cloud",
    url: "https://azure.microsoft.com/en-us/blog/feed/" },
  { id: "gcp", name: "Google Cloud Blog", kind: "rss", category: "lab", section: "cloud",
    url: "https://cloudblog.withgoogle.com/rss/" },
  { id: "cloudflare", name: "Cloudflare Blog", kind: "rss", category: "news", section: "cloud",
    url: "https://blog.cloudflare.com/rss/" },
  { id: "cncf", name: "CNCF", kind: "rss", category: "community", section: "cloud",
    url: "https://www.cncf.io/feed/" },
  { id: "hashicorp", name: "HashiCorp Blog", kind: "rss", category: "news", section: "cloud",
    url: "https://www.hashicorp.com/blog/feed.xml" },
  // maxItems: 30 (branch review, M6) -- a high-volume feed; capped so 8 cloud sources cannot
  // alone push a day's aggregate supply toward saturating RANK_INPUT_CAP (model.ts) and the
  // cost ceiling it bounds.
  { id: "newstack", name: "The New Stack", kind: "rss", category: "news", section: "cloud",
    maxItems: 30,
    url: "https://thenewstack.io/feed/" },
  // Dedupe is keyed on urlHash (capture.ts), and `hn` (query=AI, section "ai") sits earlier in
  // this registry than `hn-cloud` -- so a story matching both queries is captured by `hn` first
  // and stored as section "ai"; the cloud copy is silently dropped (branch review, I3). Accepted:
  // first-capture wins, and this is a real overlap in practice ("AI inference on AWS", "GPU
  // capacity at Azure"). hitsPerPage and maxItems both trimmed to 25 (from the ai `hn` source's
  // 50/unset) to bound cloud's day-one supply -- see the cap-saturation note on RANK_INPUT_CAP.
  { id: "hn-cloud", name: "Hacker News (cloud)", kind: "hn", category: "community", section: "cloud",
    maxItems: 25,
    url: "https://hn.algolia.com/api/v1/search_by_date?query=cloud&tags=story&numericFilters=points%3E20&hitsPerPage=25" },
];
