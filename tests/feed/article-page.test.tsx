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

// Fix round 2: `RunStatusLine` moved out of this page entirely, into
// `app/(feed)/layout.tsx` (see tests/feed/feed-layout.test.tsx and
// tests/structure/page-groups.test.ts) -- the page itself no longer calls
// `getRunStatus`/`getArchive`, so this mock no longer needs to stub them.
vi.mock("../../src/lib/feed/read.js", () => ({
  getArticle: vi.fn(),
  getDay: vi.fn(),
}));

import { ArticlePageImpl } from "../../app/(feed)/article/article-page-impl.js";
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

    await ArticlePageImpl({ pathSection: "ai", params: params(HASH) });

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
      await ArticlePageImpl({ pathSection: "ai", params: params(HASH) });
    } catch (err) {
      caught = err;
    }

    expect(isHTTPAccessFallbackError(caught)).toBe(true);
  });

  it("does not call getDay when the article is missing", async () => {
    vi.mocked(getArticle).mockResolvedValue(null);

    await expect(ArticlePageImpl({ pathSection: "ai", params: params(HASH) })).rejects.toThrow();
    expect(getDay).not.toHaveBeenCalled();
  });

  describe("a shape-invalid urlHash -- final review, N3", () => {
    // `isValidUrlHash` (src/types/article.ts) is already enforced write-side by
    // NormalizedArticleSchema; this pins the read-side use of the identical check, the same
    // asymmetry L3 fixed for /day/[date]'s date shape. Asserting the call count, not just the
    // eventual 404 status, is what actually proves the GetItem is skipped -- a page that still
    // 404s AFTER calling getArticle for a missing hash would pass a status-only assertion just
    // as well.
    it("404s WITHOUT ever calling getArticle for a hash that is not 64 lowercase-hex characters", async () => {
      let caught: unknown;
      try {
        await ArticlePageImpl({ pathSection: "ai", params: params("not-a-hash") });
      } catch (err) {
        caught = err;
      }

      expect(isHTTPAccessFallbackError(caught)).toBe(true);
      expect(getArticle).not.toHaveBeenCalled();
    });

    it("404s WITHOUT calling getArticle for a hash that is the right length but contains an uppercase letter", async () => {
      const upper = `A${HASH.slice(1)}`;

      let caught: unknown;
      try {
        await ArticlePageImpl({ pathSection: "ai", params: params(upper) });
      } catch (err) {
        caught = err;
      }

      expect(isHTTPAccessFallbackError(caught)).toBe(true);
      expect(getArticle).not.toHaveBeenCalled();
    });

    it("still calls getArticle for a well-formed hash", async () => {
      vi.mocked(getArticle).mockResolvedValue(detail({ ingestDay: null }));

      await ArticlePageImpl({ pathSection: "ai", params: params(HASH) });

      expect(getArticle).toHaveBeenCalledWith(HASH);
    });
  });

  describe("cluster siblings", () => {
    it("renders no siblings and does not call getDay when ingestDay is null", async () => {
      vi.mocked(getArticle).mockResolvedValue(
        detail({ ingestDay: null, clusterId: "2026-08-18#gpt6", corroborationToday: 3 }),
      );

      render(await ArticlePageImpl({ pathSection: "ai", params: params(HASH) }));

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

      render(await ArticlePageImpl({ pathSection: "ai", params: params(HASH) }));

      expect(screen.queryByTestId("siblings")).toBeNull();
      expect(getDay).not.toHaveBeenCalled();
    });

    it("does not call getDay when clusterId is a __self__ placeholder", async () => {
      vi.mocked(getArticle).mockResolvedValue(
        detail({ ingestDay: "2026-08-18", clusterId: `__self__:${HASH}` }),
      );

      render(await ArticlePageImpl({ pathSection: "ai", params: params(HASH) }));

      expect(screen.queryByTestId("siblings")).toBeNull();
      expect(getDay).not.toHaveBeenCalled();
    });

    it("reads the article's own ingestDay to find its siblings, not a computed date", async () => {
      vi.mocked(getArticle).mockResolvedValue(
        detail({ ingestDay: "2026-08-18", clusterId: "2026-08-18#gpt6", corroborationToday: 2 }),
      );

      render(await ArticlePageImpl({ pathSection: "ai", params: params(HASH) }));

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

      render(await ArticlePageImpl({ pathSection: "ai", params: params(HASH) }));

      const siblingLink = screen.getByRole("link", { name: "The Verge" });
      expect(siblingLink.getAttribute("href")).toBe(`/article/ai/${SIBLING_HASH}`);
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

      render(await ArticlePageImpl({ pathSection: "ai", params: params(HASH) }));

      expect(
        screen.getByRole("link", { name: "A degraded sibling with no source name" }),
      ).toBeTruthy();
    });
  });

  it("renders SectionNav with neither vertical current", async () => {
    vi.mocked(getArticle).mockResolvedValue(detail({ ingestDay: null }));

    render(await ArticlePageImpl({ pathSection: "ai", params: params(HASH) }));

    expect(screen.getByRole("link", { name: "AI" }).getAttribute("aria-current")).toBeNull();
    expect(screen.getByRole("link", { name: "Design" }).getAttribute("aria-current")).toBeNull();
  });

  it("links prominently to the original article URL, leaving the app", async () => {
    vi.mocked(getArticle).mockResolvedValue(
      detail({ ingestDay: null, url: "https://example.com/original-story" }),
    );

    const { container } = render(await ArticlePageImpl({ pathSection: "ai", params: params(HASH) }));

    const link = container.querySelector('[data-testid="original-link"]');
    expect(link?.getAttribute("href")).toBe("https://example.com/original-story");
    expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
  });

  describe("a url that is not a valid http(s) address -- final review, L9", () => {
    // `toArticleDetail`/`toFeedArticle` (src/lib/feed/shape.ts) already coerce a non-http(s)
    // `url` to `""` at the read boundary -- these pin the page's OWN decision about what to do
    // with that: render the article unlinked (no `<a>` at all, so there is no href a browser
    // could ever act on) rather than drop the whole article from the page. Everything else about
    // the article (title, summary, whyItMatters, score signals) is independently valid data, so
    // hiding all of it over one bad field would throw away more than the bad field earns.
    it("renders no original-link anchor and shows an unavailable notice instead", async () => {
      vi.mocked(getArticle).mockResolvedValue(
        detail({ ingestDay: null, url: "javascript:alert(1)" }),
      );

      const { container } = render(await ArticlePageImpl({ pathSection: "ai", params: params(HASH) }));

      expect(container.querySelector('[data-testid="original-link"]')).toBeNull();
      expect(screen.getByTestId("original-link-unavailable")).toBeTruthy();
    });

    it("still renders the rest of the article normally", async () => {
      vi.mocked(getArticle).mockResolvedValue(
        detail({ ingestDay: null, url: "javascript:alert(1)", title: "GPT-6 ships" }),
      );

      render(await ArticlePageImpl({ pathSection: "ai", params: params(HASH) }));

      expect(screen.getByText("GPT-6 ships")).toBeTruthy();
    });
  });

  describe("published-date provenance", () => {
    it("notes that the published date was estimated when publishedAtSource is 'fallback'", async () => {
      vi.mocked(getArticle).mockResolvedValue(
        detail({ ingestDay: null, publishedAtSource: "fallback" }),
      );

      render(await ArticlePageImpl({ pathSection: "ai", params: params(HASH) }));

      expect(screen.getByTestId("published-guessed")).toBeTruthy();
    });

    it("shows no note at all when publishedAtSource is 'feed'", async () => {
      vi.mocked(getArticle).mockResolvedValue(
        detail({ ingestDay: null, publishedAtSource: "feed" }),
      );

      render(await ArticlePageImpl({ pathSection: "ai", params: params(HASH) }));

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

      render(await ArticlePageImpl({ pathSection: "ai", params: params(HASH) }));

      expect(screen.getByTestId("published-provenance-unknown")).toBeTruthy();
      expect(screen.queryByTestId("published-guessed")).toBeNull();
    });
  });

  describe("whyItMatters", () => {
    it("shows the rationale when present", async () => {
      vi.mocked(getArticle).mockResolvedValue(
        detail({ ingestDay: null, whyItMatters: "Because it changes the frontier." }),
      );

      render(await ArticlePageImpl({ pathSection: "ai", params: params(HASH) }));

      expect(screen.getByTestId("why-it-matters").textContent).toBe(
        "Because it changes the frontier.",
      );
    });

    it("renders no whyItMatters element when it is null", async () => {
      vi.mocked(getArticle).mockResolvedValue(detail({ ingestDay: null, whyItMatters: null }));

      const { container } = render(await ArticlePageImpl({ pathSection: "ai", params: params(HASH) }));

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

      const { container } = render(await ArticlePageImpl({ pathSection: "ai", params: params(HASH) }));

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

      render(await ArticlePageImpl({ pathSection: "ai", params: params(HASH) }));

      expect(screen.getByTestId("ranking-degraded")).toBeTruthy();
    });

    it("shows no marker for a normally-ranked article", async () => {
      vi.mocked(getArticle).mockResolvedValue(detail({ ingestDay: null, scoreVersion: "v1" }));

      render(await ArticlePageImpl({ pathSection: "ai", params: params(HASH) }));

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

      render(await ArticlePageImpl({ pathSection: "ai", params: params(HASH) }));

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

      render(await ArticlePageImpl({ pathSection: "ai", params: params(HASH) }));

      expect(screen.getByTestId("recency").textContent).toContain("1.00");
    });

    it("computes recency as 0.00 for a very old article", async () => {
      vi.mocked(getArticle).mockResolvedValue(
        detail({ ingestDay: null, publishedAt: "2000-01-01T00:00:00.000Z" }),
      );

      render(await ArticlePageImpl({ pathSection: "ai", params: params(HASH) }));

      expect(screen.getByTestId("recency").textContent).toContain("0.00");
    });
  });

  // Fix round 1's F1 presence assertion lived here; fix round 2 removed it -- `ArticlePage`
  // alone no longer renders `RunStatusLine` (see the note on the mock above). The presence
  // guarantee now lives in tests/feed/feed-layout.test.tsx and tests/structure/page-groups.test.ts.

  describe("XSS escaping -- final review, M1", () => {
    // ArticleCard's own version of this test (tests/feed/card.test.tsx, "renders bracketed prose
    // and a defanged script tag...") is the standing defence for src/lib/ingest/fetchers/rss.ts's
    // stripTags heuristic, which deliberately leaves `<model>`-shaped prose untouched in stored
    // summaries because it cannot always tell that prose apart from real markup after
    // entity-decoding. This story page renders the same two fields (`summary`, `whyItMatters`)
    // the card does -- plus `title`, pinned separately below, since the sweep found `title` named
    // in this same finding's text but not actually swept anywhere (final review, N2) -- and until
    // this test existed, nothing pinned that half of the guarantee: switching either field to
    // `dangerouslySetInnerHTML` left every other test in this file green (they all assert
    // `textContent`, which a real dangerouslySetInnerHTML render of this exact fixture would
    // still satisfy, since there is no unescaped `<` anywhere in the DEFANGED prose being
    // rendered as visible text either way). Asserting `container.querySelector("script")` is
    // null, not merely a text match, is what actually distinguishes "rendered as escaped text"
    // from "rendered as parsed HTML" -- a card that ever renders either field via
    // `dangerouslySetInnerHTML` turns this fixture's `<script>` text into a live `<script>`
    // element; plain JSX text never can.
    it("renders bracketed prose and a defanged script tag as visible text in summary and whyItMatters, and creates no script element", async () => {
      const summary =
        "The <model> improved, unlike <script>alert(1)</script> which is prose quoted here.";
      const whyItMatters =
        "Because <model> matters, unlike <script>alert(2)</script> which is prose quoted here.";
      vi.mocked(getArticle).mockResolvedValue(detail({ ingestDay: null, summary, whyItMatters }));

      const { container } = render(await ArticlePageImpl({ pathSection: "ai", params: params(HASH) }));

      expect(container.querySelector("script")).toBeNull();
      expect(screen.getByTestId("summary").textContent).toBe(summary);
      expect(screen.getByTestId("why-it-matters").textContent).toBe(whyItMatters);
    });

    it("renders title's bracketed prose and a defanged script tag as visible text too, and creates no script element -- final review, N2", async () => {
      // The story page's <h1> was never asserted against this payload on its own -- the test
      // above only exercises summary/whyItMatters. Verified by mutation: switching the <h1> to
      // dangerouslySetInnerHTML left all 25 other tests in this file green before this test
      // existed.
      const title =
        "The <model> improved, unlike <script>alert(4)</script> which is prose quoted here.";
      vi.mocked(getArticle).mockResolvedValue(detail({ ingestDay: null, title }));

      const { container } = render(await ArticlePageImpl({ pathSection: "ai", params: params(HASH) }));

      expect(container.querySelector("script")).toBeNull();
      expect(container.querySelector("h1")?.textContent).toBe(title);
    });
  });
});

describe("the canonical section path", () => {
  it("redirects to the stored section when the URL claims another", async () => {
    // next/navigation's redirect throws NEXT_REDIRECT; asserting on the throw pins both that
    // the mismatch redirects and where it lands.
    vi.mocked(getArticle).mockResolvedValue(detail());
    await expect(
      ArticlePageImpl({ pathSection: "design", params: params(HASH) }),
    ).rejects.toMatchObject({ digest: expect.stringContaining(`/article/ai/${HASH}`) });
  });
});
