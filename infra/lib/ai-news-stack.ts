import { CfnOutput, Stack, type StackProps } from "aws-cdk-lib";
import type { Construct } from "constructs";
import { ArticleTable } from "./table.js";
import { Functions } from "./functions.js";
import { Monitoring } from "./monitoring.js";

export interface AiNewsStackProps extends StackProps {
  alertEmail: string;
  backupRepo: string;
  githubTokenParam: string;
}

export class AiNewsStack extends Stack {
  readonly articleTable: ArticleTable;
  readonly functions: Functions;

  constructor(scope: Construct, id: string, props: AiNewsStackProps) {
    super(scope, id, props);

    this.articleTable = new ArticleTable(this, "Articles");

    this.functions = new Functions(this, "Functions", {
      table: this.articleTable.table,
      backupRepo: props.backupRepo,
      githubTokenParam: props.githubTokenParam,
    });

    new Monitoring(this, "Monitoring", {
      capture: this.functions.capture,
      rank: this.functions.rank,
      alertEmail: props.alertEmail,
    });

    // Printed by `cdk deploy` and re-readable any time after with
    // `aws cloudformation describe-stacks --stack-name AiNewsStack --query "Stacks[0].Outputs"`.
    // Without these the runbook has no way to hand the operator the real, CDK-generated
    // physical names it needs for `pnpm smoke` and the manual Lambda invokes right after --
    // and the table in particular has no other reliable lookup: it synthesizes as
    // AWS::DynamoDB::GlobalTable, not AWS::DynamoDB::Table, so a resource-type filter written
    // for "the DynamoDB table" silently matches nothing.
    new CfnOutput(this, "TableName", {
      value: this.articleTable.table.tableName,
      description: "export TABLE_NAME=<this> before running pnpm smoke or reading the table.",
    });
    new CfnOutput(this, "CaptureFunctionName", {
      value: this.functions.capture.functionName,
      description: "--function-name for a manual capture invoke (runbook step 7).",
    });
    new CfnOutput(this, "RankFunctionName", {
      value: this.functions.rank.functionName,
      description: "--function-name for a manual rank invoke (runbook step 8).",
    });
    // Same reasoning as the table output above, for the same silent reason: no `userName` is
    // set on this construct, so CloudFormation auto-generates the IAM user's physical name --
    // it is NOT literally "VercelReader" in the console's user list, and there is no filter
    // that recovers it short of this output or a full IAM::User resource scan.
    new CfnOutput(this, "VercelReaderUserName", {
      value: this.functions.vercel.userName,
      description: "IAM user to open in the console for step 10's access-key mint.",
    });
  }
}
