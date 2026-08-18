import type { UpdateCommandInput } from "@aws-sdk/lib-dynamodb";
import { buildSortKey } from "../core/sortKey.js";
import type { NormalizedArticle } from "../../types/article.js";
import { HASH_VERSION, SCHEMA_VERSION, articleKey, dayPartition } from "./keys.js";
import { updateBuilder } from "./expression.js";

export interface CaptureWriteInput {
  article: NormalizedArticle;
  ingestDay: string;
  score: number;
  scoreVersion: string;
  now: string;
}

export function buildCaptureUpdate(tableName: string, input: CaptureWriteInput): UpdateCommandInput {
  const { article: a, ingestDay, score, scoreVersion, now } = input;
  const b = updateBuilder();

  // Pinned once, for the life of the item. These four are the archive-integrity guarantee.
  b.setIfAbsent("ingestDay", ingestDay);
  b.setIfAbsent("firstSeenAt", now);
  b.setIfAbsent("publishedAt", a.publishedAt);
  b.setIfAbsent("hashVersion", HASH_VERSION);
  b.setIfAbsent("gsi1pk", dayPartition(ingestDay));

  // Refreshed every run.
  b.set("url", a.url);
  b.set("title", a.title);
  b.set("summary", a.summary);
  b.set("imageUrl", a.imageUrl);
  b.set("source", a.source);
  b.set("sourceName", a.sourceName);
  b.set("category", a.category);
  b.set("publishedAtSource", a.publishedAtSource);
  b.set("points", a.points);
  b.set("v", SCHEMA_VERSION);

  // setIfAbsent, NOT set. Capture runs hourly and its score is always the DEGRADED one, so
  // overwriting here reverts the rank position of every article ranked earlier that day --
  // enrichment survives (it is omitted-when-null) but the ORDERING does not, which is the
  // half of the archive invariant that is visible to the reader. Feeds carry items for days;
  // this is routine, not an edge case.
  //
  // The tradeoff: an unranked article's recency term stops decaying between captures. That is
  // acceptable because rank recomputes every score daily even when Bedrock is down, so no
  // score stays frozen longer than 24 hours.
  b.setIfAbsent("score", score);
  b.setIfAbsent("scoreVersion", scoreVersion);
  b.setIfAbsent("gsi1sk", buildSortKey(score, a.urlHash));

  return { TableName: tableName, Key: articleKey(a.urlHash), ...b.build() };
}

export interface RankWriteInput {
  urlHash: string;
  llmImportance: number | null;
  whyItMatters: string | null;
  clusterId: string | null;
  corroborationToday: number | null;
  /** Null in the enrichment phase, which writes model output without touching the ordering. */
  score: number | null;
  scoreVersion: string | null;
}

export function buildRankUpdate(tableName: string, input: RankWriteInput): UpdateCommandInput {
  const b = updateBuilder();
  b.set("llmImportance", input.llmImportance);
  b.set("whyItMatters", input.whyItMatters);
  b.set("clusterId", input.clusterId);
  b.set("corroborationToday", input.corroborationToday);
  b.set("score", input.score);
  b.set("scoreVersion", input.scoreVersion);
  // Only when there is a score to encode. The rank handler writes enrichment first and scores
  // second (spec §5's re-read pass), and the first write must not move the item in the index
  // using a sort key built from a null.
  if (input.score !== null) b.set("gsi1sk", buildSortKey(input.score, input.urlHash));

  return {
    TableName: tableName,
    Key: articleKey(input.urlHash),
    // The model can return a hash that was never captured. reconcile() reports those as
    // `unknown`, but this condition is what guarantees one can never materialise as a
    // half-built item with a score and no title.
    ConditionExpression: "attribute_exists(pk)",
    ...b.build(),
  };
}
