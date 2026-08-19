import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  MAX_ARCHIVE_SEARCH_DAYS,
  RECENT_WINDOW_DAYS,
  exceedsArchiveBound,
  isValidDay,
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

describe("the cost-story constants themselves -- fix round 1, finding 1", () => {
  // Every other test in this file (and in search-page.test.tsx) references these constants
  // symbolically -- `Array.from({ length: MAX_ARCHIVE_SEARCH_DAYS + 1 })`,
  // `subtractDays(TODAY, RECENT_WINDOW_DAYS + MAX_ARCHIVE_SEARCH_DAYS)` -- so all of them move
  // with the constant and none of them notice if its actual value changes. Reproduced: changing
  // MAX_ARCHIVE_SEARCH_DAYS from 31 to 365 left all 634 tests green. These two assertions are
  // deliberately the only place in the suite that spells out the literal number, so a change to
  // either constant fails here even though every symbolic reference elsewhere stays green.
  it("RECENT_WINDOW_DAYS is 30 -- Spec §8's 'last 30 days', ~30 Queries and ~1,500 RRU per search", () => {
    expect(RECENT_WINDOW_DAYS).toBe(30);
  });

  it("MAX_ARCHIVE_SEARCH_DAYS is 31 -- Spec §8 [revised]: '~31 concurrent requests, ~8 MB, comfortable'; 365 would be ~98 MB and blow past a Vercel Hobby function's 60s cap and memory", () => {
    expect(MAX_ARCHIVE_SEARCH_DAYS).toBe(31);
  });
});

describe("isValidDay -- fix round 1, finding 3", () => {
  it("accepts a real, ordinary date", () => {
    expect(isValidDay("2026-08-19")).toBe(true);
  });

  it("rejects a day-00 value -- no calendar day is numbered 00", () => {
    expect(isValidDay("2026-08-00")).toBe(false);
  });

  it("rejects a month-00 value -- no calendar month is numbered 00", () => {
    expect(isValidDay("2026-00-15")).toBe(false);
  });

  it("rejects a month-13 value -- there is no 13th month", () => {
    expect(isValidDay("2026-13-01")).toBe(false);
  });

  it("rejects February 30th -- February never reaches 30 in any year", () => {
    expect(isValidDay("2026-02-30")).toBe(false);
  });

  it("rejects April 31st -- April has only 30 days", () => {
    expect(isValidDay("2026-04-31")).toBe(false);
  });

  it("accepts February 29th in a leap year", () => {
    expect(isValidDay("2028-02-29")).toBe(true);
  });

  it("rejects February 29th in a non-leap year", () => {
    expect(isValidDay("2026-02-29")).toBe(false);
  });

  it("rejects a value that fails the shape check outright", () => {
    expect(isValidDay("banana")).toBe(false);
  });

  it("rejects an unpadded date -- shape matters, not just numeric validity", () => {
    expect(isValidDay("2026-1-1")).toBe(false);
  });
});

describe("splitSearchRange's independent iteration cap -- fix round 1, finding 3", () => {
  // Task 8 review reproduced: `?since=0000-01-01` is a real, valid calendar date (isValidDay
  // does not and should not reject it), so it reaches this function unchanged and used to walk
  // ~740,000 days before exceedsArchiveBound ever got a chance to refuse it -- a free
  // CPU/allocation amplifier on a public URL. This cap must fire long before that, and must not
  // fire on any legitimate range this file already exercises elsewhere (the longest of which is
  // a few dozen days).
  it("throws rather than enumerating hundreds of thousands of days for an extreme range", () => {
    expect(() => splitSearchRange("0000-01-01", "2026-08-19", "2026-08-19")).toThrow(
      /exceeds .* days/,
    );
  });

  it("does not throw for a long-but-realistic multi-year range", () => {
    // Comfortably above MAX_ARCHIVE_SEARCH_DAYS (so it would already be refused by
    // exceedsArchiveBound) but nowhere near the defensive cap -- proves the cap does not
    // interfere with a merely-long, legitimate range.
    expect(() => splitSearchRange("2020-01-01", "2026-08-19", "2026-08-19")).not.toThrow();
  });
});

describe("timezone independence -- fix round 1, finding 2", () => {
  const RAW_SOURCE = readFileSync(
    fileURLToPath(new URL("../../src/lib/search/range.ts", import.meta.url)),
    "utf8",
  );
  // The module's own doc comments describe what it deliberately does NOT do ("no argless `new
  // Date()`"), in prose -- so the literal string "new Date(" appears in this file's comments
  // even in the fully-correct version. Stripping comments before the check is what makes this a
  // guard on the CODE, not a guard that a docstring happens to trip over its own explanation.
  const CODE_ONLY = RAW_SOURCE
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

  // Task 8 review reproduced twice: replacing `previousDay`'s body with a `new Date(...)`
  // round-trip -- both a UTC-safe form and a genuinely wrong local-timezone form -- left every
  // one of this file's 61 tests green, and the wrong form ALSO passed all 83 new tests under
  // `TZ=UTC`, which is what CI runs. The UTC-round-trip form is not actually distinguishable
  // from correct output under ANY timezone: a date-only ISO string (`"YYYY-MM-DD"`, no time or
  // offset) always parses as UTC per the ECMA-262 Date Time String Format, regardless of
  // `process.env.TZ` -- verified directly (`new Date("2026-08-19").toISOString()` is identical
  // under `TZ=UTC`, `TZ=America/New_York`, and `TZ=Pacific/Chatham`). So no behavioural test, run
  // under any TZ, with any choice of inputs, can catch that specific reintroduction by comparing
  // output values -- the numbers are mathematically identical. A static guard on the module's own
  // source text is the only check immune to that: if `Date` is never constructed anywhere in this
  // module, neither the UTC-safe nor the local-time mutation can exist in the first place.
  it("never constructs a Date object anywhere in this module's actual code", () => {
    expect(CODE_ONLY).not.toMatch(/\bnew\s+Date\s*\(/);
    expect(CODE_ONLY).not.toMatch(/\bDate\.(now|parse)\s*\(/);
  });
});

describe("output is independent of process.env.TZ -- fix round 1, finding 2", () => {
  // The genuinely-wrong local-timezone mutation (`new Date(y, m - 1, d - 1).toISOString()`)
  // interprets its (y, m, d) arguments as LOCAL date/time components -- so its output depends on
  // whatever timezone the process happens to be running under. Node picks up a runtime change to
  // `process.env.TZ` for every `Date` constructed afterward (verified directly: `new Date(2026, 0,
  // 1).toISOString()` differs across `TZ=UTC`/`TZ=America/New_York`/`TZ=Pacific/Chatham` within
  // one process). A genuinely pure, Date-free implementation, by contrast, cannot possibly depend
  // on `process.env.TZ` at all, since it never reads it -- so comparing this module's own output
  // across explicit TZ values, within a single test, is a portable, CI-timezone-independent proof
  // that holds regardless of whatever TZ the test runner itself starts in.
  const ORIGINAL_TZ = process.env.TZ;

  afterEach(() => {
    if (ORIGINAL_TZ === undefined) delete process.env.TZ;
    else process.env.TZ = ORIGINAL_TZ;
  });

  // Chosen to cross a month boundary, a leap day, a year boundary, and (for the DST-observing
  // zones below) a real US DST transition -- 2026-03-08 (spring forward) and 2026-11-01 (fall
  // back) -- so a TZ-sensitive implementation has every reasonable chance to disagree with itself.
  const CASES: Array<[string, string, string]> = [
    ["2026-07-25", "2026-08-05", "2026-08-05"],
    ["2028-02-25", "2028-03-05", "2028-03-05"],
    ["2025-12-28", "2026-01-05", "2026-01-05"],
    ["2026-03-01", "2026-03-15", "2026-03-15"],
    ["2026-10-25", "2026-11-05", "2026-11-05"],
  ];

  function computeUnderCurrentTZ() {
    return CASES.map(([from, to, today]) => ({
      split: splitSearchRange(from, to, today),
      sub: subtractDays(today, 40),
    }));
  }

  it("produces identical splitSearchRange/subtractDays output under UTC, a DST-observing zone, and non-whole-hour-offset zones", () => {
    process.env.TZ = "UTC";
    const utc = computeUnderCurrentTZ();

    process.env.TZ = "America/New_York"; // observes DST (spring forward / fall back)
    expect(computeUnderCurrentTZ()).toEqual(utc);

    process.env.TZ = "Pacific/Chatham"; // UTC+12:45 / +13:45 -- not even a whole-hour offset
    expect(computeUnderCurrentTZ()).toEqual(utc);

    process.env.TZ = "Australia/Lord_Howe"; // 30-minute DST shift, not the usual 60
    expect(computeUnderCurrentTZ()).toEqual(utc);
  });
});
