import { Duration, Stack } from "aws-cdk-lib";
import * as budgets from "aws-cdk-lib/aws-budgets";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as actions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subs from "aws-cdk-lib/aws-sns-subscriptions";
import type { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Construct } from "constructs";

export interface MonitoringProps {
  capture: NodejsFunction;
  rank: NodejsFunction;
  alertEmail: string;
}

export class Monitoring extends Construct {
  constructor(scope: Construct, id: string, props: MonitoringProps) {
    super(scope, id);

    const topic = new sns.Topic(this, "Alerts", { displayName: "ai-news alerts" });
    // An email subscription sits in PendingConfirmation until the confirmation link in the
    // subscribe email is clicked — the topic and every alarm/budget pointed at it deploy
    // looking healthy regardless. Until that click happens, all three alarms and both budgets
    // below are silently useless: they fire, SNS has nowhere to deliver, and no one is told.
    // Checkable post-deploy with `aws sns list-subscriptions-by-topic --topic-arn <arn>`: a
    // confirmed subscription shows a real SubscriptionArn; an unconfirmed one shows the literal
    // string "PendingConfirmation" instead of an ARN.
    topic.addSubscription(new subs.EmailSubscription(props.alertEmail));
    const notify = new actions.SnsAction(topic);

    for (const fn of [props.capture, props.rank]) {
      // Per-function metric, not the account-wide Lambda namespace.
      new cloudwatch.Alarm(this, `${fn.node.id}Errors`, {
        metric: fn.metricErrors({ period: Duration.hours(1) }),
        threshold: 1,
        evaluationPeriods: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      }).addAlarmAction(notify);
    }

    // The alarm that matters most. If EventBridge stops firing, no error is ever raised and
    // no datapoint is ever published — the system goes quiet and looks healthy. Only
    // treatMissingData: BREACHING turns that silence into a page.
    //
    // Two consequences of that same property, both intentional, not bugs:
    // - Day-one false alarm: on a fresh deploy, before capture has ever run, there are zero
    //   datapoints in the window and BREACHING fires once. Invoking capture manually right
    //   after deploy publishes the first Invocations datapoint and clears it. Any other
    //   treatMissingData setting would trade this one-time, expected alarm for permanent
    //   silence during a real stoppage — not a trade worth making.
    // - Detection latency: the metric period is 25 hours (below), so after a *real* stoppage
    //   this fires roughly 25-50 hours later, not within the hour. That delay is deliberate: a
    //   25-hour trailing window (vs. the 1-hour capture schedule) is what stops a single missed
    //   run from paging the owner, which is the same cry-wolf failure this alarm exists to
    //   avoid. Tolerating one missed run costs a day of extra detection latency on a real one.
    new cloudwatch.Alarm(this, "CaptureStopped", {
      metric: props.capture.metricInvocations({ period: Duration.hours(25) }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.BREACHING,
    }).addAlarmAction(notify);

    // Mirrors CaptureStopped above, for the same reason: a total ranking outage today costs
    // nothing and pages no one, and the feed would simply stay degraded forever, looking like
    // a quiet news period rather than a broken one.
    //
    // The period is NOT copied verbatim from CaptureStopped, and that is deliberate rather
    // than an oversight: rank fires once a DAY (cron), not once an HOUR (rate). Reusing 25
    // hours here would alarm after a single missed day, since a normal rolling 25-hour window
    // around a daily schedule contains at most one invocation to begin with. 49 hours (two
    // daily cycles plus a 1-hour buffer) is the daily-schedule analogue of CaptureStopped's
    // 25-hour margin: it tolerates one missed run without paging, and still catches a genuine
    // multi-day outage once two consecutive scheduled runs are both missing.
    new cloudwatch.Alarm(this, "RankStopped", {
      metric: props.rank.metricInvocations({ period: Duration.hours(49) }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.BREACHING,
    }).addAlarmAction(notify);

    // Thresholds sit above expected spend (~$10/month, essentially all Bedrock). A $5 budget
    // would fire during normal operation. Spec §8.
    // Budget names are unique per ACCOUNT, not per stack, so a hardcoded name makes a second
    // deploy of this template into the same account fail. Derived from the stack name instead.
    const stackName = Stack.of(this).stackName;
    // $25 / $40, NOT $15 / $30. The per-call hard cap is 32k max_tokens billed as output
    // ($0.48) plus ~21k input ($0.06), so a month of one call a day tops out near $16.30
    // against an expected $6.20. A $15 warning therefore sits INSIDE the plausible range and
    // would fire in a legitimate busy month -- the same cry-wolf failure that makes the
    // account's pre-existing $1 and $10 budgets useless. $25 says "top of the range you asked
    // for"; $40 says "something is wrong".
    for (const [suffix, amount] of [["warning", 25], ["investigate", 40]] as const) {
      new budgets.CfnBudget(this, `Budget${suffix}`, {
        budget: {
          budgetName: `${stackName}-${suffix}`,
          // Deliberately NOT tag-scoped. A cost-allocation tag filter is more precise, but the
          // tag must first be activated by hand in the Billing console and takes up to 24h to
          // take effect — until then the filter matches nothing and the budget is silently
          // dead. A budget that does not fire is worse than one that is slightly broad, which
          // is the same principle that set these thresholds at $25/$40 instead of $5.
          // This account holds one unrelated resource (a HelloWorld Lambda costing ~$0), so
          // account-wide and stack-scoped are equivalent here in practice. Revisit if the
          // account ever runs a second real workload.
          budgetType: "COST",
          timeUnit: "MONTHLY",
          budgetLimit: { amount, unit: "USD" },
        },
        notificationsWithSubscribers: [{
          notification: {
            notificationType: "ACTUAL",
            comparisonOperator: "GREATER_THAN",
            threshold: 100,
            thresholdType: "PERCENTAGE",
          },
          subscribers: [{ subscriptionType: "EMAIL", address: props.alertEmail }],
        }],
      });
    }
  }
}
