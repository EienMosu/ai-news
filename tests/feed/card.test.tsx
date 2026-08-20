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

  it("renders an img element with the right src, lazily loaded, when imageUrl is present", () => {
    const article = toFeedArticle(raw({ imageUrl: "https://example.com/hero.png" }));
    const { container } = render(<ArticleCard article={article} now={NOW} />);
    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toBe("https://example.com/hero.png");
    expect(img?.getAttribute("loading")).toBe("lazy");
  });

  it("renders no img element when the stored imageUrl is not a valid http(s) address -- final review, L9", () => {
    // `toFeedArticle` (src/lib/feed/shape.ts) coerces a non-http(s) imageUrl to `null` at the
    // read boundary; this card's own existing `!== null` guard (already required for the
    // ordinary "no image" case) is what keeps a rejected value from ever reaching an `<img src>`
    // -- no new render logic here, just the coercion feeding the guard that already existed.
    const article = toFeedArticle(raw({ imageUrl: "javascript:alert(1)" }));
    const { container } = render(<ArticleCard article={article} now={NOW} />);
    expect(container.querySelector("img")).toBeNull();
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

  it("wraps the relative time in a <time> element carrying the ISO publishedAt as dateTime", () => {
    const article = toFeedArticle(raw({ publishedAt: "2026-08-18T09:00:00.000Z" }));
    const { container } = render(<ArticleCard article={article} now={NOW} />);
    const time = container.querySelector("time");
    expect(time?.getAttribute("dateTime")).toBe("2026-08-18T09:00:00.000Z");
    expect(time?.textContent).toBe("3h ago");
  });

  it("omits the dateTime attribute (but still shows relative text) when publishedAt is null", () => {
    const article = toFeedArticle(raw({ publishedAt: undefined }));
    const { container } = render(<ArticleCard article={article} now={NOW} />);
    const time = container.querySelector("time");
    expect(time?.hasAttribute("dateTime")).toBe(false);
    expect(time?.textContent).toBe("date unknown");
  });

  it("renders a fully degraded article coherently, with no stray leading separator", () => {
    // Every optional signal absent at once: no image, no whyItMatters, no clusterId, no
    // publishedAt, an empty sourceName (the coerced default -- see asString in shape.ts), and
    // a degraded scoreVersion. This is precisely the case spec §7 says to design for first.
    const article = toFeedArticle(
      raw({
        imageUrl: undefined,
        whyItMatters: undefined,
        clusterId: undefined,
        corroborationToday: undefined,
        publishedAt: undefined,
        sourceName: "",
        scoreVersion: "v1-degraded",
      }),
    );
    const { container } = render(<ArticleCard article={article} now={NOW} />);

    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector('[data-testid="why-it-matters"]')).toBeNull();
    expect(container.querySelector('[data-testid="corroboration"]')).toBeNull();
    expect(screen.getByText(/new since last ranking/i)).toBeTruthy();

    const meta = container.querySelector('[data-testid="meta"]');
    // No sourceName means no " · " separator either -- the meta line is just the relative
    // time, not "· date unknown" or " · date unknown" with a stray leading mark.
    expect(meta?.textContent).toBe("date unknown");
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

  it("renders whyItMatters' bracketed prose and a defanged script tag as visible text too, and creates no script element -- sibling of the summary test above", () => {
    // Final review, M1's sibling sweep: this card's own doc comment claims BOTH `summary` AND
    // `whyItMatters` are "rendered as plain JSX text, never dangerouslySetInnerHTML" -- but until
    // this test existed, only `summary` had a DOM-asserting test proving it. Switching
    // `whyItMatters` alone to `dangerouslySetInnerHTML` left all 20 tests in this file green
    // (verified by mutation), the exact same vacuous-check shape the review found one level up,
    // on the story page, for the identical two fields -- just unnamed here until now.
    const whyItMatters =
      "Because <model> matters, unlike <script>alert(3)</script> which is prose quoted here.";
    const article = toFeedArticle(raw({ whyItMatters }));
    const { container } = render(<ArticleCard article={article} now={NOW} />);
    expect(container.querySelector("script")).toBeNull();
    expect(screen.getByTestId("why-it-matters").textContent).toBe(whyItMatters);
  });

  it("renders title's bracketed prose and a defanged script tag as visible text too, and creates no script element -- final review, N2", () => {
    // M1's own finding text named `title` alongside `summary`/`whyItMatters` as a field this
    // page renders ("plus title"), but the sweep that followed only pinned the other two. Title
    // is not subject to the ingest stripTags heuristic the way summary/whyItMatters are, but
    // nothing in this component's contract prevents a future edit from switching it to
    // dangerouslySetInnerHTML either -- and until this test existed, one would have (verified by
    // mutation: all 21 tests in this file stayed green).
    const title =
      "The <model> improved, unlike <script>alert(4)</script> which is prose quoted here.";
    const article = toFeedArticle(raw({ title }));
    const { container } = render(<ArticleCard article={article} now={NOW} />);
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("h3")?.textContent).toBe(title);
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

  it("links the header date to its own day page -- fix round 1, F3", () => {
    // Before this fix, nothing inside the app pointed at /day/[date] at all -- it was reachable
    // only by typing a URL. The header date is the obvious anchor for it.
    render(<DaySection day="2026-08-18" articles={[]} now={NOW} />);
    expect(screen.getByRole("link", { name: "2026-08-18" }).getAttribute("href")).toBe(
      "/day/2026-08-18",
    );
  });
});
