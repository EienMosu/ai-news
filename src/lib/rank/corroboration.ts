/**
 * How many of today's articles cover the same story as each article.
 *
 * Takes the day's STORED items, not the current run's reconcile map. Spec §5: "At the end of
 * each run the day partition is re-read once and corroborationToday recomputed for the whole
 * day, making it consistent and idempotent under repeated manual triggers." Deriving it from
 * the run's own map instead would give a second run a different answer than the first, and
 * would miss articles ranked on an earlier run of the same day.
 *
 * `__self__:`-prefixed ids are singletons by construction (spec §4) and each already contains
 * its own hash, so they never collide — but this counts them explicitly as 1 rather than
 * relying on that, because the invariant is what matters and a future change to the prefix
 * scheme should not silently inflate the signal.
 */
export function countCorroboration(items: Record<string, unknown>[]): Map<string, number> {
  const sizes = new Map<string, number>();
  for (const item of items) {
    const clusterId = typeof item.clusterId === "string" ? item.clusterId : "";
    if (clusterId) sizes.set(clusterId, (sizes.get(clusterId) ?? 0) + 1);
  }
  const out = new Map<string, number>();
  for (const item of items) {
    const hash = String(item.pk ?? "").slice("ART#".length);
    const clusterId = typeof item.clusterId === "string" ? item.clusterId : "";
    if (!clusterId || clusterId.startsWith("__self__:")) out.set(hash, 1);
    else out.set(hash, sizes.get(clusterId) ?? 1);
  }
  return out;
}
