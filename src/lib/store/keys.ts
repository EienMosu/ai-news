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

/** The day lock rank takes before ranking (`src/lambda/rank.ts`). Was an inline literal in two
 *  places -- rank's own PutItem and the IAM condition that permits it -- which is the same
 *  drift risk the review raised for META#INGEST, one file over. */
export const DAY_LOCK_PK = "META#lock";

/** Key PREFIXES, as distinct from whole keys. They exist because `infra/lib/functions.ts` scopes
 *  each function's DynamoDB grant with a `LeadingKeys` condition, and those conditions were
 *  spelling the prefixes out by hand: a rename here would have left the IAM policy pointing at
 *  the old prefix, denying every write at runtime with the whole suite green. */
export const ARTICLE_PK_PREFIX = "ART#";
export const DAY_PARTITION_PREFIX = "DAY#";

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

export const articleKey = (urlHash: string) => ({ pk: `${ARTICLE_PK_PREFIX}${urlHash}`, sk: ARTICLE_SK });
export const dayPartition = (ingestDay: string) => `${DAY_PARTITION_PREFIX}${ingestDay}`;
export const ingestCounterKey = (ingestDay: string) => ({ pk: INGEST_META_PK, sk: ingestDay });
