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
 * en-CA formats as YYYY-MM-DD, which is what we want for lexicographic keys.
 */
export function istanbulDay(at: Date): string {
  return FORMATTER.format(at);
}
