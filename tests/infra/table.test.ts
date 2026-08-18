import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { AiNewsStack } from "../../infra/lib/ai-news-stack.js";

const template = () =>
  Template.fromStack(new AiNewsStack(new App(), "Test", {
    env: { account: "111111111111", region: "eu-central-1" },
    alertEmail: "alerts@example.com",
    backupRepo: "EienMosu/ai-news",
    githubTokenParam: "/ai-news/github-token",
  }));

describe("article table", () => {
  it("bills on demand, because provisioned capacity at this shape costs ~$28/month", () => {
    // Spec §4: the free 25 RCU/WCU allowance is per-account-per-region across tables AND
    // indexes, so "provisioned to stay free" is arithmetically impossible here.
    template().hasResourceProperties("AWS::DynamoDB::GlobalTable", {
      BillingMode: "PAY_PER_REQUEST",
    });
  });

  it("retains the table when the stack is destroyed, because it holds the archive", () => {
    template().hasResource("AWS::DynamoDB::GlobalTable", { DeletionPolicy: "Retain" });
  });

  it("declares exactly one GSI, named feed-by-day, keyed for a descending score read", () => {
    // NOTE the path. `AWS::DynamoDB::GlobalTable` puts KeySchema and Projection ONLY at
    // top-level Properties.GlobalSecondaryIndexes[i]; the Replicas[0] entry carries just
    // IndexName. Asserting through Replicas[0] does not fail — it THROWS on undefined.
    const gsis = Object.values(template().findResources("AWS::DynamoDB::GlobalTable"))[0]!
      .Properties.GlobalSecondaryIndexes;
    expect(gsis).toHaveLength(1);
    expect(gsis[0].IndexName).toBe("feed-by-day");
  });

  it("projects every attribute the feed card and cluster list need", () => {
    // INCLUDE not ALL: ALL duplicates every attribute into the index and doubles write cost.
    // The list is deliberately a little wider than spec §7's card fields. The asymmetry
    // decides it: over-projecting costs fractions of a cent per month, under-projecting costs
    // recreating the index and backfilling the archive, and a projection is IMMUTABLE after
    // creation. `url` in particular is load-bearing for the detail page's "also covered by…"
    // cluster list, and `scoreVersion` for spec §2's "new since last ranking" marker.
    const table = Object.values(template().findResources("AWS::DynamoDB::GlobalTable"))[0]!;
    const proj = table.Properties.GlobalSecondaryIndexes[0].Projection;
    expect(proj.ProjectionType).toBe("INCLUDE");
    expect([...proj.NonKeyAttributes].sort()).toEqual([
      "category", "clusterId", "corroborationToday", "firstSeenAt", "imageUrl",
      "llmImportance", "points", "pointsImputed", "publishedAt", "score", "scoreVersion",
      "section", "source", "sourceName", "summary", "title", "url", "whyItMatters",
    ]);
  });

  it("projects section -- one of the two attributes that cannot be added after this table deploys", () => {
    // Mutation: removing "section" from FEED_CARD_ATTRIBUTES in infra/lib/table.ts (or from
    // this list) makes this fail on length alone -- 17 instead of 18 -- as well as on content.
    // This is deliberately its own assertion, separate from the general projection test above,
    // because this one attribute is the entire reason this task exists: a GSI projection is
    // immutable after index creation, and nothing is deployed yet.
    const table = Object.values(template().findResources("AWS::DynamoDB::GlobalTable"))[0]!;
    const proj = table.Properties.GlobalSecondaryIndexes[0].Projection;
    expect(proj.NonKeyAttributes).toHaveLength(18);
    expect(proj.NonKeyAttributes).toContain("section");
  });

  it("enables point-in-time recovery", () => {
    template().hasResourceProperties("AWS::DynamoDB::GlobalTable", {
      Replicas: [ { PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true } } ],
    });
  });
});
