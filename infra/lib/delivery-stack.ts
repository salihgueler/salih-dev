import * as path from "node:path";
import { execFileSync } from "node:child_process";

import {
  AssetHashType,
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  type StackProps,
} from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as appconfig from "aws-cdk-lib/aws-appconfig";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as actions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as codebuild from "aws-cdk-lib/aws-codebuild";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
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

import { Analytics } from "./analytics";
import { ContentApi } from "./content-api";
import { FeatureFlags } from "./feature-flags";
import { suppressBasicLambdaLoggingPolicy } from "./lambda-log-suppressions";
import { viewerRequestCode, viewerRenderRequestCode, viewerResponseCode, viewerDeckRequestCode, viewerImageRequestCode } from "./edge-functions";
import { Monitoring } from "./monitoring";
import { PrefixScopedS3Origin } from "./prefix-scoped-s3-origin";

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

    const rootEditorArn = Stack.of(this).formatArn({
      account: Stack.of(this).account,
      region: "",
      resource: "root",
      service: "iam",
    });
    new CfnOutput(this, "ContentRootPrincipalArn", {
      description: "Account root identity allowed for site content updates.",
      value: rootEditorArn,
    });

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
    const renderRequestFunction = new cloudfront.Function(
      this,
      "ViewerRenderRequest",
      {
        code: cloudfront.FunctionCode.fromInline(
          viewerRenderRequestCode(props.domainName),
        ),
        comment:
          "Redirect www and negotiate Markdown for the SSR render origin, keeping clean route paths.",
        runtime: cloudfront.FunctionRuntime.JS_2_0,
      },
    );
    const responseFunction = new cloudfront.Function(this, "ViewerResponse", {
      code: cloudfront.FunctionCode.fromInline(
        viewerResponseCode(props.domainName),
      ),
      comment: "Advertise canonical HTML and Markdown representations.",
      runtime: cloudfront.FunctionRuntime.JS_2_0,
    });
    const deckRequestFunction = new cloudfront.Function(this, "ViewerDeckRequest", {
      code: cloudfront.FunctionCode.fromInline(
        viewerDeckRequestCode(props.domainName),
      ),
      comment:
        "Rewrite /talks/slides/api/<id>.pdf to the talks/decks/ content-bucket key; 404 anything else.",
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

    // --- Request-time render origin for Talks / Location / Events ---
    // A read-only Lambda that reads the content bucket at request time and
    // renders the dynamic routes with Astro SSR (the official @astrojs/node
    // adapter in middleware mode, wrapped by a thin API Gateway handler), so a
    // content write is live in seconds via a scoped CloudFront invalidation
    // instead of a full publisher build. The package (handler + SSR server +
    // prerendered client assets) is assembled by scripts/build-render-lambda.mjs.
    const renderLogGroup = new logs.LogGroup(this, "RenderLogs", {
      removalPolicy: RemovalPolicy.DESTROY,
      retention: logs.RetentionDays.ONE_MONTH,
    });
    const renderBuildScript = path.resolve(
      __dirname,
      "../scripts/build-render-lambda.mjs",
    );
    const renderFunction = new lambda.Function(this, "RenderFunction", {
      architecture: lambda.Architecture.ARM_64,
      code: lambda.Code.fromAsset(path.resolve(__dirname, "../.."), {
        assetHashType: AssetHashType.OUTPUT,
        bundling: {
          // Bundling runs on the host (no container): the SSR build needs the
          // repo's own toolchain and node_modules. The Docker image is declared
          // only to satisfy the BundlingOptions contract; local bundling always
          // succeeds here, so the image is never pulled.
          image: lambda.Runtime.NODEJS_24_X.bundlingImage,
          local: {
            tryBundle(outputDir: string): boolean {
              execFileSync("node", [renderBuildScript, outputDir], {
                stdio: "inherit",
              });
              return true;
            },
          },
          command: [],
        },
      }),
      environment: {
        CONTENT_BUCKET_NAME: props.contentBucket.bucketName,
        SALIH_DEV_SSR: "1",
        // The off path (flag off) serves the baked static page for the route
        // from the site bucket; the on path renders through Astro.
        SITE_BUCKET_NAME: siteBucket.bucketName,
        // While the rollout is active, render responses are `private, no-store`
        // so the flag decision runs per visitor and a rollback is immediate.
        // Set to "0" (or removed) once the flag is deleted to restore edge
        // caching (DYNAMIC_CACHE_CONTROL).
        RENDER_ROLLOUT_ACTIVE: "1",
      },
      handler: "index.handler",
      logGroup: renderLogGroup,
      memorySize: 1024,
      runtime: lambda.Runtime.NODEJS_24_X,
      timeout: Duration.seconds(29),
    });

    // Read-only, least-privilege. GetObject on the content object, the talk
    // records and the blog posts; prefix-scoped ListBucket on every prefix it
    // lists so a missing key surfaces as a clean 404 rather than an
    // AccessDenied masked as a 500. It lists `talks/decks/` (to decide deck
    // presence) but never reads a deck object: decks are served straight from
    // the content bucket through CloudFront, never through this Lambda.
    renderFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["s3:ListBucket"],
        conditions: {
          StringLike: {
            "s3:prefix": ["talks/records/*", "talks/decks/*", "posts/*"],
          },
        },
        resources: [props.contentBucket.bucketArn],
      }),
    );
    renderFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["s3:GetObject"],
        resources: [
          props.contentBucket.arnForObjects("site/content.v1.json"),
          props.contentBucket.arnForObjects("talks/records/*"),
          props.contentBucket.arnForObjects("posts/*"),
        ],
      }),
    );

    // Off path (flag off): read the baked static page for a dynamic route from
    // the SITE bucket. Scoped to exactly the baked dynamic-route keys the off
    // path serves (mirrors OFF_PATH_KEY_PATTERNS in src/lib/off-path-key.ts),
    // never the whole bucket. A prefix-scoped ListBucket lets S3 answer a
    // missing key as a clean 404 rather than an AccessDenied masked as a 500.
    const offPathKeyPatterns = [
      "index.html",
      "index.md",
      "talks/*",
      "blog/*",
      "categories/*",
      "tags/*",
      "rss.xml",
      "sitemap.xml",
      "llms.txt",
      "llms-full.txt",
    ];
    renderFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["s3:GetObject"],
        resources: offPathKeyPatterns.map((pattern) =>
          siteBucket.arnForObjects(pattern),
        ),
      }),
    );
    renderFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["s3:ListBucket"],
        conditions: {
          StringLike: {
            "s3:prefix": ["talks/*", "blog/*", "categories/*", "tags/*"],
          },
        },
        resources: [siteBucket.bucketArn],
      }),
    );

    suppressBasicLambdaLoggingPolicy(
      renderFunction,
      "one-month render execution logs",
    );
    NagSuppressions.addResourceSuppressions(
      renderFunction,
      [
        {
          id: "AwsSolutions-IAM5",
          appliesTo: [
            "Resource::<ContentBucket52D4B12C.Arn>/talks/records/*",
            "Resource::<ContentBucket52D4B12C.Arn>/posts/*",
          ],
          reason:
            "The render function reads only the code-owned talk-record and blog-post prefixes it renders plus the single site content object; each object wildcard is scoped to exactly that prefix and grants read (GetObject) only, with no write or delete. ListBucket is separately scoped by an s3:prefix condition to the prefixes it enumerates.",
        },
      ],
      true,
    );

    // --- AppConfig feature-flag control plane (render-rollout-flag) ---
    // The application, the `production` environment with the render-error and
    // p95 alarms as monitors, and the feature-flag profile holding
    // `renderFromBackend` (default off), deployed with a linear strategy and a
    // final bake time so an alarm during rollout rolls the flag back.
    const featureFlags = new FeatureFlags(this, "FeatureFlags", {
      renderFunction,
      renderLogGroup,
    });

    // The AppConfig L2 auto-generates the environment's alarm-read role from
    // Monitor.fromCloudWatchAlarm. Its cloudwatch:DescribeAlarms action is
    // resource-wildcard by AWS design (DescribeAlarms does not support
    // resource-level scoping), so the generated role trips AwsSolutions-IAM5.
    NagSuppressions.addResourceSuppressions(
      featureFlags.environment,
      [
        {
          id: "AwsSolutions-IAM5",
          appliesTo: ["Resource::*"],
          reason:
            "The AppConfig environment's alarm-monitor role is auto-generated by Monitor.fromCloudWatchAlarm and calls cloudwatch:DescribeAlarms, which does not support resource-level permissions, so the resource is necessarily '*'. The role has only that read action and is assumable only by the AppConfig service.",
        },
      ],
      true,
    );

    // The render Lambda reads the flag through the AWS AppConfig Agent, added as
    // a Lambda extension layer. The layer ARN is Region- and
    // architecture-specific; getLambdaLayerVersionArn resolves the arm64 ARN for
    // this stack's Region (us-east-1), so no per-Region ARN is hard-coded.
    const appConfigLayer = lambda.LayerVersion.fromLayerVersionArn(
      this,
      "AppConfigAgentLayer",
      appconfig.Application.getLambdaLayerVersionArn(
        Stack.of(this).region,
        appconfig.Platform.ARM_64,
      ),
    );
    renderFunction.addLayers(appConfigLayer);

    // Prefetch the flag during init so its value is in the extension's local
    // cache before the handler runs on a cold start, and give the handler the
    // application/environment/profile names it reads the flag from.
    renderFunction.addEnvironment(
      "AWS_APPCONFIG_EXTENSION_PREFETCH_LIST",
      featureFlags.configurationPath(),
    );
    renderFunction.addEnvironment(
      "APPCONFIG_APPLICATION",
      featureFlags.application.name ?? "salih-dev",
    );
    renderFunction.addEnvironment("APPCONFIG_ENVIRONMENT", "production");
    renderFunction.addEnvironment(
      "APPCONFIG_PROFILE",
      featureFlags.configuration.name ?? "render-flags",
    );

    // The extension calls StartConfigurationSession/GetLatestConfiguration on
    // each cold start and on each background poll. Granting via
    // environment.grantReadConfig would make the render role depend on the
    // environment, which depends on the render-error alarm, which depends on the
    // render function — a dependency cycle. Instead the read is granted with a
    // manual policy scoped to this application's own configuration resources by
    // ARN (the application does not depend on the render function), which grants
    // exactly the two data-plane actions without the cyclic construct reference.
    const appConfigResourceArn = Stack.of(this).formatArn({
      service: "appconfig",
      resource: "application",
      resourceName: `${featureFlags.application.applicationId}/environment/*/configuration/*`,
    });
    renderFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "appconfig:StartConfigurationSession",
          "appconfig:GetLatestConfiguration",
        ],
        resources: [
          appConfigResourceArn,
          Stack.of(this).formatArn({
            service: "appconfig",
            resource: "application",
            resourceName: featureFlags.application.applicationId,
          }),
        ],
      }),
    );

    // The Lambda is reachable only through CloudFront: its Function URL uses
    // IAM auth and is fronted with Origin Access Control, so it is never a
    // world-reachable endpoint.
    const renderFunctionUrl = renderFunction.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.AWS_IAM,
    });
    const renderOrigin =
      origins.FunctionUrlOrigin.withOriginAccessControl(renderFunctionUrl);

    // Dynamic routes cache briefly at the edge and are refreshed by the write
    // paths' scoped invalidation; the cache key includes Accept so HTML and
    // Markdown negotiate correctly.
    //
    // RESTORE AT FLAG REMOVAL (render-rollout-flag, Step 11): PR #10's
    // edge-caching render cache policy is replaced during the rollout by
    // `renderRolloutCachePolicy` below (which caches nothing so the per-visitor
    // flag decision runs on every request). When the flag is removed, restore
    // this policy on the render behavior to bring back edge caching and the
    // `stale-if-error` outage window (see DYNAMIC_CACHE_CONTROL in
    // src/lib/render-cache.ts, kept in code for exactly this):
    //
    //   const renderCachePolicy = new cloudfront.CachePolicy(this,
    //     "RenderCachePolicy", {
    //       cachePolicyName: "salih-dev-render",
    //       defaultTtl: Duration.minutes(5),
    //       maxTtl: Duration.hours(24),
    //       minTtl: Duration.seconds(0),
    //       headerBehavior: cloudfront.CacheHeaderBehavior.allowList("Accept"),
    //       cookieBehavior: cloudfront.CacheCookieBehavior.none(),
    //       queryStringBehavior: cloudfront.CacheQueryStringBehavior.none(),
    //       enableAcceptEncodingGzip: true,
    //       enableAcceptEncodingBrotli: true,
    //     });

    // --- Rollout caching (render-rollout-flag, Step 8) ---
    // While the flag exists, the flag decision is per visitor (keyed on the
    // `vid` cookie), so the render behavior must NOT cache: a shared cached
    // object would serve one visitor's version to everyone and the flag would
    // never re-evaluate. This policy caches nothing (all TTLs 0). The
    // edge-caching `renderCachePolicy` above is kept in code to restore when the
    // flag is removed (Step 11).
    const renderRolloutCachePolicy = new cloudfront.CachePolicy(
      this,
      "RenderRolloutCachePolicy",
      {
        cachePolicyName: "salih-dev-render-rollout",
        defaultTtl: Duration.seconds(0),
        maxTtl: Duration.seconds(1),
        minTtl: Duration.seconds(0),
        headerBehavior: cloudfront.CacheHeaderBehavior.allowList("Accept"),
        // The cookie is NOT part of the cache key (that would fragment the
        // cache per visitor); the origin re-decides per request because nothing
        // is cached.
        cookieBehavior: cloudfront.CacheCookieBehavior.none(),
        queryStringBehavior: cloudfront.CacheQueryStringBehavior.none(),
        enableAcceptEncodingGzip: true,
        enableAcceptEncodingBrotli: true,
      },
    );

    // Forward ONLY the `vid` cookie to the render origin (plus Accept for the
    // Markdown negotiation), so the flag read has the visitor id and nothing
    // else about the visitor reaches the Lambda.
    const renderOriginRequestPolicy = new cloudfront.OriginRequestPolicy(
      this,
      "RenderOriginRequestPolicy",
      {
        originRequestPolicyName: "salih-dev-render-vid",
        cookieBehavior: cloudfront.OriginRequestCookieBehavior.allowList("vid"),
        headerBehavior:
          cloudfront.OriginRequestHeaderBehavior.allowList("Accept"),
        queryStringBehavior:
          cloudfront.OriginRequestQueryStringBehavior.none(),
      },
    );

    const renderBehavior: cloudfront.BehaviorOptions = {
      allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
      cachePolicy: renderRolloutCachePolicy,
      originRequestPolicy: renderOriginRequestPolicy,
      compress: true,
      functionAssociations: [
        {
          eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
          function: renderRequestFunction,
        },
        {
          eventType: cloudfront.FunctionEventType.VIEWER_RESPONSE,
          function: responseFunction,
        },
      ],
      origin: renderOrigin,
      responseHeadersPolicy: responseHeaders,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
    };

    // --- API-authored slide-deck origin (content bucket, read-only, scoped) ---
    // Decks are served straight from `talks/decks/` so a newly published talk's
    // PDF is reachable without a build. The origin's OAC read is scoped to that
    // one prefix, and the behavior's viewer-request function rewrites the public
    // slide path to the object key, so no other content-bucket prefix is
    // exposed. Decks are immutable once published (a new deck is a new id), so
    // the edge caches them for a day and the write path never has to invalidate.
    const deckOriginAccessControl = new cloudfront.S3OriginAccessControl(
      this,
      "DeckOriginAccessControl",
    );
    const deckOrigin = PrefixScopedS3Origin.forPrefix(props.contentBucket, {
      keyPrefix: "talks/decks/",
      originAccessControl: deckOriginAccessControl,
    });
    const deckCachePolicy = new cloudfront.CachePolicy(this, "DeckCachePolicy", {
      cachePolicyName: "salih-dev-decks",
      defaultTtl: Duration.hours(24),
      maxTtl: Duration.days(365),
      minTtl: Duration.hours(1),
      headerBehavior: cloudfront.CacheHeaderBehavior.none(),
      cookieBehavior: cloudfront.CacheCookieBehavior.none(),
      queryStringBehavior: cloudfront.CacheQueryStringBehavior.none(),
      enableAcceptEncodingGzip: false,
      enableAcceptEncodingBrotli: false,
    });
    const deckBehavior: cloudfront.BehaviorOptions = {
      allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
      cachePolicy: deckCachePolicy,
      compress: false,
      functionAssociations: [
        {
          eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
          function: deckRequestFunction,
        },
      ],
      origin: deckOrigin,
      responseHeadersPolicy: responseHeaders,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
    };

    // --- Blog hero images (content bucket, read-only, scoped) ---
    // Blog posts reference `https://salih.dev/images/blog/<file>.webp`. Those
    // objects live in the content bucket at `images/<file>.webp` (the publisher
    // syncs `public/images/blog/` there), so a post imported at request time can
    // reference an image that is live without a build. The origin's OAC read is
    // scoped to `images/*`, and the behavior strips the `/blog` path segment so
    // the request maps to the `images/` key; no other content-bucket prefix is
    // reachable through it. Images are content-addressed by file name, so the
    // edge caches them for a day.
    const imageOriginAccessControl = new cloudfront.S3OriginAccessControl(
      this,
      "ImageOriginAccessControl",
    );
    const imageOrigin = PrefixScopedS3Origin.forPrefix(props.contentBucket, {
      keyPrefix: "images/",
      originAccessControl: imageOriginAccessControl,
      // The public path is `/images/blog/<file>`; the object key is
      // `images/<file>`. Origin path `/images` + the behavior stripping
      // `/images/blog` is avoided by rewriting in the viewer function instead,
      // so the origin serves the bucket root and the OAC scopes the read.
    });
    const imageCachePolicy = new cloudfront.CachePolicy(
      this,
      "ImageCachePolicy",
      {
        cachePolicyName: "salih-dev-blog-images",
        defaultTtl: Duration.hours(24),
        maxTtl: Duration.days(365),
        minTtl: Duration.hours(1),
        headerBehavior: cloudfront.CacheHeaderBehavior.none(),
        cookieBehavior: cloudfront.CacheCookieBehavior.none(),
        queryStringBehavior: cloudfront.CacheQueryStringBehavior.none(),
        enableAcceptEncodingGzip: false,
        enableAcceptEncodingBrotli: false,
      },
    );
    const imageRequestFunction = new cloudfront.Function(
      this,
      "ViewerImageRequest",
      {
        code: cloudfront.FunctionCode.fromInline(
          viewerImageRequestCode(props.domainName),
        ),
        comment:
          "Rewrite /images/blog/<file> to the images/ content-bucket key; 404 traversal.",
        runtime: cloudfront.FunctionRuntime.JS_2_0,
      },
    );
    const imageBehavior: cloudfront.BehaviorOptions = {
      allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
      cachePolicy: imageCachePolicy,
      compress: false,
      functionAssociations: [
        {
          eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
          function: imageRequestFunction,
        },
      ],
      origin: imageOrigin,
      responseHeadersPolicy: responseHeaders,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
    };

    const distribution = new cloudfront.Distribution(this, "Distribution", {
      additionalBehaviors: {
        // The render origin serves every route whose content lives in the
        // content bucket: the home page (location, events, latest posts), the
        // Talks archive, the blog index, posts, categories and tags, and the
        // machine-readable listings, each with its Markdown alternate. The
        // render viewer-request function keeps the clean route paths the SSR
        // server matches and negotiates the ".md" alternates. Every other page
        // (about, contact, 404, skills, the API catalog) stays static and is
        // served from S3 by the default behavior.
        "/": renderBehavior,
        "/index.md": renderBehavior,
        "/talks/": renderBehavior,
        "/talks/index.md": renderBehavior,
        "/talks": renderBehavior,
        "/blog": renderBehavior,
        "/blog/*": renderBehavior,
        "/categories/*": renderBehavior,
        "/tags/*": renderBehavior,
        "/rss.xml": renderBehavior,
        "/sitemap.xml": renderBehavior,
        "/llms.txt": renderBehavior,
        "/llms-full.txt": renderBehavior,
        // Blog hero images are served straight from the content bucket's
        // `images/` prefix.
        "/images/blog/*": imageBehavior,
        // API-authored slide decks are served straight from the content
        // bucket's `talks/decks/` prefix, so a newly published talk's PDF link
        // works without a build. The viewer-request function rewrites the public
        // slide path to the object key and 404s anything that is not the exact
        // deck-id shape; the origin's OAC read is scoped to `talks/decks/*`, so
        // no other prefix of the content bucket is reachable through it.
        "/talks/slides/api/*": deckBehavior,
      },
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
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
        responseHeadersPolicy: responseHeaders,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
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
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
    });

    // A Function URL behind OAC needs BOTH lambda:InvokeFunctionUrl and
    // lambda:InvokeFunction for the CloudFront service principal (see the
    // CloudFront guide, "Restrict access to an AWS Lambda function URL
    // origin"). FunctionUrlOrigin.withOriginAccessControl in this CDK version
    // grants only InvokeFunctionUrl, and the first production deploy returned
    // 403 (served as the 404 page) on every render route until this was added.
    renderFunction.addPermission("AllowCloudFrontInvokeFunction", {
      action: "lambda:InvokeFunction",
      principal: new iam.ServicePrincipal("cloudfront.amazonaws.com"),
      sourceArn: `arn:${this.partition}:cloudfront::${this.account}:distribution/${distribution.distributionId}`,
    });

    const analytics = new Analytics(this, { distribution });

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
        ".kiro/settings",
        ".kiro/settings/**",
        "dist/**",
        "infra",
        "infra/**",
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
              'mkdir -p .cache public/images/blog "$TALK_RECORD_CACHE_PATH" "$TALK_DECK_CACHE_PATH"',
              'aws s3 cp "s3://$CONTENT_BUCKET/site/content.v1.json" "$SITE_CONTENT_PATH" --only-show-errors',
              'aws s3 sync "s3://$CONTENT_BUCKET/posts/" src/content/blog/ --only-show-errors',
              'aws s3 sync "s3://$CONTENT_BUCKET/images/" public/images/blog/ --only-show-errors',
              'aws s3 cp "s3://$CONTENT_BUCKET/state/dev-sync-manifest.json" .cache/dev-sync-manifest.json --only-show-errors || echo "No existing DEV manifest; running initial sync."',
              'aws s3 sync "s3://$CONTENT_BUCKET/talks/records/" "$TALK_RECORD_CACHE_PATH" --delete --only-show-errors',
              'aws s3 sync "s3://$CONTENT_BUCKET/talks/decks/" "$TALK_DECK_CACHE_PATH" --delete --only-show-errors',
              "npm run materialize:talks",
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
        buildImage: codebuild.LinuxLambdaBuildImage.AMAZON_LINUX_2023_NODE_22,
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
        SITE_CONTENT_PATH: {
          value: ".cache/site-content.json",
        },
        SITE_URL: {
          value: `https://${props.domainName}`,
        },
        TALK_DECK_CACHE_PATH: {
          value: ".cache/talk-decks",
        },
        TALK_RECORD_CACHE_PATH: {
          value: ".cache/talk-records",
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

    // --- Import-only dev.to sync (no build, no site publish) ---
    // Because the blog is served at request time from S3 `posts/` + `images/`,
    // the daily dev.to import no longer needs a full site build: it imports new
    // and edited posts, writes the changed `posts/` and `images/` objects to the
    // content bucket, and invalidates exactly the blog and listing routes plus
    // the affected images. The next request renders the change from S3 within
    // seconds. Full builds (`Publisher`, run on demand) stay for code, design,
    // and template changes. CodeBuild — not a Lambda — runs the import because
    // it reuses the repo's own toolchain and the existing `scripts/import-dev.mjs`
    // unchanged, with network egress to dev.to; a Lambda would have to repackage
    // that script, its dependencies, and egress with no reuse.
    const importLogGroup = new logs.LogGroup(this, "ImportLogGroup", {
      logGroupName: "/aws/codebuild/salih-dev-dev-importer",
      removalPolicy: RemovalPolicy.DESTROY,
      retention: logs.RetentionDays.ONE_MONTH,
    });
    const importer = new codebuild.Project(this, "DevImporter", {
      buildSpec: codebuild.BuildSpec.fromObject({
        version: "0.2",
        phases: {
          install: {
            "runtime-versions": { nodejs: 22 },
            commands: ["npm ci"],
          },
          pre_build: {
            commands: [
              "mkdir -p .cache src/content/blog public/images/blog",
              'aws s3 sync "s3://$CONTENT_BUCKET/posts/" src/content/blog/ --only-show-errors',
              'aws s3 sync "s3://$CONTENT_BUCKET/images/" public/images/blog/ --only-show-errors',
              'aws s3 cp "s3://$CONTENT_BUCKET/state/dev-sync-manifest.json" .cache/dev-sync-manifest.json --only-show-errors || echo "No existing DEV manifest; running initial sync."',
            ],
          },
          build: {
            // Import only. No `npm run build`, no `verify:build`, no dist/.
            commands: ["npm run import:dev"],
          },
          post_build: {
            commands: [
              'if [ "$CODEBUILD_BUILD_SUCCEEDING" -ne 1 ]; then echo "Import failed; skipping sync."; exit 1; fi',
              // Write the imported posts and images to the content bucket only.
              // The site bucket is never touched, and no build output is synced.
              'aws s3 sync src/content/blog/ "s3://$CONTENT_BUCKET/posts/" --delete --only-show-errors',
              'aws s3 sync public/images/blog/ "s3://$CONTENT_BUCKET/images/" --delete --only-show-errors',
              'aws s3 cp .cache/dev-sync-manifest.json "s3://$CONTENT_BUCKET/state/dev-sync-manifest.json" --cache-control "no-cache" --content-type "application/json" --only-show-errors',
              // Invalidate exactly the request-time routes that reflect posts and
              // the blog images, never "/*": the render origin re-renders these
              // from S3 on the next request, and the images are re-fetched.
              'aws cloudfront create-invalidation --distribution-id "$DISTRIBUTION_ID" --paths "/" "/index.md" "/blog/*" "/categories/*" "/tags/*" "/rss.xml" "/sitemap.xml" "/llms.txt" "/llms-full.txt" "/images/blog/*" >/dev/null',
              // During the render rollout, also start the publisher build so the
              // baked pages the OFF-path visitors see include the new posts.
              // Gated on RENDER_ROLLOUT_ACTIVE; a no-op once the flag is removed.
              'if [ "$RENDER_ROLLOUT_ACTIVE" = "1" ] && [ -n "$PUBLISHER_PROJECT_NAME" ]; then aws codebuild start-build --project-name "$PUBLISHER_PROJECT_NAME" >/dev/null || echo "publisher build trigger failed (non-fatal)"; fi',
            ],
          },
        },
      }),
      concurrentBuildLimit: 1,
      environment: {
        buildImage: codebuild.LinuxLambdaBuildImage.AMAZON_LINUX_2023_NODE_22,
        computeType: codebuild.ComputeType.LAMBDA_1GB,
      },
      environmentVariables: {
        CONTENT_BUCKET: { value: props.contentBucket.bucketName },
        DEV_MANIFEST_PATH: { value: ".cache/dev-sync-manifest.json" },
        DISTRIBUTION_ID: { value: distribution.distributionId },
        SITE_URL: { value: `https://${props.domainName}` },
        // Dual write during the rollout: the importer also starts the publisher
        // so off-path visitors see new posts. A no-op once the flag is removed.
        RENDER_ROLLOUT_ACTIVE: { value: "1" },
        PUBLISHER_PROJECT_NAME: { value: project.projectName },
      },
      logging: {
        cloudWatch: { logGroup: importLogGroup, prefix: "import" },
      },
      source: codebuild.Source.s3({
        bucket: source.bucket,
        path: source.s3ObjectKey,
      }),
    });
    source.grantRead(importer);
    // The importer reads and writes only the content bucket; it never touches
    // the site bucket, so it is not granted access to it.
    props.contentBucket.grantReadWrite(importer);
    // During the rollout the importer also starts the publisher build (dual
    // write), so it needs codebuild:StartBuild on that one project.
    importer.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["codebuild:StartBuild"],
        resources: [project.projectArn],
      }),
    );
    importer.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["cloudfront:CreateInvalidation"],
        resources: [
          `arn:${Stack.of(this).partition}:cloudfront::${Stack.of(this).account}:distribution/${distribution.distributionId}`,
        ],
      }),
    );

    new ContentApi(this, "ContentApi", {
      allowedCallerArns: [rootEditorArn],
      contentBucket: props.contentBucket,
      distribution,
      publisherProject: project,
      // The render rollout is active (Parts 1-2): write paths dual-write to the
      // publisher so the baked pages the off path serves stay current. Flip to
      // false when the flag is removed (Step 11).
      rolloutActive: true,
    });

    const schedulerDlq = new sqs.Queue(this, "SchedulerDlq", {
      enforceSSL: true,
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      removalPolicy: RemovalPolicy.DESTROY,
      retentionPeriod: Duration.days(14),
    });
    new scheduler.Schedule(this, "DailyPublishSchedule", {
      description:
        "Imports new or edited DEV posts to the content bucket and invalidates the request-time blog routes, without a full site build.",
      schedule: scheduler.ScheduleExpression.cron({
        hour: "3",
        minute: "15",
      }),
      target: new schedulerTargets.CodeBuildStartBuild(importer, {
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
      alarmDescription:
        "The daily salih.dev DEV import failed (posts were not synced to the content bucket).",
      comparisonOperator:
        cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      evaluationPeriods: 1,
      metric: importer.metricFailedBuilds({
        period: Duration.days(1),
      }),
      threshold: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    buildAlarm.addAlarmAction(new actions.SnsAction(alarmTopic));

    // The publisher still bakes the static site on code pushes and, while
    // RENDER_ROLLOUT_ACTIVE is on, on every content write and daily import.
    // Visitors on the flag-off path (and every on-path fallback) read those
    // baked pages, so a failed publish would leave them silently stale.
    const publisherAlarm = new cloudwatch.Alarm(
      this,
      "PublisherBuildFailureAlarm",
      {
        alarmDescription:
          "A salih.dev publisher build failed (the baked static site in the site bucket was not updated).",
        comparisonOperator:
          cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        evaluationPeriods: 1,
        metric: project.metricFailedBuilds({
          period: Duration.hours(1),
        }),
        threshold: 1,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      },
    );
    publisherAlarm.addAlarmAction(new actions.SnsAction(alarmTopic));

    // --- Operational monitoring: CloudFront errors and scheduled homepage check ---
    new Monitoring(this, {
      alarmTopic,
      analyticsWidgetFunction: analytics.widgetFunction,
      distribution,
      distributionId: distribution.distributionId,
      domainName: props.domainName,
    });

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
    NagSuppressions.addResourceSuppressions(
      importer,
      [
        {
          id: "AwsSolutions-CB4",
          reason:
            "CodeBuild uses AWS-managed encryption and produces no build artifacts. A dedicated customer-managed KMS key would add recurring cost without protecting persistent build output.",
        },
        {
          id: "AwsSolutions-IAM5",
          reason:
            "CDK grant methods scope wildcard object paths and action families to the application source and the content bucket (the importer never touches the site bucket). CodeBuild also requires generated log stream and report-group suffixes.",
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
      description:
        "Subscribe an email endpoint to receive build failure alerts.",
      value: alarmTopic.topicArn,
    });
  }
}
