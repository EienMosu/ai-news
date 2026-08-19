import { describe, expect, it } from "vitest";
import {
  MAX_ARCHIVE_SEARCH_DAYS,
  RECENT_WINDOW_DAYS,
  exceedsArchiveBound,
  splitSearchRange,
  subtractDays,
} from "../../src/lib/search/range.js";

describe("subtractDays", () => {
  it("returns the same day unchanged for n=0", () => {
    expect(subtractDays("2026-08-19", 0)).toBe("2026-08-19");
  });

  it("subtracts within a month with no boundary crossing", () => {
    expect(subtractDays("2026-08-19", 1)).toBe("2026-08-18");
  });

  it("crosses a month boundary into a 31-day month", () => {
    expect(subtractDays("2026-08-01", 1)).toBe("2026-07-31");
  });

  it("crosses a year boundary", () => {
    expect(subtractDays("2026-01-01", 1)).toBe("2025-12-31");
  });

  it("lands on the leap day in a leap year", () => {
    // 2028 is divisible by 4 and not by 100 -- a real leap year.
    expect(subtractDays("2028-03-01", 1)).toBe("2028-02-29");
  });

  it("skips the leap day in a non-leap year", () => {
    // 2027 is not divisible by 4.
    expect(subtractDays("2027-03-01", 1)).toBe("2027-02-28");
  });

  it("treats a century year not divisible by 400 as non-leap", () => {
    // 2100 is divisible by 4 and by 100, but not by 400 -- not a leap year.
    expect(subtractDays("2100-03-01", 1)).toBe("2100-02-28");
  });

  it("treats a century year divisible by 400 as leap", () => {
    expect(subtractDays("2000-03-01", 1)).toBe("2000-02-29");
  });

  it("walks back multiple days across several boundaries at once", () => {
    expect(subtractDays("2026-01-02", 3)).toBe("2025-12-30");
  });

  it("gets every month's day count right, not just the two exercised by the other boundary tests", () => {
    // 2026 is not a leap year. Rolling back one day from the 1st of each month pins that
    // month's own entry in the DAYS_IN_MONTH table individually -- the month-boundary and
    // year-boundary tests above only ever exercise July (31) and December (31) this way, so a
    // wrong day count for, say, August or September would pass every other test in this file.
    // Caught for real: mutating August's table entry from 31 to 30 left the rest of this file
    // (24 other tests) green.
    expect(subtractDays("2026-02-01", 1)).toBe("2026-01-31"); // January: 31
    expect(subtractDays("2026-03-01", 1)).toBe("2026-02-28"); // February: 28 (non-leap, via isLeapYear)
    expect(subtractDays("2026-04-01", 1)).toBe("2026-03-31"); // March: 31
    expect(subtractDays("2026-05-01", 1)).toBe("2026-04-30"); // April: 30
    expect(subtractDays("2026-06-01", 1)).toBe("2026-05-31"); // May: 31
    expect(subtractDays("2026-07-01", 1)).toBe("2026-06-30"); // June: 30
    expect(subtractDays("2026-08-01", 1)).toBe("2026-07-31"); // July: 31
    expect(subtractDays("2026-09-01", 1)).toBe("2026-08-31"); // August: 31
    expect(subtractDays("2026-10-01", 1)).toBe("2026-09-30"); // September: 30
    expect(subtractDays("2026-11-01", 1)).toBe("2026-10-31"); // October: 31
    expect(subtractDays("2026-12-01", 1)).toBe("2026-11-30"); // November: 30
    expect(subtractDays("2027-01-01", 1)).toBe("2026-12-31"); // December: 31
  });
});

describe("splitSearchRange", () => {
  const TODAY = "2026-08-19";

  it("puts today itself in recentDays, first", () => {
    const { recentDays } = splitSearchRange(TODAY, TODAY, TODAY);
    expect(recentDays).toEqual([TODAY]);
  });

  it("puts a single archive-only day (well before the recent window) only in archiveDays", () => {
    const { recentDays, archiveDays } = splitSearchRange("2026-01-01", "2026-01-01", TODAY);
    expect(recentDays).toEqual([]);
    expect(archiveDays).toEqual(["2026-01-01"]);
  });

  it("includes the day exactly RECENT_WINDOW_DAYS-1 before today in recentDays -- the inclusive boundary", () => {
    const boundaryDay = subtractDays(TODAY, RECENT_WINDOW_DAYS - 1);
    const { recentDays, archiveDays } = splitSearchRange(boundaryDay, TODAY, TODAY);
    expect(recentDays[recentDays.length - 1]).toBe(boundaryDay);
    expect(archiveDays).toEqual([]);
  });

  it("puts the day exactly RECENT_WINDOW_DAYS before today in archiveDays -- one day past the boundary", () => {
    const oneRecentWindowBack = subtractDays(TODAY, RECENT_WINDOW_DAYS);
    const { recentDays, archiveDays } = splitSearchRange(oneRecentWindowBack, TODAY, TODAY);
    expect(archiveDays[0]).toBe(oneRecentWindowBack);
    expect(recentDays).not.toContain(oneRecentWindowBack);
  });

  it("returns recentDays with length RECENT_WINDOW_DAYS for a range spanning exactly the recent window", () => {
    const from = subtractDays(TODAY, RECENT_WINDOW_DAYS - 1);
    const { recentDays, archiveDays } = splitSearchRange(from, TODAY, TODAY);
    expect(recentDays).toHaveLength(RECENT_WINDOW_DAYS);
    expect(archiveDays).toHaveLength(0);
  });

  it("splits a range straddling the boundary into the correct recent/archive counts", () => {
    // 35 days total: 30 recent + 5 archive.
    const from = subtractDays(TODAY, 34);
    const { recentDays, archiveDays } = splitSearchRange(from, TODAY, TODAY);
    expect(recentDays).toHaveLength(RECENT_WINDOW_DAYS);
    expect(archiveDays).toHaveLength(5);
  });

  it("orders recentDays newest first", () => {
    const from = subtractDays(TODAY, 3);
    const { recentDays } = splitSearchRange(from, TODAY, TODAY);
    expect(recentDays).toEqual([TODAY, "2026-08-18", "2026-08-17", "2026-08-16"]);
  });

  it("orders archiveDays newest first, immediately following on from recentDays chronologically", () => {
    const from = subtractDays(TODAY, RECENT_WINDOW_DAYS + 1); // 30 recent + 2 archive
    const { recentDays, archiveDays } = splitSearchRange(from, TODAY, TODAY);
    const lastRecent = recentDays[recentDays.length - 1]!;
    expect(archiveDays[0]).toBe(subtractDays(lastRecent, 1));
    expect(archiveDays).toEqual([subtractDays(lastRecent, 1), subtractDays(lastRecent, 2)]);
  });

  it("includes the from day itself as the oldest entry", () => {
    const from = "2026-06-01";
    const { archiveDays } = splitSearchRange(from, TODAY, TODAY);
    expect(archiveDays[archiveDays.length - 1]).toBe(from);
  });

  it("returns two empty arrays when from is after to, rather than throwing", () => {
    const result = splitSearchRange("2026-08-20", "2026-08-19", TODAY);
    expect(result).toEqual({ recentDays: [], archiveDays: [] });
  });

  it("classifies using today, not the range's own to -- a range entirely in the past has no recentDays even though `to` is its own newest day", () => {
    // `to` here ("2026-01-05") is newer than `from`, but both are far before the real `today`.
    const { recentDays, archiveDays } = splitSearchRange("2026-01-01", "2026-01-05", TODAY);
    expect(recentDays).toEqual([]);
    expect(archiveDays).toHaveLength(5);
  });

  it("walks a range that crosses a leap day correctly (no skipped or duplicated day)", () => {
    const { recentDays, archiveDays } = splitSearchRange("2028-02-27", "2028-03-01", "2028-03-01");
    const all = [...recentDays, ...archiveDays];
    expect(all).toEqual(["2028-03-01", "2028-02-29", "2028-02-28", "2028-02-27"]);
  });

  it("walks a range that crosses a year boundary correctly", () => {
    const { recentDays } = splitSearchRange("2025-12-30", "2026-01-02", "2026-01-02");
    expect(recentDays).toEqual(["2026-01-02", "2026-01-01", "2025-12-31", "2025-12-30"]);
  });
});

describe("exceedsArchiveBound", () => {
  it("is false for an empty archive list", () => {
    expect(exceedsArchiveBound([])).toBe(false);
  });

  it("is false at exactly MAX_ARCHIVE_SEARCH_DAYS", () => {
    expect(exceedsArchiveBound(Array.from({ length: MAX_ARCHIVE_SEARCH_DAYS }, (_, i) => String(i)))).toBe(false);
  });

  it("is true one past MAX_ARCHIVE_SEARCH_DAYS", () => {
    expect(exceedsArchiveBound(Array.from({ length: MAX_ARCHIVE_SEARCH_DAYS + 1 }, (_, i) => String(i)))).toBe(true);
  });
});
