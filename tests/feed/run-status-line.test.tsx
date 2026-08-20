// @vitest-environment jsdom
//
// Opt-in per file -- see the docblock in tests/feed/card.test.tsx for why: this file needs a
// DOM and explicit `afterEach(cleanup)` because `test.globals` is false project-wide.
//
// Mocks `src/lib/feed/read.js` (the module, not the AWS SDK underneath it -- read.test.ts
// already covers that layer), the same pattern tests/feed/day-page.test.tsx uses: `await` the
// component directly and assert on what it does with the data, without a DynamoDB mock.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/lib/feed/read.js", () => ({ getRunStatus: vi.fn(), getArchive: vi.fn() }));

// Fix round 1, F10: the component is `RunStatusLine`, not `RunStatus` -- the data interface
// below already owns that name, so importing both here no longer needs an alias.
import { RunStatusLine } from "../../components/RunStatusLine.js";
import { getArchive, getRunStatus, type RunStatus } from "../../src/lib/feed/read.js";
import type { DayMeta } from "../../src/lib/store/meta.js";

afterEach(() => {
  cleanup();
  vi.mocked(getRunStatus).mockReset();
  vi.mocked(getArchive).mockReset();
});

const NOW = new Date("2026-08-18T10:00:00.000Z"); // 4h after the fixture's startedAt below

const baseStatus: RunStatus = {
  startedAt: "2026-08-18T06:00:00.000Z",
  durationMs: 1000,
  perSourceCounts: {},
  filtered: {},
  quarantined: {},
  llmStatus: "ok",
  itemsWritten: 0,
  itemsFailed: 0,
  errors: [],
};

const dayMeta = (over: Partial<DayMeta> = {}): DayMeta => ({
  day: "2026-08-17",
  status: "partial",
  articleCount: 264,
  llmRanked: 250,
  truncated: 14,
  llmStatus: "ok",
  runId: "r1",
  completedAt: "2026-08-17T03:00:00.000Z",
  ...over,
});

describe("RunStatusLine", () => {
  it("renders a plain statement, not any of the five states, when the pipeline has never run", async () => {
    vi.mocked(getRunStatus).mockResolvedValue(null);
    vi.mocked(getArchive).mockResolvedValue([]);

    render(await RunStatusLine({ now: NOW }));

    expect(screen.getByTestId("run-status-empty").textContent).toBe("No ingest run recorded yet.");
    expect(screen.queryByTestId("run-status")).toBeNull();
  });

  it("fix round 1 F6: degrades to a status-unavailable line rather than throwing when getRunStatus rejects", async () => {
    vi.mocked(getRunStatus).mockRejectedValue(new Error("DynamoDB blip"));
    vi.mocked(getArchive).mockResolvedValue([]);

    // The whole point of F6: this must resolve to a rendered element, not a rejected promise
    // that would propagate out of the page and take the rest of the page's own content with it.
    render(await RunStatusLine({ now: NOW }));

    expect(screen.getByTestId("run-status-unavailable").textContent).toBe("Run status unavailable.");
    expect(screen.queryByTestId("run-status")).toBeNull();
  });

  it("renders the spec §8 summary line, with the LLM clause sourced from the latest META#DAY", async () => {
    vi.mocked(getRunStatus).mockResolvedValue({
      ...baseStatus,
      itemsWritten: 229,
      perSourceCounts: { techcrunch: 10, verge: 20 },
    });
    vi.mocked(getArchive).mockResolvedValue([dayMeta({ day: "2026-08-17", llmStatus: "ok" })]);

    render(await RunStatusLine({ now: NOW }));

    expect(screen.getByTestId("run-status-summary").textContent).toBe(
      "last run 4h ago · 229 items · 2/2 sources · LLM ok (ranked through 2026-08-17)",
    );
    // getArchive(1) is the read this clause depends on -- confirms the component actually calls
    // it, not merely that summarizeRunStatus can accept a DayMeta if handed one.
    expect(getArchive).toHaveBeenCalledWith(1);
  });

  it("fix round 1 F2: reads 'no ranked day yet' when getArchive resolves an empty archive", async () => {
    vi.mocked(getRunStatus).mockResolvedValue({ ...baseStatus, perSourceCounts: { techcrunch: 10 } });
    vi.mocked(getArchive).mockResolvedValue([]);

    render(await RunStatusLine({ now: NOW }));

    expect(screen.getByTestId("run-status-summary").textContent).toContain("LLM no ranked day yet");
  });

  it("fix round 1 F6: a failed archive read degrades only the LLM clause, not the whole line", async () => {
    vi.mocked(getRunStatus).mockResolvedValue({ ...baseStatus, perSourceCounts: { techcrunch: 10 } });
    vi.mocked(getArchive).mockRejectedValue(new Error("DynamoDB blip"));

    render(await RunStatusLine({ now: NOW }));

    const text = screen.getByTestId("run-status-summary").textContent;
    expect(text).toContain("LLM status unavailable");
    // The per-source summary -- the primary content this component exists to show -- survives
    // the secondary read's failure intact.
    expect(text).toContain("last run 4h ago · 0 items · 1/1 sources");
  });

  it("never surfaces DayMeta.status ('partial') in the rendered line -- it is permanently partial under the rank cap", async () => {
    vi.mocked(getRunStatus).mockResolvedValue({ ...baseStatus, perSourceCounts: { techcrunch: 10 } });
    vi.mocked(getArchive).mockResolvedValue([dayMeta({ status: "partial" })]);

    render(await RunStatusLine({ now: NOW }));

    expect(screen.getByTestId("run-status-summary").textContent).not.toContain("partial");
  });

  it("renders no notable-sources list when every source is healthy", async () => {
    vi.mocked(getRunStatus).mockResolvedValue({
      ...baseStatus,
      perSourceCounts: { techcrunch: 10 },
    });
    vi.mocked(getArchive).mockResolvedValue([]);

    render(await RunStatusLine({ now: NOW }));

    expect(screen.queryByTestId("run-status-notable")).toBeNull();
  });

  it("fix round 1 F3: a source that quarantines one item while still producing counts toward the fraction", async () => {
    // The anthropic case spec §8 names: producing is producing, whether or not it also
    // quarantined something. A healthy day (nothing genuinely broken) must be able to read
    // M/M, not permanently M-1/M.
    vi.mocked(getRunStatus).mockResolvedValue({
      ...baseStatus,
      perSourceCounts: { techcrunch: 10, anthropic: 40 },
      quarantined: { anthropic: 1 },
    });
    vi.mocked(getArchive).mockResolvedValue([]);

    render(await RunStatusLine({ now: NOW }));

    expect(screen.getByTestId("run-status-summary").textContent).toContain("2/2 sources");
  });

  it("names a quarantined source explicitly, in amber, even though it also produced items", async () => {
    // The anthropic case spec §8 names by name: one degenerate title a day must never be
    // hidden, and must never be worded as a fault either.
    vi.mocked(getRunStatus).mockResolvedValue({
      ...baseStatus,
      perSourceCounts: { anthropic: 40 },
      quarantined: { anthropic: 1 },
    });
    vi.mocked(getArchive).mockResolvedValue([]);

    render(await RunStatusLine({ now: NOW }));

    const item = screen.getByText("anthropic: parser or schema drift");
    expect(item.className).toContain("text-amber-600");
  });

  it("names a quiet source in grey, worded as quiet rather than any kind of failure", async () => {
    vi.mocked(getRunStatus).mockResolvedValue({
      ...baseStatus,
      filtered: { alistapart: 3 },
    });
    vi.mocked(getArchive).mockResolvedValue([]);

    render(await RunStatusLine({ now: NOW }));

    const item = screen.getByText("alistapart: quiet");
    expect(item.className).toBe("text-neutral-400");
  });

  it("never renders a red/rose/danger class, even for a dead source", async () => {
    vi.mocked(getRunStatus).mockResolvedValue({
      ...baseStatus,
      perSourceCounts: { deadsource: 0 },
    });
    vi.mocked(getArchive).mockResolvedValue([]);

    render(await RunStatusLine({ now: NOW }));

    const item = screen.getByText("deadsource: no items");
    expect(item.className).not.toMatch(/red|rose|danger/i);
  });

  it("labels a fetch-failure source distinctly from a dead one", async () => {
    vi.mocked(getRunStatus).mockResolvedValue({
      ...baseStatus,
      errors: [{ source: "flaky", message: "HTTP 429" }],
    });
    vi.mocked(getArchive).mockResolvedValue([]);

    render(await RunStatusLine({ now: NOW }));

    expect(screen.getByText("flaky: fetch failed")).toBeTruthy();
  });
});
