import { describe, expect, it } from "vitest";
import {
  FILTERS,
  matchesFilter,
  resolveFilter,
  sanitizeFilterParam,
} from "../../src/lib/feed/filter.js";
import type { FeedArticle } from "../../src/lib/feed/shape.js";
import type { Section } from "../../src/types/article.js";

/** A minimal, fully-typed FeedArticle -- only title/summary/sourceName vary per test, since
 *  those three fields are the only ones `matchesFilter` reads. */
const article = (over: Partial<FeedArticle> = {}): FeedArticle => ({
  urlHash: "a".repeat(64),
  url: "https://example.com/p",
  title: "",
  summary: "",
  imageUrl: null,
  source: "example",
  sourceName: "",
  category: null,
  section: null,
  publishedAt: null,
  clusterId: null,
  corroborationToday: null,
  whyItMatters: null,
  score: 0,
  scoreVersion: "v1",
  points: null,
  pointsImputed: false,
  llmImportance: null,
  firstSeenAt: "2026-08-18T10:00:00.000Z",
  ...over,
});

/** Looks up a named filter def by id within a section's table -- throws (via the `!`-free
 *  bang below turned into a real assertion) if the id is missing, so a typo in a test's own
 *  setup fails loudly instead of silently comparing against `undefined`. */
function def(section: Section, id: string) {
  const found = FILTERS[section].find((d) => d.id === id);
  if (!found) throw new Error(`no filter def "${id}" in section "${section}"`);
  return found;
}

describe("FILTERS table shape", () => {
  it("has exactly the five named filters per section, in spec order", () => {
    expect(FILTERS.ai.map((d) => d.id)).toEqual(["anthropic", "openai", "google", "meta", "qwen"]);
    expect(FILTERS.design.map((d) => d.id)).toEqual(["figma", "adobe", "apple", "google", "framer"]);
    expect(FILTERS.cloud.map((d) => d.id)).toEqual(["aws", "azure", "gcp", "cloudflare", "kubernetes"]);
  });
});

describe("matchesFilter -- ai section", () => {
  it("anthropic matches its own name and claude", () => {
    const d = def("ai", "anthropic");
    expect(matchesFilter(article({ title: "Anthropic ships a new model" }), d)).toBe(true);
    expect(matchesFilter(article({ summary: "Claude gets a memory upgrade" }), d)).toBe(true);
    expect(matchesFilter(article({ title: "Unrelated story" }), d)).toBe(false);
  });

  it("openai matches openai, chatgpt, and the hyphenated gpt- token", () => {
    const d = def("ai", "openai");
    expect(matchesFilter(article({ title: "OpenAI announces update" }), d)).toBe(true);
    expect(matchesFilter(article({ title: "ChatGPT gets voice mode" }), d)).toBe(true);
    expect(matchesFilter(article({ title: "OpenAI ships gpt-5 today" }), d)).toBe(true);
  });

  it("openai does not match a bare 'gpt' with no hyphen (egpt-class false positive avoided)", () => {
    // The spec keeps the hyphen on purpose: a bare "gpt" synonym would match inside unrelated
    // words like "widgetgpt" or "snapgpt". Only "gpt-" is a synonym, not "gpt".
    const d = def("ai", "openai");
    expect(matchesFilter(article({ title: "snapgpt tool released", sourceName: "SnapGPT" }), d)).toBe(false);
  });

  it("google (ai) matches google, gemini, deepmind", () => {
    const d = def("ai", "google");
    expect(matchesFilter(article({ title: "Google releases update" }), d)).toBe(true);
    expect(matchesFilter(article({ title: "Gemini 3 launches" }), d)).toBe(true);
    expect(matchesFilter(article({ title: "DeepMind publishes a paper" }), d)).toBe(true);
  });

  it("meta matches the word 'meta' and 'llama', not 'metadata'", () => {
    const d = def("ai", "meta");
    expect(matchesFilter(article({ title: "Meta releases Llama 4" }), d)).toBe(true);
    expect(matchesFilter(article({ summary: "Llama weights are open" }), d)).toBe(true);
    expect(matchesFilter(article({ title: "Fixing metadata handling in the pipeline" }), d)).toBe(false);
  });

  it("qwen matches qwen and alibaba", () => {
    const d = def("ai", "qwen");
    expect(matchesFilter(article({ title: "Qwen3 released" }), d)).toBe(true);
    expect(matchesFilter(article({ title: "Alibaba open-sources a model" }), d)).toBe(true);
  });
});

describe("matchesFilter -- design section", () => {
  it("figma matches figma", () => {
    const d = def("design", "figma");
    expect(matchesFilter(article({ title: "Figma ships new prototyping tools" }), d)).toBe(true);
    expect(matchesFilter(article({ title: "Unrelated design story" }), d)).toBe(false);
  });

  it("adobe matches adobe, photoshop, illustrator", () => {
    const d = def("design", "adobe");
    expect(matchesFilter(article({ title: "Adobe updates its suite" }), d)).toBe(true);
    expect(matchesFilter(article({ title: "Photoshop gets a new fill tool" }), d)).toBe(true);
    expect(matchesFilter(article({ title: "Illustrator adds vector AI fill" }), d)).toBe(true);
  });

  it("apple matches the word 'apple', ios, human interface -- not 'pineapple'", () => {
    const d = def("design", "apple");
    expect(matchesFilter(article({ title: "Apple updates its design language" }), d)).toBe(true);
    expect(matchesFilter(article({ title: "iOS 20 ships a new icon grid" }), d)).toBe(true);
    expect(matchesFilter(article({ summary: "The human interface guidelines were updated" }), d)).toBe(true);
    expect(matchesFilter(article({ title: "A pineapple farming co-op redesigns its logo" }), d)).toBe(false);
  });

  it("google (design) matches google, material design, android", () => {
    const d = def("design", "google");
    expect(matchesFilter(article({ title: "Google updates its icons" }), d)).toBe(true);
    expect(matchesFilter(article({ title: "Material Design 4 announced" }), d)).toBe(true);
    expect(matchesFilter(article({ title: "Android gets a new widget system" }), d)).toBe(true);
  });

  it("framer matches the word 'framer', not 'framework'", () => {
    const d = def("design", "framer");
    expect(matchesFilter(article({ title: "Framer ships a new site builder" }), d)).toBe(true);
    expect(matchesFilter(article({ title: "A new testing framework was released" }), d)).toBe(false);
  });
});

describe("matchesFilter -- cloud section", () => {
  it("aws matches the word 'aws', amazon web services, bedrock, and the word 'lambda'", () => {
    const d = def("cloud", "aws");
    expect(matchesFilter(article({ title: "AWS launches a new region" }), d)).toBe(true);
    expect(matchesFilter(article({ title: "Amazon Web Services adds a feature" }), d)).toBe(true);
    expect(matchesFilter(article({ title: "Bedrock gets a new model" }), d)).toBe(true);
    expect(matchesFilter(article({ title: "AWS Lambda adds SnapStart for Python" }), d)).toBe(true);
  });

  it("aws does not match 'awsome' or 'lambdalabs' (word-boundary guards)", () => {
    const d = def("cloud", "aws");
    expect(matchesFilter(article({ title: "This awsome new gadget ships today" }), d)).toBe(false);
    expect(matchesFilter(article({ title: "Lambdalabs releases a new GPU instance" }), d)).toBe(false);
  });

  it("azure matches azure, microsoft", () => {
    const d = def("cloud", "azure");
    expect(matchesFilter(article({ title: "Azure adds a new VM family" }), d)).toBe(true);
    expect(matchesFilter(article({ title: "Microsoft updates its cloud pricing" }), d)).toBe(true);
  });

  it("gcp matches gcp and the phrase google cloud", () => {
    const d = def("cloud", "gcp");
    expect(matchesFilter(article({ title: "GCP launches a new zone" }), d)).toBe(true);
    expect(matchesFilter(article({ title: "Google Cloud adds a new SKU" }), d)).toBe(true);
  });

  it("cloudflare matches cloudflare and the word 'workers'", () => {
    const d = def("cloud", "cloudflare");
    expect(matchesFilter(article({ title: "Cloudflare ships a new edge feature" }), d)).toBe(true);
    expect(matchesFilter(article({ title: "Workers gets a new runtime API" }), d)).toBe(true);
  });

  it("kubernetes matches kubernetes, k8s, cncf", () => {
    const d = def("cloud", "kubernetes");
    expect(matchesFilter(article({ title: "Kubernetes 2.0 released" }), d)).toBe(true);
    expect(matchesFilter(article({ title: "K8s adds a new scheduler feature" }), d)).toBe(true);
    expect(matchesFilter(article({ title: "CNCF welcomes a new project" }), d)).toBe(true);
  });
});

describe("matchesFilter -- case-insensitivity", () => {
  it("matches regardless of the haystack's casing", () => {
    const d = def("ai", "anthropic");
    expect(matchesFilter(article({ title: "ANTHROPIC SHIPS A MODEL" }), d)).toBe(true);
    expect(matchesFilter(article({ title: "aNtHrOpIc ships a model" }), d)).toBe(true);
  });

  it("matches regardless of the sourceName's casing", () => {
    const d = def("cloud", "aws");
    expect(matchesFilter(article({ sourceName: "AWS News Blog" }), d)).toBe(true);
  });
});

describe("matchesFilter -- free text", () => {
  it("matches its own literal text, case-insensitively, against title/summary/sourceName", () => {
    const freeText = resolveFilter("ai", "nvidia");
    expect(matchesFilter(article({ title: "Nvidia unveils a new chip" }), freeText)).toBe(true);
    expect(matchesFilter(article({ summary: "an NVIDIA partnership" }), freeText)).toBe(true);
    expect(matchesFilter(article({ sourceName: "nvidia blog" }), freeText)).toBe(true);
    expect(matchesFilter(article({ title: "Unrelated story" }), freeText)).toBe(false);
  });
});

describe("resolveFilter", () => {
  it("returns the known FilterDef for a known id", () => {
    expect(resolveFilter("ai", "anthropic")).toBe(def("ai", "anthropic"));
    expect(resolveFilter("cloud", "aws")).toBe(def("cloud", "aws"));
  });

  it("looks up known ids case-insensitively", () => {
    expect(resolveFilter("ai", "ANTHROPIC")).toBe(def("ai", "anthropic"));
    expect(resolveFilter("design", "Figma")).toBe(def("design", "figma"));
  });

  it("falls back to a free-text def whose label is the input, for an unknown id", () => {
    expect(resolveFilter("ai", "nvidia")).toEqual({
      id: "nvidia",
      label: "nvidia",
      synonyms: ["nvidia"],
    });
  });

  it("keeps a section's filters independent -- an id known in one section is free text in another", () => {
    // "figma" is a known id in design, not in ai.
    expect(resolveFilter("ai", "figma")).toEqual({
      id: "figma",
      label: "figma",
      synonyms: ["figma"],
    });
  });
});

describe("sanitizeFilterParam", () => {
  it("returns null for undefined", () => {
    expect(sanitizeFilterParam(undefined)).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(sanitizeFilterParam("")).toBeNull();
  });

  it("returns null when the input is only whitespace", () => {
    expect(sanitizeFilterParam("    ")).toBeNull();
  });

  it("trims surrounding whitespace", () => {
    expect(sanitizeFilterParam("  anthropic  ")).toBe("anthropic");
  });

  it("strips control characters wherever they appear, not just at the edges", () => {
    expect(sanitizeFilterParam("meta\x00data")).toBe("metadata");
    expect(sanitizeFilterParam("a\tb\nc")).toBe("abc");
  });

  it("returns null when the input is nothing but control characters", () => {
    expect(sanitizeFilterParam("\x00\x01\x1f\x7f")).toBeNull();
  });

  it("caps at 40 characters", () => {
    const raw = "a".repeat(50);
    const result = sanitizeFilterParam(raw);
    expect(result).toBe("a".repeat(40));
    expect(result?.length).toBe(40);
  });

  it("leaves a short, clean value unchanged", () => {
    expect(sanitizeFilterParam("nvidia")).toBe("nvidia");
  });
});
