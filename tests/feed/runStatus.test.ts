import { describe, expect, it } from "vitest";
import {
  classifySourceState,
  SOURCE_STATE_CLASS,
  SOURCE_STATE_LABEL,
  summarizeRunStatus,
  type SourceCounts,
} from "../../src/lib/feed/runStatus.js";
import type { RunStatus } from "../../src/lib/feed/read.js";

const counts = (over: Partial<SourceCounts> = {}): SourceCounts => ({
  produced: 0, filtered: 0, quarantined: 0, hasError: false, ...over,
});

describe("classifySourceState -- spec §8's five-state table", () => {
  it("row 1: produced>0, quarantined=0, no error -> healthy", () => {
    expect(classifySourceState(counts({ produced: 5 }))).toBe("healthy");
  });

  it("row 1: 'any' filtered does not change the healthy verdict", () => {
    expect(classifySourceState(counts({ produced: 5, filtered: 12 }))).toBe("healthy");
  });

  it("row 2: produced=0, filtered>0, quarantined=0, no error -> quiet", () => {
    expect(classifySourceState(counts({ filtered: 3 }))).toBe("quiet");
  });

  it("row 3: quarantined>0 with produced>0 -> drift, not healthy (the anthropic case)", () => {
    // This is the row-precedence check: produced>0 alone would satisfy row 1's condition, but
    // quarantined>0 must win. Mutating classifySourceState to check `produced > 0` before
    // `quarantined > 0` makes this test fail while the plain "row 1" test above still passes.
    expect(classifySourceState(counts({ produced: 40, quarantined: 1 }))).toBe("drift");
  });

  it("row 3: quarantined>0 with produced=0 -> drift, not dead", () => {
    expect(classifySourceState(counts({ quarantined: 2 }))).toBe("drift");
  });

  it("row 4: all zero with an error -> fetchFailed", () => {
    expect(classifySourceState(counts({ hasError: true }))).toBe("fetchFailed");
  });

  it("row 5: all zero, no error -> dead", () => {
    expect(classifySourceState(counts())).toBe("dead");
  });
});

describe("SOURCE_STATE_CLASS -- only amber and grey, never red", () => {
  // Spec §8: fetchFailed/dead only turn red after two consecutive runs, and getRunStatus
  // (src/lib/feed/read.ts) reads a single run with no history of the run before it -- there is
  // no signal here to check "two consecutive" against. Capping both at amber, the same as
  // drift, is a deliberate choice documented in runStatus.ts and the Task 9 report, not an
  // oversight; this test pins it so a future change cannot reintroduce a red class without
  // also reintroducing the cross-run signal that would justify it.
  it("never assigns a red/rose/danger-named class to any state", () => {
    for (const cls of Object.values(SOURCE_STATE_CLASS)) {
      expect(cls).not.toMatch(/red|rose|danger/i);
    }
  });

  it("quiet is grey, not amber -- spec §8: a reliably-quiet source is not a fault", () => {
    expect(SOURCE_STATE_CLASS.quiet).toBe("text-neutral-400");
  });

  it("drift, fetchFailed and dead all render the same amber, the cap this task chose", () => {
    expect(SOURCE_STATE_CLASS.drift).toBe(SOURCE_STATE_CLASS.fetchFailed);
    expect(SOURCE_STATE_CLASS.fetchFailed).toBe(SOURCE_STATE_CLASS.dead);
  });
});

describe("SOURCE_STATE_LABEL", () => {
  it("names drift as schema drift, not as a generic error", () => {
    expect(SOURCE_STATE_LABEL.drift).toBe("parser or schema drift");
  });
});

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

describe("summarizeRunStatus", () => {
  const now = new Date("2026-08-18T10:00:00.000Z"); // 4h after startedAt

  it("builds the relative time from startedAt using the given `now`, not the real clock", () => {
    const summary = summarizeRunStatus(baseStatus, now);
    expect(summary.relativeTime).toBe("4h ago");
  });

  it("passes itemsWritten through unchanged", () => {
    const summary = summarizeRunStatus({ ...baseStatus, itemsWritten: 229 }, now);
    expect(summary.itemsWritten).toBe(229);
  });

  it("counts producingCount as sources classified healthy, out of every known source id", () => {
    const status: RunStatus = {
      ...baseStatus,
      perSourceCounts: { techcrunch: 10, alistapart: 0, anthropic: 40 },
      filtered: { techcrunch: 0, alistapart: 5, anthropic: 0 },
      quarantined: { techcrunch: 0, alistapart: 0, anthropic: 1 },
    };
    const summary = summarizeRunStatus(status, now);

    // techcrunch: healthy. alistapart: quiet (row 2). anthropic: drift (row 3, quarantined
    // wins over its 40 produced). Only techcrunch counts toward producingCount.
    expect(summary.producingCount).toBe(1);
    expect(summary.totalSources).toBe(3);
  });

  it("lists every non-healthy source in `notable`, sorted by id", () => {
    const status: RunStatus = {
      ...baseStatus,
      perSourceCounts: { zeta: 0, alistapart: 0 },
      filtered: { zeta: 0, alistapart: 5 },
      quarantined: { zeta: 0, alistapart: 0 },
      errors: [{ source: "zeta", message: "HTTP 429" }],
    };
    const summary = summarizeRunStatus(status, now);

    expect(summary.notable).toEqual([
      { source: "alistapart", state: "quiet" },
      { source: "zeta", state: "fetchFailed" },
    ]);
  });

  it("never puts a healthy source in `notable`", () => {
    const status: RunStatus = { ...baseStatus, perSourceCounts: { techcrunch: 10 } };
    const summary = summarizeRunStatus(status, now);
    expect(summary.notable).toEqual([]);
  });

  it("includes a source known only through `errors`, absent from the count maps, in the total", () => {
    const status: RunStatus = {
      ...baseStatus,
      errors: [{ source: "orphan", message: "boom" }],
    };
    const summary = summarizeRunStatus(status, now);
    expect(summary.totalSources).toBe(1);
    expect(summary.notable).toEqual([{ source: "orphan", state: "fetchFailed" }]);
  });

  it("maps llmStatus ok/skipped/failed to their own label", () => {
    expect(summarizeRunStatus({ ...baseStatus, llmStatus: "ok" }, now).llmLabel).toBe("ok");
    expect(summarizeRunStatus({ ...baseStatus, llmStatus: "skipped" }, now).llmLabel).toBe("skipped");
    expect(summarizeRunStatus({ ...baseStatus, llmStatus: "failed" }, now).llmLabel).toBe("failed");
  });

  it("labels a null llmStatus (an unrecognised stored value) as unknown, not a crash", () => {
    expect(summarizeRunStatus({ ...baseStatus, llmStatus: null }, now).llmLabel).toBe("unknown");
  });
});
