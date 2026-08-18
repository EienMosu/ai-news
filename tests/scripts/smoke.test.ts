import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { DescribeTableCommand, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { ListSchedulesCommand, SchedulerClient } from "@aws-sdk/client-scheduler";
import { ListSubscriptionsByTopicCommand, ListTopicsCommand, SNSClient } from "@aws-sdk/client-sns";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runSmoke } from "../../scripts/smoke.js";

const ddb = mockClient(DynamoDBClient);
const doc = mockClient(DynamoDBDocumentClient);
const ssm = mockClient(SSMClient);
const sns = mockClient(SNSClient);
const scheduler = mockClient(SchedulerClient);
const bedrock = mockClient(BedrockRuntimeClient);

// Minutes-ago helper so lastRun-age assertions don't depend on fake timers -- at the
// magnitudes used here (minutes), the few milliseconds a test takes to run never shifts the
// rounded-to-the-minute result.
const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();

function awsError(name: string, message: string): Error {
  return Object.assign(new Error(message), { name });
}

function healthyTable() {
  ddb.on(DescribeTableCommand).resolves({
    Table: {
      TableStatus: "ACTIVE",
      BillingModeSummary: { BillingMode: "PAY_PER_REQUEST" },
      GlobalSecondaryIndexes: [{ IndexName: "feed-by-day", IndexStatus: "ACTIVE" }],
    },
  });
}

function healthyLastRun(overrides: Record<string, unknown> = {}) {
  doc.on(GetCommand).resolves({
    Item: {
      startedAt: minutesAgo(5),
      itemsWritten: 10,
      itemsFailed: 0,
      perSourceCounts: {},
      filtered: {},
      quarantined: {},
      errors: [],
      ...overrides,
    },
  });
}

function healthyDays() {
  doc.on(QueryCommand).resolves({
    Items: [{ day: "2026-08-18", status: "complete", articleCount: 42 }],
  });
}

function healthyToken() {
  ssm.on(GetParameterCommand).resolves({ Parameter: { Name: "/ai-news/github-token" } });
}

function healthyAlerts() {
  sns.on(ListTopicsCommand).resolves({
    Topics: [{ TopicArn: "arn:aws:sns:eu-central-1:356117015048:AiNewsStack-MonitoringAlerts" }],
  });
  sns.on(ListSubscriptionsByTopicCommand).resolves({
    Subscriptions: [
      { Protocol: "email", Endpoint: "owner@example.com", SubscriptionArn: "arn:aws:sns:...:sub" },
    ],
  });
}

function healthySchedules() {
  scheduler.on(ListSchedulesCommand).resolves({
    Schedules: [
      { Name: "AiNewsStack-CaptureSchedule", State: "ENABLED" },
      { Name: "AiNewsStack-RankSchedule", State: "ENABLED" },
    ],
  });
}

function healthyAll() {
  healthyTable();
  healthyLastRun();
  healthyDays();
  healthyToken();
  healthyAlerts();
  healthySchedules();
}

/** Runs runSmoke with console.log captured, so assertions can read exactly what a human would see. */
async function run(argv: string[] = []): Promise<{ failures: number; lines: string[] }> {
  const lines: string[] = [];
  const spy = vi.spyOn(console, "log").mockImplementation((m: unknown) => {
    lines.push(String(m));
  });
  const failures = await runSmoke(argv);
  spy.mockRestore();
  return { failures, lines };
}

const hasLine = (lines: string[], substring: string) => lines.some((l) => l.includes(substring));

beforeEach(() => {
  ddb.reset();
  doc.reset();
  ssm.reset();
  sns.reset();
  scheduler.reset();
  bedrock.reset();
  process.env.TABLE_NAME = "t";
  delete process.env.GITHUB_TOKEN_PARAM;
});

afterEach(() => {
  delete process.env.TABLE_NAME;
  delete process.env.GITHUB_TOKEN_PARAM;
});

describe("a fully healthy deploy", () => {
  it("reports zero failures and 'all checks passed'", async () => {
    healthyAll();
    const { failures, lines } = await run();
    expect(failures).toBe(0);
    expect(hasLine(lines, "all checks passed")).toBe(true);
  });
});

describe("table check", () => {
  it("flags a table that is not ACTIVE", async () => {
    // Mutation: `t.TableStatus === "ACTIVE"` -> `t.TableStatus !== "ACTIVE"` makes this pass
    // silently as "ok" instead of failing -- red without the fix.
    healthyAll();
    ddb.on(DescribeTableCommand).resolves({
      Table: {
        TableStatus: "CREATING",
        BillingModeSummary: { BillingMode: "PAY_PER_REQUEST" },
        GlobalSecondaryIndexes: [{ IndexName: "feed-by-day", IndexStatus: "ACTIVE" }],
      },
    });
    const { failures, lines } = await run();
    expect(hasLine(lines, "FAIL table CREATING")).toBe(true);
    expect(failures).toBe(1);
  });

  it("flags provisioned billing as a cost regression, not just 'different'", async () => {
    // Mutation: dropping the `-- provisioned costs ~$28/mo here` half of the message would
    // still fail the check but stop telling the reader why it matters; caught by the substring
    // assertion below, not just the failure count.
    healthyAll();
    ddb.on(DescribeTableCommand).resolves({
      Table: {
        TableStatus: "ACTIVE",
        BillingModeSummary: { BillingMode: "PROVISIONED" },
        GlobalSecondaryIndexes: [{ IndexName: "feed-by-day", IndexStatus: "ACTIVE" }],
      },
    });
    const { failures, lines } = await run();
    expect(hasLine(lines, "billing is PROVISIONED -- provisioned costs ~$28/mo here")).toBe(true);
    expect(failures).toBe(1);
  });

  it("flags a missing or non-ACTIVE feed-by-day GSI", async () => {
    // Mutation: `gsi?.IndexStatus === "ACTIVE"` -> `!== "ACTIVE"` inverts this to ok/fail
    // backwards.
    healthyAll();
    ddb.on(DescribeTableCommand).resolves({
      Table: {
        TableStatus: "ACTIVE",
        BillingModeSummary: { BillingMode: "PAY_PER_REQUEST" },
        GlobalSecondaryIndexes: [],
      },
    });
    const { failures, lines } = await run();
    expect(hasLine(lines, "FAIL GSI missing or not ACTIVE")).toBe(true);
    expect(failures).toBe(1);
  });

  it("reports a missing table informatively, using the AWS error name, not just its message", async () => {
    // This is the real shape seen against the undeployed account: DescribeTable's own
    // .message is already descriptive, but other services (see the github-token test below)
    // are not, so the check must always prefix with e.name. Mutation: `${e.name}: ${e.message}`
    // -> `${e.message}` alone still passes THIS test (DescribeTable's message is fine on its
    // own) but is caught by the github-token test instead -- the two together pin the contract
    // down completely.
    healthyAll();
    ddb.on(DescribeTableCommand).rejects(
      awsError("ResourceNotFoundException", "Requested resource not found: Table: t not found"),
    );
    const { failures, lines } = await run();
    expect(hasLine(lines, "FAIL table: ResourceNotFoundException: Requested resource not found")).toBe(true);
    expect(failures).toBe(1);
  });
});

describe("lastRun check", () => {
  it("flags META#lastRun absent as capture never having completed", async () => {
    // Mutation: `if (!r) return fail(...)` -> `if (r) return fail(...)` flips this so a
    // present record is flagged and an absent one is not.
    healthyAll();
    doc.on(GetCommand).resolves({});
    const { failures, lines } = await run();
    expect(hasLine(lines, "FAIL META#lastRun absent -- capture has never completed")).toBe(true);
    expect(failures).toBe(1);
  });

  it("does not flag a run from a few minutes ago", async () => {
    healthyAll();
    healthyLastRun({ startedAt: minutesAgo(5) });
    const { failures, lines } = await run();
    expect(hasLine(lines, "hourly schedule may have stopped")).toBe(false);
    expect(failures).toBe(0);
    expect(hasLine(lines, "last run 5m ago, 10 written, 0 failed")).toBe(true);
  });

  it("flags a run older than 130 minutes as a possibly stopped schedule", async () => {
    // Mutation: `ageMin > 130` -> `ageMin > 100000` makes this never fire.
    healthyAll();
    healthyLastRun({ startedAt: minutesAgo(200) });
    const { failures, lines } = await run();
    expect(hasLine(lines, "FAIL last run 200m ago -- hourly schedule may have stopped")).toBe(true);
    expect(failures).toBe(1);
  });

  it("flags a quarantined source even when nothing else is wrong with it", async () => {
    // Mutation: `quarantined > 0` -> `quarantined > 100` lets small quarantine counts through
    // silently -- exactly the "silently dropped article" the brief calls out.
    healthyAll();
    healthyLastRun({ perSourceCounts: { hn: 0 }, quarantined: { hn: 3 } });
    const { failures, lines } = await run();
    expect(hasLine(lines, "FAIL hn: 3 quarantined -- feed shape changed")).toBe(true);
    expect(failures).toBe(1);
  });

  it("flags a source that produced, filtered, and errored nothing as dead", async () => {
    // Mutation: dropping the `!errored` guard (i.e. `produced === 0 && filtered === 0`) would
    // also mark an errored-but-otherwise-quiet source dead, conflating two different causes of
    // "zero" that the brief insists stay distinguishable.
    healthyAll();
    healthyLastRun({ perSourceCounts: { hn: 0 } });
    const { failures, lines } = await run();
    expect(hasLine(lines, "FAIL hn: dead (nothing at all)")).toBe(true);
    expect(failures).toBe(1);
  });

  it("does not call a source dead when it produced nothing but errored", async () => {
    // Mutation: deleting the `produced === 0 && errored` branch collapses this into the
    // "quiet" branch, which reads as healthy rather than "fetch failed" -- a materially
    // different signal to act on.
    healthyAll();
    healthyLastRun({
      perSourceCounts: { hn: 0 },
      errors: [{ source: "hn", message: "HTTP 503" }],
    });
    const { failures, lines } = await run();
    expect(hasLine(lines, "ok   hn: fetch error, not dead")).toBe(true);
    expect(hasLine(lines, "dead (nothing at all)")).toBe(false);
    expect(failures).toBe(0);
  });

  it("calls a source quiet, not dead, when its entire feed was filtered", async () => {
    // Mutation: removing `filtered === 0` from the dead-check condition would mark this source
    // dead even though it produced nothing only because everything was out of window/over cap.
    healthyAll();
    healthyLastRun({ perSourceCounts: { hn: 0 }, filtered: { hn: 7 } });
    const { failures, lines } = await run();
    expect(hasLine(lines, "ok   hn: quiet (7 filtered)")).toBe(true);
    expect(failures).toBe(0);
  });

  it("reports a producing source's count instead of staying silent about it", async () => {
    // This branch is an addition over the brief's draft, which left a healthy, producing
    // source with no output line at all. Mutation: deleting the trailing `else ok(...)`
    // reproduces that gap -- caught here since the line would then be entirely absent.
    healthyAll();
    healthyLastRun({ perSourceCounts: { hn: 12 } });
    const { failures, lines } = await run();
    expect(hasLine(lines, "ok   hn: 12 produced")).toBe(true);
    expect(failures).toBe(0);
  });
});

describe("days check", () => {
  it("prints each recent day's status and article count", async () => {
    // Mutation: dropping `d.status` from the template string still passes a substring check on
    // just the day, so this asserts the exact composed line.
    healthyAll();
    healthyDays();
    const { lines } = await run();
    expect(hasLine(lines, "ok   2026-08-18 complete 42 articles")).toBe(true);
  });
});

describe("github token check", () => {
  it("confirms presence without requesting decryption", async () => {
    // Mutation: adding `WithDecryption: true` to the GetParameterCommand call would still pass
    // a message-only assertion while materialising the PAT in the process -- this test reads
    // the actual request instead of trusting the printed message.
    healthyAll();
    healthyToken();
    const { failures, lines } = await run();
    expect(hasLine(lines, "/ai-news/github-token present (value not read)")).toBe(true);
    const call = ssm.commandCalls(GetParameterCommand)[0]!.args[0].input;
    expect(call.WithDecryption).not.toBe(true);
    expect(failures).toBe(0);
  });

  it("reports a missing parameter by its real AWS error name, not a generic message", async () => {
    // Verified live against the undeployed account: SSM's GetParameter on a missing name has
    // e.message literally read "UnknownError" while e.name correctly read "ParameterNotFound".
    // Mutation: `${e.name}: ${e.message}` -> `${e.message}` reproduces that uninformative
    // output.
    healthyAll();
    ssm.on(GetParameterCommand).rejects(awsError("ParameterNotFound", "UnknownError"));
    const { failures, lines } = await run();
    expect(hasLine(lines, "FAIL github token: ParameterNotFound: UnknownError")).toBe(true);
    expect(failures).toBe(1);
  });
});

describe("alerts reach someone check", () => {
  it("fails when no alerts topic exists at all", async () => {
    // Mutation: `mine.length === 0` -> `mine.length === 1` skips the fail entirely for the
    // zero-topic case.
    healthyAll();
    sns.on(ListTopicsCommand).resolves({ Topics: [] });
    const { failures, lines } = await run();
    expect(hasLine(lines, "FAIL no alerts topic found")).toBe(true);
    expect(failures).toBe(1);
  });

  it("fails when the topic exists but has no subscribers", async () => {
    // Mutation: deleting the trailing `if (subs.length === 0) fail(...)` line drops this case
    // to silence -- no ok, no fail, nothing printed for the check at all.
    healthyAll();
    sns.on(ListSubscriptionsByTopicCommand).resolves({ Subscriptions: [] });
    const { failures, lines } = await run();
    expect(hasLine(lines, "FAIL alerts topic has no subscribers at all")).toBe(true);
    expect(failures).toBe(1);
  });

  it("flags an unconfirmed subscription using AWS's PendingConfirmation sentinel", async () => {
    // The single most important check in this script per the brief: an unconfirmed
    // subscription leaves every alarm and both budgets silent while everything looks deployed.
    // Mutation: `sub.SubscriptionArn === "PendingConfirmation"` -> `!==` swaps this and the
    // confirmed case's outcomes entirely.
    healthyAll();
    sns.on(ListSubscriptionsByTopicCommand).resolves({
      Subscriptions: [
        { Protocol: "email", Endpoint: "owner@example.com", SubscriptionArn: "PendingConfirmation" },
      ],
    });
    const { failures, lines } = await run();
    expect(
      hasLine(lines, "FAIL owner@example.com has not confirmed -- every alarm is silent until it does"),
    ).toBe(true);
    expect(failures).toBe(1);
  });

  it("reports a confirmed subscription as ok with its protocol and endpoint", async () => {
    healthyAll();
    const { failures, lines } = await run();
    expect(hasLine(lines, "ok   email owner@example.com confirmed")).toBe(true);
    expect(failures).toBe(0);
  });
});

describe("schedules check", () => {
  it("fails when fewer than two schedules are found", async () => {
    // Mutation: `mine.length >= 2` -> `mine.length >= 1` accepts a single schedule as enough.
    healthyAll();
    scheduler.on(ListSchedulesCommand).resolves({
      Schedules: [{ Name: "AiNewsStack-CaptureSchedule", State: "ENABLED" }],
    });
    const { failures, lines } = await run();
    expect(hasLine(lines, "FAIL only 1 schedules")).toBe(true);
    expect(failures).toBe(1);
  });

  it("flags a disabled schedule individually, without hiding the healthy one", async () => {
    // Mutation: `s.State === "ENABLED"` -> `!==` reports the enabled schedule as broken and the
    // disabled one as fine.
    healthyAll();
    scheduler.on(ListSchedulesCommand).resolves({
      Schedules: [
        { Name: "AiNewsStack-CaptureSchedule", State: "ENABLED" },
        { Name: "AiNewsStack-RankSchedule", State: "DISABLED" },
      ],
    });
    const { failures, lines } = await run();
    expect(hasLine(lines, "ok   AiNewsStack-CaptureSchedule ENABLED")).toBe(true);
    expect(hasLine(lines, "FAIL AiNewsStack-RankSchedule is DISABLED")).toBe(true);
    expect(failures).toBe(1);
  });

  it("ignores schedules unrelated to this stack when counting", async () => {
    // Mutation: dropping the `.filter((s) => (s.Name ?? "").includes("Schedule"))` call counts
    // every schedule in the account, including ones this stack didn't create, and would also
    // wrongly fail this test on the unrelated entry's state.
    healthyAll();
    scheduler.on(ListSchedulesCommand).resolves({
      Schedules: [
        { Name: "SomeoneElsesThing", State: "DISABLED" },
        { Name: "AiNewsStack-CaptureSchedule", State: "ENABLED" },
        { Name: "AiNewsStack-RankSchedule", State: "ENABLED" },
      ],
    });
    const { failures, lines } = await run();
    expect(hasLine(lines, "ok   2 schedules")).toBe(true);
    expect(hasLine(lines, "SomeoneElsesThing")).toBe(false);
    expect(failures).toBe(0);
  });
});

describe("--with-bedrock gating (the only step that spends money)", () => {
  it("makes no Bedrock call at all by default", async () => {
    // Mutation: removing the `if (withBedrock)` guard runs the Converse call unconditionally,
    // which is exactly the cost leak this flag exists to prevent.
    healthyAll();
    const { failures, lines } = await run([]);
    expect(bedrock.calls()).toHaveLength(0);
    expect(hasLine(lines, "skip bedrock (pass --with-bedrock to verify the ranking path)")).toBe(true);
    expect(failures).toBe(0);
  });

  it("with --with-bedrock, sends the smallest possible probe and reports token usage", async () => {
    // Mutation: `maxTokens: 16` -> `maxTokens: 1024` still passes a message-content-only
    // assertion but multiplies the (tiny) real cost of every smoke run; asserting on the
    // request body pins the cost down, not just the wording of the report.
    healthyAll();
    bedrock.on(ConverseCommand).resolves({ usage: { inputTokens: 15, outputTokens: 8, totalTokens: 23 } });
    const { failures, lines } = await run(["--with-bedrock"]);
    expect(hasLine(lines, "global.anthropic.claude-sonnet-4-6 responded in")).toBe(true);
    expect(hasLine(lines, "23 tokens (~$0.0001)")).toBe(true);
    const call = bedrock.commandCalls(ConverseCommand)[0]!.args[0].input;
    expect(call.modelId).toBe("global.anthropic.claude-sonnet-4-6");
    expect(call.inferenceConfig?.maxTokens).toBe(16);
    expect(failures).toBe(0);
  });

  it("reports a Bedrock failure instead of throwing out of runSmoke", async () => {
    healthyAll();
    bedrock.on(ConverseCommand).rejects(awsError("AccessDeniedException", "not authorized"));
    const { failures, lines } = await run(["--with-bedrock"]);
    expect(hasLine(lines, "FAIL bedrock: AccessDeniedException: not authorized")).toBe(true);
    expect(failures).toBe(1);
  });
});

describe("overall accounting", () => {
  it("sums failures across independent checks and reports the total", async () => {
    // Mutation: `failures += 1` -> no-op in the fail() helper keeps the counter at 0 no matter
    // how many FAIL lines are printed -- caught by the returned count, not just the log text.
    healthyAll();
    ddb.on(DescribeTableCommand).resolves({
      Table: {
        TableStatus: "CREATING",
        BillingModeSummary: { BillingMode: "PAY_PER_REQUEST" },
        GlobalSecondaryIndexes: [{ IndexName: "feed-by-day", IndexStatus: "ACTIVE" }],
      },
    });
    ssm.on(GetParameterCommand).rejects(awsError("ParameterNotFound", "UnknownError"));
    const { failures, lines } = await run();
    expect(failures).toBe(2);
    expect(hasLine(lines, "2 check(s) failed")).toBe(true);
  });
});
