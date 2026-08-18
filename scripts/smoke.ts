// scripts/smoke.ts
//
// Read-only health check for the deployed ai-news stack. Every call here is a
// describe/list/get -- nothing it does creates, modifies or deletes anything, with one
// deliberate exception: the "bedrock" check, gated behind --with-bedrock, because it is the
// only step in this entire project that spends money (~$0.0001, one 16-token Converse call).
//
// Usage:
//   pnpm smoke                 -- free. Checks the table, last capture run, recent days, the
//                                  GitHub token parameter, the alerts topic and the schedules.
//   pnpm smoke --with-bedrock  -- adds one live Bedrock call, proving the ranking model is
//                                  actually invokable with the deployed IAM policy.
//
// Exit code is 0 when every check passed, 1 otherwise.

import { pathToFileURL } from "node:url";
import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { DescribeTableCommand, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { ListSchedulesCommand, SchedulerClient } from "@aws-sdk/client-scheduler";
import { ListSubscriptionsByTopicCommand, ListTopicsCommand, SNSClient } from "@aws-sdk/client-sns";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
// RANK_MODEL comes from model.ts, which has no imports of its own. Pulling it in from
// bedrock.ts instead would drag @anthropic-ai/bedrock-sdk into this script for no reason --
// this script talks to Bedrock (if at all) through @aws-sdk/client-bedrock-runtime, not that
// SDK.
import { RANK_MODEL } from "../src/lib/rank/model.js";
import { docClient } from "../src/lib/store/client.js";
import { listDays } from "../src/lib/store/query.js";

/**
 * Runs every check and returns the number that failed.
 *
 * Exported, rather than left as bare top-level script code, so tests can call it with mocked
 * AWS clients and inspect the result directly -- the process.exit below only ever runs when
 * this file is executed as the CLI entry point (see the isMain guard at the bottom), never
 * when it is imported.
 */
export async function runSmoke(argv: string[] = process.argv.slice(2)): Promise<number> {
  const TABLE = process.env.TABLE_NAME ?? "";
  const TOKEN_PARAM = process.env.GITHUB_TOKEN_PARAM ?? "/ai-news/github-token";
  const withBedrock = argv.includes("--with-bedrock");

  let failures = 0;
  const ok = (m: string) => console.log(`  ok   ${m}`);
  const fail = (m: string) => {
    failures += 1;
    console.log(`  FAIL ${m}`);
  };

  async function check(name: string, fn: () => Promise<void>) {
    try {
      await fn();
    } catch (e) {
      // e.name carries the actual AWS error code (ResourceNotFoundException,
      // ParameterNotFound, AccessDeniedException, ...) and e.message alone is not always
      // enough: verified live against this account that SSM's GetParameter on a missing
      // parameter reports message "UnknownError" while e.name correctly says
      // "ParameterNotFound" -- dropping the name here would have made that failure
      // uninformative rather than merely terse.
      const detail = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      fail(`${name}: ${detail}`);
    }
  }

  await check("table", async () => {
    const t = (
      await new DynamoDBClient({}).send(new DescribeTableCommand({ TableName: TABLE }))
    ).Table!;
    t.TableStatus === "ACTIVE" ? ok("table ACTIVE") : fail(`table ${t.TableStatus}`);
    t.BillingModeSummary?.BillingMode === "PAY_PER_REQUEST"
      ? ok("billing PAY_PER_REQUEST")
      : fail(`billing is ${t.BillingModeSummary?.BillingMode} -- provisioned costs ~$28/mo here`);
    const gsi = t.GlobalSecondaryIndexes?.find((g) => g.IndexName === "feed-by-day");
    gsi?.IndexStatus === "ACTIVE" ? ok("GSI feed-by-day ACTIVE") : fail("GSI missing or not ACTIVE");
  });

  await check("lastRun", async () => {
    const out = await docClient().send(
      new GetCommand({ TableName: TABLE, Key: { pk: "META#lastRun", sk: "A" } }),
    );
    const r = out.Item as Record<string, unknown> | undefined;
    if (!r) return fail("META#lastRun absent -- capture has never completed");
    const ageMin = Math.round((Date.now() - Date.parse(String(r.startedAt))) / 60_000);
    ok(`last run ${ageMin}m ago, ${r.itemsWritten} written, ${r.itemsFailed} failed`);
    if (ageMin > 130) fail(`last run ${ageMin}m ago -- hourly schedule may have stopped`);

    // Spec §8: produced 0 AND filtered 0 AND quarantined 0 AND no error is the ONLY signature
    // that means dead. Everything else -- quiet, rate-limited, drifting, or plainly healthy --
    // gets its own line, so a source that IS producing is visible too, not just a broken one.
    const perSource = (r.perSourceCounts ?? {}) as Record<string, number>;
    const filteredBySource = (r.filtered ?? {}) as Record<string, number>;
    const quarantinedBySource = (r.quarantined ?? {}) as Record<string, number>;
    const errors = (r.errors ?? []) as { source: string }[];
    for (const [id, produced] of Object.entries(perSource)) {
      const filtered = filteredBySource[id] ?? 0;
      const quarantined = quarantinedBySource[id] ?? 0;
      const errored = errors.some((e) => e.source === id);
      if (quarantined > 0) fail(`${id}: ${quarantined} quarantined -- feed shape changed`);
      else if (produced === 0 && filtered === 0 && !errored) fail(`${id}: dead (nothing at all)`);
      else if (produced === 0 && errored) ok(`${id}: fetch error, not dead`);
      else if (produced === 0) ok(`${id}: quiet (${filtered} filtered)`);
      else ok(`${id}: ${produced} produced`);
    }
  });

  await check("days", async () => {
    for (const d of await listDays(docClient(), TABLE, 5)) {
      ok(`${d.day} ${d.status} ${d.articleCount} articles`);
    }
  });

  await check("github token", async () => {
    // WithDecryption is omitted (defaults to false) deliberately: this proves the parameter
    // exists without ever materialising the PAT in this process or in a terminal scrollback.
    await new SSMClient({}).send(new GetParameterCommand({ Name: TOKEN_PARAM }));
    ok(`${TOKEN_PARAM} present (value not read)`);
  });

  await check("alerts reach someone", async () => {
    // The failure this catches is invisible from the console at a glance: an email
    // subscription sits in PendingConfirmation until the link is clicked, and until then all
    // three alarms and both budgets deliver nothing while the topic looks deployed and
    // healthy. AWS reports it by putting the literal string "PendingConfirmation" where the
    // ARN belongs.
    const sns = new SNSClient({});
    const topics = await sns.send(new ListTopicsCommand({}));
    const mine = (topics.Topics ?? []).filter((t) => (t.TopicArn ?? "").includes("AiNews"));
    if (mine.length === 0) return fail("no alerts topic found");
    for (const t of mine) {
      const subs = await sns.send(new ListSubscriptionsByTopicCommand({ TopicArn: t.TopicArn }));
      for (const sub of subs.Subscriptions ?? []) {
        sub.SubscriptionArn === "PendingConfirmation"
          ? fail(`${sub.Endpoint} has not confirmed -- every alarm is silent until it does`)
          : ok(`${sub.Protocol} ${sub.Endpoint} confirmed`);
      }
      if ((subs.Subscriptions ?? []).length === 0) fail("alerts topic has no subscribers at all");
    }
  });

  await check("schedules", async () => {
    const out = await new SchedulerClient({}).send(new ListSchedulesCommand({}));
    const mine = (out.Schedules ?? []).filter((s) => (s.Name ?? "").includes("Schedule"));
    mine.length >= 2 ? ok(`${mine.length} schedules`) : fail(`only ${mine.length} schedules`);
    for (const s of mine) {
      s.State === "ENABLED" ? ok(`${s.Name} ENABLED`) : fail(`${s.Name} is ${s.State}`);
    }
  });

  if (withBedrock) {
    await check("bedrock", async () => {
      const t0 = Date.now();
      const out = await new BedrockRuntimeClient({}).send(
        new ConverseCommand({
          modelId: RANK_MODEL,
          messages: [{ role: "user", content: [{ text: "Reply with exactly: OK" }] }],
          inferenceConfig: { maxTokens: 16 },
        }),
      );
      ok(
        `${RANK_MODEL} responded in ${Date.now() - t0}ms, ` +
          `${out.usage?.totalTokens} tokens (~$0.0001)`,
      );
    });
  } else {
    console.log("  skip bedrock (pass --with-bedrock to verify the ranking path)");
  }

  console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
  return failures;
}

// Runs only when this file is the process entry point (`pnpm smoke`), never on import -- the
// exit call below would otherwise tear down whatever imported it, tests included.
const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const failures = await runSmoke();
  process.exit(failures === 0 ? 0 : 1);
}
