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

  it("sets the rank schedule's own retry policy to zero, separate from the Lambda-side setting", () => {
    // EventBridge Scheduler has ITS OWN retry policy, independent of the Lambda `retryAttempts:
    // 0` asserted below -- a schedule redelivery after the day lock's 20-minute expiry would
    // otherwise re-invoke (and re-bill Bedrock for) a day. Mutation: deleting `retryPolicy`
    // from RankSchedule's target leaves this property absent (undefined, not 0).
    const schedules = Object.values(template().findResources("AWS::Scheduler::Schedule"));
    const rankSchedule = schedules.find(
      (s: any) => s.Properties.ScheduleExpression === "cron(0 6 * * ? *)",
    )!;
    expect((rankSchedule as any).Properties.Target.RetryPolicy?.MaximumRetryAttempts).toBe(0);
  });

  /** The 18:00 interim schedule's own Properties, found by its distinct cron expression so it
   *  can never be confused with the 06:00 final schedule above. */
  const interimScheduleProperties = () => {
    const schedules = Object.values(template().findResources("AWS::Scheduler::Schedule"));
    const interim = schedules.find(
      (s: any) => s.Properties.ScheduleExpression === "cron(0 18 * * ? *)",
    )!;
    return (interim as any).Properties;
  };

  it("runs the interim rank schedule at 18:00 Europe/Istanbul", () => {
    // Mutation: changing RankInterimSchedule's `scheduleExpressionTimezone` from
    // "Europe/Istanbul" to anything else (or omitting it) makes this read undefined instead of
    // "Europe/Istanbul" -- the interim run would then fire at 18:00 UTC, not 18:00 local.
    expect(interimScheduleProperties().ScheduleExpressionTimezone).toBe("Europe/Istanbul");
  });

  it("points the interim schedule's target at the rank function, not capture", () => {
    const target = interimScheduleProperties().Target;
    // Resolve both function logical ids directly off their own resources rather than assuming
    // naming, so this test still means something if either function is ever renamed.
    const functionIds = Object.keys(template().findResources("AWS::Lambda::Function"));
    const rankFnId = functionIds.find((id) => id.includes("RankFunction"))!;
    const captureFnId = functionIds.find((id) => id.includes("CaptureFunction"))!;
    // Mutation: changing RankInterimSchedule's target `arn` from `this.rank.functionArn` to
    // `this.capture.functionArn` makes `target.Arn` resolve to the capture function's logical
    // id instead of the rank function's -- this run would silently invoke the wrong Lambda,
    // capturing articles at 18:00 instead of ranking them.
    expect(JSON.stringify(target.Arn)).toContain(rankFnId);
    expect(JSON.stringify(target.Arn)).not.toContain(captureFnId);
  });

  it("sends {\"interim\":true} as the interim schedule's invocation payload", () => {
    // This is the ONLY signal src/lambda/rank.ts's `resolveDay` has to pick today over
    // yesterday and to force `status: "partial"`. Mutation: changing the payload from
    // `JSON.stringify({ interim: true })` to `JSON.stringify({ interim: false })` (or omitting
    // `input` entirely) makes this read something other than the exact string `{"interim":
    // true}` -- the schedule would then re-run a FINAL rank on yesterday a second time instead
    // of ranking today so far.
    expect(interimScheduleProperties().Target.Input).toBe(JSON.stringify({ interim: true }));
  });

  it("sets the interim schedule's own retry policy to zero, like the 06:00 final schedule", () => {
    // Same reasoning as the 06:00 schedule's own retry-policy test above: EventBridge
    // Scheduler's retry is independent of the Lambda-side `retryAttempts: 0`, and a redelivery
    // after the 20-minute day lock expires would pay for a second Bedrock call.
    // Mutation: deleting `retryPolicy` from RankInterimSchedule's target leaves this property
    // absent (undefined, not 0).
    expect(interimScheduleProperties().Target.RetryPolicy?.MaximumRetryAttempts).toBe(0);
  });

  it("grants the shared rank scheduler role invoke on the rank function only, not capture", () => {
    // Both rank schedules share ONE role (see the comment above `rankSchedulerRole` in
    // functions.ts) -- this confirms that sharing didn't quietly widen what the role can
    // invoke. `policyDocumentFor` matches on marker text, and "RankFunctionSchedulerRole" is
    // distinct from "RankFunction" alone, so this can't accidentally match the rank function's
    // OWN execution-role policy instead of its scheduler role's.
    //
    // Checks EVERY `lambda:InvokeFunction` statement, not just the first: a stray extra grant
    // (e.g. `this.capture.grantInvoke(rankSchedulerRole)`) lands as a SECOND statement in the
    // same policy document rather than replacing the first, so a `.find()` here would still
    // see only the rank-only statement and miss it entirely.
    const doc = policyDocumentFor("RankFunctionSchedulerRole");
    const invokeStatements = doc.Statement.filter((s: any) =>
      String(s.Action).includes("lambda:InvokeFunction"));
    expect(invokeStatements.length).toBeGreaterThan(0);
    // Mutation: changing `schedulerRole` (called once, shared by both schedules) back to being
    // called separately per schedule with `fn.grantInvoke` also given `this.capture` by
    // mistake would make this string contain "CaptureFunction" too.
    expect(JSON.stringify(invokeStatements)).not.toContain("CaptureFunction");
    expect(JSON.stringify(invokeStatements)).toContain("RankFunction");
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

  it("splits the bedrock grant so the profile call works and the bare model stays fenced", () => {
    // Two statements, and the split is the point. A single CONDITIONED statement denies the
    // call we actually make: `bedrock:InferenceProfileArn` is only populated when a request
    // reaches a foundation model THROUGH a profile, so when the request targets the profile
    // itself the key is absent and StringEquals on an absent key is false. The first live
    // ranking run failed with exactly that 403, and `iam simulate-custom-policy` reproduces it.
    const bedrock = rankPolicyDocument().Statement.filter((s: any) =>
      String(s.Action).includes("bedrock"),
    );
    expect(bedrock).toHaveLength(2);

    const onProfile = bedrock.find((s: any) => JSON.stringify(s.Resource).includes("inference-profile"))!;
    const onModel = bedrock.find((s: any) => JSON.stringify(s.Resource).includes("foundation-model"))!;

    // The profile statement must NOT be conditioned, or the call is denied outright.
    expect(onProfile.Condition).toBeUndefined();
    // The model statement MUST be, or the role could invoke the bare model directly and the
    // grant fails OPEN — more access than intended, which nothing alerts on.
    expect(JSON.stringify(onModel.Condition)).toContain("bedrock:InferenceProfileArn");
  });

  it("gives each function its own log group rather than logs on every log group", () => {
    const template_ = template();
    expect(Object.keys(template_.findResources("AWS::Logs::LogGroup"))).toHaveLength(2);
  });

  it("sets zero async retries on rank, so a hard kill cannot re-bill the Bedrock call", () => {
    template().hasResourceProperties("AWS::Lambda::EventInvokeConfig", {
      MaximumRetryAttempts: 0,
    });
  });

  it("reserves no concurrency, because this account's quota makes it impossible", () => {
    // The account's Lambda concurrency limit is 10 and AWS refuses a reservation that leaves
    // fewer than 10 unreserved, so `reservedConcurrentExecutions: 1` fails at deploy time --
    // synth accepts it happily. Mutual exclusion comes from the day lock instead.
    for (const fn of Object.values(template().findResources("AWS::Lambda::Function"))) {
      expect(fn.Properties.ReservedConcurrentExecutions).toBeUndefined();
    }
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

  it("scopes the vercel reader's GetItem to the base table only, since GetItem cannot target a GSI", () => {
    // Fix 11 (final review, axis 1): GetItem paired with `${table.tableArn}/index/*` was
    // inert (there is no such thing as GetItem against a GSI) but misleading to the next
    // reader. Mutation: reverting to one statement granting both actions against both
    // resources makes the GetItem statement's Resource include "index" again.
    const doc = vercelPolicyDocument();
    const getItem = doc.Statement.find((s: any) => String(s.Action).includes("GetItem"))!;
    expect(JSON.stringify(getItem.Resource)).not.toContain("index");
    const query = doc.Statement.find((s: any) => String(s.Action).includes("Query"))!;
    expect(JSON.stringify(query.Resource)).toContain("index");
  });

  it("creates no access key in the template", () => {
    expect(Object.keys(template().findResources("AWS::IAM::AccessKey"))).toHaveLength(0);
  });

  it("attaches no AWS managed policy to either function's execution role", () => {
    // A default NodejsFunction-generated role carries AWSLambdaBasicExecutionRole, whose actual
    // Resource is "*" (verified against the live account) — every log group in the account,
    // not just the function's own. Passing an explicit `role:` is what suppresses that
    // attachment; this is the regression that would otherwise be invisible, since the function
    // would keep logging successfully either way.
    const roles = Object.entries(template().findResources("AWS::IAM::Role"));
    const executionRoles = roles.filter(([id]) => id.includes("ExecutionRole"));
    expect(executionRoles.length).toBe(2);
    for (const [, role] of executionRoles) {
      expect((role as any).Properties.ManagedPolicyArns).toBeUndefined();
    }
  });

  it("scopes each function's logging permission to CreateLogStream/PutLogEvents only, never CreateLogGroup", () => {
    // The group is declared in CDK and exists before the function does, so nothing needs to
    // create it. `logs:CreateLogGroup` reappearing here would mean the role can create OTHER
    // log groups too, which is exactly the account-wide shape spec §9 forbids.
    for (const doc of [capturePolicyDocument(), rankPolicyDocument()]) {
      const json = JSON.stringify(doc);
      expect(json).toContain("logs:CreateLogStream");
      expect(json).toContain("logs:PutLogEvents");
      expect(json).not.toContain("logs:CreateLogGroup");
    }
  });

  it("scopes the github token grant to GetParameter only, not grantRead's other three actions", () => {
    // `.grantRead()` on an IStringParameter expands to DescribeParameters, GetParameters,
    // GetParameter, and GetParameterHistory. GetParameterHistory returns PREVIOUS versions of
    // a SecureString, so granting it would let a rotated-away PAT stay readable.
    const json = JSON.stringify(rankPolicyDocument());
    expect(json).toContain("ssm:GetParameter");
    for (const forbidden of ["ssm:GetParameterHistory", "ssm:GetParameters", "ssm:DescribeParameters"]) {
      expect(json).not.toContain(forbidden);
    }
  });
});
