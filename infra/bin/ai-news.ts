import { App } from "aws-cdk-lib";
import { AiNewsStack } from "../lib/ai-news-stack.js";

const app = new App();

// Account and region come from the environment so the stack is portable: deploying to a
// different account is a different profile, not a code change. Spec §2, portability.
new AiNewsStack(app, "AiNewsStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? "eu-central-1",
  },
});
