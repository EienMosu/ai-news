import { describe, expect, it } from "vitest";
import { istanbulDay } from "../../src/lib/core/day.js";

describe("istanbulDay", () => {
  // Turkey is a constant UTC+3, so 21:00Z is already the next local day.
  // This is the exact bug the design review caught: toISOString().slice(0,10)
  // would stamp the previous day here, every day.
  it("treats 21:00Z as the next Istanbul day", () => {
    expect(istanbulDay(new Date("2026-08-17T21:00:00Z"))).toBe("2026-08-18");
  });

  it("treats 20:59Z as still the same Istanbul day", () => {
    expect(istanbulDay(new Date("2026-08-17T20:59:00Z"))).toBe("2026-08-17");
  });

  it("handles the 23:59 local boundary", () => {
    expect(istanbulDay(new Date("2026-08-18T20:59:59Z"))).toBe("2026-08-18");
  });

  it("handles the 00:01 local boundary", () => {
    expect(istanbulDay(new Date("2026-08-18T21:01:00Z"))).toBe("2026-08-19");
  });

  it("crosses month and year boundaries", () => {
    expect(istanbulDay(new Date("2026-12-31T21:00:00Z"))).toBe("2027-01-01");
  });

  it("differs from the naive UTC derivation at the hours that matter", () => {
    const d = new Date("2026-08-17T22:00:00Z");
    expect(d.toISOString().slice(0, 10)).toBe("2026-08-17");
    expect(istanbulDay(d)).toBe("2026-08-18");
  });
});
