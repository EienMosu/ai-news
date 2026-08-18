/**
 * Truncates by Unicode code point rather than UTF-16 code unit, so a cut
 * never lands inside a surrogate pair (which would otherwise turn an emoji
 * into a lone high surrogate — rendered as U+FFFD when written as UTF-8).
 * Must run last: truncating before decodeEntities can also cut an entity
 * reference in half (e.g. "...&am"), a second way to produce garbage text.
 * Exported for use by feed adapters and the ranking prompt that need safe
 * truncation.
 */
export function truncate(s: string, max: number): string {
  const codePoints = Array.from(s);
  return codePoints.length <= max ? s : codePoints.slice(0, max).join("");
}
