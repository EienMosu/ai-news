// @vitest-environment jsdom
//
// Opt-in per file, not global -- see vitest.config.ts. The rest of the suite (`environment:
// "node"`) exercises the AWS SDK against fakes and must never see a jsdom global by accident.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ArticleCard } from "../../components/ArticleCard.js";
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
  // ---- What left the rows with Modern Classic (owner-approved final mock) ----
  //
  // The row is now title, whyItMatters, and ONE apparatus meta line. The scraped summary, the
  // thumbnail, the <time>/relative-time pair, and the separate corroboration line all moved to
  // the story page, where reading happens. Each of the tests below is the REPLACEMENT for a
  // retired assertion, not a deletion: the old "renders X correctly" contracts become "X never
  // renders in a row, even when the data is present" -- the strongest form of "it moved".

  it("renders no img element even when imageUrl is present -- thumbnails left the rows", () => {
    // Replaces the old trio of img tests (null / present-with-lazy-loading / javascript:
    // coercion). With no <img> in the row at all, even a perfectly valid stored imageUrl must
    // not produce one; the L9 scheme-coercion defence in toFeedArticle still runs at the read
    // boundary and is exercised where the image actually renders (the story page).
    const article = toFeedArticle(raw({ imageUrl: "https://example.com/hero.png" }));
    const { container } = render(<ArticleCard article={article} now={NOW} />);
    expect(container.querySelector("img")).toBeNull();
  });

  it("renders no <time> element even when publishedAt is present -- timestamps left the rows", () => {
    // Replaces the two old <time> tests (ISO dateTime attribute + "3h ago" text, and the
    // null-publishedAt "date unknown" fallback). The dateTime/relative-time contract now lives
    // on the story page; a row that still rendered either string would be reintroducing the
    // retired anatomy, so both texts are pinned absent alongside the element itself.
    const article = toFeedArticle(raw({ publishedAt: "2026-08-18T09:00:00.000Z" }));
    const { container } = render(<ArticleCard article={article} now={NOW} />);
    expect(container.querySelector("time")).toBeNull();
    expect(container.textContent).not.toContain("3h ago");
    expect(container.textContent).not.toContain("date unknown");
  });

  it("renders no summary text at all -- the scraped summary left the rows, taking its escaping question with it", () => {
    // Replaces the old summary XSS test, which asserted the hostile text rendered AS VISIBLE
    // TEXT with no script element. The row no longer renders `summary` in any form, so the
    // equivalent-strength assertion flips: no script element (still) AND none of the summary's
    // text appears. The stripTags-heuristic defence this test used to stand for now lives with
    // the story page's own tests, where summary still renders.
    const summary =
      "The <model> improved, unlike <script>alert(1)</script> which is prose quoted here.";
    const article = toFeedArticle(raw({ summary }));
    const { container } = render(<ArticleCard article={article} now={NOW} />);
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).not.toContain("improved");
  });

  // ---- The rank numeral ----

  it("renders the rank as an unpadded, aria-hidden italic display numeral", () => {
    // Modern Classic sets the rank as a folio number -- display-serif italic, "1" not "01".
    // The old zero-padded form is pinned absent, not just the new form present, so a revert
    // to padStart cannot slip past a substring match ("01" contains "1"). aria-hidden because
    // document order already conveys rank to a screen reader; announcing "1" before every
    // title is repetition, not information.
    const article = toFeedArticle(raw());
    const { container } = render(<ArticleCard article={article} now={NOW} rank={1} />);
    const numeral = container.querySelector("[data-numeric]");
    expect(numeral?.textContent).toBe("1");
    expect(numeral?.getAttribute("aria-hidden")).toBe("true");
    expect(numeral?.className).toContain("italic");
    expect(numeral?.className).toContain("var(--font-display)");
  });

  it("renders no numeral element at all when rank is not given", () => {
    // Structural check (no [data-numeric] element), matching the why-it-matters test below:
    // an empty numeral column would still reserve its width and misalign the unranked row.
    const article = toFeedArticle(raw());
    const { container } = render(<ArticleCard article={article} now={NOW} />);
    expect(container.querySelector("[data-numeric]")).toBeNull();
  });

  it("lead strengthens the numeral to full gold but never inverts the row", () => {
    // Old design: data-lead flipped the whole card into an inverted ink-on-field block. Modern
    // Classic moved the lead's announcement into DaySection (gold rule + THE LEAD tag); inside
    // the row, `lead` only promotes the numeral from soft gold to full gold. The data-lead
    // attribute may remain as an inert anchor, but no inversion classes may appear anywhere in
    // the row -- bg-[var(--ink)] is the active-chip/outbound-link treatment, never a card's.
    const article = toFeedArticle(raw());
    const leadRender = render(<ArticleCard article={article} now={NOW} rank={1} lead={true} />);
    const leadNumeral = leadRender.container.querySelector("[data-numeric]");
    expect(leadNumeral?.className).toContain("text-[color:var(--gold)]");
    expect(leadRender.container.innerHTML).not.toContain("bg-[var(--ink)]");
    cleanup();

    const plainRender = render(<ArticleCard article={article} now={NOW} rank={2} />);
    const plainNumeral = plainRender.container.querySelector("[data-numeric]");
    expect(plainNumeral?.className).toContain("text-[color:var(--gold-soft)]");
    expect(plainNumeral?.className).not.toContain("text-[color:var(--gold)]");
  });

  // ---- whyItMatters: the row's own prose ----

  it("renders no rationale element at all when whyItMatters is null", () => {
    // A structural check (no [data-testid="why-it-matters"] element), not a text-content
    // check -- textContent-not-contains would hold trivially even for a mutant that always
    // renders the wrapping element with a null child, since JSX renders `null` as nothing.
    const article = toFeedArticle(raw({ whyItMatters: undefined }));
    const { container } = render(<ArticleCard article={article} now={NOW} />);
    expect(container.querySelector('[data-testid="why-it-matters"]')).toBeNull();
  });

  it("renders whyItMatters as the row's italic prose line when present", () => {
    // The italic is content-bearing in Modern Classic: it distinguishes the one line the
    // product wrote itself from the scraped title above and the apparatus meta below, so it
    // is asserted alongside the text rather than left to visual review.
    const article = toFeedArticle(raw({ whyItMatters: "Because it changes the frontier." }));
    render(<ArticleCard article={article} now={NOW} />);
    const why = screen.getByTestId("why-it-matters");
    expect(why.textContent).toBe("Because it changes the frontier.");
    expect(why.className).toContain("italic");
  });

  // ---- The meta line: SOURCE · N points · +K more, every part conditional ----

  it("composes the full meta line as 'SOURCE · N points · +K more' with the source set off in a <b>", () => {
    // The exact-string assertion pins separator placement too: " · " only BETWEEN parts,
    // never leading or trailing. The <b> check pins that the source -- the provenance the
    // reader scans for -- is the emphasised first part, per the mock.
    const article = toFeedArticle(
      raw({ points: 812, pointsImputed: false, clusterId: "2026-08-18#gpt6", corroborationToday: 3 }),
    );
    const { container } = render(<ArticleCard article={article} now={NOW} />);
    const meta = container.querySelector('[data-testid="meta"]');
    expect(meta?.textContent).toBe("TechCrunch · 812 points · +2 more");
    expect(meta?.querySelector("b")?.textContent).toBe("TechCrunch");
  });

  it("omits points from the meta line when points is null -- imputed points are never shown as real ones", () => {
    // The fixture's default is points: null with pointsImputed: true, i.e. a score the ranker
    // invented for ordering. Printing it would present a guess as a fact, so the part is
    // dropped and the remaining parts close ranks around a single separator.
    const article = toFeedArticle(raw({ clusterId: "2026-08-18#gpt6", corroborationToday: 3 }));
    const { container } = render(<ArticleCard article={article} now={NOW} />);
    expect(container.querySelector('[data-testid="meta"]')?.textContent).toBe(
      "TechCrunch · +2 more",
    );
  });

  it("shows '0 points' when points is genuinely zero -- the guard is non-null, not truthy", () => {
    // 0 is a real, reported score (a fresh HN post), distinct from null (no score exists). A
    // truthiness guard would erase it; this pins the `!== null` distinction.
    const article = toFeedArticle(
      raw({ points: 0, pointsImputed: false, clusterId: undefined, corroborationToday: undefined }),
    );
    const { container } = render(<ArticleCard article={article} now={NOW} />);
    expect(container.querySelector('[data-testid="meta"]')?.textContent).toBe(
      "TechCrunch · 0 points",
    );
  });

  it("shows '+K more' only via the meta line -- the old separate corroboration element is gone", () => {
    // Replaces the old "also covered by N others" test: same K-of-N arithmetic (K =
    // corroborationToday - 1, the count NOT including this article), new home. The retired
    // [data-testid="corroboration"] element is pinned absent so a revert to the two-line
    // anatomy fails here rather than in a snapshot nobody reads.
    const article = toFeedArticle(raw({ clusterId: "2026-08-18#gpt6", corroborationToday: 3 }));
    const { container } = render(<ArticleCard article={article} now={NOW} />);
    expect(container.querySelector('[data-testid="corroboration"]')).toBeNull();
    expect(container.querySelector('[data-testid="meta"]')?.textContent).toContain("+2 more");
  });

  it("omits '+K more' for a __self__ placeholder cluster, even with corroborationToday > 1", () => {
    // A `__self__:` id means the model considered the article and deliberately assigned it no
    // cluster; several articles can share the placeholder, so its count is not corroboration.
    // hasCorroboration (shape.ts) owns this predicate -- the row must not reimplement it.
    const article = toFeedArticle(raw({ clusterId: "__self__:shared", corroborationToday: 5 }));
    const { container } = render(<ArticleCard article={article} now={NOW} />);
    expect(container.querySelector('[data-testid="meta"]')?.textContent).toBe("TechCrunch");
  });

  it("omits '+K more' when corroborationToday is 1 -- '+0 more' would be a lie", () => {
    const article = toFeedArticle(raw({ clusterId: "2026-08-18#gpt6", corroborationToday: 1 }));
    const { container } = render(<ArticleCard article={article} now={NOW} />);
    expect(container.querySelector('[data-testid="meta"]')?.textContent).toBe("TechCrunch");
  });

  // ---- The unranked stamp ----

  it("shows the 'new since last ranking' stamp for a v1-degraded article", () => {
    // The stamp survives the redesign unchanged: an honest label for an article the model
    // never scored, set in the shared .stamp apparatus style rather than ad-hoc classes.
    const article = toFeedArticle(raw({ scoreVersion: "v1-degraded" }));
    render(<ArticleCard article={article} now={NOW} />);
    const marker = screen.getByTestId("unranked-marker");
    expect(marker.textContent).toMatch(/new since last ranking/i);
    expect(marker.querySelector(".stamp")).not.toBeNull();
  });

  it("does not show the stamp for a normally-ranked article", () => {
    const article = toFeedArticle(raw({ scoreVersion: "v1" }));
    const { container } = render(<ArticleCard article={article} now={NOW} />);
    expect(container.querySelector('[data-testid="unranked-marker"]')).toBeNull();
  });

  // ---- Link target ----

  it("links the whole card to the article's own detail page, never the source URL", () => {
    const article = toFeedArticle(raw());
    const { container } = render(<ArticleCard article={article} now={NOW} />);
    const link = container.querySelector("a");
    expect(link?.getAttribute("href")).toBe(`/article/ai/${"a".repeat(64)}`);
  });

  // ---- Fully degraded article ----

  it("renders a fully degraded article coherently: no meta line at all rather than an empty one", () => {
    // Every optional signal absent at once: no image, no whyItMatters, no clusterId, no
    // publishedAt, an empty sourceName (the coerced default -- see asString in shape.ts), null
    // points, and a degraded scoreVersion. Spec §7's design-for-first case. The old design fell
    // back to "date unknown" here; with timestamps gone from rows the honest empty state is
    // stronger still: zero meta parts means NO meta element, never an empty <p> or a stray
    // leading " · " separator. Title and stamp are all that remain.
    const article = toFeedArticle(
      raw({
        imageUrl: undefined,
        whyItMatters: undefined,
        clusterId: undefined,
        corroborationToday: undefined,
        publishedAt: undefined,
        sourceName: "",
        points: null,
        scoreVersion: "v1-degraded",
      }),
    );
    const { container } = render(<ArticleCard article={article} now={NOW} />);

    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("time")).toBeNull();
    expect(container.querySelector('[data-testid="why-it-matters"]')).toBeNull();
    expect(container.querySelector('[data-testid="corroboration"]')).toBeNull();
    expect(container.querySelector('[data-testid="meta"]')).toBeNull();
    expect(screen.getByText(/new since last ranking/i)).toBeTruthy();
  });

  // ---- Escaping: the two fields the row still renders ----

  it("renders whyItMatters' bracketed prose and a defanged script tag as visible text, and creates no script element", () => {
    // Final review, M1's sibling sweep, carried across the redesign: the card's doc comment
    // claims its rendered fields are plain JSX text, never dangerouslySetInnerHTML. With
    // `summary` gone from the row, `whyItMatters` and `title` are the two fields left that
    // carry scraped-adjacent prose, so each keeps its own DOM-asserting proof. Switching
    // `whyItMatters` alone to dangerouslySetInnerHTML left every test in the pre-redesign file
    // green until this test existed (verified by mutation).
    const whyItMatters =
      "Because <model> matters, unlike <script>alert(3)</script> which is prose quoted here.";
    const article = toFeedArticle(raw({ whyItMatters }));
    const { container } = render(<ArticleCard article={article} now={NOW} />);
    expect(container.querySelector("script")).toBeNull();
    expect(screen.getByTestId("why-it-matters").textContent).toBe(whyItMatters);
  });

  it("renders title's bracketed prose and a defanged script tag as visible text too, and creates no script element -- final review, N2", () => {
    // Title is not subject to the ingest stripTags heuristic the way summary/whyItMatters are,
    // but nothing in this component's contract prevents a future edit from switching it to
    // dangerouslySetInnerHTML either -- and before this test existed, one would have (verified
    // by mutation: every test in the file stayed green).
    const title =
      "The <model> improved, unlike <script>alert(4)</script> which is prose quoted here.";
    const article = toFeedArticle(raw({ title }));
    const { container } = render(<ArticleCard article={article} now={NOW} />);
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("h3")?.textContent).toBe(title);
  });
});

// DaySection's own tests moved to tests/feed/day-section.test.tsx (Task C2) once it took
// ranked entries plus totalInDay instead of a bare articles array -- a signature no longer
// shared with ArticleCard's own props, so it no longer belongs in this file.
