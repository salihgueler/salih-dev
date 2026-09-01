import { Duration, RemovalPolicy, Stack } from "aws-cdk-lib";
import * as athena from "aws-cdk-lib/aws-athena";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";
import { NagSuppressions } from "cdk-nag";
import type { Construct } from "constructs";

import type { AnalyticsCatalog } from "./analytics-catalog";
import {
  ANALYTICS_DATABASE_NAME,
  ANALYTICS_TABLE_NAME,
  ANALYTICS_WORKGROUP_NAME,
} from "./analytics-constants";
import { buildAnalyticsWidgetCode } from "./analytics-widget-code";

export function createAnalyticsWidget(
  scope: Construct,
  bucket: s3.IBucket,
  catalog: AnalyticsCatalog,
  workGroup: athena.CfnWorkGroup,
): lambda.Function {
  const stack = Stack.of(scope);
  const logGroup = new logs.LogGroup(scope, "AnalyticsWidgetLogs", {
    removalPolicy: RemovalPolicy.DESTROY,
    retention: logs.RetentionDays.ONE_WEEK,
  });
  const widget = new lambda.Function(scope, "AnalyticsWidget", {
    architecture: lambda.Architecture.ARM_64,
    code: lambda.Code.fromInline(buildAnalyticsWidgetCode()),
    description:
      "Renders privacy-filtered Athena results in the salih.dev operations dashboard.",
    environment: {
      DATABASE_NAME: ANALYTICS_DATABASE_NAME,
      WORKGROUP_NAME: ANALYTICS_WORKGROUP_NAME,
    },
    handler: "index.handler",
    logGroup,
    memorySize: 128,
    runtime: lambda.Runtime.NODEJS_24_X,
    timeout: Duration.seconds(15),
  });

  widget.addToRolePolicy(
    new iam.PolicyStatement({
      actions: [
        "athena:GetQueryExecution",
        "athena:GetQueryResults",
        "athena:StartQueryExecution",
      ],
      resources: [
        stack.formatArn({
          resource: "workgroup",
          resourceName: ANALYTICS_WORKGROUP_NAME,
          service: "athena",
        }),
      ],
    }),
  );
  widget.addToRolePolicy(
    new iam.PolicyStatement({
      actions: ["glue:GetDatabase", "glue:GetPartitions", "glue:GetTable"],
      resources: [
        stack.formatArn({ resource: "catalog", service: "glue" }),
        stack.formatArn({
          resource: "database",
          resourceName: ANALYTICS_DATABASE_NAME,
          service: "glue",
        }),
        stack.formatArn({
          resource: "table",
          resourceName: `${ANALYTICS_DATABASE_NAME}/${ANALYTICS_TABLE_NAME}`,
          service: "glue",
        }),
      ],
    }),
  );
  bucket.grantRead(widget, "AWSLogs/*");
  bucket.grantRead(widget, "athena-results/*");
  widget.addToRolePolicy(
    new iam.PolicyStatement({
      actions: ["s3:AbortMultipartUpload", "s3:PutObject"],
      resources: [bucket.arnForObjects("athena-results/*")],
    }),
  );
  widget.node.addDependency(catalog.database, catalog.table, workGroup);

  NagSuppressions.addResourceSuppressions(
    widget,
    [
      {
        id: "AwsSolutions-IAM4",
        reason:
          "AWSLambdaBasicExecutionRole is used only for the widget's short CloudWatch execution logs.",
      },
      {
        id: "AwsSolutions-IAM5",
        reason:
          "S3 log and Athena result object keys are generated dynamically but remain scoped to dedicated bucket prefixes.",
      },
    ],
    true,
  );
  return widget;
}
