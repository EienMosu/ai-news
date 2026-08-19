// @vitest-environment jsdom
//
// Opt-in per file -- see the docblock in tests/feed/card.test.tsx for why: this file needs a
// DOM and explicit `afterEach(cleanup)` because `test.globals` is false project-wide.
//
// Mocks `src/lib/feed/read.js` (the module, not the AWS SDK underneath it -- read.test.ts
// already covers that layer), the same pattern tests/feed/pages.test.tsx uses for the two feed
// routes: `await` the page component directly and assert on what it does with the data,
// without a DynamoDB mock.
import { cleanup, render, screen } from "@testing-library/react";
import { isHTTPAccessFallbackError } from "next/dist/client/components/http-access-fallback/http-access-fallback.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/lib/feed/read.js", () => ({
  getArticle: vi.fn(),
  getDay: vi.fn(),
}));

import ArticlePage from "../../app/article/[urlHash]/page.js";
import { getArticle, getDay } from "../../src/lib/feed/read.js";
import { toArticleDetail, toFeedArticle } from "../../src/lib/feed/shape.js";

afterEach(() => {
  cleanup();
  vi.mocked(getArticle).mockReset();
  vi.mocked(getDay).mockReset();
});

const HASH = "a".repeat(64);
const SIBLING_HASH = "b".repeat(64);

const rawItem = (over: Record<string, unknown> = {}) => ({
  pk: `ART#${HASH}`,
  sk: "A",
  title: "GPT-6 ships",
  summary: "A plain summary.",
  imageUrl: null,
  url: "https://example.com/original-story",
  source: "techcrunch",
  sourceName: "TechCrunch",
  category: "news",
  section: "ai",
  publishedAt: "2026-08-18T09:00:00.000Z",
  clusterId: null,
  corroborationToday: null,
  whyItMatters: null,
  score: 500,
  scoreVersion: "v1",
  points: null,
  pointsImputed: true,
  llmImportance: null,
  firstSeenAt: "2026-08-18T10:00:00.000Z",
  ingestDay: "2026-08-18",
  publishedAtSource: "feed",
  ...over,
});

const detail = (over: Record<string, unknown> = {}) => toArticleDetail(rawItem(over));

const EMPTY_DAY_RESULT = {
  articles: [],
  day: "2026-08-18",
  status: "complete" as const,
  llmRankedInDay: 5,
  truncatedInDay: 0,
};

const params = (urlHash: string) => Promise.resolve({ urlHash });

// `getDay` defaults to resolving with an empty day rather than being left to resolve
// `undefined` (vi.fn()'s default). Most of the tests below don't care what `getDay` returns --
// they only exist to pin unrelated behaviour (SectionNav, the original-source link, the
// published-date note, whyItMatters, the ScoreSignals wiring) on fixtures that happen to set
// `ingestDay: null`, which means the page is not supposed to call `getDay` for them at all.
// Without this default, a bug that makes the page call `getDay` unconditionally (see the
// "does not call getDay" test below) crashes every one of those unrelated tests with a
// generic TypeError instead of leaving them green and failing only the one test that actually
// asserts on `getDay`'s call count -- collateral damage that would make a single mutation look
// like it broke many independent tests, when only one of them is actually testing that claim.
beforeEach(() => {
  vi.mocked(getDay).mockResolvedValue(EMPTY_DAY_RESULT);
});

describe("ArticlePage (app/article/[urlHash]/page.tsx)", () => {
  it("reads urlHash from the awaited params (a Promise, not a plain object) and passes it to getArticle", async () => {
    // A dedicated test for the Next 15+ trap the brief singles out as this file's main hazard
    // -- fix round 1, finding F7: previously this was pinned only by a trailing assertion
    // inside the 404 test below, which a future edit could delete without anyone noticing the
    // trap had gone unpinned. This test's only job is that one assertion, on the happy path
    // (a found article), independent of the 404 behaviour.
    vi.mocked(getArticle).mockResolvedValue(detail({ ingestDay: null }));

    await ArticlePage({ params: params(HASH) });

    expect(getArticle).toHaveBeenCalledWith(HASH);
  });

  it("triggers a real 404 (notFound), not merely any thrown error, when the article does not exist", async () => {
    // A bare `.rejects.toThrow()` is satisfied by any thrown error -- including a plain
    // TypeError from reading a property off `null` a few lines further down, which is exactly
    // what happens if the `notFound()` call is ever removed while the rest of the function is
    // left reading `article.*` unguarded. Checking `isHTTPAccessFallbackError` (Next's own
    // predicate for `notFound()`'s specific thrown shape) is what actually pins this to a real
    // 404 rather than to "the function rejected for some reason".
    vi.mocked(getArticle).mockResolvedValue(null);

    let caught: unknown;
    try {
      await ArticlePage({ params: params(HASH) });
    } catch (err) {
      caught = err;
    }

    expect(isHTTPAccessFallbackError(caught)).toBe(true);
  });

  it("does not call getDay when the article is missing", async () => {
    vi.mocked(getArticle).mockResolvedValue(null);

    await expect(ArticlePage({ params: params(HASH) })).rejects.toThrow();
    expect(getDay).not.toHaveBeenCalled();
  });

  describe("cluster siblings", () => {
    it("renders no siblings and does not call getDay when ingestDay is null", async () => {
      vi.mocked(getArticle).mockResolvedValue(
        detail({ ingestDay: null, clusterId: "2026-08-18#gpt6", corroborationToday: 3 }),
      );

      render(await ArticlePage({ params: params(HASH) }));

      expect(screen.queryByTestId("siblings")).toBeNull();
      expect(getDay).not.toHaveBeenCalled();
    });

    it("does not call getDay when clusterId is null, even though ingestDay is set", async () => {
      // Fix round 1, finding F4: a day partition is ~650 items, and querying it only to have
      // clusterSiblings immediately discard the result (via isRealCluster) is a wasted read on
      // every unclustered article's page view. The guard must run BEFORE the read, using
      // clusterId -- already in hand from getArticle's own GetItem -- not after it.
      vi.mocked(getArticle).mockResolvedValue(
        detail({ ingestDay: "2026-08-18", clusterId: null }),
      );

      render(await ArticlePage({ params: params(HASH) }));

      expect(screen.queryByTestId("siblings")).toBeNull();
      expect(getDay).not.toHaveBeenCalled();
    });

    it("does not call getDay when clusterId is a __self__ placeholder", async () => {
      vi.mocked(getArticle).mockResolvedValue(
        detail({ ingestDay: "2026-08-18", clusterId: `__self__:${HASH}` }),
      );

      render(await ArticlePage({ params: params(HASH) }));

      expect(screen.queryByTestId("siblings")).toBeNull();
      expect(getDay).not.toHaveBeenCalled();
    });

    it("reads the article's own ingestDay to find its siblings, not a computed date", async () => {
      vi.mocked(getArticle).mockResolvedValue(
        detail({ ingestDay: "2026-08-18", clusterId: "2026-08-18#gpt6", corroborationToday: 2 }),
      );

      render(await ArticlePage({ params: params(HASH) }));

      expect(getDay).toHaveBeenCalledWith("2026-08-18");
    });

    it("renders siblings from the same cluster, each linking to its own story page, labelled by source name", async () => {
      // §7's worked example is source names ("also covered by The Verge, Ars Technica"), not
      // sibling headlines -- fix round 1, finding F5.
      vi.mocked(getArticle).mockResolvedValue(
        detail({ ingestDay: "2026-08-18", clusterId: "2026-08-18#gpt6", corroborationToday: 2 }),
      );
      vi.mocked(getDay).mockResolvedValue({
        ...EMPTY_DAY_RESULT,
        articles: [
          toFeedArticle(
            rawItem({
              pk: `ART#${SIBLING_HASH}`,
              title: "A rival's take on the same launch",
              sourceName: "The Verge",
              clusterId: "2026-08-18#gpt6",
            }),
          ),
          // The subject itself comes back in the day's list too (a separate fetch, same
          // story) -- it must never appear in its own sibling list.
          toFeedArticle(rawItem({ pk: `ART#${HASH}`, clusterId: "2026-08-18#gpt6" })),
        ],
      });

      render(await ArticlePage({ params: params(HASH) }));

      const siblingLink = screen.getByRole("link", { name: "The Verge" });
      expect(siblingLink.getAttribute("href")).toBe(`/article/${SIBLING_HASH}`);
      expect(screen.queryByRole("link", { name: "TechCrunch" })).toBeNull();
    });

    it("falls back to the sibling's title when its sourceName is the empty string", async () => {
      vi.mocked(getArticle).mockResolvedValue(
        detail({ ingestDay: "2026-08-18", clusterId: "2026-08-18#gpt6", corroborationToday: 2 }),
      );
      vi.mocked(getDay).mockResolvedValue({
        ...EMPTY_DAY_RESULT,
        articles: [
          toFeedArticle(
            rawItem({
              pk: `ART#${SIBLING_HASH}`,
              title: "A degraded sibling with no source name",
              sourceName: "",
              clusterId: "2026-08-18#gpt6",
            }),
          ),
        ],
      });

      render(await ArticlePage({ params: params(HASH) }));

      expect(
        screen.getByRole("link", { name: "A degraded sibling with no source name" }),
      ).toBeTruthy();
    });
  });

  it("renders SectionNav with neither vertical current", async () => {
    vi.mocked(getArticle).mockResolvedValue(detail({ ingestDay: null }));

    render(await ArticlePage({ params: params(HASH) }));

    expect(screen.getByRole("link", { name: "AI" }).getAttribute("aria-current")).toBeNull();
    expect(screen.getByRole("link", { name: "Design" }).getAttribute("aria-current")).toBeNull();
  });

  it("links prominently to the original article URL, leaving the app", async () => {
    vi.mocked(getArticle).mockResolvedValue(
      detail({ ingestDay: null, url: "https://example.com/original-story" }),
    );

    const { container } = render(await ArticlePage({ params: params(HASH) }));

    const link = container.querySelector('[data-testid="original-link"]');
    expect(link?.getAttribute("href")).toBe("https://example.com/original-story");
    expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
  });

  describe("published-date provenance", () => {
    it("notes that the published date was estimated when publishedAtSource is 'fallback'", async () => {
      vi.mocked(getArticle).mockResolvedValue(
        detail({ ingestDay: null, publishedAtSource: "fallback" }),
      );

      render(await ArticlePage({ params: params(HASH) }));

      expect(screen.getByTestId("published-guessed")).toBeTruthy();
    });

    it("shows no note at all when publishedAtSource is 'feed'", async () => {
      vi.mocked(getArticle).mockResolvedValue(
        detail({ ingestDay: null, publishedAtSource: "feed" }),
      );

      render(await ArticlePage({ params: params(HASH) }));

      expect(screen.queryByTestId("published-guessed")).toBeNull();
      expect(screen.queryByTestId("published-provenance-unknown")).toBeNull();
    });

    it("shows an unknown-provenance note when publishedAtSource is null, distinct from the fallback note", async () => {
      // Fix round 1, finding F3: null must render distinctly from BOTH "feed" (no note) and
      // "fallback" (the estimated-date note) -- showing no note here would present unknown
      // provenance as reported provenance, the same dishonesty already guarded against
      // elsewhere on this page.
      vi.mocked(getArticle).mockResolvedValue(
        detail({ ingestDay: null, publishedAtSource: null }),
      );

      render(await ArticlePage({ params: params(HASH) }));

      expect(screen.getByTestId("published-provenance-unknown")).toBeTruthy();
      expect(screen.queryByTestId("published-guessed")).toBeNull();
    });
  });

  describe("whyItMatters", () => {
    it("shows the rationale when present", async () => {
      vi.mocked(getArticle).mockResolvedValue(
        detail({ ingestDay: null, whyItMatters: "Because it changes the frontier." }),
      );

      render(await ArticlePage({ params: params(HASH) }));

      expect(screen.getByTestId("why-it-matters").textContent).toBe(
        "Because it changes the frontier.",
      );
    });

    it("renders no whyItMatters element when it is null", async () => {
      vi.mocked(getArticle).mockResolvedValue(detail({ ingestDay: null, whyItMatters: null }));

      const { container } = render(await ArticlePage({ params: params(HASH) }));

      expect(container.querySelector('[data-testid="why-it-matters"]')).toBeNull();
    });

    it("renders before the scraped summary, not after", async () => {
      // Judgment call (fix round 1, finding F8/§7): "given prominence" is read as position,
      // not only style -- the app's own contribution leads, the scraped text follows. See the
      // fix-round-1 report section for the full reasoning.
      vi.mocked(getArticle).mockResolvedValue(
        detail({
          ingestDay: null,
          whyItMatters: "Because it changes the frontier.",
          summary: "A plain summary.",
        }),
      );

      const { container } = render(await ArticlePage({ params: params(HASH) }));

      const why = container.querySelector('[data-testid="why-it-matters"]');
      const summary = container.querySelector('[data-testid="summary"]');
      expect(why).toBeTruthy();
      expect(summary).toBeTruthy();
      // DOCUMENT_POSITION_FOLLOWING (4): set on the node passed to compareDocumentPosition
      // when it comes AFTER the node compareDocumentPosition is called on -- true here only if
      // `summary` follows `why` in the DOM.
      expect(why!.compareDocumentPosition(summary!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
  });

  describe("degraded-ranking marker", () => {
    it("shows a marker for a v1-degraded article", async () => {
      // Fix round 1, finding F2: the panel whose stated job is making the ranking inspectable
      // must say when there is no real ranking to inspect yet, the same way ArticleCard
      // already does via isUnranked.
      vi.mocked(getArticle).mockResolvedValue(
        detail({ ingestDay: null, scoreVersion: "v1-degraded" }),
      );

      render(await ArticlePage({ params: params(HASH) }));

      expect(screen.getByTestId("ranking-degraded")).toBeTruthy();
    });

    it("shows no marker for a normally-ranked article", async () => {
      vi.mocked(getArticle).mockResolvedValue(detail({ ingestDay: null, scoreVersion: "v1" }));

      render(await ArticlePage({ params: params(HASH) }));

      expect(screen.queryByTestId("ranking-degraded")).toBeNull();
    });
  });

  describe("ScoreSignals wiring", () => {
    it("passes the article's own ranking signals through", async () => {
      vi.mocked(getArticle).mockResolvedValue(
        detail({
          ingestDay: null,
          category: "lab",
          llmImportance: 77,
          corroborationToday: 4,
          points: null,
          pointsImputed: true,
        }),
      );

      render(await ArticlePage({ params: params(HASH) }));

      expect(screen.getByTestId("source-weight").textContent).toBe("1 (lab)");
      expect(screen.getByTestId("llm-importance").textContent).toBe("77 / 100");
      expect(screen.getByTestId("corroboration-today").textContent).toBe("4 sources");
      expect(screen.getByTestId("engagement").textContent).toContain("not measured");
    });

    // Both anchors are deliberately far outside any plausible test-run date rather than near
    // "now": the page computes recency against `new Date()` internally (uncontrolled from the
    // test), so an assertion near a moving "now" would be flaky. A future-dated publishedAt
    // clamps age to exactly 0 (`Math.max(0, ...)` in computeRecency); a date from the year 2000
    // is old enough that the half-life decay rounds to 0.00 at two decimal places for any
    // conceivable run date. Both are stable regardless of when this suite executes.
    it("computes recency as 1.00 for an article published in the future (age clamped to 0)", async () => {
      vi.mocked(getArticle).mockResolvedValue(
        detail({ ingestDay: null, publishedAt: "2099-01-01T00:00:00.000Z" }),
      );

      render(await ArticlePage({ params: params(HASH) }));

      expect(screen.getByTestId("recency").textContent).toContain("1.00");
    });

    it("computes recency as 0.00 for a very old article", async () => {
      vi.mocked(getArticle).mockResolvedValue(
        detail({ ingestDay: null, publishedAt: "2000-01-01T00:00:00.000Z" }),
      );

      render(await ArticlePage({ params: params(HASH) }));

      expect(screen.getByTestId("recency").textContent).toContain("0.00");
    });
  });
});
