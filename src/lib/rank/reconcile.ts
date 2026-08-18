export interface RankingEntry {
  clusterId: string;
  importance: number;
  whyItMatters: string | null;
}

export interface ReconcileResult {
  byHash: Map<string, RankingEntry>;
  matched: number;
  missing: number;
  unknown: number;
  withoutCluster: number;
  withoutRationale: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * The model is not obliged to return one entry per input: structured-output
 * schemas support neither maxItems nor numeric ranges. Everything unmatched is
 * reported so the run record can show it, rather than silently imputed.
 *
 * An `importance` that is not a JSON number (e.g. a string like "85") causes
 * the entire entry to be skipped and counted as missing, since a type mismatch
 * is a schema violation. Structured outputs enforce JSON types, so being strict
 * is correct.
 *
 * A missing or blank cluster id falls back to a prefixed singleton cluster id
 * (`__self__:<urlHash>`). The prefix prevents collision with model-supplied ids,
 * since the model sees every article's hash in the response schema and could
 * legitimately name a cluster after any hash.
 */
export function reconcile(inputHashes: string[], response: unknown): ReconcileResult {
  const expected = new Set(inputHashes);
  const byHash = new Map<string, RankingEntry>();
  let unknown = 0;
  let withoutCluster = 0;
  let withoutRationale = 0;

  const items = (response as any)?.items;
  if (Array.isArray(items)) {
    for (const raw of items) {
      const hash = typeof raw?.urlHash === "string" ? raw.urlHash : null;
      if (!hash) continue;
      if (!expected.has(hash)) {
        unknown++;
        continue;
      }
      if (typeof raw.importance !== "number" || Number.isNaN(raw.importance)) continue;
      if (byHash.has(hash)) continue;

      const rawCluster = typeof raw.clusterId === "string" ? raw.clusterId.trim() : "";
      const clusterId = rawCluster || `__self__:${hash}`;
      if (!rawCluster) withoutCluster++;

      const rawRationale = typeof raw.whyItMatters === "string" ? raw.whyItMatters.trim() : "";
      const whyItMatters = rawRationale || null;
      if (!rawRationale) withoutRationale++;

      byHash.set(hash, {
        clusterId,
        importance: clamp(Math.round(raw.importance), 0, 100),
        whyItMatters,
      });
    }
  }

  return {
    byHash,
    matched: byHash.size,
    missing: expected.size - byHash.size,
    unknown,
    withoutCluster,
    withoutRationale,
  };
}
