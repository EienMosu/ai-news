/**
 * GSI1 sort key. DynamoDB compares string sort keys lexicographically, so the
 * score field must be fixed-width — which means rounding an inherently float
 * score, and clamping so nothing can widen the field. See spec §5.
 */
export function buildSortKey(score: number, urlHash: string): string {
  const safe = Number.isFinite(score) ? score : 0;
  const bounded = Math.min(9999, Math.max(0, Math.round(safe)));
  return `${String(bounded).padStart(4, "0")}#${urlHash}`;
}
