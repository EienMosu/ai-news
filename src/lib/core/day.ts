const FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Istanbul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * The single source of truth for "which day is this". Derived once during
 * capture and persisted as `ingestDay`; readers follow the stored pointer and
 * never compute a date. See spec §4.
 *
 * Reads parts by name (year, month, day) instead of relying on `format()` output
 * to ensure consistent YYYY-MM-DD format regardless of CLDR data — the result is
 * a persisted DynamoDB partition key and must not vary with Node/ICU versions.
 *
 * Throws RangeError for invalid dates (e.g. `new Date("garbage")`); this is by
 * design, as a bogus key is worse than an early error.
 */
export function istanbulDay(at: Date): string {
  const parts = FORMATTER.formatToParts(at);
  const get = (type: "year" | "month" | "day") =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
