// @vitest-environment jsdom
//
// Opt-in per file -- see the docblock in tests/feed/card.test.tsx for why: this file needs a
// DOM and explicit `afterEach(cleanup)` because `test.globals` is false project-wide.
//
// `app/page.tsx` and `app/design/page.tsx` are a hand-copy of each other with three coupled
// strings changed (the `getFeed` argument, `SectionNav`'s `current`, `FeedView`'s `section`) --
// the classic copy-paste seam, and nothing else in this suite pins any of the three. Mocking
// `getFeed` (the module, not the AWS SDK underneath it -- read.test.ts already covers that
// layer) lets these tests `await` each page component directly and assert on exactly that seam,
// without a DynamoDB mock. See task-5-review.md finding 3: the reviewer rewrote
// `app/design/page.tsx` to serve the AI vertical entirely and the suite stayed green with
// nothing here to catch it -- these tests are what closes that gap.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/lib/feed/read.js", () => ({
  getFeed: vi.fn(),
}));

import DesignPage from "../../app/design/page.js";
import Home from "../../app/page.js";
import { getFeed } from "../../src/lib/feed/read.js";

afterEach(() => {
  cleanup();
  vi.mocked(getFeed).mockReset();
});

// A day that ranked fine but has nothing for whichever section asks. The empty-section message
// names the section it was given, which is what makes the FeedView-prop assertions below
// possible without inspecting props directly.
const EMPTY_DAY_RESULT = {
  articles: [],
  day: "2026-08-18",
  status: "complete" as const,
  llmRankedInDay: 5,
  truncatedInDay: 0,
};

describe("Home (app/page.tsx)", () => {
  it("asks getFeed for the 'ai' section", async () => {
    vi.mocked(getFeed).mockResolvedValue(EMPTY_DAY_RESULT);
    render(await Home());
    expect(getFeed).toHaveBeenCalledWith("ai");
  });

  it("marks the AI nav link current, not Design", async () => {
    vi.mocked(getFeed).mockResolvedValue(EMPTY_DAY_RESULT);
    render(await Home());
    expect(screen.getByRole("link", { name: "AI" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Design" }).getAttribute("aria-current")).toBeNull();
  });

  it("passes its own section to FeedView, not the other one", async () => {
    vi.mocked(getFeed).mockResolvedValue(EMPTY_DAY_RESULT);
    render(await Home());
    expect(screen.getByText("No AI stories for 2026-08-18.")).toBeTruthy();
  });
});

describe("DesignPage (app/design/page.tsx)", () => {
  it("asks getFeed for the 'design' section", async () => {
    vi.mocked(getFeed).mockResolvedValue(EMPTY_DAY_RESULT);
    render(await DesignPage());
    expect(getFeed).toHaveBeenCalledWith("design");
  });

  it("marks the Design nav link current, not AI", async () => {
    vi.mocked(getFeed).mockResolvedValue(EMPTY_DAY_RESULT);
    render(await DesignPage());
    expect(screen.getByRole("link", { name: "Design" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "AI" }).getAttribute("aria-current")).toBeNull();
  });

  it("passes its own section to FeedView, not the other one", async () => {
    vi.mocked(getFeed).mockResolvedValue(EMPTY_DAY_RESULT);
    render(await DesignPage());
    expect(screen.getByText("No design stories for 2026-08-18.")).toBeTruthy();
  });
});
