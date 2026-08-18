import type { Category } from "../../types/article.js";

/** The three adapter shapes captureAll knows how to dispatch to. */
export type SourceKind = "rss" | "hn" | "hfPapers";

/** One entry in the registry: everything captureAll needs to fetch and label a source. */
export interface SourceDef {
  id: string;
  name: string;
  kind: SourceKind;
  category: Category;
  url: string;
  /**
   * Cap on in-window items kept per run, applied after the recency filter,
   * newest-first. Defaults to 50 in captureAll — most feeds never need this,
   * but a source that ships its entire history (observed: OpenAI 1132 items
   * back to 2015, Hugging Face 843 back to 2020) must be tunable here without
   * touching the orchestrator.
   */
  maxItems?: number;
}

/** Spec §3. arXiv cs.AI is deliberately absent — 268 items/day would drown the feed. */
export const SOURCES: SourceDef[] = [
  { id: "techcrunch", name: "TechCrunch", kind: "rss", category: "news",
    url: "https://techcrunch.com/category/artificial-intelligence/feed/" },
  { id: "verge", name: "The Verge", kind: "rss", category: "news",
    url: "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml" },
  { id: "arstechnica", name: "Ars Technica", kind: "rss", category: "news",
    url: "https://arstechnica.com/ai/feed/" },
  { id: "venturebeat", name: "VentureBeat", kind: "rss", category: "news",
    url: "https://venturebeat.com/category/ai/feed/" },
  { id: "mittr", name: "MIT Technology Review", kind: "rss", category: "news",
    url: "https://www.technologyreview.com/feed/" },
  { id: "openai", name: "OpenAI", kind: "rss", category: "lab",
    url: "https://openai.com/news/rss.xml" },
  { id: "deepmind", name: "Google DeepMind", kind: "rss", category: "lab",
    url: "https://deepmind.google/blog/rss.xml" },
  { id: "huggingface", name: "Hugging Face", kind: "rss", category: "lab",
    url: "https://huggingface.co/blog/feed.xml" },
  // Anthropic publishes no RSS feed; Google News is the only keyless route.
  { id: "anthropic", name: "Anthropic", kind: "rss", category: "lab",
    url: "https://news.google.com/rss/search?q=site:anthropic.com&hl=en-US&gl=US&ceid=US:en" },
  // Algolia's /search endpoint is relevance-sorted, not date-sorted, so its
  // results span 2023-2026 interleaved -- our recency window filtered the
  // whole feed. /search_by_date is static and date-sorted; points>20 keeps
  // quality up while our own window/cap do the recency work. Also: Algolia's
  // query param does not support boolean OR, so the old "AI OR LLM OR
  // OpenAI OR Anthropic" was always treated as a literal phrase.
  { id: "hn", name: "Hacker News", kind: "hn", category: "community",
    url: "https://hn.algolia.com/api/v1/search_by_date?query=AI&tags=story&numericFilters=points%3E20&hitsPerPage=50" },
  // Reddit's JSON endpoints 403 without OAuth; the .rss route needs no key.
  { id: "reddit-localllama", name: "r/LocalLLaMA", kind: "rss", category: "community",
    url: "https://www.reddit.com/r/LocalLLaMA/hot.rss" },
  { id: "reddit-ml", name: "r/MachineLearning", kind: "rss", category: "community",
    url: "https://www.reddit.com/r/MachineLearning/hot.rss" },
  { id: "hfpapers", name: "HF Daily Papers", kind: "hfPapers", category: "research",
    url: "https://huggingface.co/api/daily_papers?limit=20" },
];
