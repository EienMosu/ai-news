import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseHfPapers } from "../../src/lib/ingest/fetchers/hfPapers.js";

const hf = JSON.parse(readFileSync(new URL("../fixtures/hf-papers.json", import.meta.url), "utf8"));

describe("parseHfPapers", () => {
  it("extracts title and a paper link", () => {
    const items = parseHfPapers(hf);
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]!.link).toMatch(/^https:\/\/huggingface\.co\/papers\//);
  });

  it("returns an empty array for a malformed payload", () => {
    expect(parseHfPapers({})).toEqual([]);
    expect(parseHfPapers(null)).toEqual([]);
  });
});
