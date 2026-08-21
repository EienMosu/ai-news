import { describe, expect, it } from "vitest";
import { SOURCES } from "../../src/lib/ingest/sources.js";

const DESIGN_SOURCES = [
  { id: "smashing", name: "Smashing Magazine", category: "news",
    url: "https://www.smashingmagazine.com/feed/" },
  { id: "alistapart", name: "A List Apart", category: "news",
    url: "https://alistapart.com/main/feed/" },
  { id: "csstricks", name: "CSS-Tricks", category: "news",
    url: "https://css-tricks.com/feed/" },
  { id: "creativebloq", name: "Creative Bloq", category: "news",
    url: "https://www.creativebloq.com/feeds/all" },
  { id: "nngroup", name: "Nielsen Norman Group", category: "research",
    url: "https://www.nngroup.com/feed/rss/" },
  { id: "uxcollective", name: "UX Collective", category: "community",
    url: "https://uxdesign.cc/feed" },
  { id: "sidebar", name: "Sidebar", category: "community",
    url: "https://sidebar.io/feed.xml" },
  { id: "awwwards", name: "Awwwards", category: "community",
    url: "https://www.awwwards.com/blog/feed" },
] as const;
const CLOUD_SOURCES = [
  { id: "aws-news", name: "AWS News Blog", category: "lab",
    url: "https://aws.amazon.com/blogs/aws/feed/" },
  { id: "azure", name: "Microsoft Azure Blog", category: "lab",
    url: "https://azure.microsoft.com/en-us/blog/feed/" },
  { id: "gcp", name: "Google Cloud Blog", category: "lab",
    url: "https://cloudblog.withgoogle.com/rss/" },
  { id: "cloudflare", name: "Cloudflare Blog", category: "lab",
    url: "https://blog.cloudflare.com/rss/" },
  { id: "cncf", name: "CNCF", category: "community",
    url: "https://www.cncf.io/feed/" },
  { id: "hashicorp", name: "HashiCorp Blog", category: "lab",
    url: "https://www.hashicorp.com/blog/feed.xml" },
  { id: "newstack", name: "The New Stack", category: "news",
    url: "https://thenewstack.io/feed/" },
] as const;
const AI_IDS = [
  "techcrunch", "verge", "arstechnica", "venturebeat", "mittr", "openai", "deepmind",
  "huggingface", "anthropic", "hn", "reddit-localllama", "reddit-ml", "hfpapers",
];

describe("section", () => {
  it("has exactly the 13 original AI sources plus the 8 design sources plus the 8 cloud sources", () => {
    // Mutation: deleting any one source entry from SOURCES drops this to 28.
    expect(SOURCES).toHaveLength(29);
  });

  it("keeps every original source on the ai vertical", () => {
    // Mutation: changing any single original entry's `section: "ai"` to `"design"` (or
    // omitting it, once the compiler is out of the way) makes this fail on that one id --
    // red per-source, not just in aggregate.
    for (const id of AI_IDS) {
      const s = SOURCES.find((x) => x.id === id);
      expect(s?.section, `${id} must be section "ai"`).toBe("ai");
    }
    expect(SOURCES.filter((s) => s.section === "ai")).toHaveLength(13);
  });

  it("puts every new source on the design vertical, with the right id/name/category/url/kind", () => {
    // Mutation: changing any one field of any one entry above (e.g. csstricks's url, or
    // nngroup's category from "research" to "news") makes this fail on that field.
    for (const expected of DESIGN_SOURCES) {
      const s = SOURCES.find((x) => x.id === expected.id);
      expect(s, `${expected.id} is missing from SOURCES`).toBeDefined();
      expect(s?.name).toBe(expected.name);
      expect(s?.category).toBe(expected.category);
      expect(s?.url).toBe(expected.url);
      expect(s?.kind).toBe("rss");
      expect(s?.section).toBe("design");
    }
    expect(SOURCES.filter((s) => s.section === "design")).toHaveLength(8);
  });

  it("gives no design source the lab category", () => {
    // Spec: no design source qualifies as lab (Figma, Google Design, Material, Airbnb, Adobe,
    // Spotify all 404 or return zero items). Mutation: changing any one design entry's
    // category to "lab" makes this fail.
    for (const s of SOURCES.filter((s) => s.section === "design")) {
      expect(s.category, `${s.id} must not be category "lab"`).not.toBe("lab");
    }
  });

  it("puts every RSS source on the cloud vertical, with the right id/name/category/url/kind", () => {
    // Mutation: changing any one field of any one entry above (e.g. aws-news's url, or
    // cncf's category from "community" to "lab") makes this fail on that field.
    for (const expected of CLOUD_SOURCES) {
      const s = SOURCES.find((x) => x.id === expected.id);
      expect(s, `${expected.id} is missing from SOURCES`).toBeDefined();
      expect(s?.name).toBe(expected.name);
      expect(s?.category).toBe(expected.category);
      expect(s?.url).toBe(expected.url);
      expect(s?.kind).toBe("rss");
      expect(s?.section).toBe("cloud");
    }
  });

  it("keeps hn-cloud on the cloud vertical with the right shape", () => {
    const s = SOURCES.find((x) => x.id === "hn-cloud");
    expect(s, "hn-cloud is missing from SOURCES").toBeDefined();
    expect(s?.name).toBe("Hacker News (cloud)");
    expect(s?.category).toBe("community");
    expect(s?.url).toBe("https://hn.algolia.com/api/v1/search_by_date?query=cloud&tags=story&numericFilters=points%3E20&hitsPerPage=50");
    expect(s?.kind).toBe("hn");
    expect(s?.section).toBe("cloud");
    expect(SOURCES.filter((s) => s.section === "cloud")).toHaveLength(8);
  });
});

describe("hashStrategy", () => {
  it("uses the title strategy for the Google News wrapped source", () => {
    const anthropic = SOURCES.find((s) => s.id === "anthropic");
    expect(anthropic?.hashStrategy).toBe("title");
    expect(anthropic?.publisherSuffix).toBe(true);
  });

  it("leaves every directly-fetched source on the url strategy", () => {
    for (const s of SOURCES.filter((s) => s.id !== "anthropic")) {
      expect(s.hashStrategy ?? "url").toBe("url");
      expect(s.publisherSuffix ?? false).toBe(false);
    }
  });
});
