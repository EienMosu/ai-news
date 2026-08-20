import { describe, expect, it } from "vitest";
import { relativeTime } from "../../src/lib/feed/format.js";

const NOW = new Date("2026-08-18T12:00:00.000Z");

describe("relativeTime", () => {
  it("renders 'date unknown' for a null publishedAt, not a blank or 'Invalid Date'", () => {
    expect(relativeTime(null, NOW)).toBe("date unknown");
  });

  it("renders 'date unknown' for an unparseable string", () => {
    expect(relativeTime("not-a-date", NOW)).toBe("date unknown");
  });

  it("renders 'just now' for something published seconds ago", () => {
    expect(relativeTime("2026-08-18T11:59:50.000Z", NOW)).toBe("just now");
  });

  it("renders minutes for something published under an hour ago", () => {
    expect(relativeTime("2026-08-18T11:15:00.000Z", NOW)).toBe("45m ago");
  });

  it("renders hours for something published under a day ago", () => {
    expect(relativeTime("2026-08-18T06:00:00.000Z", NOW)).toBe("6h ago");
  });

  it("renders days for something published a day or more ago", () => {
    expect(relativeTime("2026-08-15T12:00:00.000Z", NOW)).toBe("3d ago");
  });

  it("clamps a future-dated publish time to 'just now' rather than a negative duration", () => {
    expect(relativeTime("2026-08-18T12:05:00.000Z", NOW)).toBe("just now");
  });
});
