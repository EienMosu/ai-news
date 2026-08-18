import { App } from "aws-cdk-lib";
import { AiNewsStack } from "../lib/ai-news-stack.js";

const app = new App();

/** Fails loudly rather than deploying a stack with no alert subscriber or no backup target. */
function required(key: string): string {
  const v = app.node.tryGetContext(key);
  if (typeof v !== "string" || v.length === 0) {
    throw new Error(`missing required context: -c ${key}=<value>`);
  }
  return v;
}

new AiNewsStack(app, "AiNewsStack", {
  // Account and region come from the environment so moving accounts is a profile change,
  // not a code change. Spec §2, portability.
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? "eu-central-1",
  },
  alertEmail: required("alertEmail"),
  backupRepo: app.node.tryGetContext("backupRepo") ?? "EienMosu/ai-news",
  githubTokenParam: app.node.tryGetContext("githubTokenParam") ?? "/ai-news/github-token",
});
