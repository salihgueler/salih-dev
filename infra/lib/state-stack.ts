import {
  CfnOutput,
  Duration,
  Fn,
  RemovalPolicy,
  Stack,
  type StackProps,
} from "aws-cdk-lib";
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
      ],
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      removalPolicy: RemovalPolicy.RETAIN,
      versioned: true,
    });

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
