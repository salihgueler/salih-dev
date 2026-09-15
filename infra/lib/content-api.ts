import * as path from "node:path";
import { CfnOutput, Duration, RemovalPolicy, Stack } from "aws-cdk-lib";
import { AccessLogFormat } from "aws-cdk-lib/aws-apigateway";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import { HttpIamAuthorizer } from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as codebuild from "aws-cdk-lib/aws-codebuild";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";

import { CONTENT_KEY } from "../functions/content-api-shared";
import { suppressBasicLambdaLoggingPolicy } from "./lambda-log-suppressions";

export interface ContentApiProps {
  allowedCallerArns: string[];
  contentBucket: s3.IBucket;
  editor: iam.IUser;
  publisher: codebuild.IProject;
}

export class ContentApi extends Construct {
  constructor(scope: Construct, id: string, props: ContentApiProps) {
    super(scope, id);

    const projectRoot = path.resolve(__dirname, "../..");
    const lockFile = path.resolve(__dirname, "../package-lock.json");
    const commonEnvironment = {
      CONTENT_ALLOWED_CALLER_ARNS: props.allowedCallerArns.join(","),
      CONTENT_BUCKET_NAME: props.contentBucket.bucketName,
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
      environment: {
        ...commonEnvironment,
        PUBLISHER_PROJECT_NAME: props.publisher.projectName,
      },
      logGroup: writeLogs,
      memorySize: 256,
      projectRoot,
      runtime: lambda.Runtime.NODEJS_24_X,
      timeout: Duration.seconds(10),
    });

    const objectArn = props.contentBucket.arnForObjects(CONTENT_KEY);
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
        actions: ["codebuild:StartBuild"],
        resources: [props.publisher.projectArn],
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

    props.editor.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ["execute-api:Invoke"],
        resources: [
          api.arnForExecuteApi("GET", "/v1/content", "$default"),
          api.arnForExecuteApi("PUT", "/v1/content", "$default"),
        ],
      }),
    );

    for (const fn of [readFunction, writeFunction]) {
      suppressBasicLambdaLoggingPolicy(fn, "one-month API execution logs");
    }

    new CfnOutput(Stack.of(this), "ContentApiUrl", { value: stage.url });
  }
}
