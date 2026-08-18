/** Spec §4. Every key string in the system is built here and nowhere else. */
export const ARTICLE_SK = "A";
export const DAY_META_PK = "META#DAY";
export const LAST_RUN_PK = "META#lastRun";
export const LAST_RUN_SK = "A";

/** Bumped by any change to the urlHash normalization pipeline. Spec §4. */
export const HASH_VERSION = 1;

/** Current item schema version, for future backfills. */
export const SCHEMA_VERSION = 1;

export const articleKey = (urlHash: string) => ({ pk: `ART#${urlHash}`, sk: ARTICLE_SK });
export const dayPartition = (ingestDay: string) => `DAY#${ingestDay}`;
