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

describe("ArticlePage (app/article/[urlHash]/page.tsx)", () => {
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
    expect(getArticle).toHaveBeenCalledWith(HASH);
  });

  it("does not call getDay when the article is missing", async () => {
    vi.mocked(getArticle).mockResolvedValue(null);

    await expect(ArticlePage({ params: params(HASH) })).rejects.toThrow();
    expect(getDay).not.toHaveBeenCalled();
  });

  it("renders no siblings and does not call getDay when ingestDay is null", async () => {
    vi.mocked(getArticle).mockResolvedValue(
      detail({ ingestDay: null, clusterId: "2026-08-18#gpt6", corroborationToday: 3 }),
    );

    render(await ArticlePage({ params: params(HASH) }));

    expect(screen.queryByTestId("siblings")).toBeNull();
    expect(getDay).not.toHaveBeenCalled();
  });

  it("reads the article's own ingestDay to find its siblings, not a computed date", async () => {
    vi.mocked(getArticle).mockResolvedValue(
      detail({ ingestDay: "2026-08-18", clusterId: "2026-08-18#gpt6", corroborationToday: 2 }),
    );
    vi.mocked(getDay).mockResolvedValue(EMPTY_DAY_RESULT);

    render(await ArticlePage({ params: params(HASH) }));

    expect(getDay).toHaveBeenCalledWith("2026-08-18");
  });

  it("renders siblings from the same cluster, each linking to its own story page", async () => {
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
            clusterId: "2026-08-18#gpt6",
          }),
        ),
        // The subject itself comes back in the day's list too (a separate fetch, same story)
        // -- it must never appear in its own sibling list.
        toFeedArticle(rawItem({ pk: `ART#${HASH}`, clusterId: "2026-08-18#gpt6" })),
      ],
    });

    render(await ArticlePage({ params: params(HASH) }));

    const siblingLink = screen.getByRole("link", { name: "A rival's take on the same launch" });
    expect(siblingLink.getAttribute("href")).toBe(`/article/${SIBLING_HASH}`);
    expect(screen.queryByText("GPT-6 ships", { selector: "a" })).toBeNull();
  });

  it("renders no siblings for a __self__ cluster, even if getDay returns other articles", async () => {
    const selfId = `__self__:${HASH}`;
    vi.mocked(getArticle).mockResolvedValue(
      detail({ ingestDay: "2026-08-18", clusterId: selfId, corroborationToday: 1 }),
    );
    vi.mocked(getDay).mockResolvedValue({
      ...EMPTY_DAY_RESULT,
      articles: [
        // Same clusterId string as the subject's -- proves the __self__ guard, not merely an
        // absence of matching articles.
        toFeedArticle(rawItem({ pk: `ART#${SIBLING_HASH}`, clusterId: selfId })),
      ],
    });

    render(await ArticlePage({ params: params(HASH) }));

    expect(screen.queryByTestId("siblings")).toBeNull();
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

  it("notes that the published date was estimated when publishedAtSource is 'fallback'", async () => {
    vi.mocked(getArticle).mockResolvedValue(
      detail({ ingestDay: null, publishedAtSource: "fallback" }),
    );

    render(await ArticlePage({ params: params(HASH) }));

    expect(screen.getByTestId("published-guessed")).toBeTruthy();
  });

  it("shows no estimated-date note when publishedAtSource is 'feed'", async () => {
    vi.mocked(getArticle).mockResolvedValue(detail({ ingestDay: null, publishedAtSource: "feed" }));

    render(await ArticlePage({ params: params(HASH) }));

    expect(screen.queryByTestId("published-guessed")).toBeNull();
  });

  it("shows the whyItMatters rationale when present", async () => {
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

  it("passes the article's own ranking signals through to ScoreSignals", async () => {
    vi.mocked(getArticle).mockResolvedValue(
      detail({
        ingestDay: null,
        category: "lab",
        corroborationToday: 4,
        points: null,
        pointsImputed: true,
      }),
    );

    render(await ArticlePage({ params: params(HASH) }));

    expect(screen.getByTestId("source-weight").textContent).toBe("1 (lab)");
    expect(screen.getByTestId("corroboration-today").textContent).toBe("4 sources");
    expect(screen.getByTestId("engagement").textContent).toContain("not measured");
  });
});
