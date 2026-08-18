import { describe, expect, it } from "vitest";
import { buildCaptureUpdate, buildRankUpdate } from "../../src/lib/store/articles.js";
import type { NormalizedArticle } from "../../src/types/article.js";

const HASH = "a".repeat(64);

const article: NormalizedArticle = {
  urlHash: HASH,
  url: "https://example.com/post",
  title: "A title",
  summary: "A summary",
  imageUrl: "https://example.com/i.png",
  source: "techcrunch",
  sourceName: "TechCrunch",
  category: "news",
  section: "ai",
  publishedAt: "2026-08-18T09:00:00.000Z",
  publishedAtSource: "feed",
  points: 42,
};

const base = {
  article,
  ingestDay: "2026-08-18",
  score: 814,
  scoreVersion: "v1-degraded",
  pointsImputed: false,
  now: "2026-08-18T12:00:00.000Z",
};

/** Every attribute name is aliased, so read them back through the alias map. */
function attrs(cmd: { UpdateExpression?: string; ExpressionAttributeNames?: Record<string, string>; ExpressionAttributeValues?: Record<string, unknown> }) {
  const out: Record<string, { value: unknown; guarded: boolean }> = {};
  for (const [alias, name] of Object.entries(cmd.ExpressionAttributeNames ?? {})) {
    const m = new RegExp(`${alias} = (if_not_exists\\(${alias}, )?(:v\\d+)\\)?`).exec(cmd.UpdateExpression ?? "");
    if (m) out[name] = { value: cmd.ExpressionAttributeValues?.[m[2]!], guarded: Boolean(m[1]) };
  }
  return out;
}

describe("buildCaptureUpdate", () => {
  it("addresses the item by its deterministic key", () => {
    const cmd = buildCaptureUpdate("t", base);
    expect(cmd.TableName).toBe("t");
    expect(cmd.Key).toEqual({ pk: `ART#${HASH}`, sk: "A" });
  });

  it("guards the archive-pinning fields with if_not_exists", () => {
    const a = attrs(buildCaptureUpdate("t", base));
    for (const field of ["ingestDay", "firstSeenAt", "publishedAt", "hashVersion", "gsi1pk", "section"]) {
      expect(a[field], `${field} must be present`).toBeDefined();
      expect(a[field]!.guarded, `${field} must use if_not_exists`).toBe(true);
    }
  });

  it("writes section, pinned to the article's vertical at capture time", () => {
    // Mutation: dropping `b.setIfAbsent("section", a.section);` from buildCaptureUpdate makes
    // `a.section` undefined here -- red because the field is simply missing from the command.
    const a = attrs(buildCaptureUpdate("t", base));
    expect(a.section).toBeDefined();
    expect(a.section!.value).toBe("ai");
    // Pinned like the other archive-integrity fields, not refreshed like category: a source
    // moving between verticals must not retroactively move an already-archived article.
    expect(a.section!.guarded).toBe(true);
  });

  it("does NOT guard the fields that must stay fresh", () => {
    const a = attrs(buildCaptureUpdate("t", base));
    for (const field of ["title", "summary", "url", "points", "pointsImputed"]) {
      expect(a[field], `${field} must be present`).toBeDefined();
      expect(a[field]!.guarded, `${field} must be overwritten every run`).toBe(false);
    }
  });

  it("never reverts an already-ranked article's score back to the degraded one", () => {
    // Capture runs hourly and always scores in degraded mode. Overwriting score/gsi1sk would
    // move a ranked article back down the feed an hour after it was ranked.
    const a = attrs(buildCaptureUpdate("t", base));
    for (const field of ["score", "scoreVersion", "gsi1sk"]) {
      expect(a[field], `${field} must be present`).toBeDefined();
      expect(a[field]!.guarded, `${field} must use if_not_exists`).toBe(true);
    }
  });

  it("pins the day partition so a re-seen article never leaves its first day", () => {
    const a = attrs(buildCaptureUpdate("t", base));
    expect(a.gsi1pk!.value).toBe("DAY#2026-08-18");
    expect(a.gsi1pk!.guarded).toBe(true);
  });

  it("encodes the sort key zero-padded so lexicographic order is numeric order", () => {
    const a = attrs(buildCaptureUpdate("t", { ...base, score: 7 }));
    expect(a.gsi1sk!.value).toBe(`0007#${HASH}`);
  });

  it("omits null attributes entirely rather than writing null", () => {
    const cmd = buildCaptureUpdate("t", {
      ...base,
      article: { ...article, imageUrl: null, points: null },
    });
    const a = attrs(cmd);
    expect(a.imageUrl).toBeUndefined();
    expect(a.points).toBeUndefined();
    expect(JSON.stringify(cmd.ExpressionAttributeValues)).not.toContain("null");
  });

  it("stamps hashVersion so the key algorithm stays revisable", () => {
    expect(attrs(buildCaptureUpdate("t", base)).hashVersion!.value).toBe(1);
  });

  it("writes a falsy-but-real points value of 0, not the same as absent", () => {
    // hn.ts normalizes a non-finite points value to exactly 0. A `!value` check in the
    // builder would drop it as if it had never been supplied.
    const a = attrs(buildCaptureUpdate("t", { ...base, article: { ...article, points: 0 } }));
    expect(a.points).toBeDefined();
    expect(a.points!.value).toBe(0);
  });

  it("writes pointsImputed, including the falsy-but-real value false", () => {
    // pointsImputed is a boolean, so `false` is the common case (a source that does carry
    // engagement) and is exactly as real as `true`. The builder's null/undefined guard must
    // not be a falsy-value guard in disguise -- the same trap `points: 0` and `score: 0` cover
    // above, just for a boolean instead of a number.
    const withFalse = attrs(buildCaptureUpdate("t", { ...base, pointsImputed: false }));
    expect(withFalse.pointsImputed).toBeDefined();
    expect(withFalse.pointsImputed!.value).toBe(false);

    const withTrue = attrs(buildCaptureUpdate("t", { ...base, pointsImputed: true }));
    expect(withTrue.pointsImputed).toBeDefined();
    expect(withTrue.pointsImputed!.value).toBe(true);
  });

  it("writes an empty-string value rather than treating it as absent", () => {
    const a = attrs(buildCaptureUpdate("t", { ...base, article: { ...article, summary: "" } }));
    expect(a.summary).toBeDefined();
    expect(a.summary!.value).toBe("");
  });
});

describe("buildRankUpdate", () => {
  const rank = {
    urlHash: HASH,
    llmImportance: 88,
    whyItMatters: "Because.",
    clusterId: "c1",
    corroborationToday: 3,
    score: 912,
    scoreVersion: "v1",
  };

  it("refuses to create an item that capture never wrote", () => {
    const cmd = buildRankUpdate("t", rank);
    expect(cmd.ConditionExpression).toContain("attribute_exists");
  });

  it("moves the item within its day by rewriting only the sort key", () => {
    const a = attrs(buildRankUpdate("t", rank));
    expect(a.gsi1sk!.value).toBe(`0912#${HASH}`);
    expect(a.gsi1pk).toBeUndefined();   // the day partition is never touched by ranking
  });

  it("omits enrichment fields the model did not supply, leaving prior values intact", () => {
    const a = attrs(buildRankUpdate("t", { ...rank, llmImportance: null, whyItMatters: null }));
    expect(a.llmImportance).toBeUndefined();
    expect(a.whyItMatters).toBeUndefined();
    expect(a.score).toBeDefined();      // the score still updates
  });

  it("writes no sort key when there is no score, so enrichment cannot move the item", () => {
    // The enrichment pass runs before scoring. A gsi1sk built from a null score would move the
    // article to an arbitrary position in the day, visible to any reader in between.
    const a = attrs(buildRankUpdate("t", { ...rank, score: null, scoreVersion: null }));
    expect(a.gsi1sk).toBeUndefined();
    expect(a.llmImportance).toBeDefined();
  });

  it("writes a falsy-but-real score of 0, including its sort key", () => {
    // buildSortKey clamps to a floor of 0, so a genuine zero score exists. A `!value` check
    // would drop both `score` and `gsi1sk`, and the item would never appear in the feed.
    const a = attrs(buildRankUpdate("t", { ...rank, score: 0, scoreVersion: "v1" }));
    expect(a.score).toBeDefined();
    expect(a.score!.value).toBe(0);
    expect(a.gsi1sk).toBeDefined();
    expect(a.gsi1sk!.value).toBe(`0000#${HASH}`);
  });

  it("writes a falsy-but-real llmImportance of 0", () => {
    // reconcile clamps importance into 0-100 inclusive, so 0 is a legitimate model output.
    const a = attrs(buildRankUpdate("t", { ...rank, llmImportance: 0 }));
    expect(a.llmImportance).toBeDefined();
    expect(a.llmImportance!.value).toBe(0);
  });

  it("refuses to persist a NaN score rather than writing it silently", () => {
    // Reachable, not theoretical: computeScore falls back to Date.parse(ingestedAt) when
    // publishedAt is unparseable, and the rank handler passes the stored firstSeenAt as
    // ingestedAt. A corrupted stored timestamp makes that NaN all the way through to score.
    // buildSortKey clamps separately, so a silent drop here would leave gsi1sk written as
    // "0000#<hash>" while score itself vanished -- two attributes disagreeing about the same
    // number. Throwing here, where the attribute name is known, keeps the failure loud.
    expect(() => buildRankUpdate("t", { ...rank, score: NaN })).toThrow(/score/);
  });
});
