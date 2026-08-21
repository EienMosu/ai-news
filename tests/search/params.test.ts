import { describe, expect, it } from "vitest";
import { parseQueryParam, parseSectionParam, parseSinceParam } from "../../src/lib/search/params.js";
import { RECENT_WINDOW_DAYS, subtractDays } from "../../src/lib/search/range.js";

const TODAY = "2026-08-19";

describe("parseQueryParam", () => {
  it("trims surrounding whitespace", () => {
    expect(parseQueryParam("  claude  ")).toBe("claude");
  });

  it("returns an empty string for a missing value", () => {
    expect(parseQueryParam(undefined)).toBe("");
  });

  it("returns an empty string for a repeated ?q= (an array), not the first/last element", () => {
    expect(parseQueryParam(["claude", "gpt"])).toBe("");
  });

  it("returns an empty string for a whitespace-only value", () => {
    expect(parseQueryParam("   ")).toBe("");
  });

  it("passes a real query through unchanged aside from trimming", () => {
    expect(parseQueryParam("agent sdk")).toBe("agent sdk");
  });
});

describe("parseSectionParam", () => {
  it("returns 'ai' when given 'ai'", () => {
    expect(parseSectionParam("ai", "design")).toBe("ai");
  });

  it("returns 'design' when given 'design'", () => {
    expect(parseSectionParam("design", "ai")).toBe("design");
  });

  it("returns 'both' when given 'both'", () => {
    expect(parseSectionParam("both", "ai")).toBe("both");
  });

  it("returns 'cloud' when given 'cloud' -- the branch's own SectionNav emits ?section=cloud from /cloud", () => {
    expect(parseSectionParam("cloud", "ai")).toBe("cloud");
  });

  it("falls back to the caller's fallback for a missing value", () => {
    expect(parseSectionParam(undefined, "design")).toBe("design");
  });

  it("falls back to the caller's fallback for garbage input, not 'both'", () => {
    expect(parseSectionParam("everything", "ai")).toBe("ai");
  });

  it("falls back to the caller's fallback for a repeated param (an array)", () => {
    expect(parseSectionParam(["ai", "design"], "design")).toBe("design");
  });
});

describe("parseSinceParam", () => {
  const defaultSince = subtractDays(TODAY, RECENT_WINDOW_DAYS - 1);

  it("defaults to today minus (RECENT_WINDOW_DAYS - 1) when missing", () => {
    expect(parseSinceParam(undefined, TODAY)).toBe(defaultSince);
  });

  it("passes a valid, past date through unchanged", () => {
    expect(parseSinceParam("2026-01-01", TODAY)).toBe("2026-01-01");
  });

  it("accepts today itself", () => {
    expect(parseSinceParam(TODAY, TODAY)).toBe(TODAY);
  });

  it("falls back to the default for a date after today", () => {
    expect(parseSinceParam("2026-08-20", TODAY)).toBe(defaultSince);
  });

  it("falls back to the default for a malformed value (wrong shape)", () => {
    // "banana" is a bad test case for this: it sorts lexicographically AFTER any real
    // "YYYY-MM-DD" string (letters > digits), so the (unrelated) future-date fallback below
    // would also reject it -- a mutation that deleted the shape check entirely left this exact
    // assertion green. "2020-1-1" is unpadded (wrong shape) but sorts BEFORE today, so only the
    // shape check itself can be what rejects it.
    expect(parseSinceParam("2020-1-1", TODAY)).toBe(defaultSince);
  });

  it("falls back to the default for a repeated param (an array)", () => {
    expect(parseSinceParam(["2026-01-01", "2026-01-02"], TODAY)).toBe(defaultSince);
  });

  describe("calendar-impossible but shape-valid dates -- fix round 1, finding 3", () => {
    // Task 8 review reproduced: `?since=2026-08-00` and `?since=2026-02-30` both match
    // `/^\d{4}-\d{2}-\d{2}$/` but are not real calendar dates, and used to reach
    // `splitSearchRange`'s day-walk unchanged, which stepped past `from` (no calendar day
    // equals "2026-08-00") and threw after ~740,000 iterations -- an unhandled 500 on a plain
    // URL. `parseSinceParam` must reject these the same way it rejects "banana": before the
    // walk ever starts.
    it("falls back to the default for a day-00 value (no such day exists)", () => {
      expect(parseSinceParam("2026-08-00", TODAY)).toBe(defaultSince);
    });

    it("falls back to the default for a month-00 value (no such month exists)", () => {
      expect(parseSinceParam("2026-00-15", TODAY)).toBe(defaultSince);
    });

    it("falls back to the default for February 30th (February never reaches 30)", () => {
      expect(parseSinceParam("2026-02-30", TODAY)).toBe(defaultSince);
    });

    it("falls back to the default for a month-13 value (no such month exists)", () => {
      // "2026-13-01" is a bad case for this on its own: it sorts lexicographically AFTER
      // "2026-08-19" (TODAY) -- "13" > "08" -- so the (unrelated) future-date fallback below
      // would also reject it, the same coincidental-pass shape the "banana" test above was
      // rewritten to avoid. An earlier year keeps the whole string before TODAY regardless of
      // the invalid month, so only the calendar-validity check can be what rejects this one.
      expect(parseSinceParam("2020-13-01", TODAY)).toBe(defaultSince);
    });

    it("accepts February 29th in a real leap year", () => {
      expect(parseSinceParam("2028-02-29", "2028-03-01")).toBe("2028-02-29");
    });

    it("rejects February 29th in a non-leap year", () => {
      const fallbackFor2026 = subtractDays("2026-03-01", RECENT_WINDOW_DAYS - 1);
      expect(parseSinceParam("2026-02-29", "2026-03-01")).toBe(fallbackFor2026);
    });
  });
});
