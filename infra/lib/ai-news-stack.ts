import { Stack, type StackProps } from "aws-cdk-lib";
import type { Construct } from "constructs";
import { ArticleTable } from "./table.js";

export class AiNewsStack extends Stack {
  readonly articleTable: ArticleTable;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);
    this.articleTable = new ArticleTable(this, "Articles");
  }
}
