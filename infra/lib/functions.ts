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

    // An explicit log group per function. CDK's default execution role attaches
    // AWSLambdaBasicExecutionRole, which grants logs on `arn:aws:logs:*:*:*`; spec §9 asks for
    // "the function's own log group". Declaring the group also makes retention a property of
    // the group rather than of the deprecated `logRetention` custom resource.
    const logGroup = (name: string) =>
      new logs.LogGroup(this, `${name}Logs`, {
        retention: logs.RetentionDays.TWO_WEEKS,
        removalPolicy: RemovalPolicy.DESTROY,
      });

    const common = {
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,   // cheaper per ms, identical code
      environment: { TABLE_NAME: props.table.tableName },
      bundling: { format: OutputFormat.ESM, target: "node22" },
      // Left at the default (externalize @aws-sdk/*, use the runtime-provided SDK). Note the
      // consequence: production runs whatever SDK version nodejs22.x ships, not the version
      // pinned in package.json and exercised by the tests. Set `bundleAwsSDK: true` if that
      // divergence ever matters more than the ~10 MB of bundle it costs.
    };

    this.capture = new NodejsFunction(this, "CaptureFunction", {
      ...common,
      entry: "src/lambda/capture.ts",
      timeout: Duration.minutes(3),
      memorySize: 512,
      logGroup: logGroup("Capture"),
      // Capture is reachable from a public route. Retrying a failed fetch pass costs nothing
      // and helps; it is set explicitly so it is a decision rather than a default.
      retryAttempts: 1,
    });

    this.rank = new NodejsFunction(this, "RankFunction", {
      ...common,
      entry: "src/lambda/rank.ts",
      // 900s, with the Bedrock call aborted at ~600s from inside the handler. Spec §6: a
      // Lambda timeout kills the execution environment with NO catchable signal, so a timeout
      // set equal to the abort point means the degraded-mode fallback can never run. The
      // margin between 600s and 900s is what lets the handler finish writing degraded scores.
      timeout: Duration.minutes(15),
      memorySize: 1024,
      logGroup: logGroup("Rank"),
      // Spec §9: reserved concurrency of 1, so a manual trigger and the schedule cannot
      // interleave and write two incompatible clusterings into one day partition.
      reservedConcurrentExecutions: 1,
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
    this.rank.addToRolePolicy(new iam.PolicyStatement({
      actions: ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
      resources: [
        profileArn,
        // Every region the profile can route to. Omitting them produces INTERMITTENT
        // AccessDeniedException that fails only when a request happens to route to an
        // unlisted region — the non-determinism is what pushes people to attach
        // AmazonBedrockFullAccess. Spec §9.
        `arn:aws:bedrock:*::foundation-model/${BARE_MODEL}`,
      ],
      conditions: { StringEquals: { "bedrock:InferenceProfileArn": profileArn } },
    }));

    ssm.StringParameter.fromSecureStringParameterAttributes(this, "GithubToken", {
      parameterName: props.githubTokenParam,
    }).grantRead(this.rank);

    new scheduler.CfnSchedule(this, "CaptureSchedule", {
      flexibleTimeWindow: { mode: "OFF" },
      scheduleExpression: "rate(1 hour)",
      target: { arn: this.capture.functionArn, roleArn: this.schedulerRole(this.capture).roleArn },
    });

    new scheduler.CfnSchedule(this, "RankSchedule", {
      flexibleTimeWindow: { mode: "OFF" },
      scheduleExpression: "cron(0 6 * * ? *)",
      scheduleExpressionTimezone: "Europe/Istanbul",
      target: { arn: this.rank.functionArn, roleArn: this.schedulerRole(this.rank).roleArn },
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
    user.addToPolicy(new iam.PolicyStatement({
      actions: ["dynamodb:Query", "dynamodb:GetItem"],
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
