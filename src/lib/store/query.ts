import {
  QueryCommand,
  type DynamoDBDocumentClient,
  type QueryCommandInput,
} from "@aws-sdk/lib-dynamodb";
import { DAY_META_PK, dayPartition } from "./keys.js";
import type { DayMeta } from "./meta.js";

/**
 * Pages a Query to exhaustion.
 *
 * Spec §8 requires this and it is not optional: DynamoDB's 1 MB page limit is applied BEFORE
 * any filtering, and a caller that ignores LastEvaluatedKey silently receives partial results
 * — a feed that looks complete and is not. Spec §4 bounds a day at ~650 items which, at a
 * realistic 1.5 KB per projected item, lands almost exactly ON the 1 MB boundary. Treating
 * that bound as "one page is enough" would be a rationalisation, not a guarantee.
 */
async function queryAll(
  client: DynamoDBDocumentClient, input: QueryCommandInput,
): Promise<Record<string, unknown>[]> {
  const items: Record<string, unknown>[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const out = await client.send(new QueryCommand({ ...input, ExclusiveStartKey: startKey }));
    items.push(...((out.Items ?? []) as Record<string, unknown>[]));
    startKey = out.LastEvaluatedKey;
  } while (startKey);
  return items;
}

/** One day's articles, highest score first. */
export async function queryDay(
  client: DynamoDBDocumentClient, tableName: string, day: string,
): Promise<Record<string, unknown>[]> {
  return await queryAll(client, {
    TableName: tableName,
    IndexName: "feed-by-day",
    KeyConditionExpression: "gsi1pk = :d",
    ExpressionAttributeValues: { ":d": dayPartition(day) },
    ScanIndexForward: false,
  });
}

/** Newest days first. Limit is a hard cap, so this one page is genuinely enough. */
export async function listDays(
  client: DynamoDBDocumentClient, tableName: string, limit: number,
): Promise<DayMeta[]> {
  const out = await client.send(new QueryCommand({
    TableName: tableName,
    KeyConditionExpression: "pk = :p",
    ExpressionAttributeValues: { ":p": DAY_META_PK },
    ScanIndexForward: false,
    Limit: limit,
  }));
  return (out.Items ?? []) as DayMeta[];
}

/**
 * The feed's entry point. Readers never compute a date — they follow this pointer. Spec §4.
 *
 * Falls back to the newest day of ANY status when no complete day is in the window. A single
 * transient write failure marks a day `partial` and nothing retries it, so preferring
 * "complete" without a fallback means a run of unlucky days makes the site show NOTHING —
 * a worse outcome than showing a day that is 199 articles out of 200. The caller gets the
 * status and can say so in the UI.
 */
export async function getLatestCompleteDay(
  client: DynamoDBDocumentClient, tableName: string,
): Promise<DayMeta | null> {
  const days = await listDays(client, tableName, 30);
  return days.find((d) => d.status === "complete") ?? days[0] ?? null;
}
