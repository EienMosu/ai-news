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

vi.mock("../../src/lib/feed/read.js", () => ({ getRunStatus: vi.fn() }));

import { RunStatus } from "../../components/RunStatus.js";
import { getRunStatus } from "../../src/lib/feed/read.js";
import type { RunStatus as RunStatusData } from "../../src/lib/feed/read.js";

afterEach(() => {
  cleanup();
  vi.mocked(getRunStatus).mockReset();
});

const NOW = new Date("2026-08-18T10:00:00.000Z"); // 4h after the fixture's startedAt below

const baseStatus: RunStatusData = {
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

describe("RunStatus", () => {
  it("renders a plain statement, not any of the five states, when the pipeline has never run", async () => {
    vi.mocked(getRunStatus).mockResolvedValue(null);

    render(await RunStatus({ now: NOW }));

    expect(screen.getByTestId("run-status-empty").textContent).toBe("No ingest run recorded yet.");
    expect(screen.queryByTestId("run-status")).toBeNull();
  });

  it("renders the spec §8 summary line: last run, items, sources, LLM status", async () => {
    vi.mocked(getRunStatus).mockResolvedValue({
      ...baseStatus,
      itemsWritten: 229,
      perSourceCounts: { techcrunch: 10, verge: 20 },
    });

    render(await RunStatus({ now: NOW }));

    expect(screen.getByTestId("run-status-summary").textContent).toBe(
      "last run 4h ago · 229 items · 2/2 sources · LLM ok",
    );
  });

  it("renders no notable-sources list when every source is healthy", async () => {
    vi.mocked(getRunStatus).mockResolvedValue({
      ...baseStatus,
      perSourceCounts: { techcrunch: 10 },
    });

    render(await RunStatus({ now: NOW }));

    expect(screen.queryByTestId("run-status-notable")).toBeNull();
  });

  it("names a quarantined source explicitly, in amber, even though it also produced items", async () => {
    // The anthropic case spec §8 names by name: one degenerate title a day must never be
    // hidden, and must never be worded as a fault either.
    vi.mocked(getRunStatus).mockResolvedValue({
      ...baseStatus,
      perSourceCounts: { anthropic: 40 },
      quarantined: { anthropic: 1 },
    });

    render(await RunStatus({ now: NOW }));

    const item = screen.getByText("anthropic: parser or schema drift");
    expect(item.className).toContain("text-amber-600");
  });

  it("names a quiet source in grey, worded as quiet rather than any kind of failure", async () => {
    vi.mocked(getRunStatus).mockResolvedValue({
      ...baseStatus,
      filtered: { alistapart: 3 },
    });

    render(await RunStatus({ now: NOW }));

    const item = screen.getByText("alistapart: quiet");
    expect(item.className).toBe("text-neutral-400");
  });

  it("never renders a red/rose/danger class, even for a dead source", async () => {
    vi.mocked(getRunStatus).mockResolvedValue({
      ...baseStatus,
      perSourceCounts: { deadsource: 0 },
    });

    render(await RunStatus({ now: NOW }));

    const item = screen.getByText("deadsource: no items");
    expect(item.className).not.toMatch(/red|rose|danger/i);
  });

  it("labels a fetch-failure source distinctly from a dead one", async () => {
    vi.mocked(getRunStatus).mockResolvedValue({
      ...baseStatus,
      errors: [{ source: "flaky", message: "HTTP 429" }],
    });

    render(await RunStatus({ now: NOW }));

    expect(screen.getByText("flaky: fetch failed")).toBeTruthy();
  });
});
