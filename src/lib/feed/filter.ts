import type { Section } from "../../types/article.js";
import type { FeedArticle } from "./shape.js";

/**
 * One quick filter: a named chip (`FILTERS[section]`) or a free-text def built on the fly by
 * `resolveFilter` for an `f` that is not a known id. `synonyms` mixes plain strings (matched by
 * case-insensitive substring) with `RegExp`s (matched by `.test`, always authored with a `\b`
 * word boundary and the `i` flag) -- see `matchesFilter` and spec section 6.2.
 */
export interface FilterDef {
  id: string;
  label: string;
  synonyms: (string | RegExp)[];
}

/**
 * The five named filters per section, spec section 6.2. Order matches the decision table in
 * section 2 of the design doc -- the filter row renders chips in this order.
 *
 * A bare substring is a false-positive risk exactly where a short or common word can hide
 * inside an unrelated longer word (`"meta"` inside `"metadata"`, `"apple"` inside
 * `"pineapple"`, `"aws"` inside `"awsome"`, `"lambda"` inside `"lambdalabs"`, `"framer"` inside
 * a hypothetical longer word). Those synonyms are `RegExp`s with `\b` on both sides instead of
 * plain strings; every other synonym is a plain string because the plan doc does not flag it as
 * a boundary risk (`ios`, `ChatGPT`, `k8s` and friends are already distinctive enough as bare
 * substrings).
 *
 * `gcp` is not flagged as a boundary risk in the spec (there is no common English word that
 * contains "gcp"), but it gets the same `\b` treatment anyway as a low-cost precaution for a
 * three-letter acronym -- cheaper to guard than to reason about every future feed's vocabulary.
 * `"google cloud"` is a second, plain-string synonym for the same filter (spec 6.2), since it is
 * a multi-word phrase with no boundary ambiguity.
 *
 * `workers` (cloudflare) keeps a known, accepted false-positive risk from the spec: `\bworkers\b`
 * still matches ordinary English like "co-workers". The spec calls this out explicitly and
 * accepts it rather than trying to disambiguate "Cloudflare Workers" from the common noun.
 */
export const FILTERS: Record<Section, FilterDef[]> = {
  ai: [
    { id: "anthropic", label: "Anthropic", synonyms: ["anthropic", "claude"] },
    // "gpt-" keeps its hyphen on purpose: a bare "gpt" synonym would match inside unrelated
    // words such as "widgetgpt" or "snapgpt" (spec 6.2's own "egpt-class" note).
    { id: "openai", label: "OpenAI", synonyms: ["openai", "chatgpt", "gpt-"] },
    { id: "google", label: "Google", synonyms: ["google", "gemini", "deepmind"] },
    { id: "meta", label: "Meta", synonyms: [/\bmeta\b/i, "llama"] },
    { id: "qwen", label: "Qwen", synonyms: ["qwen", "alibaba"] },
  ],
  design: [
    { id: "figma", label: "Figma", synonyms: ["figma"] },
    { id: "adobe", label: "Adobe", synonyms: ["adobe", "photoshop", "illustrator"] },
    { id: "apple", label: "Apple", synonyms: [/\bapple\b/i, "ios", "human interface"] },
    { id: "google", label: "Google", synonyms: ["google", "material design", "android"] },
    { id: "framer", label: "Framer", synonyms: [/\bframer\b/i] },
  ],
  cloud: [
    {
      id: "aws",
      label: "AWS",
      synonyms: [/\baws\b/i, "amazon web services", "bedrock", /\blambda\b/i],
    },
    { id: "azure", label: "Azure", synonyms: ["azure", "microsoft"] },
    { id: "gcp", label: "GCP", synonyms: [/\bgcp\b/i, "google cloud"] },
    { id: "cloudflare", label: "Cloudflare", synonyms: ["cloudflare", /\bworkers\b/i] },
    { id: "kubernetes", label: "Kubernetes", synonyms: ["kubernetes", "k8s", "cncf"] },
  ],
};

/**
 * Every character a crafted `?f=` link could use to spoof or corrupt the rendered filter label,
 * not just ASCII control characters -- branch review M1. `\p{Cc}` is every Unicode "Control"
 * code point (C0, DEL, and the C1 range 0x80-0x9F, which includes U+0085 NEL -- the old
 * `/[\x00-\x1f\x7f]/` regex this replaces missed all of C1). `\p{Cf}` is every "Format" code
 * point: zero-width space (U+200B), the right-to-left/left-to-right marks and the RTL override
 * (U+200E/U+200F/U+202E -- a `?f=` carrying U+202E visually reverses the rest of the FILTER
 * sentence and the chip row), and the BOM (U+FEFF). Neither category covers U+2028 (LINE
 * SEPARATOR) or U+2029 (PARAGRAPH SEPARATOR) -- those are category Zl/Zp -- so they are listed
 * explicitly. The `u` flag is required for `\p{...}` property escapes to be recognised at all.
 */
const INVISIBLE_CHARS = /[\p{Cc}\p{Cf}\u2028\u2029]/gu;

/** Spec 6.2: the longest free-text filter the Others form will carry through the URL, counted
 *  in Unicode code points, not UTF-16 code units (branch review M2) -- see `sanitizeFilterParam`. */
const MAX_FILTER_PARAM_LENGTH = 40;

/**
 * Turns a raw `?f=` query value into a safe filter string, or `null` when there is nothing to
 * filter by. Order: strip invisible/control characters wherever they occur (not just at the
 * edges, so `"meta\x00data"` becomes `"metadata"`, not a string that merely starts and ends
 * clean), then trim ordinary whitespace, then cap at `MAX_FILTER_PARAM_LENGTH` **code points**.
 * An empty result after that pipeline -- the input was empty, all whitespace, or entirely
 * invisible characters -- returns `null` rather than a filter that would match everything or
 * nothing in some surprising way.
 *
 * The cap spreads the string (`[...s]`) rather than calling `.slice(0, 40)` directly: `.slice`
 * counts UTF-16 code units, so 39 ordinary characters plus one emoji (a surrogate pair, two
 * units) would keep the emoji's high surrogate and drop its low surrogate, leaving a lone
 * surrogate that serialises as U+FFFD (branch review M2, verified). Spreading a string iterates
 * by code point, so a trailing emoji is either kept whole or dropped whole, never split.
 *
 * `undefined` (no `f` param at all) also returns `null`. A caller does not need a separate
 * "was there a filter" check: `sanitizeFilterParam(raw) === null` is that check.
 */
export function sanitizeFilterParam(raw: string | undefined): string | null {
  if (typeof raw !== "string") return null;
  const stripped = raw.replace(INVISIBLE_CHARS, "").trim();
  const cleaned = [...stripped].slice(0, MAX_FILTER_PARAM_LENGTH).join("");
  return cleaned === "" ? null : cleaned;
}

/**
 * Resolves an `f` value to the `FilterDef` it should apply: a known chip's def when `f` matches
 * one of `FILTERS[section]`'s ids (case-insensitively -- a hand-typed `?f=ANTHROPIC` still hits
 * the named filter rather than becoming its own free-text entry), or a free-text def built from
 * `f` itself when it matches no known id. A free-text def's `label` is `f` verbatim (not
 * lowercased): it is what the Others chip echoes back to the reader, and the reader typed it in
 * whatever case they chose.
 *
 * Caller contract: `sanitizeFilterParam` runs BEFORE this function, on every call site in this
 * codebase (the three feed pages), and an `f` that sanitises to `null` never reaches
 * `resolveFilter`/`matchesFilter` at all -- that is what "no filter applied" means. In other
 * words, an empty string is not supposed to be able to reach here: `sanitizeFilterParam` already
 * turns "", whitespace-only, and invisible-characters-only input into `null` before a caller
 * ever calls this function.
 *
 * Branch review M3: the contract above was previously enforced only by convention, not by this
 * function itself, so a future call site that skips `sanitizeFilterParam` (or a refactor that
 * loosens it) would have silently produced `{ id: "", label: "", synonyms: [""] }` --
 * `matchesFilter`'s `.includes("")` is `true` for every string, so that def matches literally
 * every article, the opposite of what an empty filter should ever do. This function now enforces
 * its own side of the contract defensively: an empty or whitespace-only `f`, however it arrives,
 * returns a def with `synonyms: []` -- `matchesFilter`'s `.some(...)` over an empty array is
 * `false` for every article, so it matches nothing rather than everything.
 */
export function resolveFilter(section: Section, f: string): FilterDef {
  if (f.trim() === "") return { id: "", label: "", synonyms: [] };
  const known = FILTERS[section].find((filterDef) => filterDef.id === f.toLowerCase());
  if (known) return known;
  return { id: f, label: f, synonyms: [f] };
}

/**
 * True when `article` matches `def`: any of `def.synonyms` is found in
 * `` `${title} ${summary} ${sourceName}`.toLowerCase() ``. A string synonym is matched with
 * `.includes` after lowercasing itself too (so a free-text def's literal, unlowercased synonym
 * still matches case-insensitively); a `RegExp` synonym is matched with `.test` against the
 * already-lowercased haystack -- every `RegExp` in `FILTERS` carries the `i` flag regardless, so
 * this is belt-and-suspenders, not load-bearing.
 */
export function matchesFilter(article: FeedArticle, def: FilterDef): boolean {
  const haystack = `${article.title} ${article.summary} ${article.sourceName}`.toLowerCase();
  return def.synonyms.some((synonym) =>
    synonym instanceof RegExp ? synonym.test(haystack) : haystack.includes(synonym.toLowerCase()),
  );
}
