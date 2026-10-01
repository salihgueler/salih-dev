import {
  CfnOutput,
  Duration,
  Fn,
  RemovalPolicy,
  Stack,
  type StackProps,
} from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as s3 from "aws-cdk-lib/aws-s3";
import { NagSuppressions } from "cdk-nag";
import type { Construct } from "constructs";

export interface SalihDevStateStackProps extends StackProps {
  readonly domainName: string;
}

export class SalihDevStateStack extends Stack {
  public readonly contentBucket: s3.Bucket;
  public readonly hostedZone: route53.PublicHostedZone;
  public readonly readerCountsTable: dynamodb.TableV2;

  public constructor(
    scope: Construct,
    id: string,
    props: SalihDevStateStackProps,
  ) {
    super(scope, id, props);

    this.contentBucket = new s3.Bucket(this, "ContentBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      lifecycleRules: [
        {
          noncurrentVersionExpiration: Duration.days(90),
        },
        {
          expiration: Duration.days(1),
          prefix: "talks/pending/",
        },
      ],
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      removalPolicy: RemovalPolicy.RETAIN,
      versioned: true,
    });

    // Reader counts ("reading now" and "read so far") for blog posts. One
    // partition per post; `now#` rows expire after 75 s and `read#` rows after
    // a year, through TTL on `expiresAt`. TTL deletes within days, so the code
    // filters on `expiresAt` itself. See .kiro/specs/reader-counts/design.md.
    this.readerCountsTable = new dynamodb.TableV2(this, "ReaderCounts", {
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      billing: dynamodb.Billing.onDemand(),
      timeToLiveAttribute: "expiresAt",
      removalPolicy: RemovalPolicy.RETAIN,
    });
    NagSuppressions.addResourceSuppressions(this.readerCountsTable, [
      {
        id: "AwsSolutions-DDB3",
        reason:
          "Reader counts are a public, approximate signal that rebuilds itself from new visits; point-in-time recovery would cost more than the data is worth.",
      },
    ]);

    this.hostedZone = new route53.PublicHostedZone(this, "HostedZone", {
      zoneName: props.domainName,
    });
    this.hostedZone.applyRemovalPolicy(RemovalPolicy.RETAIN);

    NagSuppressions.addResourceSuppressions(this.contentBucket, [
      {
        id: "AwsSolutions-S1",
        reason:
          "The private content bucket is accessed only by the publisher role. CodeBuild logs all synchronization activity, so S3 request logging would duplicate operational data.",
      },
    ]);

    new CfnOutput(this, "HostedZoneId", {
      value: this.hostedZone.hostedZoneId,
    });
    new CfnOutput(this, "HostedZoneNameServers", {
      description:
        "Set these nameservers at Squarespace only after copying every existing DNS record.",
      value: this.hostedZone.hostedZoneNameServers
        ? Fn.join(",", this.hostedZone.hostedZoneNameServers)
        : "Available after deployment",
    });
    new CfnOutput(this, "ContentBucketName", {
      value: this.contentBucket.bucketName,
    });
  }
}
