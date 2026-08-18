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

describe("Monitoring", () => {
  it("alarms only on our functions, never account-wide", () => {
    // The account already contains an unrelated HelloWorld function. An account-wide Lambda
    // Errors alarm would fire on someone else's experiment and teach us to ignore it.
    for (const alarm of Object.values(template().findResources("AWS::CloudWatch::Alarm"))) {
      const dims = (alarm as any).Properties.Dimensions ??
        (alarm as any).Properties.Metrics?.[0]?.MetricStat?.Metric?.Dimensions;
      expect(dims, JSON.stringify((alarm as any).Properties.AlarmName)).toBeDefined();
    }
  });

  it("treats missing invocations as breaching, which is what catches a stopped schedule", () => {
    // The default (treatMissingData: notBreaching) makes this alarm silent in exactly the
    // failure it exists to detect: the schedule stops, so no datapoint is ever published.
    template().hasResourceProperties("AWS::CloudWatch::Alarm", {
      TreatMissingData: "breaching",
      Threshold: 1,
      ComparisonOperator: "LessThanThreshold",
    });
  });

  it("sets budget thresholds above expected spend, not at zero", () => {
    const budgets = Object.values(template().findResources("AWS::Budgets::Budget"));
    const limits = budgets.map((b: any) => Number(b.Properties.Budget.BudgetLimit.Amount)).sort((a, b) => a - b);
    // Above the honest worst case (~$16.30/month at one call a day against the 32k cap), not
    // inside it. A threshold that fires in a legitimate month trains you to ignore it.
    expect(limits).toEqual([25, 40]);
  });

  it("creates exactly one SNS topic and subscribes the alert email", () => {
    const topics = template().findResources("AWS::SNS::Topic");
    expect(Object.keys(topics)).toHaveLength(1);
    template().hasResourceProperties("AWS::SNS::Subscription", {
      Protocol: "email",
      Endpoint: "alerts@example.com",
    });
  });

  it("gives each function its own Errors alarm at threshold 1", () => {
    const alarms = Object.values(template().findResources("AWS::CloudWatch::Alarm"));
    const errorAlarms = alarms.filter((a: any) => a.Properties.MetricName === "Errors");
    expect(errorAlarms).toHaveLength(2);
    for (const alarm of errorAlarms) {
      expect((alarm as any).Properties.Threshold).toBe(1);
      expect((alarm as any).Properties.ComparisonOperator).toBe("GreaterThanOrEqualToThreshold");
    }
  });

  it("derives budget names from the stack name, not a hardcoded literal", () => {
    // Budget names are unique per ACCOUNT, not per stack. A hardcoded name would make a second
    // deploy of this template into the same account fail.
    const budgets = Object.values(template().findResources("AWS::Budgets::Budget"));
    for (const budget of budgets) {
      const name = (budget as any).Properties.Budget.BudgetName;
      expect(JSON.stringify(name)).toContain("Test");
    }
  });

  it("does not scope budgets to a cost-allocation tag filter", () => {
    // Deliberately not tag-scoped: the tag must be activated by hand and takes up to 24h, and
    // until then a tag filter matches nothing and the budget is silently dead.
    const budgets = Object.values(template().findResources("AWS::Budgets::Budget"));
    for (const budget of budgets) {
      expect((budget as any).Properties.Budget.CostFilters).toBeUndefined();
    }
  });
});
