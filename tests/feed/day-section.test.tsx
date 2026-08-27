// @vitest-environment jsdom
//
// Opt-in per file, not global -- see the docblock in tests/feed/card.test.tsx for why: this
// suite needs a DOM and explicit `afterEach(cleanup)` because `test.globals` is false
// project-wide.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DaySection, type RankedEntry } from "../../components/DaySection.js";
import { toFeedArticle } from "../../src/lib/feed/shape.js";

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

/** Every entry's rank span carries both `aria-hidden` (decorative -- the number is content the
 *  sighted layout conveys via position, not something a screen reader should announce twice)
 *  and `data-numeric`; the header's own count span carries `data-numeric` without
 *  `aria-hidden="true"`, and the day's gold double-rule div is `aria-hidden` without
 *  `data-numeric`, so this selector picks out only the per-entry rank numbers. */
const rankTexts = (container: HTMLElement): (string | null)[] =>
  Array.from(container.querySelectorAll('[aria-hidden="true"][data-numeric]')).map(
    (el) => el.textContent,
  );

/** The rank numerals rendered with the lead treatment. Modern Classic retired the field
 *  inversion; on the entry itself the lead now reads as the full-strength gold display numeral
 *  (`text-[color:var(--gold)]`), while every non-lead numeral gets soft gold
 *  (`text-[color:var(--gold-soft)]` -- note the closing bracket keeps the two class strings
 *  from matching each other as substrings). */
const leadRankTexts = (container: HTMLElement): (string | null)[] =>
  Array.from(container.querySelectorAll('[aria-hidden="true"][data-numeric]'))
    .filter((el) => el.className.includes("text-[color:var(--gold)]"))
    .map((el) => el.textContent);

const entriesFrom = (items: ReturnType<typeof toFeedArticle>[]): RankedEntry[] =>
  items.map((article, i) => ({ article, rank: i + 1 }));

describe("DaySection", () => {
  it("shows the count of the articles it is actually rendering, unfiltered", () => {
    const items = [
      raw({ pk: `ART#${"a".repeat(64)}` }),
      raw({ pk: `ART#${"b".repeat(64)}` }),
    ].map(toFeedArticle);
    const entries = entriesFrom(items);
    render(<DaySection day="2026-08-18" entries={entries} totalInDay={items.length} now={NOW} />);
    expect(screen.getByText("2 stories")).toBeTruthy();
  });

  it("uses singular 'story' for exactly one article, unfiltered", () => {
    const items = [toFeedArticle(raw())];
    const entries = entriesFrom(items);
    render(<DaySection day="2026-08-18" entries={entries} totalInDay={items.length} now={NOW} />);
    expect(screen.getByText("1 story")).toBeTruthy();
  });

  it("renders one card per entry, preserving the given (score) order", () => {
    const items = [
      raw({ pk: `ART#${"a".repeat(64)}`, title: "First" }),
      raw({ pk: `ART#${"b".repeat(64)}`, title: "Second" }),
    ].map(toFeedArticle);
    const entries = entriesFrom(items);
    const { container } = render(
      <DaySection day="2026-08-18" entries={entries} totalInDay={items.length} now={NOW} />,
    );
    const titles = Array.from(container.querySelectorAll("h3")).map((h) => h.textContent);
    expect(titles).toEqual(["First", "Second"]);
  });

  it("shows the day string in the header", () => {
    render(<DaySection day="2026-08-18" entries={[]} totalInDay={0} now={NOW} />);
    expect(screen.getByText("18.08.2026")).toBeTruthy();
  });

  it("links the header date to its own day page -- fix round 1, F3", () => {
    render(<DaySection day="2026-08-18" entries={[]} totalInDay={0} now={NOW} />);
    expect(screen.getByRole("link", { name: "18.08.2026" }).getAttribute("href")).toBe(
      "/day/2026-08-18",
    );
  });

  it("renders '93 stories' and ranks 1 through 93, unfiltered -- a day sheet at real scale", () => {
    const items = Array.from({ length: 93 }, (_, i) =>
      toFeedArticle(raw({ pk: `ART#story-${i}`, title: `Story ${i + 1}` })),
    );
    const entries = entriesFrom(items);
    const { container } = render(
      <DaySection day="2026-08-18" entries={entries} totalInDay={items.length} now={NOW} />,
    );

    expect(screen.getByText("93 stories")).toBeTruthy();
    // Modern Classic prints the rank as a folio numeral, not a counter: no zero-padding
    // ("1", never "01") -- the padding belonged to the retired tabular device.
    expect(rankTexts(container)).toEqual(Array.from({ length: 93 }, (_, i) => String(i + 1)));
  });

  it("opens the day with the gold double-rule and 'The lead' tag, before any entry", () => {
    // The lead's announcement moved off the entry and onto the day itself: Modern Classic's
    // replacement for the retired field inversion is DaySection's own apparatus -- a decorative
    // gold double-rule, then the "The lead" tag, and only then the entries. Order matters: the
    // device announces what follows, so both must precede the first entry.
    const items = [
      raw({ pk: `ART#${"a".repeat(64)}`, title: "First" }),
      raw({ pk: `ART#${"b".repeat(64)}`, title: "Second" }),
    ].map(toFeedArticle);
    const { container } = render(
      <DaySection
        day="2026-08-18"
        entries={entriesFrom(items)}
        totalInDay={items.length}
        now={NOW}
      />,
    );

    const children = Array.from(container.querySelector("section")?.children ?? []);
    const ruleIdx = children.findIndex(
      (el) => el.tagName === "DIV" && el.getAttribute("aria-hidden") === "true",
    );
    const tagIdx = children.findIndex((el) => el.textContent === "The lead");
    const firstEntryIdx = children.findIndex((el) => el.querySelector("h3") !== null);

    // The rule is ornament, so it must stay hidden from screen readers (aria-hidden above is
    // part of the findIndex predicate) and painted with the soft gold borders.
    expect(ruleIdx).toBeGreaterThan(-1);
    expect(children[ruleIdx]?.className).toContain("border-[var(--gold-soft)]");
    // The tag is apparatus text, and both sit between the header and the first entry.
    expect(tagIdx).toBeGreaterThan(ruleIdx);
    expect(children[tagIdx]?.className).toContain("apparatus");
    expect(firstEntryIdx).toBeGreaterThan(tagIdx);
  });

  it("under a filtered shape, keeps each entry's original day rank, reads 'K of N stories', and gives only the first entry the lead treatment", () => {
    // Ranks 1, 4, and 7 out of a 9-story day -- the day sheet's own filtered-shape contract
    // (shared-preamble.md's "Filter states" paragraph): rank is a fact about the day, not the
    // filter, so a filtered render must print the day's real numbers, not 1, 2, 3.
    const articleOne = toFeedArticle(raw({ pk: `ART#${"a".repeat(64)}`, title: "Day's actual rank one" }));
    const articleFour = toFeedArticle(raw({ pk: `ART#${"b".repeat(64)}`, title: "Day's actual rank four" }));
    const articleSeven = toFeedArticle(raw({ pk: `ART#${"c".repeat(64)}`, title: "Day's actual rank seven" }));
    const entries: RankedEntry[] = [
      { article: articleOne, rank: 1 },
      { article: articleFour, rank: 4 },
      { article: articleSeven, rank: 7 },
    ];

    const { container } = render(
      <DaySection day="2026-08-18" entries={entries} totalInDay={9} now={NOW} />,
    );

    expect(screen.getByText("3 of 9 stories")).toBeTruthy();
    expect(rankTexts(container)).toEqual(["1", "4", "7"]);

    // Only the first entry given (rank 1, the day's actual lead) gets the lead treatment,
    // regardless of how few entries the filter left, and no other entry does -- `ArticleCard`
    // only sets the `data-lead` marker and the full-gold display numeral on the entry it
    // renders as `lead` (the field inversion is retired; the announcement itself is the day's
    // gold rule + tag, asserted above).
    const leadLinks = container.querySelectorAll("a[data-lead]");
    expect(leadLinks.length).toBe(1);
    expect(leadLinks[0]?.textContent).toContain("Day's actual rank one");
    expect(leadRankTexts(container)).toEqual(["1"]);
  });

  it("gives the first entry given the lead treatment even when the day's #1 story was filtered out entirely (branch review I2)", () => {
    // Every fixture above keeps rank 1 among the survivors, so `lead={i === 0}` and the wrong
    // `lead={entry.rank === 1}` produce identical output for all of them -- a day whose #1 story
    // was itself filtered out is the only shape that tells the two apart. Ranks 4, 7, 9 out of a
    // 10-story day: the day's real lead (rank 1) is absent, so the first SURVIVING entry (rank
    // 4) must be the one that carries the lead marker and the full-gold numeral --
    // `entry.rank === 1` would mark nothing at all here.
    const articleFour = toFeedArticle(raw({ pk: `ART#${"d".repeat(64)}`, title: "Day's actual rank four" }));
    const articleSeven = toFeedArticle(raw({ pk: `ART#${"e".repeat(64)}`, title: "Day's actual rank seven" }));
    const articleNine = toFeedArticle(raw({ pk: `ART#${"f".repeat(64)}`, title: "Day's actual rank nine" }));
    const entries: RankedEntry[] = [
      { article: articleFour, rank: 4 },
      { article: articleSeven, rank: 7 },
      { article: articleNine, rank: 9 },
    ];

    const { container } = render(
      <DaySection day="2026-08-18" entries={entries} totalInDay={10} now={NOW} />,
    );

    expect(rankTexts(container)).toEqual(["4", "7", "9"]);

    const leadLinks = container.querySelectorAll("a[data-lead]");
    expect(leadLinks.length).toBe(1);
    expect(leadLinks[0]?.textContent).toContain("Day's actual rank four");
    expect(leadRankTexts(container)).toEqual(["4"]);
  });
});
