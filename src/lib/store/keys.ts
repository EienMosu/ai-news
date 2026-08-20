/** Spec §4. Every key string in the system is built here and nowhere else. */
export const ARTICLE_SK = "A";
export const DAY_META_PK = "META#DAY";
export const LAST_RUN_PK = "META#lastRun";
export const LAST_RUN_SK = "A";
/** Spec §9's per-day /api/ingest cap. Its own item, not a field on META#lastRun: that item is
 *  rewritten with a full PutCommand on every capture run, so an increment stored there would be
 *  overwritten or race the overwrite. `sk` is the ingestDay -- the same Istanbul day capture
 *  already computes -- so the counter resets at local midnight along with everything else. */
export const INGEST_META_PK = "META#INGEST";

/** Bumped by any change to the urlHash normalization pipeline. Spec §4. */
export const HASH_VERSION = 1;

/** Current item schema version, for future backfills. */
export const SCHEMA_VERSION = 1;

/**
 * Spec §9: caps manual /api/ingest triggers per Istanbul day. This is not a money guard --
 * capture is idempotent and costs fractions of a cent, so running it 20 times a day instead of
 * once costs nothing material. It exists purely to bound NUISANCE from a leaked shared secret,
 * so a leak caps out at 20 extra capture runs a day instead of triggering capture forever.
 */
export const INGEST_DAILY_CAP = 20;

export const articleKey = (urlHash: string) => ({ pk: `ART#${urlHash}`, sk: ARTICLE_SK });
export const dayPartition = (ingestDay: string) => `DAY#${ingestDay}`;
export const ingestCounterKey = (ingestDay: string) => ({ pk: INGEST_META_PK, sk: ingestDay });
