import { Stack, type StackProps } from "aws-cdk-lib";
import type { Construct } from "constructs";
import { ArticleTable } from "./table.js";
import { Functions } from "./functions.js";

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

    // Monitoring is added by Task 9, which owns `monitoring.ts`. Do not import it here yet —
    // this task must compile and synth on its own.
  }
}
