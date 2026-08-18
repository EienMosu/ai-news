export interface RankingEntry {
  clusterId: string;
  importance: number;
  whyItMatters: string;
}

export interface ReconcileResult {
  byHash: Map<string, RankingEntry>;
  matched: number;
  missing: number;
  unknown: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * The model is not obliged to return one entry per input: structured-output
 * schemas support neither maxItems nor numeric ranges. Everything unmatched is
 * reported so the run record can show it, rather than silently imputed.
 */
export function reconcile(inputHashes: string[], response: unknown): ReconcileResult {
  const expected = new Set(inputHashes);
  const byHash = new Map<string, RankingEntry>();
  let unknown = 0;

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

      byHash.set(hash, {
        clusterId: String(raw.clusterId ?? ""),
        importance: clamp(Math.round(raw.importance), 0, 100),
        whyItMatters: String(raw.whyItMatters ?? ""),
      });
    }
  }

  return {
    byHash,
    matched: byHash.size,
    missing: inputHashes.length - byHash.size,
    unknown,
  };
}
