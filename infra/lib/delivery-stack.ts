import * as path from "node:path";

import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  type StackProps,
} from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as actions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as codebuild from "aws-cdk-lib/aws-codebuild";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as targets from "aws-cdk-lib/aws-route53-targets";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3assets from "aws-cdk-lib/aws-s3-assets";
import * as scheduler from "aws-cdk-lib/aws-scheduler";
import * as schedulerTargets from "aws-cdk-lib/aws-scheduler-targets";
import * as sns from "aws-cdk-lib/aws-sns";
import * as sqs from "aws-cdk-lib/aws-sqs";
import { NagSuppressions } from "cdk-nag";
import type { Construct } from "constructs";

import {
  viewerRequestCode,
  viewerResponseCode,
} from "./edge-functions";

export interface SalihDevDeliveryStackProps extends StackProps {
  readonly contentBucket: s3.IBucket;
  readonly domainName: string;
  readonly hostedZone: route53.IHostedZone;
}

export class SalihDevDeliveryStack extends Stack {
  public constructor(
    scope: Construct,
    id: string,
    props: SalihDevDeliveryStackProps,
  ) {
    super(scope, id, props);

    const siteBucket = new s3.Bucket(this, "SiteBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      lifecycleRules: [
        {
          noncurrentVersionExpiration: Duration.days(30),
        },
      ],
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      removalPolicy: RemovalPolicy.RETAIN,
      versioned: true,
    });

    const certificate = new acm.Certificate(this, "Certificate", {
      domainName: props.domainName,
      subjectAlternativeNames: [`www.${props.domainName}`],
      validation: acm.CertificateValidation.fromDns(props.hostedZone),
    });

    const requestFunction = new cloudfront.Function(this, "ViewerRequest", {
      code: cloudfront.FunctionCode.fromInline(
        viewerRequestCode(props.domainName),
      ),
      comment:
        "Redirect www, negotiate Markdown, and map clean URLs to S3 objects.",
      runtime: cloudfront.FunctionRuntime.JS_2_0,
    });
    const responseFunction = new cloudfront.Function(this, "ViewerResponse", {
      code: cloudfront.FunctionCode.fromInline(
        viewerResponseCode(props.domainName),
      ),
      comment: "Advertise canonical HTML and Markdown representations.",
      runtime: cloudfront.FunctionRuntime.JS_2_0,
    });

    const responseHeaders = new cloudfront.ResponseHeadersPolicy(
      this,
      "ResponseHeaders",
      {
        customHeadersBehavior: {
          customHeaders: [
            {
              header: "Content-Signal",
              override: true,
              value: "search=yes, ai-input=yes, ai-train=no",
            },
          ],
        },
        securityHeadersBehavior: {
          contentTypeOptions: { override: true },
          frameOptions: {
            frameOption: cloudfront.HeadersFrameOption.DENY,
            override: true,
          },
          referrerPolicy: {
            override: true,
            referrerPolicy:
              cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
          },
          strictTransportSecurity: {
            accessControlMaxAge: Duration.days(365),
            includeSubdomains: true,
            override: true,
            preload: true,
          },
        },
      },
    );

    const distribution = new cloudfront.Distribution(this, "Distribution", {
      certificate,
      defaultBehavior: {
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        compress: true,
        functionAssociations: [
          {
            eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
            function: requestFunction,
          },
          {
            eventType: cloudfront.FunctionEventType.VIEWER_RESPONSE,
            function: responseFunction,
          },
        ],
        origin: origins.S3BucketOrigin.withOriginAccessControl(
          siteBucket,
        ),
        responseHeadersPolicy: responseHeaders,
        viewerProtocolPolicy:
          cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      domainNames: [props.domainName, `www.${props.domainName}`],
      enableIpv6: true,
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 404,
          responsePagePath: "/404.html",
          ttl: Duration.minutes(5),
        },
        {
          httpStatus: 404,
          responseHttpStatus: 404,
          responsePagePath: "/404.html",
          ttl: Duration.minutes(5),
        },
      ],
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      minimumProtocolVersion:
        cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
    });

    for (const recordName of [props.domainName, `www.${props.domainName}`]) {
      new route53.ARecord(this, `Ipv4Alias${recordName}`, {
        recordName,
        target: route53.RecordTarget.fromAlias(
          new targets.CloudFrontTarget(distribution),
        ),
        zone: props.hostedZone,
      });
      new route53.AaaaRecord(this, `Ipv6Alias${recordName}`, {
        recordName,
        target: route53.RecordTarget.fromAlias(
          new targets.CloudFrontTarget(distribution),
        ),
        zone: props.hostedZone,
      });
    }

    const source = new s3assets.Asset(this, "ApplicationSource", {
      exclude: [
        ".astro/**",
        ".cache/**",
        ".git/**",
        "dist/**",
        "infra/cdk.out/**",
        "infra/node_modules/**",
        "node_modules/**",
      ],
      path: path.resolve(__dirname, "../.."),
    });
    const buildLogGroup = new logs.LogGroup(this, "BuildLogGroup", {
      logGroupName: "/aws/codebuild/salih-dev-publisher",
      removalPolicy: RemovalPolicy.DESTROY,
      retention: logs.RetentionDays.ONE_MONTH,
    });

    const project = new codebuild.Project(this, "Publisher", {
      buildSpec: codebuild.BuildSpec.fromObject({
        version: "0.2",
        phases: {
          install: {
            "runtime-versions": {
              nodejs: 22,
            },
            commands: ["npm ci"],
          },
          pre_build: {
            commands: [
              "mkdir -p .cache public/images/blog",
              'aws s3 sync "s3://$CONTENT_BUCKET/posts/" src/content/blog/ --only-show-errors',
              'aws s3 sync "s3://$CONTENT_BUCKET/images/" public/images/blog/ --only-show-errors',
              'aws s3 cp "s3://$CONTENT_BUCKET/state/dev-sync-manifest.json" .cache/dev-sync-manifest.json --only-show-errors || echo "No existing DEV manifest; running initial sync."',
            ],
          },
          build: {
            commands: [
              "npm run import:dev",
              "npm test",
              "npm run check",
              "npm run build",
              "npm run verify:build",
            ],
          },
          post_build: {
            commands: [
              'if [ "$CODEBUILD_BUILD_SUCCEEDING" -ne 1 ]; then echo "Build failed; skipping publication."; exit 1; fi',
              'aws s3 sync src/content/blog/ "s3://$CONTENT_BUCKET/posts/" --delete --only-show-errors',
              'aws s3 sync public/images/blog/ "s3://$CONTENT_BUCKET/images/" --delete --only-show-errors',
              'aws s3 cp .cache/dev-sync-manifest.json "s3://$CONTENT_BUCKET/state/dev-sync-manifest.json" --cache-control "no-cache" --content-type "application/json" --only-show-errors',
              'aws s3 sync dist/ "s3://$SITE_BUCKET/" --delete --cache-control "public,max-age=300" --only-show-errors',
              'aws s3 cp dist/ "s3://$SITE_BUCKET/" --recursive --exclude "*" --include "*.md" --cache-control "public,max-age=300" --content-type "text/markdown; charset=utf-8" --only-show-errors',
              'if [ -d dist/_astro ]; then aws s3 cp dist/_astro/ "s3://$SITE_BUCKET/_astro/" --recursive --cache-control "public,max-age=31536000,immutable" --only-show-errors; fi',
              'aws cloudfront create-invalidation --distribution-id "$DISTRIBUTION_ID" --paths "/*" >/dev/null',
            ],
          },
        },
      }),
      concurrentBuildLimit: 1,
      environment: {
        buildImage:
          codebuild.LinuxLambdaBuildImage.AMAZON_LINUX_2023_NODE_22,
        computeType: codebuild.ComputeType.LAMBDA_1GB,
      },
      environmentVariables: {
        CONTENT_BUCKET: {
          value: props.contentBucket.bucketName,
        },
        DEV_MANIFEST_PATH: {
          value: ".cache/dev-sync-manifest.json",
        },
        DISTRIBUTION_ID: {
          value: distribution.distributionId,
        },
        SITE_BUCKET: {
          value: siteBucket.bucketName,
        },
        SITE_URL: {
          value: `https://${props.domainName}`,
        },
      },
      logging: {
        cloudWatch: {
          logGroup: buildLogGroup,
          prefix: "publish",
        },
      },
      source: codebuild.Source.s3({
        bucket: source.bucket,
        path: source.s3ObjectKey,
      }),
    });

    source.grantRead(project);
    props.contentBucket.grantReadWrite(project);
    siteBucket.grantReadWrite(project);
    project.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["cloudfront:CreateInvalidation"],
        resources: [
          `arn:${Stack.of(this).partition}:cloudfront::${Stack.of(this).account}:distribution/${distribution.distributionId}`,
        ],
      }),
    );

    const schedulerDlq = new sqs.Queue(this, "SchedulerDlq", {
      enforceSSL: true,
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      removalPolicy: RemovalPolicy.DESTROY,
      retentionPeriod: Duration.days(14),
    });
    new scheduler.Schedule(this, "DailyPublishSchedule", {
      description:
        "Checks DEV for new or edited posts and republishes salih.dev.",
      schedule: scheduler.ScheduleExpression.cron({
        hour: "3",
        minute: "15",
      }),
      target: new schedulerTargets.CodeBuildStartBuild(project, {
        deadLetterQueue: schedulerDlq,
        maxEventAge: Duration.hours(1),
        retryAttempts: 2,
      }),
      timeWindow: scheduler.TimeWindow.off(),
    });

    const alarmTopic = new sns.Topic(this, "BuildAlarmTopic", {
      enforceSSL: true,
    });
    const buildAlarm = new cloudwatch.Alarm(this, "BuildFailureAlarm", {
      alarmDescription: "The daily salih.dev synchronization build failed.",
      comparisonOperator:
        cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      evaluationPeriods: 1,
      metric: project.metricFailedBuilds({
        period: Duration.days(1),
      }),
      threshold: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    buildAlarm.addAlarmAction(new actions.SnsAction(alarmTopic));

    NagSuppressions.addResourceSuppressions(siteBucket, [
      {
        id: "AwsSolutions-S1",
        reason:
          "The bucket is a private CloudFront origin. CloudFront metrics and CodeBuild publication logs provide the required operational visibility without storing per-request S3 logs.",
      },
    ]);
    NagSuppressions.addResourceSuppressions(distribution, [
      {
        id: "AwsSolutions-CFR1",
        reason:
          "salih.dev is intentionally public worldwide and must not use geographic restrictions.",
      },
      {
        id: "AwsSolutions-CFR2",
        reason:
          "The distribution serves immutable static files from a private OAC origin and has no request-processing backend; AWS WAF is not justified for this low-traffic personal site.",
      },
      {
        id: "AwsSolutions-CFR3",
        reason:
          "CloudFront standard metrics are sufficient for this low-traffic public site. Request logs are omitted to minimize retained visitor data and cost.",
      },
    ]);
    NagSuppressions.addResourceSuppressions(
      project,
      [
        {
          id: "AwsSolutions-CB4",
          reason:
            "CodeBuild uses AWS-managed encryption and produces no build artifacts. A dedicated customer-managed KMS key would add recurring cost without protecting persistent build output.",
        },
        {
          id: "AwsSolutions-IAM5",
          reason:
            "CDK grant methods scope wildcard object paths and action families to the application source, content, and site buckets. CodeBuild also requires generated log stream and report-group suffixes.",
        },
      ],
      true,
    );
    NagSuppressions.addResourceSuppressions(schedulerDlq, [
      {
        id: "AwsSolutions-SQS3",
        reason:
          "This queue is itself the terminal dead-letter queue for EventBridge Scheduler and therefore must not have another DLQ.",
      },
    ]);

    new CfnOutput(this, "CloudFrontUrl", {
      value: `https://${distribution.distributionDomainName}`,
    });
    new CfnOutput(this, "DistributionId", {
      value: distribution.distributionId,
    });
    new CfnOutput(this, "PublisherProjectName", {
      description:
        "Run the initial publish with: aws codebuild start-build --project-name <value>",
      value: project.projectName,
    });
    new CfnOutput(this, "BuildAlarmTopicArn", {
      description: "Subscribe an email endpoint to receive build failure alerts.",
      value: alarmTopic.topicArn,
    });
  }
}
