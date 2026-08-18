import { mockClient } from "aws-sdk-client-mock";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { beforeEach, describe, expect, it } from "vitest";
import { dayHasArticles, getLatestCompleteDay, queryDay } from "../../src/lib/store/query.js";

const ddb = mockClient(DynamoDBDocumentClient);
beforeEach(() => ddb.reset());

describe("queryDay", () => {
  it("reads the day partition descending, so the highest score comes back first", async () => {
    ddb.on(QueryCommand).resolves({ Items: [{ title: "a" }] });
    await queryDay(ddb as never, "t", "2026-08-18");
    const call = ddb.commandCalls(QueryCommand)[0]!.args[0].input;
    expect(call.IndexName).toBe("feed-by-day");
    expect(call.ExpressionAttributeValues![":d"]).toBe("DAY#2026-08-18");
    expect(call.ScanIndexForward).toBe(false);
  });

  it("follows LastEvaluatedKey to the end, rather than returning a partial day", async () => {
    // Spec §8. The 1 MB page limit applies before filtering, so a day at the size bound
    // returns silently truncated without this.
    ddb.on(QueryCommand)
      .resolvesOnce({ Items: [{ title: "a" }], LastEvaluatedKey: { pk: "x" } })
      .resolvesOnce({ Items: [{ title: "b" }], LastEvaluatedKey: { pk: "y" } })
      .resolves({ Items: [{ title: "c" }] });

    const items = await queryDay(ddb as never, "t", "2026-08-18");
    expect(items.map((i) => i.title)).toEqual(["a", "b", "c"]);
    expect(ddb.commandCalls(QueryCommand)).toHaveLength(3);
    expect(ddb.commandCalls(QueryCommand)[1]!.args[0].input.ExclusiveStartKey).toEqual({ pk: "x" });
  });
});

describe("dayHasArticles", () => {
  it("is true when the day's partition returns at least one item", async () => {
    ddb.on(QueryCommand).resolves({ Items: [{ title: "a" }] });
    expect(await dayHasArticles(ddb as never, "t", "2026-08-18")).toBe(true);
    expect(ddb.commandCalls(QueryCommand)[0]!.args[0].input.Limit).toBe(1);
  });

  it("is false rather than throwing when the day has nothing", async () => {
    ddb.on(QueryCommand).resolves({ Items: [] });
    expect(await dayHasArticles(ddb as never, "t", "2026-08-18")).toBe(false);
  });
});

describe("getLatestCompleteDay", () => {
  it("skips a partial day and returns the newest complete one", async () => {
    ddb.on(QueryCommand).resolves({ Items: [
      { day: "2026-08-19", status: "partial" },
      { day: "2026-08-18", status: "complete" },
    ] });
    expect((await getLatestCompleteDay(ddb as never, "t"))?.day).toBe("2026-08-18");
  });

  it("returns null rather than throwing when no day has completed yet", async () => {
    ddb.on(QueryCommand).resolves({ Items: [] });
    expect(await getLatestCompleteDay(ddb as never, "t")).toBeNull();
  });
});
