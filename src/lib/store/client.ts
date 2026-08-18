import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

let cached: DynamoDBDocumentClient | undefined;

/**
 * One client per Lambda container. Created lazily so importing this module in a unit test
 * does not construct an SDK client or attempt credential resolution.
 */
export function docClient(): DynamoDBDocumentClient {
  cached ??= DynamoDBDocumentClient.from(new DynamoDBClient({}), {
    marshallOptions: { removeUndefinedValues: true },
  });
  return cached;
}

/** Test seam. Never called in production code. */
export function __setDocClient(c: DynamoDBDocumentClient | undefined) {
  cached = c;
}
