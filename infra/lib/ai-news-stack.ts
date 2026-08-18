import { Stack, type StackProps } from "aws-cdk-lib";
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
  }
}
