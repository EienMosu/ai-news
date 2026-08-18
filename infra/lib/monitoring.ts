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
    new cloudwatch.Alarm(this, "CaptureStopped", {
      metric: props.capture.metricInvocations({ period: Duration.hours(25) }),
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
