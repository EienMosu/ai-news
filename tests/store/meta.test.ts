import { describe, expect, it } from "vitest";
import { buildDayMetaPut, buildLastRunPut } from "../../src/lib/store/meta.js";

describe("buildDayMetaPut", () => {
  it("sorts days lexicographically by using the ISO date as the sort key", () => {
    const item = buildDayMetaPut("t", {
      day: "2026-08-18", status: "complete", articleCount: 97,
      runId: "r1", completedAt: "2026-08-18T03:05:00.000Z",
    }).Item!;
    expect(item.pk).toBe("META#DAY");
    expect(item.sk).toBe("2026-08-18");
    expect(item.status).toBe("complete");
  });
});

describe("buildLastRunPut", () => {
  it("carries all three per-source counters, which is what makes a dead source detectable", () => {
    const item = buildLastRunPut("t", {
      startedAt: "2026-08-18T03:00:00.000Z", durationMs: 4200,
      perSourceCounts: { verge: 10, venturebeat: 0 },
      filtered: { venturebeat: 7 },
      quarantined: {},
      llmStatus: "ok", itemsWritten: 10, itemsFailed: 0, errors: [],
    }).Item!;
    // venturebeat produced 0 but filtered 7 -> quiet, not dead. Spec §8.
    expect(item.perSourceCounts.venturebeat).toBe(0);
    expect(item.filtered.venturebeat).toBe(7);
    expect(item.quarantined).toEqual({});
  });
});
