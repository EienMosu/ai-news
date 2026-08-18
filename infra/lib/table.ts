import { RemovalPolicy } from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import { Construct } from "constructs";

/**
 * The feed-card attribute set, frozen at index creation.
 *
 * Spec §4 lists nine. Four more are here for reasons the spec did not anticipate:
 *   url, source   — the card links out and shows a source chip; without them every card
 *                   render costs a second read of the base table.
 *   score         — the ordering is already the sort key, but the UI shows relative weight.
 *   scoreVersion  — spec §2 requires a "new since last ranking" marker for articles a manual
 *                   refresh pulled in. That is exactly "scoreVersion is the degraded one",
 *                   and it is unimplementable from the index without this attribute.
 *
 * `points` and `pointsImputed` are here because spec §7 requires the detail page to show
 * "the signals behind the score — source weight, corroboration today, engagement where it
 * exists — shown plainly, so the ranking is inspectable rather than magic", and the spec
 * never says whether that page reads the base item or renders from the already-fetched day.
 * Under the second reading everything it shows must be projected. The question is genuinely
 * open and the projection is not: project both and the page works either way.
 *
 * `pointsImputed` travels with `points` and is not optional decoration. Spec §5 imputes a
 * neutral 0.5 for the ~9 sources that never carry engagement, so a projected `points` alone
 * would let the UI show a confident-looking number the system guessed. Showing an imputed
 * value as though it were measured is the same dishonesty spec §5 corrected when it renamed
 * `clusterSize` to `corroborationToday`.
 *
 * Deliberately NOT projected: publishedAtSource, llmImportance, firstSeenAt, hashVersion, v.
 *
 * Erring wide is deliberate. A projection cannot be altered after the index is created --
 * changing it means deleting and recreating the index, and recreating it on a table that
 * already holds the archive means a full backfill. Over-projecting costs fractions of a cent
 * a month at this volume. The costs are not symmetric, so this list is not minimal.
 */
export const FEED_CARD_ATTRIBUTES = [
  "title", "summary", "imageUrl", "url", "source", "sourceName", "category",
  "publishedAt", "clusterId", "corroborationToday", "whyItMatters", "score", "scoreVersion",
  "points", "pointsImputed",
];

export class ArticleTable extends Construct {
  readonly table: dynamodb.TableV2;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    this.table = new dynamodb.TableV2(this, "Table", {
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },

      // Spec §4. Never provisioned — see the [revised] block there for the arithmetic.
      billing: dynamodb.Billing.onDemand(),

      // This table is the archive. A stack delete must not take it.
      removalPolicy: RemovalPolicy.RETAIN,
      // `pointInTimeRecovery` is deprecated in current aws-cdk-lib (checked at 2.265.0).
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },

      globalSecondaryIndexes: [
        {
          indexName: "feed-by-day",
          partitionKey: { name: "gsi1pk", type: dynamodb.AttributeType.STRING },
          sortKey: { name: "gsi1sk", type: dynamodb.AttributeType.STRING },
          projectionType: dynamodb.ProjectionType.INCLUDE,
          nonKeyAttributes: FEED_CARD_ATTRIBUTES,
        },
      ],
    });
  }
}
