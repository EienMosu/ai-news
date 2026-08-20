import { describe, expect, it } from "vitest";
import {
  classifySourceState,
  SOURCE_STATE_CLASS,
  SOURCE_STATE_LABEL,
  summarizeRunStatus,
  type SourceCounts,
} from "../../src/lib/feed/runStatus.js";
import type { RunStatus } from "../../src/lib/feed/read.js";
import type { DayMeta } from "../../src/lib/store/meta.js";

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

  // These used to assert Tailwind colour names. The redesign moved state off hue entirely --
  // one vertical is drenched vermilion, where a red or amber warning cannot be seen, and the
  // other is drenched ink blue, where amber is the only thing on the page that glows. State now
  // ships as a stamp whose WORD carries the meaning (SOURCE_STATE_LABEL), and this map only sets
  // how hard the stamp is pressed. The product claims below are unchanged; only the mechanism
  // they are asserted against moved.

  it("quiet is pressed softer than a fault -- spec §8: a reliably-quiet source is not a fault", () => {
    expect(SOURCE_STATE_CLASS.quiet).not.toBe(SOURCE_STATE_CLASS.drift);
    expect(SOURCE_STATE_CLASS.quiet).toBe("opacity-70");
  });

  it("drift, fetchFailed and dead are pressed identically, the cap this layer can honestly claim", () => {
    expect(SOURCE_STATE_CLASS.drift).toBe(SOURCE_STATE_CLASS.fetchFailed);
    expect(SOURCE_STATE_CLASS.fetchFailed).toBe(SOURCE_STATE_CLASS.dead);
  });

  it("carries no colour at all, so neither field can swallow a state", () => {
    // The regression this guards: someone reintroducing `text-amber-600` here would make the
    // signal invisible on /design and glaring on /, from one map neither page controls.
    for (const value of Object.values(SOURCE_STATE_CLASS)) {
      expect(value).not.toMatch(/red|rose|amber|orange|yellow|green|text-/);
    }
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

describe("summarizeRunStatus", () => {
  const now = new Date("2026-08-18T10:00:00.000Z"); // 4h after startedAt

  it("builds the relative time from startedAt using the given `now`, not the real clock", () => {
    const summary = summarizeRunStatus(baseStatus, null, now);
    expect(summary.relativeTime).toBe("4h ago");
  });

  it("passes itemsWritten through unchanged", () => {
    const summary = summarizeRunStatus({ ...baseStatus, itemsWritten: 229 }, null, now);
    expect(summary.itemsWritten).toBe(229);
  });

  it("fix round 1 F3: producingCount counts healthy AND drift -- both mean 'produced something'", () => {
    const status: RunStatus = {
      ...baseStatus,
      perSourceCounts: { techcrunch: 10, alistapart: 0, anthropic: 40 },
      filtered: { techcrunch: 0, alistapart: 5, anthropic: 0 },
      quarantined: { techcrunch: 0, alistapart: 0, anthropic: 1 },
    };
    const summary = summarizeRunStatus(status, null, now);

    // techcrunch: healthy. alistapart: quiet (row 2, produced nothing). anthropic: drift (row
    // 3, quarantined wins over its 40 produced) -- but anthropic DID produce, so it counts too.
    // Only alistapart (quiet -- produced nothing at all) is excluded.
    expect(summary.producingCount).toBe(2);
    expect(summary.totalSources).toBe(3);
  });

  it("fix round 1 F3: a fully healthy day (nothing genuinely broken) reads the whole fraction, M/M", () => {
    // Before the fix, a source that quarantines one item while producing plenty (the anthropic
    // case spec §8 names as NOT a fault) permanently excluded that source from the numerator,
    // so a day with nothing actually broken could never read e.g. 2/2 -- the exact
    // alarm-that-always-fires §8 warns against, implemented inside the warning itself.
    const status: RunStatus = {
      ...baseStatus,
      perSourceCounts: { techcrunch: 10, anthropic: 40 },
      quarantined: { anthropic: 1 },
    };
    const summary = summarizeRunStatus(status, null, now);
    expect(summary.producingCount).toBe(summary.totalSources);
  });

  it("still excludes quiet, fetchFailed and dead sources from producingCount -- only drift changed", () => {
    const status: RunStatus = {
      ...baseStatus,
      perSourceCounts: { healthy1: 10, quiet1: 0, dead1: 0 },
      filtered: { healthy1: 0, quiet1: 5, dead1: 0 },
      errors: [{ source: "failed1", message: "HTTP 429" }],
    };
    const summary = summarizeRunStatus(status, null, now);
    expect(summary.producingCount).toBe(1);
    expect(summary.totalSources).toBe(4);
  });

  it("lists every non-healthy source in `notable`, sorted by id -- drift included, despite also producing", () => {
    const status: RunStatus = {
      ...baseStatus,
      perSourceCounts: { zeta: 0, alistapart: 0, anthropic: 40 },
      filtered: { zeta: 0, alistapart: 5, anthropic: 0 },
      quarantined: { zeta: 0, alistapart: 0, anthropic: 1 },
      errors: [{ source: "zeta", message: "HTTP 429" }],
    };
    const summary = summarizeRunStatus(status, null, now);

    expect(summary.notable).toEqual([
      { source: "alistapart", state: "quiet" },
      { source: "anthropic", state: "drift" },
      { source: "zeta", state: "fetchFailed" },
    ]);
  });

  it("never puts a healthy source in `notable`", () => {
    const status: RunStatus = { ...baseStatus, perSourceCounts: { techcrunch: 10 } };
    const summary = summarizeRunStatus(status, null, now);
    expect(summary.notable).toEqual([]);
  });

  it("includes a source known only through `errors`, absent from the count maps, in the total", () => {
    const status: RunStatus = {
      ...baseStatus,
      errors: [{ source: "orphan", message: "boom" }],
    };
    const summary = summarizeRunStatus(status, null, now);
    expect(summary.totalSources).toBe(1);
    expect(summary.notable).toEqual([{ source: "orphan", state: "fetchFailed" }]);
  });

  describe("fix round 1 F2: the LLM clause is sourced from the latest META#DAY, never META#lastRun.llmStatus", () => {
    it("undefined latestDay (the getArchive read failed) renders 'status unavailable'", () => {
      expect(summarizeRunStatus(baseStatus, undefined, now).llmLine).toBe("LLM status unavailable");
    });

    it("null latestDay (read succeeded, nothing ranked yet) renders 'no ranked day yet'", () => {
      expect(summarizeRunStatus(baseStatus, null, now).llmLine).toBe("LLM no ranked day yet");
    });

    it("maps ok/failed/truncated to their own label, plus the ranked-through day", () => {
      expect(summarizeRunStatus(baseStatus, dayMeta({ llmStatus: "ok", day: "2026-08-17" }), now).llmLine)
        .toBe("LLM ok (ranked through 2026-08-17)");
      expect(summarizeRunStatus(baseStatus, dayMeta({ llmStatus: "failed", day: "2026-08-17" }), now).llmLine)
        .toBe("LLM failed (ranked through 2026-08-17)");
      expect(summarizeRunStatus(baseStatus, dayMeta({ llmStatus: "truncated", day: "2026-08-17" }), now).llmLine)
        .toBe("LLM truncated (ranked through 2026-08-17)");
    });

    it("labels an unrecognised llmStatus value as unknown, not a crash or a literal 'undefined'", () => {
      // getArchive/listDays cast DynamoDB's raw Items straight to DayMeta[] with no field-level
      // coercion (unlike getRunStatus's memberOrNull treatment of META#lastRun) -- a malformed
      // value reaching a Record lookup keyed by the exact union would otherwise render the
      // literal string "undefined" into the header.
      const malformed = dayMeta({ llmStatus: "bogus" as unknown as DayMeta["llmStatus"] });
      expect(summarizeRunStatus(baseStatus, malformed, now).llmLine).toBe(
        "LLM unknown (ranked through 2026-08-17)",
      );
    });

    it("never surfaces DayMeta.status ('partial') -- days are permanently partial under the rank cap", () => {
      const line = summarizeRunStatus(baseStatus, dayMeta({ status: "partial" }), now).llmLine;
      expect(line).not.toContain("partial");
    });

    it("final review N1: never renders the literal string 'undefined' for a day missing from the same unchecked cast", () => {
      // The exact sibling of the "unrecognised llmStatus" test above, on the adjacent field in
      // the same expression: `day` comes off the identical unchecked `as DayMeta[]` cast
      // (src/lib/store/query.ts) but is template-interpolated directly rather than looked up in
      // a Record, so a missing/non-string value used to reach the rendered line completely raw.
      const malformed = dayMeta({ day: undefined as unknown as string });
      expect(summarizeRunStatus(baseStatus, malformed, now).llmLine).toBe(
        "LLM ok (ranked through an unknown day)",
      );
    });
  });
});
