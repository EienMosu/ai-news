// @vitest-environment jsdom
//
// LIVE_SEARCH_SCRIPT, executed for real against the real rendered markup. React's
// dangerouslySetInnerHTML never runs a script in jsdom (same as the browser's innerHTML
// rule), so each test evals the exported string directly after mounting -- which is also
// what pins the script and the markup to the same contract: data-day-sheet, data-entry,
// data-haystack, data-day-count/data-total and .folio are the script's whole API, and a
// rename on either side fails here first.
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DaySection, type RankedEntry } from "../../components/DaySection.js";
import { FilterRow, LIVE_SEARCH_SCRIPT } from "../../components/FilterRow.js";
import { toFeedArticle } from "../../src/lib/feed/shape.js";

const NOW = new Date("2026-08-18T12:00:00.000Z");

const raw = (over: Record<string, unknown> = {}) => ({
  pk: `ART#${"a".repeat(64)}`, sk: "A", title: "T", summary: "s", imageUrl: null,
  url: "https://e.com/p", source: "techcrunch", sourceName: "TechCrunch",
  category: "news", section: "ai", publishedAt: "2026-08-18T09:00:00.000Z",
  clusterId: null, corroborationToday: null, whyItMatters: null, score: 500,
  scoreVersion: "v1", points: null, pointsImputed: true, llmImportance: null,
  firstSeenAt: "2026-08-18T10:00:00.000Z",
  ...over,
});

const entry = (id: string, title: string, rank: number): RankedEntry => ({
  article: toFeedArticle(raw({ pk: `ART#${id.repeat(64).slice(0, 64)}`, title })),
  rank,
});

/** Mounts the row plus two day sheets, then runs the script -- the shape a feed page serves. */
function mount() {
  const dayA: RankedEntry[] = [
    entry("a", "Alpha ships a model", 1),
    entry("b", "Beta raises a round", 2),
    entry("c", "Gamma releases a paper", 3),
  ];
  const dayB: RankedEntry[] = [entry("d", "Beta acquires a lab", 1)];
  const view = render(
    <div>
      <FilterRow section="ai" basePath="/" activeF={null} />
      <DaySection day="2026-08-18" entries={dayA} totalInDay={3} now={NOW} />
      <DaySection day="2026-08-17" entries={dayB} totalInDay={1} now={NOW} />
    </div>,
  );
  window.eval(LIVE_SEARCH_SCRIPT);
  const input = view.container.querySelector('input[name="f"]') as HTMLInputElement;
  return { view, input };
}

const type = (input: HTMLInputElement, value: string) => {
  fireEvent.input(input, { target: { value } });
  vi.advanceTimersByTime(250);
};

const sheets = () => Array.from(document.querySelectorAll("[data-day-sheet]"));
const visibleTitles = () =>
  Array.from(document.querySelectorAll("[data-entry]:not([hidden]) h3")).map(
    (el) => el.textContent,
  );
const visibleFolios = () =>
  Array.from(document.querySelectorAll("[data-entry]:not([hidden]) .folio")).map(
    (el) => el.textContent,
  );

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  document.getElementById("live-empty")?.remove();
  vi.useRealTimers();
});

describe("LIVE_SEARCH_SCRIPT against the rendered feed", () => {
  it("narrows entries to substring matches, renumbers visible folios 1..k, and rewrites the day count", () => {
    const { input } = mount();
    type(input, "beta");

    expect(visibleTitles()).toEqual(["Beta raises a round", "Beta acquires a lab"]);
    // The survivor was rank 2 on its day; visible position says 1 now, the owner's rule.
    expect(visibleFolios()).toEqual(["1", "1"]);
    const counts = document.querySelectorAll("[data-day-count]");
    expect(counts[0]?.textContent).toBe("1 of 3 stories");
    expect(counts[1]?.textContent).toBe("1 story");
    expect(sheets().map((s) => (s as HTMLElement).hidden)).toEqual([false, false]);
  });

  it("waits out the debounce -- nothing narrows until 250ms of quiet", () => {
    const { input } = mount();
    fireEvent.input(input, { target: { value: "beta" } });
    vi.advanceTimersByTime(200);
    expect(visibleTitles()).toHaveLength(4);
    vi.advanceTimersByTime(50);
    expect(visibleTitles()).toHaveLength(2);
  });

  it("hides a sheet whose day has no matches, exactly as the app hides empty days", () => {
    const { input } = mount();
    type(input, "gamma");
    expect(sheets().map((s) => (s as HTMLElement).hidden)).toEqual([false, true]);
  });

  it("shows the one No-matches note when nothing survives anywhere, and clears it after", () => {
    const { input } = mount();
    type(input, "zzz nothing has this");
    expect(sheets().every((s) => (s as HTMLElement).hidden)).toBe(true);
    const note = document.getElementById("live-empty");
    expect(note?.hidden).toBe(false);
    expect(note?.textContent).toBe("No matches in these days.");

    type(input, "beta");
    expect(document.getElementById("live-empty")?.hidden).toBe(true);
  });

  it("restores everything on a cleared field: no hidden entries, original numbering and counts", () => {
    const { input } = mount();
    type(input, "beta");
    type(input, "");

    expect(visibleTitles()).toHaveLength(4);
    expect(visibleFolios()).toEqual(["1", "2", "3", "1"]);
    const counts = document.querySelectorAll("[data-day-count]");
    expect(counts[0]?.textContent).toBe("3 stories");
    expect(counts[1]?.textContent).toBe("1 story");
    expect(sheets().every((s) => (s as HTMLElement).hidden)).toBe(false);
  });

  it("prevents the form's GET submit -- Enter dismisses the keyboard instead of reloading", () => {
    const { input } = mount();
    // fireEvent returns false when a handler called preventDefault.
    expect(fireEvent.submit(input.form as HTMLFormElement)).toBe(false);
  });

  it("matches against summary and source too -- the same haystack the server's matchesFilter uses", () => {
    const { input } = mount();
    type(input, "techcrunch");
    expect(visibleTitles()).toHaveLength(4);
    type(input, "raises a round");
    expect(visibleTitles()).toEqual(["Beta raises a round"]);
  });
});
