import type { PutCommandInput, UpdateCommandInput } from "@aws-sdk/lib-dynamodb";
import { DAY_META_PK, INGEST_DAILY_CAP, LAST_RUN_PK, LAST_RUN_SK, ingestCounterKey } from "./keys.js";

export interface DayMeta {
  day: string;
  status: "complete" | "partial";
  articleCount: number;
  /** How many of the day's articles the model actually scored. */
  llmRanked: number;
  /** How many were cut by RANK_INPUT_CAP and never reached the model. Persisted, not logged:
   *  a day where 450 of 650 articles were never ranked must be visible in the data. */
  truncated: number;
  llmStatus: "ok" | "failed" | "truncated";
  runId: string;
  completedAt: string;
}

export interface LastRun {
  startedAt: string;
  durationMs: number;
  perSourceCounts: Record<string, number>;
  filtered: Record<string, number>;
  quarantined: Record<string, number>;
  llmStatus: "ok" | "skipped" | "failed";
  itemsWritten: number;
  itemsFailed: number;
  errors: { source: string; message: string }[];
}

export function buildDayMetaPut(tableName: string, m: DayMeta): PutCommandInput {
  return { TableName: tableName, Item: { pk: DAY_META_PK, sk: m.day, ...m } };
}

export function buildLastRunPut(tableName: string, r: LastRun): PutCommandInput {
  return { TableName: tableName, Item: { pk: LAST_RUN_PK, sk: LAST_RUN_SK, ...r } };
}

/**
 * Spec §9's real ceiling on the per-day /api/ingest cap. `ADD` is DynamoDB's atomic counter
 * increment, and the `ConditionExpression` is evaluated against the item's currently-stored
 * count before that increment is applied -- DynamoDB serializes writes to one item, so of any
 * number of concurrent manual triggers that all pass the route's own advisory read (a plain
 * `GetItem` -- see app/api/ingest/route.ts), at most `INGEST_DAILY_CAP` ever succeed here. The
 * route's check exists for legibility; this is the guarantee.
 *
 * `attribute_not_exists(#count)` covers the day's first trigger, when the item does not exist
 * yet at all -- an `ADD` against a missing item creates it starting from 0, so without this
 * clause the very first call of the day would have nothing to compare `#count < :cap` against.
 */
export function buildIngestCounterIncrement(tableName: string, ingestDay: string): UpdateCommandInput {
  return {
    TableName: tableName,
    Key: ingestCounterKey(ingestDay),
    UpdateExpression: "ADD #count :one",
    ConditionExpression: "attribute_not_exists(#count) OR #count < :cap",
    ExpressionAttributeNames: { "#count": "count" },
    ExpressionAttributeValues: { ":one": 1, ":cap": INGEST_DAILY_CAP },
  };
}
