import * as path from "node:path";
import { CfnOutput, Duration, RemovalPolicy, Stack } from "aws-cdk-lib";
import { AccessLogFormat } from "aws-cdk-lib/aws-apigateway";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import { HttpIamAuthorizer } from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { NodejsFunction, OutputFormat } from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";

import { CONTENT_KEY } from "../functions/content-api-shared";
import { suppressBasicLambdaLoggingPolicy } from "./lambda-log-suppressions";

const PENDING_TALK_OBJECTS = "talks/pending/*";
const APPROVED_TALK_DECKS = "talks/decks/*";
const API_TALK_RECORDS = "talks/records/*";

export interface ContentApiProps {
  allowedCallerArns: string[];
  contentBucket: s3.IBucket;
  distribution: cloudfront.IDistribution;
}

export class ContentApi extends Construct {
  constructor(scope: Construct, id: string, props: ContentApiProps) {
    super(scope, id);

    const projectRoot = path.resolve(__dirname, "../..");
    const lockFile = path.resolve(__dirname, "../package-lock.json");
    const distributionArn = `arn:${Stack.of(this).partition}:cloudfront::${Stack.of(this).account}:distribution/${props.distribution.distributionId}`;
    const commonEnvironment = {
      CONTENT_ALLOWED_CALLER_ARNS: props.allowedCallerArns.join(","),
      CONTENT_BUCKET_NAME: props.contentBucket.bucketName,
    };
    // Write paths refresh the edge with a scoped CloudFront invalidation
    // instead of starting the publisher, so a content change is live in
    // seconds without a full rebuild.
    const invalidatingEnvironment = {
      ...commonEnvironment,
      DISTRIBUTION_ID: props.distribution.distributionId,
    };

    const readLogs = new logs.LogGroup(this, "ReadLogs", {
      removalPolicy: RemovalPolicy.DESTROY,
      retention: logs.RetentionDays.ONE_MONTH,
    });
    const readFunction = new NodejsFunction(this, "ReadFunction", {
      architecture: lambda.Architecture.ARM_64,
      bundling: { minify: true, target: "node24" },
      depsLockFilePath: lockFile,
      entry: path.resolve(__dirname, "../functions/content-read.ts"),
      environment: commonEnvironment,
      logGroup: readLogs,
      memorySize: 256,
      projectRoot,
      runtime: lambda.Runtime.NODEJS_24_X,
      timeout: Duration.seconds(10),
    });

    const writeLogs = new logs.LogGroup(this, "WriteLogs", {
      removalPolicy: RemovalPolicy.DESTROY,
      retention: logs.RetentionDays.ONE_MONTH,
    });
    const writeFunction = new NodejsFunction(this, "WriteFunction", {
      architecture: lambda.Architecture.ARM_64,
      bundling: { minify: true, target: "node24" },
      depsLockFilePath: lockFile,
      entry: path.resolve(__dirname, "../functions/content-write.ts"),
      environment: invalidatingEnvironment,
      logGroup: writeLogs,
      memorySize: 256,
      projectRoot,
      runtime: lambda.Runtime.NODEJS_24_X,
      timeout: Duration.seconds(10),
    });

    const talkUploadStartLogs = new logs.LogGroup(this, "TalkUploadStartLogs", {
      removalPolicy: RemovalPolicy.DESTROY,
      retention: logs.RetentionDays.ONE_MONTH,
    });
    const talkUploadStartFunction = new NodejsFunction(
      this,
      "TalkUploadStartFunction",
      {
        architecture: lambda.Architecture.ARM_64,
        bundling: { minify: true, target: "node24" },
        depsLockFilePath: lockFile,
        entry: path.resolve(__dirname, "../functions/talk-upload-start.ts"),
        environment: commonEnvironment,
        logGroup: talkUploadStartLogs,
        memorySize: 256,
        projectRoot,
        runtime: lambda.Runtime.NODEJS_24_X,
        timeout: Duration.seconds(10),
      },
    );

    const talkUploadCompleteLogs = new logs.LogGroup(
      this,
      "TalkUploadCompleteLogs",
      {
        removalPolicy: RemovalPolicy.DESTROY,
        retention: logs.RetentionDays.ONE_MONTH,
      },
    );
    const talkUploadCompleteFunction = new NodejsFunction(
      this,
      "TalkUploadCompleteFunction",
      {
        architecture: lambda.Architecture.ARM_64,
        bundling: {
          // pdfjs-dist is ESM-only; a CommonJS bundle turns its import into
          // require(), which the Lambda runtime rejects with ERR_REQUIRE_ESM.
          // ESM resolution also ignores NODE_PATH, so the pinned AWS SDK is
          // bundled instead of resolved from the runtime-provided copy.
          banner:
            "import { createRequire as __kcCreateRequire } from 'node:module'; const require = __kcCreateRequire(import.meta.url);",
          bundleAwsSDK: true,
          format: OutputFormat.ESM,
          mainFields: ["module", "main"],
          minify: true,
          nodeModules: ["pdfjs-dist"],
          target: "node24",
        },
        depsLockFilePath: lockFile,
        entry: path.resolve(__dirname, "../functions/talk-upload-complete.ts"),
        environment: invalidatingEnvironment,
        logGroup: talkUploadCompleteLogs,
        memorySize: 1769,
        projectRoot,
        runtime: lambda.Runtime.NODEJS_24_X,
        timeout: Duration.seconds(29),
      },
    );

    const talkRecordsLogs = new logs.LogGroup(this, "TalkRecordsLogs", {
      removalPolicy: RemovalPolicy.DESTROY,
      retention: logs.RetentionDays.ONE_MONTH,
    });
    const talkRecordsFunction = new NodejsFunction(
      this,
      "TalkRecordsFunction",
      {
        architecture: lambda.Architecture.ARM_64,
        bundling: { minify: true, target: "node24" },
        depsLockFilePath: lockFile,
        entry: path.resolve(__dirname, "../functions/talk-records.ts"),
        environment: invalidatingEnvironment,
        logGroup: talkRecordsLogs,
        memorySize: 256,
        projectRoot,
        runtime: lambda.Runtime.NODEJS_24_X,
        timeout: Duration.seconds(10),
      },
    );

    const objectArn = props.contentBucket.arnForObjects(CONTENT_KEY);
    const pendingTalkObjectsArn =
      props.contentBucket.arnForObjects(PENDING_TALK_OBJECTS);
    const approvedTalkDecksArn =
      props.contentBucket.arnForObjects(APPROVED_TALK_DECKS);
    const apiTalkRecordsArn =
      props.contentBucket.arnForObjects(API_TALK_RECORDS);

    readFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["s3:ListBucket"],
        resources: [props.contentBucket.bucketArn],
      }),
    );
    readFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["s3:GetObject"],
        resources: [objectArn],
      }),
    );
    writeFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["s3:GetObject", "s3:PutObject"],
        resources: [objectArn],
      }),
    );
    writeFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["cloudfront:CreateInvalidation"],
        resources: [distributionArn],
      }),
    );

    talkUploadStartFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["s3:ListBucket"],
        conditions: {
          StringLike: { "s3:prefix": [API_TALK_RECORDS] },
        },
        resources: [props.contentBucket.bucketArn],
      }),
    );
    talkUploadStartFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["s3:PutObject"],
        resources: [pendingTalkObjectsArn],
      }),
    );
    talkUploadStartFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["s3:GetObject"],
        resources: [apiTalkRecordsArn],
      }),
    );

    talkUploadCompleteFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["s3:ListBucket"],
        conditions: {
          StringLike: {
            "s3:prefix": [
              PENDING_TALK_OBJECTS,
              APPROVED_TALK_DECKS,
              API_TALK_RECORDS,
            ],
          },
        },
        resources: [props.contentBucket.bucketArn],
      }),
    );
    talkUploadCompleteFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["s3:GetObject", "s3:DeleteObject"],
        resources: [pendingTalkObjectsArn],
      }),
    );
    talkUploadCompleteFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
        resources: [approvedTalkDecksArn],
      }),
    );
    talkUploadCompleteFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["s3:GetObject", "s3:PutObject"],
        resources: [apiTalkRecordsArn],
      }),
    );
    talkUploadCompleteFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["cloudfront:CreateInvalidation"],
        resources: [distributionArn],
      }),
    );

    talkRecordsFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["s3:ListBucket"],
        conditions: {
          StringLike: { "s3:prefix": [API_TALK_RECORDS] },
        },
        resources: [props.contentBucket.bucketArn],
      }),
    );
    talkRecordsFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["s3:GetObject", "s3:DeleteObject"],
        resources: [apiTalkRecordsArn],
      }),
    );
    talkRecordsFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["s3:DeleteObject"],
        resources: [approvedTalkDecksArn],
      }),
    );
    talkRecordsFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["cloudfront:CreateInvalidation"],
        resources: [distributionArn],
      }),
    );

    const authorizer = new HttpIamAuthorizer();
    const api = new apigwv2.HttpApi(this, "Api", {
      apiName: "salih-dev-content",
      createDefaultStage: false,
      defaultAuthorizer: authorizer,
      description: "IAM-authenticated updates for mutable salih.dev content.",
    });
    api.addRoutes({
      integration: new HttpLambdaIntegration("ReadIntegration", readFunction),
      methods: [apigwv2.HttpMethod.GET],
      path: "/v1/content",
    });
    api.addRoutes({
      integration: new HttpLambdaIntegration("WriteIntegration", writeFunction),
      methods: [apigwv2.HttpMethod.PUT],
      path: "/v1/content",
    });
    api.addRoutes({
      integration: new HttpLambdaIntegration(
        "TalkUploadStartIntegration",
        talkUploadStartFunction,
      ),
      methods: [apigwv2.HttpMethod.POST],
      path: "/v1/talks/uploads",
    });
    api.addRoutes({
      integration: new HttpLambdaIntegration(
        "TalkUploadCompleteIntegration",
        talkUploadCompleteFunction,
      ),
      methods: [apigwv2.HttpMethod.POST],
      path: "/v1/talks/uploads/{deckId}/completion",
    });
    api.addRoutes({
      integration: new HttpLambdaIntegration(
        "TalkRecordsListIntegration",
        talkRecordsFunction,
      ),
      methods: [apigwv2.HttpMethod.GET],
      path: "/v1/talks/records",
    });
    api.addRoutes({
      integration: new HttpLambdaIntegration(
        "TalkRecordsDeleteIntegration",
        talkRecordsFunction,
      ),
      methods: [apigwv2.HttpMethod.DELETE],
      path: "/v1/talks/records/{recordKey}",
    });

    const accessLogs = new logs.LogGroup(this, "AccessLogs", {
      removalPolicy: RemovalPolicy.DESTROY,
      retention: logs.RetentionDays.ONE_MONTH,
    });
    const stage = new apigwv2.HttpStage(this, "DefaultStage", {
      accessLogSettings: {
        destination: new apigwv2.LogGroupLogDestination(accessLogs),
        format: AccessLogFormat.custom(
          JSON.stringify({
            integrationError: "$context.integrationErrorMessage",
            requestId: "$context.requestId",
            routeKey: "$context.routeKey",
            status: "$context.status",
          }),
        ),
      },
      autoDeploy: true,
      httpApi: api,
      stageName: "$default",
      throttle: { burstLimit: 10, rateLimit: 5 },
    });

    for (const fn of [
      readFunction,
      writeFunction,
      talkUploadStartFunction,
      talkUploadCompleteFunction,
      talkRecordsFunction,
    ]) {
      suppressBasicLambdaLoggingPolicy(fn, "one-month API execution logs");
    }

    new CfnOutput(Stack.of(this), "ContentApiUrl", { value: stage.url });
  }
}
