import { Duration, RemovalPolicy, Stack } from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { NodejsFunction, OutputFormat } from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as scheduler from "aws-cdk-lib/aws-scheduler";
import * as ssm from "aws-cdk-lib/aws-ssm";
import type * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import { Construct } from "constructs";
// Imported, never re-typed. Two independent string literals for the same model drift apart
// on the next model bump and the drift shows up as an IAM denial, not a compile error.
import { RANK_MODEL } from "../../src/lib/rank/model.js";

const BARE_MODEL = RANK_MODEL.replace(/^global\./, "");

export interface FunctionsProps {
  table: dynamodb.TableV2;
  backupRepo: string;
  githubTokenParam: string;
}

export class Functions extends Construct {
  readonly capture: NodejsFunction;
  readonly rank: NodejsFunction;
  readonly vercel: iam.User;

  constructor(scope: Construct, id: string, props: FunctionsProps) {
    super(scope, id);
    const { region, account } = Stack.of(this);

    // An explicit log group per function, and an explicit execution role to match. A custom
    // `logGroup` prop only redirects where the function's logs land and how long they're
    // retained — it does NOT stop CDK from attaching its default execution role, which carries
    // the AWS-managed `AWSLambdaBasicExecutionRole` policy. That policy's actual Resource is
    // `"*"` (checked against the live account), not the `arn:aws:logs:*:*:*` its name implies:
    // every log group in the account, for both functions, forever. Spec §9 asks for
    // `logs:CreateLogStream`/`logs:PutLogEvents` on the function's OWN log group, nothing more.
    // Passing an explicit `role:` is what suppresses the managed-policy attachment
    // (aws-cdk-lib's own docs: "If you provide a Role, you must add the relevant AWS managed
    // policies yourself" — that IS the point here, since we add back only the two actions the
    // runtime needs).
    const logGroup = (name: string) =>
      new logs.LogGroup(this, `${name}Logs`, {
        retention: logs.RetentionDays.TWO_WEEKS,
        removalPolicy: RemovalPolicy.DESTROY,
      });

    // No `logs:CreateLogGroup`: the group is declared above and exists before the function
    // does, so nothing ever needs to create one. Resource is the single log group ARN — no
    // separate `:*` stream child is needed because CloudFormation's own `AWS::Logs::LogGroup`
    // `Arn` attribute already resolves with a trailing `:*` (the same single-ARN shape
    // `aws-cdk-lib`'s own `LogGroup.grantWrite()` uses internally, per its grants.json:
    // `["logs:CreateLogStream","logs:PutLogEvents"]` against `[this.logGroupArn]` alone).
    const executionRole = (name: string, group: logs.LogGroup) => {
      const role = new iam.Role(this, `${name}ExecutionRole`, {
        assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      });
      role.addToPolicy(new iam.PolicyStatement({
        actions: ["logs:CreateLogStream", "logs:PutLogEvents"],
        resources: [group.logGroupArn],
      }));
      return role;
    };

    const common = {
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,   // cheaper per ms, identical code
      environment: { TABLE_NAME: props.table.tableName },
      bundling: {
        format: OutputFormat.ESM,
        target: "node22",
        // Explicit, per spec line 120: "Set bundling.externalModules explicitly rather than
        // relying on the CDK default, which has changed across versions." `[]` means bundle
        // EVERYTHING -- no @aws-sdk/* package is externalised, unlike the CDK default, which
        // externalises @aws-sdk/* and relies on the runtime-provided SDK instead.
        //
        // Why the default is not safe here: the runtime-provided SDK is a CURATED snapshot,
        // not the full SDK, and has repeatedly shipped without newer or less common clients
        // (aws-cdk#24090, aws-sdk-js-v3#4401). The rank function pulls in
        // @aws-sdk/client-bedrock-runtime only TRANSITIVELY -- through
        // @anthropic-ai/bedrock-sdk, which nothing here declares directly -- so there is no
        // guarantee the runtime's snapshot carries it at all. If it does not, the rank
        // function dies with Runtime.ImportModuleError on its very first invocation: the one
        // Bedrock call this whole system exists to make. Nothing catches this in advance --
        // every test mocks the client, and neither `pnpm typecheck` nor `pnpm synth` looks
        // inside the emitted bundle; only reading `cdk.out/asset.*/index.mjs` itself proves it.
        //
        // It also makes the `@smithy/types` pnpm override (package.json) meaningful in
        // production. Left externalised, production would run whatever SDK version the
        // runtime ships -- not the version pinned and exercised by every test -- so the test
        // suite and the deployed code would silently be running different dependency graphs.
        //
        // Costs ~10-15 MB of asset on functions that run hourly and daily, where cold-start
        // size is not the constraint.
        externalModules: [],
        // Required BECAUSE of the line above, and we learned it the hard way: the AWS SDK
        // ships CJS, and esbuild bundling CJS into an ESM output replaces `require` with a
        // shim that throws on Node builtins --
        //   Error: Dynamic require of "node:https" is not supported
        // -- which killed the capture function on its first live invocation. `createRequire`
        // gives the bundled CJS a working `require`. Externalising and bundling each have a
        // failure mode; this is the one that comes with bundling, and this is its fix.
        banner:
          "import{createRequire}from'node:module';const require=createRequire(import.meta.url);",
      },
    };

    const captureLogGroup = logGroup("Capture");
    this.capture = new NodejsFunction(this, "CaptureFunction", {
      ...common,
      entry: "src/lambda/capture.ts",
      timeout: Duration.minutes(3),
      memorySize: 512,
      logGroup: captureLogGroup,
      role: executionRole("CaptureFunction", captureLogGroup),
      // Capture is reachable from a public route. Retrying a failed fetch pass costs nothing
      // and helps; it is set explicitly so it is a decision rather than a default.
      retryAttempts: 1,
    });

    const rankLogGroup = logGroup("Rank");
    this.rank = new NodejsFunction(this, "RankFunction", {
      ...common,
      entry: "src/lambda/rank.ts",
      // 900s, with the Bedrock call aborted at ~600s from inside the handler. Spec §6: a
      // Lambda timeout kills the execution environment with NO catchable signal, so a timeout
      // set equal to the abort point means the degraded-mode fallback can never run. The
      // margin between 600s and 900s is what lets the handler finish writing degraded scores.
      timeout: Duration.minutes(15),
      memorySize: 1024,
      logGroup: rankLogGroup,
      role: executionRole("RankFunction", rankLogGroup),
      // NO `reservedConcurrentExecutions`, and this is an account limit rather than a design
      // change. This account's Lambda concurrency quota is 10, not the usual 1000, and AWS
      // refuses any reservation that would leave fewer than 10 unreserved -- so reserving
      // even 1 is impossible here. The first deploy failed on exactly this.
      //
      // Spec §9 asked for reserved concurrency PLUS a conditional-write lock. We keep the
      // half that is the actual guarantee: the lock is a conditional PutItem on META#lock,
      // and DynamoDB conditional writes are atomic, so of two simultaneous runs exactly one
      // acquires it and the other returns early. Reserved concurrency was defence in depth.
      //
      // The one risk it covered was a run outliving the lock, and the numbers already
      // exclude that: the lock expires at 20 minutes, the Bedrock call aborts at 10, and
      // the Lambda timeout is 15. A run cannot reach the expiry. Task 7's "already
      // complete" guard is a third layer on top.
      //
      // The quota IS adjustable (Service Quotas, lambda L-B99A9384). If it is ever raised,
      // restoring `reservedConcurrentExecutions: 1` is a one-line change.
      // ZERO, deliberately. Lambda's default of 2 async retries means a hard kill re-bills the
      // same ~$0.50 Bedrock call up to three times, with no META#DAY written for the day at
      // all. Ranking is safe to re-run manually; it is not safe to re-run invisibly.
      retryAttempts: 0,
      environment: {
        ...common.environment,
        BACKUP_REPO: props.backupRepo,
        GITHUB_TOKEN_PARAM: props.githubTokenParam,
      },
    });

    // --- DynamoDB, key-scoped ---
    // Without a LeadingKeys condition, `PutItem` on the table ARN lets a compromised function
    // overwrite ANY article wholesale — precisely the damage spec §4's "UpdateItem, never
    // PutItem" rule exists to prevent — and forge META#DAY. The condition binds each role to
    // the key prefixes its own code actually writes.
    //
    // Verified against the actual call sites, not just against the brief: every
    // `client.send(...)` in src/lambda/capture.ts, src/lambda/rank.ts and src/lib/store/*.ts
    // was traced to the pk it reads or writes, so each statement below is scoped to exactly
    // what that function's own code touches — see task-8-report.md for the full trace.
    this.capture.addToRolePolicy(new iam.PolicyStatement({
      actions: ["dynamodb:UpdateItem"],
      resources: [props.table.tableArn],
      conditions: { "ForAllValues:StringLike": { "dynamodb:LeadingKeys": ["ART#*"] } },
    }));
    this.capture.addToRolePolicy(new iam.PolicyStatement({
      actions: ["dynamodb:PutItem"],
      resources: [props.table.tableArn],
      conditions: { "ForAllValues:StringEquals": { "dynamodb:LeadingKeys": ["META#lastRun"] } },
    }));

    this.rank.addToRolePolicy(new iam.PolicyStatement({
      actions: ["dynamodb:UpdateItem"],
      resources: [props.table.tableArn],
      conditions: { "ForAllValues:StringLike": { "dynamodb:LeadingKeys": ["ART#*"] } },
    }));
    this.rank.addToRolePolicy(new iam.PolicyStatement({
      actions: ["dynamodb:PutItem"],
      resources: [props.table.tableArn],
      conditions: { "ForAllValues:StringEquals": { "dynamodb:LeadingKeys": ["META#DAY", "META#lock"] } },
    }));
    this.rank.addToRolePolicy(new iam.PolicyStatement({
      // Query against the index needs the index ARN — spec §9 says "table ARN only", which is
      // true for WRITES (they propagate to GSIs automatically) but not for an index Query.
      // queryDay/dayHasArticles both query IndexName "feed-by-day" on gsi1pk = "DAY#<day>".
      actions: ["dynamodb:Query"],
      resources: [`${props.table.tableArn}/index/feed-by-day`],
      conditions: { "ForAllValues:StringLike": { "dynamodb:LeadingKeys": ["DAY#*"] } },
    }));
    this.rank.addToRolePolicy(new iam.PolicyStatement({
      // Distinct from the Query above: src/lib/store/query.ts's `listDays` (the multi-day gap
      // check added in Task 7's review) queries the BASE table with no IndexName at all —
      // `KeyConditionExpression: "pk = :p"`, pk = DAY_META_PK = "META#DAY" exactly. That is a
      // different resource (table ARN, not the index ARN) and a different action-scoping than
      // the PutItem grant above, so it needs its own statement or `listDays` gets denied on
      // every run — silently, since the gap check is wrapped in its own try/catch and only
      // logs "gap check failed" rather than failing the handler.
      actions: ["dynamodb:Query"],
      resources: [props.table.tableArn],
      conditions: { "ForAllValues:StringEquals": { "dynamodb:LeadingKeys": ["META#DAY"] } },
    }));

    // --- Bedrock, profile-scoped ---
    // The InferenceProfileArn condition is NOT optional. Without it the foundation-model ARN
    // in the resource list also authorises DIRECT on-demand invocation of the bare model,
    // bypassing the `global.` profile entirely — the permission fails OPEN, not closed. AWS's
    // own documentation uses this condition for exactly this global-profile scenario.
    const profileArn = `arn:aws:bedrock:${region}:${account}:inference-profile/${RANK_MODEL}`;

    // TWO statements, and the split is load-bearing: a single conditioned statement denies the
    // very call we need. Proven with `aws iam simulate-custom-policy`:
    //   conditioned statement, profile-targeted request  -> implicitDeny, 0 statements matched
    //   same statement with the context key supplied     -> allowed
    // `bedrock:InferenceProfileArn` is populated when a request reaches a FOUNDATION MODEL
    // through a profile. When the request targets the PROFILE itself — which is what a modelId
    // of "global.anthropic.claude-sonnet-4-6" does — the key is absent, StringEquals on an
    // absent key is false, and the statement never matches. The first live ranking run failed
    // with exactly this 403.
    //
    // 1: the profile itself. No condition — the resource ARN is already the constraint.
    this.rank.addToRolePolicy(new iam.PolicyStatement({
      actions: ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
      resources: [profileArn],
    }));

    // 2: the underlying foundation model, in every region the profile can route to. Omitting
    // those produces INTERMITTENT AccessDeniedException that fails only when a request happens
    // to route to an unlisted region (spec §9). HERE the condition belongs and does real work:
    // it stops this role invoking the bare model directly, so the only way through is our
    // profile. Without it the grant fails OPEN.
    this.rank.addToRolePolicy(new iam.PolicyStatement({
      actions: ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
      resources: [`arn:aws:bedrock:*::foundation-model/${BARE_MODEL}`],
      conditions: { StringEquals: { "bedrock:InferenceProfileArn": profileArn } },
    }));

    const githubToken = ssm.StringParameter.fromSecureStringParameterAttributes(this, "GithubToken", {
      parameterName: props.githubTokenParam,
    });
    // Explicit statement, not `.grantRead()`: that helper expands to FOUR actions —
    // ssm:DescribeParameters, ssm:GetParameters, ssm:GetParameter, ssm:GetParameterHistory.
    // Spec §9 asks for GetParameter alone. GetParameterHistory in particular returns PREVIOUS
    // versions of a SecureString, so granting it means rotating a leaked PAT doesn't revoke
    // read access to the old value — exactly the case rotation exists to close.
    this.rank.addToRolePolicy(new iam.PolicyStatement({
      actions: ["ssm:GetParameter"],
      resources: [githubToken.parameterArn],
    }));

    new scheduler.CfnSchedule(this, "CaptureSchedule", {
      flexibleTimeWindow: { mode: "OFF" },
      scheduleExpression: "rate(1 hour)",
      target: { arn: this.capture.functionArn, roleArn: this.schedulerRole(this.capture).roleArn },
    });

    // Shared by both rank schedules below, not called once per schedule: `schedulerRole`
    // names its Role construct from `fn.node.id` alone, so a second call for the same
    // function would collide on the same construct id within this scope. One role invoking
    // `this.rank` is exactly the permission either schedule needs.
    const rankSchedulerRole = this.schedulerRole(this.rank);

    new scheduler.CfnSchedule(this, "RankSchedule", {
      flexibleTimeWindow: { mode: "OFF" },
      scheduleExpression: "cron(0 6 * * ? *)",
      scheduleExpressionTimezone: "Europe/Istanbul",
      target: {
        arn: this.rank.functionArn,
        roleArn: rankSchedulerRole.roleArn,
        // EventBridge Scheduler has its OWN retry policy -- entirely separate from the
        // Lambda-side `retryAttempts: 0` set above, and left at CloudFormation's default
        // (185 attempts) if not stated here. Without this, a redelivery after the day lock's
        // 20-minute expiry would re-invoke rank -- and re-bill Bedrock -- for a day that may
        // already be complete. The handler's own "already complete" guard (src/lambda/
        // rank.ts) is the half of this that actually matters, since it does not depend on
        // this configuration being right; this is defense in depth, not the only line of
        // defense.
        retryPolicy: { maximumRetryAttempts: 0 },
      },
    });

    // The FINAL run above targets yesterday and may mark it "complete". This INTERIM run
    // targets TODAY -- whatever has been captured between midnight and 18:00 -- so articles
    // captured after this fires don't sit unranked until tomorrow's 06:00 final run. The
    // `{"interim":true}` payload is what src/lambda/rank.ts's `resolveDay` reads to pick
    // today over yesterday AND to force `status: "partial"` no matter how the run goes: the
    // evening's articles haven't been captured yet, so this run must never mark today
    // "complete" -- if it did, tomorrow's final run would see "complete" already and skip the
    // day via the same already-complete guard that protects against double-billing, stranding
    // everything captured after 18:00 unranked forever.
    new scheduler.CfnSchedule(this, "RankInterimSchedule", {
      flexibleTimeWindow: { mode: "OFF" },
      scheduleExpression: "cron(0 18 * * ? *)",
      scheduleExpressionTimezone: "Europe/Istanbul",
      target: {
        arn: this.rank.functionArn,
        roleArn: rankSchedulerRole.roleArn,
        input: JSON.stringify({ interim: true }),
        // Same reasoning as the final run's schedule above: this is defense in depth around
        // the handler's own guards, not the only protection against a re-billed Bedrock call.
        retryPolicy: { maximumRetryAttempts: 0 },
      },
    });

    this.vercel = this.vercelReader(props.table);
  }

  private schedulerRole(fn: lambda.IFunction): iam.Role {
    const role = new iam.Role(this, `${fn.node.id}SchedulerRole`, {
      assumedBy: new iam.ServicePrincipal("scheduler.amazonaws.com"),
    });
    fn.grantInvoke(role);
    return role;
  }

  private vercelReader(table: dynamodb.TableV2): iam.User {
    const user = new iam.User(this, "VercelReader");
    // Split rather than one statement pairing both actions with both resources: there is no
    // such thing as GetItem against a GSI (it is a base-table-only operation), so a statement
    // that grants it alongside `${table.tableArn}/index/*` was inert -- harmless, since IAM
    // simply never has occasion to apply it there -- but it misled the next reader into
    // thinking that combination means something.
    user.addToPolicy(new iam.PolicyStatement({
      actions: ["dynamodb:GetItem"],
      resources: [table.tableArn],
    }));
    user.addToPolicy(new iam.PolicyStatement({
      actions: ["dynamodb:Query"],
      resources: [table.tableArn, `${table.tableArn}/index/*`],
    }));
    // Capture only, never rank. Spec §2: a refresh path that reaches ranking lets a stuck
    // finger — or a leaked secret — spend the credit balance.
    user.addToPolicy(new iam.PolicyStatement({
      actions: ["lambda:InvokeFunction"],
      resources: [this.capture.functionArn],
    }));
    return user;
  }
}
