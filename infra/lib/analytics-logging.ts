import { Duration, RemovalPolicy, Stack } from "aws-cdk-lib";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";
import { NagSuppressions } from "cdk-nag";
import type { Construct } from "constructs";

import {
  ANALYTICS_RECORD_FIELDS,
  DELIVERY_DESTINATION_NAME,
  DELIVERY_SOURCE_NAME,
} from "./analytics-constants";

export function createAnalyticsLogging(
  scope: Construct,
  distribution: cloudfront.IDistribution,
): s3.Bucket {
  const stack = Stack.of(scope);
  const bucket = new s3.Bucket(scope, "AnalyticsBucket", {
    blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    encryption: s3.BucketEncryption.S3_MANAGED,
    enforceSSL: true,
    lifecycleRules: [
      {
        abortIncompleteMultipartUploadAfter: Duration.days(7),
        expiration: Duration.days(90),
      },
    ],
    objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
    removalPolicy: RemovalPolicy.RETAIN,
  });
  const sourceArn = stack.formatArn({
    account: stack.account,
    region: "us-east-1",
    resource: `delivery-source:${DELIVERY_SOURCE_NAME}`,
    service: "logs",
  });
  const logObjectPath = `AWSLogs/aws-account-id=${stack.account}/CloudFront/*`;

  bucket.addToResourcePolicy(
    new iam.PolicyStatement({
      actions: ["s3:GetBucketAcl"],
      conditions: {
        ArnLike: { "aws:SourceArn": sourceArn },
        StringEquals: { "aws:SourceAccount": stack.account },
      },
      principals: [new iam.ServicePrincipal("delivery.logs.amazonaws.com")],
      resources: [bucket.bucketArn],
      sid: "AWSLogsDeliveryAclCheck",
    }),
  );
  bucket.addToResourcePolicy(
    new iam.PolicyStatement({
      actions: ["s3:PutObject"],
      conditions: {
        ArnLike: { "aws:SourceArn": sourceArn },
        StringEquals: {
          "aws:SourceAccount": stack.account,
          "s3:x-amz-acl": "bucket-owner-full-control",
        },
      },
      principals: [new iam.ServicePrincipal("delivery.logs.amazonaws.com")],
      resources: [bucket.arnForObjects(logObjectPath)],
      sid: "AWSLogsDeliveryWrite",
    }),
  );

  const source = new logs.CfnDeliverySource(scope, "AnalyticsDeliverySource", {
    logType: "ACCESS_LOGS",
    name: DELIVERY_SOURCE_NAME,
    resourceArn: distribution.distributionArn,
  });
  const destination = new logs.CfnDeliveryDestination(
    scope,
    "AnalyticsDeliveryDestination",
    {
      deliveryDestinationType: "S3",
      destinationResourceArn: bucket.bucketArn,
      name: DELIVERY_DESTINATION_NAME,
      outputFormat: "json",
    },
  );
  const delivery = new logs.CfnDelivery(scope, "AnalyticsDelivery", {
    deliveryDestinationArn: destination.attrArn,
    deliverySourceName: DELIVERY_SOURCE_NAME,
    recordFields: ANALYTICS_RECORD_FIELDS,
    s3EnableHiveCompatiblePath: true,
    s3SuffixPath: "year={yyyy}/month={MM}/day={dd}/hour={HH}",
  });
  delivery.addResourceDependency(source);
  delivery.addResourceDependency(destination);
  if (bucket.policy) delivery.node.addDependency(bucket.policy);

  NagSuppressions.addResourceSuppressions(bucket, [
    {
      id: "AwsSolutions-S1",
      reason:
        "This is the short-retention destination for privacy-filtered CloudFront logs; access logging would recurse and retain more request data.",
    },
  ]);
  return bucket;
}
