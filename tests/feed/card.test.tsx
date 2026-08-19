// @vitest-environment jsdom
//
// Opt-in per file, not global -- see vitest.config.ts. The rest of the suite (`environment:
// "node"`) exercises the AWS SDK against fakes and must never see a jsdom global by accident.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ArticleCard } from "../../components/ArticleCard.js";
import { DaySection } from "../../components/DaySection.js";
import { toFeedArticle } from "../../src/lib/feed/shape.js";

// `test.globals` is false in vitest.config.ts (this suite always imports its own `afterEach`
// etc. rather than relying on injected globals), so @testing-library/react's automatic
// cleanup -- which detects and hooks a *global* `afterEach` -- never registers itself. Without
// this, every `render()` in this file leaves its container attached to `document.body`, and a
// later `screen.getByText(...)` throws "multiple elements found" once more than one test has
// rendered the same text (e.g. two cards both titled "GPT-6 ships", or two DaySection headers
// both reading "2026-08-18"). Confirmed by running this file without the explicit cleanup:
// three tests failed with exactly that error, at the third, fourth-plus render of matching text.
afterEach(cleanup);

const NOW = new Date("2026-08-18T12:00:00.000Z");

const raw = (over: Record<string, unknown> = {}) => ({
  pk: `ART#${"a".repeat(64)}`,
  sk: "A",
  title: "GPT-6 ships",
  summary: "A plain summary.",
  imageUrl: null,
  url: "https://example.com/p",
  source: "techcrunch",
  sourceName: "TechCrunch",
  category: "news",
  section: "ai",
  publishedAt: "2026-08-18T09:00:00.000Z",
  clusterId: "2026-08-18#gpt6",
  corroborationToday: 3,
  whyItMatters: "Because it changes the frontier.",
  score: 812,
  scoreVersion: "v1",
  points: null,
  pointsImputed: true,
  llmImportance: 88,
  firstSeenAt: "2026-08-18T10:00:00.000Z",
  ...over,
});

describe("ArticleCard", () => {
  it("renders the bare card with no img element when imageUrl is null", () => {
    const article = toFeedArticle(raw({ imageUrl: null }));
    const { container } = render(<ArticleCard article={article} now={NOW} />);
    expect(container.querySelector("img")).toBeNull();
  });

  it("renders an img element with the right src when imageUrl is present", () => {
    const article = toFeedArticle(raw({ imageUrl: "https://example.com/hero.png" }));
    const { container } = render(<ArticleCard article={article} now={NOW} />);
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "https://example.com/hero.png",
    );
  });

  it("renders no rationale element at all when whyItMatters is null", () => {
    // A structural check (no [data-testid="why-it-matters"] element), not a text-content
    // check -- textContent-not-contains would hold trivially even for a mutant that always
    // renders the wrapping element with a null child, since JSX renders `null` as nothing.
    const article = toFeedArticle(raw({ whyItMatters: undefined }));
    const { container } = render(<ArticleCard article={article} now={NOW} />);
    expect(container.querySelector('[data-testid="why-it-matters"]')).toBeNull();
  });

  it("renders whyItMatters when it is present", () => {
    const article = toFeedArticle(raw({ whyItMatters: "Because it changes the frontier." }));
    render(<ArticleCard article={article} now={NOW} />);
    expect(screen.getByText("Because it changes the frontier.")).toBeTruthy();
  });

  it("does not show 'also covered' for a __self__ cluster, even with corroborationToday > 1", () => {
    const article = toFeedArticle(
      raw({ clusterId: "__self__:shared", corroborationToday: 5 }),
    );
    const { container } = render(<ArticleCard article={article} now={NOW} />);
    expect(container.querySelector('[data-testid="corroboration"]')).toBeNull();
  });

  it("does not show 'also covered' when corroborationToday is 1", () => {
    const article = toFeedArticle(raw({ clusterId: "2026-08-18#gpt6", corroborationToday: 1 }));
    const { container } = render(<ArticleCard article={article} now={NOW} />);
    expect(container.querySelector('[data-testid="corroboration"]')).toBeNull();
  });

  it("shows 'also covered by N others' for a real, shared cluster", () => {
    const article = toFeedArticle(raw({ clusterId: "2026-08-18#gpt6", corroborationToday: 3 }));
    render(<ArticleCard article={article} now={NOW} />);
    expect(screen.getByText(/also covered by 2 others/i)).toBeTruthy();
  });

  it("shows the 'new since last ranking' marker for a v1-degraded article", () => {
    const article = toFeedArticle(raw({ scoreVersion: "v1-degraded" }));
    render(<ArticleCard article={article} now={NOW} />);
    expect(screen.getByText(/new since last ranking/i)).toBeTruthy();
  });

  it("does not show the marker for a normally-ranked article", () => {
    const article = toFeedArticle(raw({ scoreVersion: "v1" }));
    const { container } = render(<ArticleCard article={article} now={NOW} />);
    expect(container.querySelector('[data-testid="unranked-marker"]')).toBeNull();
  });

  it("links the whole card to the article's own detail page, never the source URL", () => {
    const article = toFeedArticle(raw());
    const { container } = render(<ArticleCard article={article} now={NOW} />);
    const link = container.querySelector("a");
    expect(link?.getAttribute("href")).toBe(`/article/${"a".repeat(64)}`);
  });

  it("renders bracketed prose and a defanged script tag as visible text, and creates no script element", () => {
    // The standing defence for src/lib/ingest/fetchers/rss.ts's stripTags heuristic, which
    // deliberately leaves `<model>`-shaped prose untouched because it cannot always tell it
    // apart from real markup. `<script>` itself is in that file's ALLOWED_TAGS and would
    // normally be stripped before a summary is ever stored -- this test bypasses ingest and
    // builds the FeedArticle directly, so it proves the *component* is safe regardless of what
    // reaches it, not just that today's ingest pipeline happens to be. A card that ever renders
    // `summary` via dangerouslySetInnerHTML would turn this exact text into a live <script>
    // element; plain JSX text never can.
    const summary =
      "The <model> improved, unlike <script>alert(1)</script> which is prose quoted here.";
    const article = toFeedArticle(raw({ summary }));
    const { container } = render(<ArticleCard article={article} now={NOW} />);
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain("<model>");
    expect(container.textContent).toContain("<script>alert(1)</script>");
  });
});

describe("DaySection", () => {
  it("shows the count of the articles it is actually rendering", () => {
    const items = [
      raw({ pk: `ART#${"a".repeat(64)}` }),
      raw({ pk: `ART#${"b".repeat(64)}` }),
    ].map(toFeedArticle);
    render(<DaySection day="2026-08-18" articles={items} now={NOW} />);
    expect(screen.getByText("2 stories")).toBeTruthy();
  });

  it("uses singular 'story' for exactly one article", () => {
    const items = [toFeedArticle(raw())];
    render(<DaySection day="2026-08-18" articles={items} now={NOW} />);
    expect(screen.getByText("1 story")).toBeTruthy();
  });

  it("renders one card per article, preserving the given (score) order", () => {
    const items = [
      raw({ pk: `ART#${"a".repeat(64)}`, title: "First" }),
      raw({ pk: `ART#${"b".repeat(64)}`, title: "Second" }),
    ].map(toFeedArticle);
    const { container } = render(<DaySection day="2026-08-18" articles={items} now={NOW} />);
    const titles = Array.from(container.querySelectorAll("h3")).map((h) => h.textContent);
    expect(titles).toEqual(["First", "Second"]);
  });

  it("shows the day string in the header", () => {
    render(<DaySection day="2026-08-18" articles={[]} now={NOW} />);
    expect(screen.getByText("2026-08-18")).toBeTruthy();
  });
});
