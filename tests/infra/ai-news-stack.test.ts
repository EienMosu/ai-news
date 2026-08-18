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

describe("stack outputs", () => {
  // The runbook (steps 4, 6-8) hands the operator TABLE_NAME and the two function names
  // straight from `cdk deploy`'s own output rather than making them hunt for CDK-generated
  // physical names. Without these three outputs there is no reliable lookup at all for the
  // table -- it synthesizes as AWS::DynamoDB::GlobalTable, not AWS::DynamoDB::Table, so even a
  // resource-type filter doesn't find it.
  it("outputs the table name", () => {
    // Mutation: deleting the `new CfnOutput(this, "TableName", ...)` block removes this
    // output entirely -- red, because `hasOutput` requires a match to exist at all.
    template().hasOutput("TableName", {});
  });

  it("outputs the capture function's real name", () => {
    // Mutation: `this.functions.capture.functionName` -> `this.functions.rank.functionName`
    // points this output at the wrong function -- red, because the output's Value no longer
    // resolves to a Ref/GetAtt on the CaptureFunction resource.
    const outputs = template().findOutputs("CaptureFunctionName");
    const value = JSON.stringify(outputs.CaptureFunctionName!.Value);
    expect(value).toMatch(/FunctionsCaptureFunction/);
  });

  it("outputs the rank function's real name", () => {
    const outputs = template().findOutputs("RankFunctionName");
    const value = JSON.stringify(outputs.RankFunctionName!.Value);
    expect(value).toMatch(/FunctionsRankFunction/);
  });

  it("does not cross-wire the two function outputs", () => {
    // Mutation: swapping the two CfnOutput values (Capture <-> Rank) makes both of the above
    // tests pass individually only if the swap were symmetric in naming, which it isn't --
    // this test pins the pairing down directly by comparing them against each other.
    const outputs = template().toJSON().Outputs;
    const captureValue = JSON.stringify(outputs.CaptureFunctionName!.Value);
    const rankValue = JSON.stringify(outputs.RankFunctionName!.Value);
    expect(captureValue).not.toBe(rankValue);
    expect(captureValue).toMatch(/CaptureFunction/);
    expect(rankValue).toMatch(/RankFunction/);
  });

  it("outputs the VercelReader IAM user's real name", () => {
    // The user has no explicit `userName`, so CloudFormation auto-generates its physical name
    // -- it is not literally "VercelReader" in the console. Mutation:
    // `this.functions.vercel.userName` -> a hardcoded `"VercelReader"` string still produces
    // an output, but red here because the value would then be a literal string instead of a
    // Ref/GetAtt onto the VercelReader resource.
    const outputs = template().findOutputs("VercelReaderUserName");
    const value = JSON.stringify(outputs.VercelReaderUserName!.Value);
    expect(value).toMatch(/VercelReader/);
    expect(value).not.toBe('"VercelReader"');
  });
});
