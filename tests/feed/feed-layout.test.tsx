// @vitest-environment jsdom
//
// Opt-in per file -- see the docblock in tests/feed/card.test.tsx for why: this file needs a
// DOM and explicit `afterEach(cleanup)` because `test.globals` is false project-wide.
//
// Fix round 2: `RunStatusLine` moved out of the five individual pages and into
// `app/(feed)/layout.tsx` -- a single call site every route in the group is forced through by
// Next's own routing, rather than six call sites a future page could simply omit. This file is
// the one place that tests the layout ACTUALLY composes `RunStatusLine` with its children;
// `tests/structure/page-groups.test.ts` is the other half -- it proves every `page.tsx` is
// forced into this group (or explicitly allowlisted) in the first place. Neither file alone
// closes fix round 1's F7-residual gap; together they do.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/lib/feed/read.js", () => ({ getRunStatus: vi.fn(), getArchive: vi.fn() }));

import FeedLayout from "../../app/(feed)/layout.js";
import { getArchive, getRunStatus } from "../../src/lib/feed/read.js";

afterEach(() => {
  cleanup();
  vi.mocked(getRunStatus).mockReset();
  vi.mocked(getArchive).mockReset();
});

describe("FeedLayout (app/(feed)/layout.tsx)", () => {
  it("renders RunStatusLine's output", async () => {
    vi.mocked(getRunStatus).mockResolvedValue(null);
    vi.mocked(getArchive).mockResolvedValue([]);

    render(await FeedLayout({ children: <div data-testid="page-content">the page</div> }));

    // `run-status-empty` is RunStatusLine's own testid for "pipeline never ran" -- proves this
    // layout actually calls it, not merely that it compiles alongside it.
    expect(screen.getByTestId("run-status-empty")).toBeTruthy();
  });

  it("still renders its children -- a layout that swallows them breaks every page in the group", async () => {
    vi.mocked(getRunStatus).mockResolvedValue(null);
    vi.mocked(getArchive).mockResolvedValue([]);

    render(await FeedLayout({ children: <div data-testid="page-content">the page</div> }));

    expect(screen.getByTestId("page-content").textContent).toBe("the page");
  });

  it("renders the run-status line before the page content, in document order", async () => {
    vi.mocked(getRunStatus).mockResolvedValue(null);
    vi.mocked(getArchive).mockResolvedValue([]);

    render(await FeedLayout({ children: <div data-testid="page-content">the page</div> }));

    const line = screen.getByTestId("run-status-empty");
    const content = screen.getByTestId("page-content");
    expect(line.compareDocumentPosition(content) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("passes a real summary through when a run has recorded status -- not just the empty case", async () => {
    vi.mocked(getRunStatus).mockResolvedValue({
      startedAt: "2026-08-18T06:00:00.000Z",
      durationMs: 1000,
      perSourceCounts: { techcrunch: 10 },
      filtered: {},
      quarantined: {},
      llmStatus: "ok",
      itemsWritten: 10,
      itemsFailed: 0,
      errors: [],
    });
    vi.mocked(getArchive).mockResolvedValue([]);

    render(await FeedLayout({ children: <div data-testid="page-content">the page</div> }));

    expect(screen.getByTestId("run-status-summary")).toBeTruthy();
    expect(screen.getByTestId("page-content")).toBeTruthy();
  });
});
