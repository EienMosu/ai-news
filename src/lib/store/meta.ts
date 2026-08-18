import type { PutCommandInput } from "@aws-sdk/lib-dynamodb";
import { DAY_META_PK, LAST_RUN_PK, LAST_RUN_SK } from "./keys.js";

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
