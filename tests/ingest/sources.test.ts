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
    url: "https://aws.amazon.com/blogs/aws/feed/", maxItems: undefined },
  { id: "azure", name: "Microsoft Azure Blog", category: "lab",
    url: "https://azure.microsoft.com/en-us/blog/feed/", maxItems: undefined },
  { id: "gcp", name: "Google Cloud Blog", category: "lab",
    url: "https://cloudblog.withgoogle.com/rss/", maxItems: undefined },
  // I5 ruling (branch review): cloudflare/hashicorp are vendor blogs one step removed from the
  // big-three platforms above, so they hold the news (0.7) weight, not lab (1.0).
  { id: "cloudflare", name: "Cloudflare Blog", category: "news",
    url: "https://blog.cloudflare.com/rss/", maxItems: undefined },
  { id: "cncf", name: "CNCF", category: "community",
    url: "https://www.cncf.io/feed/", maxItems: undefined },
  { id: "hashicorp", name: "HashiCorp Blog", category: "news",
    url: "https://www.hashicorp.com/blog/feed.xml", maxItems: undefined },
  // M6: capped at 30 (a high-volume feed) so cloud's aggregate day-one supply cannot alone
  // saturate RANK_INPUT_CAP.
  { id: "newstack", name: "The New Stack", category: "news",
    url: "https://thenewstack.io/feed/", maxItems: 30 },
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

  it("puts every RSS source on the cloud vertical, with the right id/name/category/url/kind/maxItems", () => {
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
      expect(s?.maxItems, `${expected.id} maxItems`).toBe(expected.maxItems);
    }
  });

  it("keeps aws-news, azure and gcp at the lab weight -- I5 ruling: primary platform sources for this vertical's owner", () => {
    for (const id of ["aws-news", "azure", "gcp"]) {
      const s = SOURCES.find((x) => x.id === id);
      expect(s?.category, `${id} must stay category "lab"`).toBe("lab");
    }
  });

  it("drops cloudflare and hashicorp to the news weight, not lab -- I5 ruling", () => {
    for (const id of ["cloudflare", "hashicorp"]) {
      const s = SOURCES.find((x) => x.id === id);
      expect(s?.category, `${id} must be category "news"`).toBe("news");
    }
  });

  it("keeps hn-cloud on the cloud vertical with the right shape, bounded per M6", () => {
    const s = SOURCES.find((x) => x.id === "hn-cloud");
    expect(s, "hn-cloud is missing from SOURCES").toBeDefined();
    expect(s?.name).toBe("Hacker News (cloud)");
    expect(s?.category).toBe("community");
    expect(s?.url).toBe("https://hn.algolia.com/api/v1/search_by_date?query=cloud&tags=story&numericFilters=points%3E20&hitsPerPage=25");
    expect(s?.kind).toBe("hn");
    expect(s?.section).toBe("cloud");
    expect(s?.maxItems).toBe(25);
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
