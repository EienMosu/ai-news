import { describe, expect, it } from "vitest";
import { DEFAULT_ARCHIVE_DAYS, MAX_ARCHIVE_DAYS, MIN_ARCHIVE_DAYS, parseDaysParam } from "../../src/lib/feed/days.js";

describe("parseDaysParam", () => {
  it("defaults to MIN_ARCHIVE_DAYS when the param is missing", () => {
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

  it("clamps a value below MIN_ARCHIVE_DAYS up to the minimum", () => {
    expect(parseDaysParam("3")).toBe(MIN_ARCHIVE_DAYS);
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
