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

/** Finds the inline IAM::Policy attached to the function whose logical id contains `marker`. */
function policyDocumentFor(marker: string): any {
  const policies = Object.values(template().findResources("AWS::IAM::Policy"));
  const policy = policies.find((p: any) => JSON.stringify(p).includes(marker));
  if (!policy) throw new Error(`no IAM::Policy found referencing ${marker}`);
  return (policy as any).Properties.PolicyDocument;
}

const capturePolicyDocument = () => policyDocumentFor("CaptureFunction");
const rankPolicyDocument = () => policyDocumentFor("RankFunction");
const vercelPolicyDocument = () => policyDocumentFor("VercelReader");

describe("Functions", () => {
  it("gives the capture function no bedrock permission at all", () => {
    // Spec §2: /api/ingest triggers capture, so capture must be incapable of spending money.
    const policies = template().findResources("AWS::IAM::Policy");
    const capture = Object.values(policies).find((p) =>
      JSON.stringify(p).includes("CaptureFunction"))!;
    expect(JSON.stringify(capture)).not.toContain("bedrock");
  });

  it("scopes the rank function's bedrock permission to the one model", () => {
    const doc = rankPolicyDocument();
    const stmt = doc.Statement.find((s: any) => String(s.Action).includes("bedrock"))!;
    expect(JSON.stringify(stmt.Resource)).toContain("claude-sonnet-4-6");
    expect(JSON.stringify(stmt.Resource)).not.toBe('"*"');
  });

  it("gives neither function permission to delete table items", () => {
    for (const doc of [capturePolicyDocument(), rankPolicyDocument()]) {
      expect(JSON.stringify(doc)).not.toContain("dynamodb:DeleteItem");
      expect(JSON.stringify(doc)).not.toContain("dynamodb:Scan");
    }
  });

  it("gives only the rank function the github token", () => {
    expect(JSON.stringify(capturePolicyDocument())).not.toContain("ssm:GetParameter");
    expect(JSON.stringify(rankPolicyDocument())).toContain("ssm:GetParameter");
  });

  it("runs the rank schedule at 06:00 Europe/Istanbul", () => {
    template().hasResourceProperties("AWS::Scheduler::Schedule", {
      ScheduleExpression: "cron(0 6 * * ? *)",
      ScheduleExpressionTimezone: "Europe/Istanbul",
    });
  });

  it("runs capture hourly", () => {
    template().hasResourceProperties("AWS::Scheduler::Schedule", {
      ScheduleExpression: "rate(1 hour)",
    });
  });

  it("scopes each role to the key prefixes its own code writes", () => {
    // Without this, PutItem on the table ARN lets a compromised role overwrite any article
    // wholesale and forge META#DAY.
    const doc = capturePolicyDocument();
    const put = doc.Statement.find((s: any) => String(s.Action).includes("PutItem"))!;
    expect(JSON.stringify(put.Condition)).toContain("META#lastRun");
    const upd = doc.Statement.find((s: any) => String(s.Action).includes("UpdateItem"))!;
    expect(JSON.stringify(upd.Condition)).toContain("ART#");
  });

  it("scopes the rank function's PutItem to META#DAY and META#lock only", () => {
    const doc = rankPolicyDocument();
    const put = doc.Statement.find((s: any) =>
      String(s.Action).includes("PutItem") && !String(s.Action).includes("Update"))!;
    expect(JSON.stringify(put.Condition)).toContain("META#DAY");
    expect(JSON.stringify(put.Condition)).toContain("META#lock");
  });

  it("grants rank a base-table Query scoped to META#DAY for the multi-day gap check", () => {
    // src/lib/store/query.ts's listDays queries the BASE table (no IndexName) on pk =
    // "META#DAY" exactly. That's a different resource than the feed-by-day index Query below,
    // so it needs its own statement — otherwise the Task 7 review's gap-visibility feature is
    // denied on every single run, silently, because the caller wraps it in its own try/catch.
    const doc = rankPolicyDocument();
    const tableQueries = doc.Statement.filter((s: any) =>
      String(s.Action).includes("Query") &&
      !JSON.stringify(s.Resource).includes("index"));
    expect(tableQueries.length).toBeGreaterThan(0);
    expect(JSON.stringify(tableQueries)).toContain("META#DAY");
  });

  it("grants rank an index Query scoped to DAY# for reading a day's articles", () => {
    const doc = rankPolicyDocument();
    const indexQueries = doc.Statement.filter((s: any) =>
      String(s.Action).includes("Query") &&
      JSON.stringify(s.Resource).includes("feed-by-day"));
    expect(indexQueries.length).toBeGreaterThan(0);
    expect(JSON.stringify(indexQueries)).toContain("DAY#");
  });

  it("binds the bedrock grant to the inference profile, so it cannot fail open", () => {
    // Without the condition the foundation-model ARN also authorises direct on-demand
    // invocation of the bare model, bypassing the global profile.
    const stmt = rankPolicyDocument().Statement.find((s: any) => String(s.Action).includes("bedrock"))!;
    expect(JSON.stringify(stmt.Condition)).toContain("bedrock:InferenceProfileArn");
  });

  it("gives each function its own log group rather than logs on every log group", () => {
    const template_ = template();
    expect(Object.keys(template_.findResources("AWS::Logs::LogGroup"))).toHaveLength(2);
  });

  it("caps rank at one concurrent execution and zero async retries", () => {
    // Concurrency: spec §9 — two interleaved runs write two incompatible clusterings into one
    // day. Retries: a hard kill would otherwise re-bill the same ~$0.50 Bedrock call 3x.
    template().hasResourceProperties("AWS::Lambda::Function", {
      ReservedConcurrentExecutions: 1,
    });
    template().hasResourceProperties("AWS::Lambda::EventInvokeConfig", {
      MaximumRetryAttempts: 0,
    });
  });

  it("leaves the rank timeout well above the in-handler abort point", () => {
    // 900s Lambda vs 600s abort. Equal values mean the degraded fallback never runs, because a
    // Lambda timeout kills the environment with no catchable signal.
    //
    // NOTE: the brief's version of this test matched resources via
    // `JSON.stringify(f).includes("rank")` — that never matches anything. The synthesized
    // logical id is `RankFunction...` (capital R, and the id is the *key* of
    // findResources()'s map, not part of the stringified value), and the source path
    // "src/lambda/rank.ts" doesn't survive bundling into an S3 asset hash. That version of the
    // test passes vacuously (`.find` returns undefined, `undefined!.Properties` would throw —
    // actually caught here by keying on the entry, not the stringified value).
    const fns = Object.entries(template().findResources("AWS::Lambda::Function"));
    const [, rank] = fns.find(([id]) => id.includes("RankFunction"))!;
    expect((rank as any).Properties.Timeout).toBeGreaterThan(600);
  });

  it("gives the Vercel user no write and no bedrock permission", () => {
    const json = JSON.stringify(vercelPolicyDocument());
    for (const forbidden of ["bedrock", "dynamodb:PutItem", "dynamodb:UpdateItem",
                             "dynamodb:DeleteItem", "dynamodb:Scan"]) {
      expect(json, forbidden).not.toContain(forbidden);
    }
  });

  it("lets the Vercel user invoke capture but not rank", () => {
    const json = JSON.stringify(vercelPolicyDocument());
    expect(json).toContain("CaptureFunction");
    expect(json).not.toContain("RankFunction");
  });

  it("creates no access key in the template", () => {
    expect(Object.keys(template().findResources("AWS::IAM::AccessKey"))).toHaveLength(0);
  });
});
