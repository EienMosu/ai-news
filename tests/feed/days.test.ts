import { describe, expect, it } from "vitest";
import { DEFAULT_ARCHIVE_DAYS, MAX_ARCHIVE_DAYS, MIN_ARCHIVE_DAYS, parseDaysParam } from "../../src/lib/feed/days.js";

describe("parseDaysParam", () => {
  it("defaults to DEFAULT_ARCHIVE_DAYS when the param is missing", () => {
    expect(parseDaysParam(undefined)).toBe(DEFAULT_ARCHIVE_DAYS);
  });

  it("ignores an array value (a repeated ?days= query param) and falls back to the default", () => {
    expect(parseDaysParam(["7", "14"])).toBe(DEFAULT_ARCHIVE_DAYS);
  });

  it("ignores an unparseable string and falls back to the default, not NaN or 0", () => {
    expect(parseDaysParam("banana")).toBe(DEFAULT_ARCHIVE_DAYS);
  });

  it("ignores a negative number string -- the shape check requires bare digits only", () => {
    expect(parseDaysParam("-5")).toBe(DEFAULT_ARCHIVE_DAYS);
  });

  it("ignores a decimal string -- the shape check requires bare digits only", () => {
    expect(parseDaysParam("7.5")).toBe(DEFAULT_ARCHIVE_DAYS);
  });

  it("passes a value already inside [MIN_ARCHIVE_DAYS, MAX_ARCHIVE_DAYS] through unchanged", () => {
    expect(parseDaysParam("14")).toBe(14);
  });

  it("passes a low but valid request (?days=1) through unchanged -- fix round 1, F7: the floor no longer silently raises it to the default", () => {
    // Before fix round 1, MIN_ARCHIVE_DAYS was 7 (the same as the default), so a reader asking
    // for a single day silently got seven days and seven concurrent partition Queries instead.
    // Spec §7's "seven" describes the *initial* load, not a floor on what a reader may
    // deliberately request.
    expect(parseDaysParam("1")).toBe(1);
    expect(parseDaysParam("3")).toBe(3);
  });

  it("clamps a value below MIN_ARCHIVE_DAYS (0) up to the minimum, not the unparseable-value default", () => {
    // `0` is a bare non-negative integer -- it passes the digit shape check and must be
    // distinguished from "unparseable" (which falls back to DEFAULT_ARCHIVE_DAYS, 7): the floor
    // is MIN_ARCHIVE_DAYS (1), a different number from the default.
    expect(parseDaysParam("0")).toBe(MIN_ARCHIVE_DAYS);
    expect(MIN_ARCHIVE_DAYS).not.toBe(DEFAULT_ARCHIVE_DAYS);
  });

  it("clamps a value above MAX_ARCHIVE_DAYS down to the maximum", () => {
    expect(parseDaysParam("1000")).toBe(MAX_ARCHIVE_DAYS);
  });

  it("passes the exact lower bound through unchanged, not clamped away", () => {
    expect(parseDaysParam(String(MIN_ARCHIVE_DAYS))).toBe(MIN_ARCHIVE_DAYS);
  });

  it("passes the exact upper bound through unchanged, not clamped away", () => {
    expect(parseDaysParam(String(MAX_ARCHIVE_DAYS))).toBe(MAX_ARCHIVE_DAYS);
  });
});

describe("archive day constants -- fix round 1, F8", () => {
  it("no longer derives MIN_ARCHIVE_DAYS from DEFAULT_ARCHIVE_DAYS", () => {
    // Before fix round 1, MIN_ARCHIVE_DAYS was literally `= DEFAULT_ARCHIVE_DAYS` (both 7).
    // They are unrelated numbers now: the floor a reader may request vs. the size of the
    // initial page. `components/FeedArchive.tsx`'s own tests separately pin that the
    // load-more step is `ARCHIVE_STEP_DAYS`, not `DEFAULT_ARCHIVE_DAYS`, via a literal expected
    // href (`/?days=14` from a start of 7) that does not reference either constant by name.
    expect(MIN_ARCHIVE_DAYS).toBe(1);
    expect(MIN_ARCHIVE_DAYS).not.toBe(DEFAULT_ARCHIVE_DAYS);
  });
});
