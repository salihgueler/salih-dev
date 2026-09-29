import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";

import { SalihDevDeliveryStack } from "../lib/delivery-stack";
import { SalihDevStateStack } from "../lib/state-stack";

type JsonRecord = Record<string, unknown>;
type SynthResource = Readonly<{
  DeletionPolicy?: unknown;
  Metadata?: JsonRecord;
  Properties: JsonRecord;
  UpdateReplacePolicy?: unknown;
}>;

function createStacks() {
  const app = new App();
  const env = { account: "111111111111", region: "us-east-1" };
  const state = new SalihDevStateStack(app, "State", {
    domainName: "salih.dev",
    env,
  });
  const delivery = new SalihDevDeliveryStack(app, "Delivery", {
    contentBucket: state.contentBucket,
    domainName: "salih.dev",
    env,
    hostedZone: state.hostedZone,
  });
  return {
    app,
    state: Template.fromStack(state),
    delivery: Template.fromStack(delivery),
  };
}

function asRecord(value: unknown, label: string): JsonRecord {
  assert.ok(
    value !== null && typeof value === "object",
    `${label} is an object`,
  );
  return value as JsonRecord;
}

function asArray(value: unknown, label: string): readonly unknown[] {
  assert.ok(Array.isArray(value), `${label} is an array`);
  return value;
}

function asStringArray(value: unknown, label: string): readonly string[] {
  const values = typeof value === "string" ? [value] : asArray(value, label);
  assert.ok(
    values.every((item) => typeof item === "string"),
    `${label} contains only strings`,
  );
  return values as readonly string[];
}

function findResourceEntry(
  template: Template,
  type: string,
  constructPathSuffix: string,
): readonly [string, SynthResource] {
  const resources = template.findResources(type) as Record<
    string,
    SynthResource
  >;
  const logicalIdFragment = constructPathSuffix
    .split("/")
    .filter((segment) => segment.length > 0 && segment !== "Resource")
    .join("");
  const entry = Object.entries(resources).find(([logicalId, resource]) => {
    const constructPath = resource.Metadata?.["aws:cdk:path"];
    return (
      (typeof constructPath === "string" &&
        constructPath.endsWith(constructPathSuffix)) ||
      logicalId.includes(logicalIdFragment)
    );
  });
  assert.ok(entry, `found ${type} at ${constructPathSuffix}`);
  return entry;
}

function findResource(
  template: Template,
  type: string,
  constructPathSuffix: string,
): SynthResource {
  return findResourceEntry(template, type, constructPathSuffix)[1];
}

function policyStatements(
  template: Template,
  constructPathSuffix: string,
): readonly JsonRecord[] {
  const policy = findResource(
    template,
    "AWS::IAM::Policy",
    constructPathSuffix,
  );
  const document = asRecord(
    policy.Properties.PolicyDocument,
    `${constructPathSuffix} policy document`,
  );
  return asArray(document.Statement, `${constructPathSuffix} statements`).map(
    (statement, index) =>
      asRecord(statement, `${constructPathSuffix} statement ${index}`),
  );
}

function assertStatement(
  statement: JsonRecord,
  expectedActions: readonly string[],
  expectedResourceFragment: string,
): void {
  assert.deepEqual(
    [...asStringArray(statement.Action, "statement actions")].sort(),
    [...expectedActions].sort(),
  );
  assert.equal(statement.Effect, "Allow");
  const resource = JSON.stringify(statement.Resource);
  assert.ok(
    resource.includes(expectedResourceFragment),
    `resource ${resource} includes ${expectedResourceFragment}`,
  );
}

function environmentVariables(resource: SynthResource): JsonRecord {
  const environment = asRecord(
    resource.Properties.Environment,
    "Lambda environment",
  );
  return asRecord(environment.Variables, "Lambda environment variables");
}

function readDependency(
  packagePath: string,
  section: "dependencies" | "devDependencies",
  dependency: string,
): string | undefined {
  const parsed: unknown = JSON.parse(readFileSync(packagePath, "utf8"));
  const packageJson = asRecord(parsed, packagePath);
  const dependencies = asRecord(
    packageJson[section],
    `${packagePath} ${section}`,
  );
  const version = dependencies[dependency];
  assert.ok(
    version === undefined || typeof version === "string",
    `${dependency} has a string version`,
  );
  return version;
}

test("creates retained private versioned storage with pending-only expiry", () => {
  const { state } = createStacks();

  state.resourceCountIs("AWS::S3::Bucket", 1);
  state.allResourcesProperties("AWS::S3::Bucket", {
    BucketEncryption: {
      ServerSideEncryptionConfiguration: [
        {
          ServerSideEncryptionByDefault: {
            SSEAlgorithm: "AES256",
          },
        },
      ],
    },
    LifecycleConfiguration: {
      Rules: [
        {
          NoncurrentVersionExpiration: { NoncurrentDays: 90 },
          Status: "Enabled",
        },
        {
          ExpirationInDays: 1,
          Prefix: "talks/pending/",
          Status: "Enabled",
        },
      ],
    },
    OwnershipControls: {
      Rules: [{ ObjectOwnership: "BucketOwnerEnforced" }],
    },
    PublicAccessBlockConfiguration: {
      BlockPublicAcls: true,
      BlockPublicPolicy: true,
      IgnorePublicAcls: true,
      RestrictPublicBuckets: true,
    },
    VersioningConfiguration: {
      Status: "Enabled",
    },
  });

  const bucket = findResource(
    state,
    "AWS::S3::Bucket",
    "/ContentBucket/Resource",
  );
  assert.equal(bucket.DeletionPolicy, "Retain");
  assert.equal(bucket.UpdateReplacePolicy, "Retain");
  state.hasResourceProperties("AWS::S3::BucketPolicy", {
    PolicyDocument: {
      Statement: Match.arrayWith([
        Match.objectLike({
          Action: "s3:*",
          Condition: { Bool: { "aws:SecureTransport": "false" } },
          Effect: "Deny",
        }),
      ]),
    },
  });
});

test("creates static delivery and daily publishing resources", () => {
  const { delivery } = createStacks();

  delivery.resourceCountIs("AWS::CloudFront::Distribution", 1);
  delivery.resourceCountIs("AWS::CloudFront::Function", 5);
  delivery.resourceCountIs("AWS::CodeBuild::Project", 2);
  delivery.resourceCountIs("AWS::Scheduler::Schedule", 1);
  delivery.resourceCountIs("AWS::SQS::Queue", 1);
  delivery.hasResourceProperties("AWS::Scheduler::Schedule", {
    ScheduleExpression: "cron(15 3 * * ? *)",
    FlexibleTimeWindow: {
      Mode: "OFF",
    },
    Target: Match.objectLike({
      RetryPolicy: {
        MaximumEventAgeInSeconds: 3600,
        MaximumRetryAttempts: 2,
      },
    }),
  });
});

test("uses a private S3 origin and TLS domain aliases", () => {
  const { delivery } = createStacks();

  delivery.hasResourceProperties("AWS::CloudFront::Distribution", {
    DistributionConfig: Match.objectLike({
      Aliases: ["salih.dev", "www.salih.dev"],
      Enabled: true,
      HttpVersion: "http2and3",
      IPV6Enabled: true,
      ViewerCertificate: Match.objectLike({
        MinimumProtocolVersion: "TLSv1.2_2021",
        SslSupportMethod: "sni-only",
      }),
    }),
  });
});

test("includes agent-friendly edge behavior", () => {
  const { delivery } = createStacks();
  const functions = delivery.findResources("AWS::CloudFront::Function");
  const joinedCode = Object.values(functions)
    .map((resource) => JSON.stringify(resource.Properties.FunctionCode))
    .join("\n");

  assert.match(joinedCode, /text\/markdown/);
  assert.match(joinedCode, /Content-Signal|canonical/);
  assert.match(joinedCode, /api\/catalog\.json/);
  delivery.hasResourceProperties("AWS::CloudFront::ResponseHeadersPolicy", {
    ResponseHeadersPolicyConfig: Match.objectLike({
      CustomHeadersConfig: {
        Items: [
          {
            Header: "Content-Signal",
            Override: true,
            Value: "search=yes, ai-input=yes, ai-train=no",
          },
        ],
      },
    }),
  });
});

test("exposes exactly the IAM-authorized content and talk routes with shared throttling", () => {
  const { delivery } = createStacks();
  const routes = delivery.findResources("AWS::ApiGatewayV2::Route") as Record<
    string,
    SynthResource
  >;
  const routeProperties = Object.values(routes).map(
    (resource) => resource.Properties,
  );

  assert.deepEqual(
    routeProperties.map((properties) => properties.RouteKey).sort(),
    [
      "DELETE /v1/talks/records/{recordKey}",
      "GET /v1/content",
      "GET /v1/talks/records",
      "POST /v1/talks/uploads",
      "POST /v1/talks/uploads/{deckId}/completion",
      "PUT /v1/content",
    ],
  );
  assert.ok(
    routeProperties.every(
      (properties) => properties.AuthorizationType === "AWS_IAM",
    ),
  );
  assert.ok(
    routeProperties.every(
      (properties) =>
        !("AuthorizationScopes" in properties) &&
        !("AuthorizerId" in properties),
    ),
  );
  delivery.hasResourceProperties("AWS::ApiGatewayV2::Stage", {
    AutoDeploy: true,
    DefaultRouteSettings: {
      ThrottlingBurstLimit: 10,
      ThrottlingRateLimit: 5,
    },
    StageName: "$default",
  });
  const stage = Object.values(
    delivery.findResources("AWS::ApiGatewayV2::Stage") as Record<
      string,
      SynthResource
    >,
  )[0];
  assert.ok(!("RouteSettings" in stage.Properties));
});

test("configures isolated talk functions, environments, and one-month logs", () => {
  const { delivery } = createStacks();
  const functionCases = [
    {
      path: "/ContentApi/TalkUploadStartFunction/Resource",
      logPath: "/ContentApi/TalkUploadStartLogs/Resource",
      memory: 256,
      publisher: false,
      timeout: 10,
    },
    {
      path: "/ContentApi/TalkUploadCompleteFunction/Resource",
      logPath: "/ContentApi/TalkUploadCompleteLogs/Resource",
      memory: 1769,
      publisher: true,
      timeout: 29,
    },
    {
      path: "/ContentApi/TalkRecordsFunction/Resource",
      logPath: "/ContentApi/TalkRecordsLogs/Resource",
      memory: 256,
      publisher: true,
      timeout: 10,
    },
  ] as const;

  for (const functionCase of functionCases) {
    const [logLogicalId, logGroup] = findResourceEntry(
      delivery,
      "AWS::Logs::LogGroup",
      functionCase.logPath,
    );
    assert.equal(logGroup.Properties.RetentionInDays, 30);

    const fn = findResource(
      delivery,
      "AWS::Lambda::Function",
      functionCase.path,
    );
    assert.deepEqual(fn.Properties.Architectures, ["arm64"]);
    assert.equal(fn.Properties.Runtime, "nodejs24.x");
    assert.equal(fn.Properties.MemorySize, functionCase.memory);
    assert.equal(fn.Properties.Timeout, functionCase.timeout);
    assert.deepEqual(fn.Properties.LoggingConfig, {
      LogGroup: { Ref: logLogicalId },
    });

    const variables = environmentVariables(fn);
    assert.deepEqual(
      Object.keys(variables).sort(),
      [
        "CONTENT_ALLOWED_CALLER_ARNS",
        "CONTENT_BUCKET_NAME",
        // The invalidating (publisher) functions carry the distribution id and,
        // while the render rollout is active, the dual-write markers that let
        // them also start the publisher build (render-rollout-flag, Part 2).
        ...(functionCase.publisher
          ? ["DISTRIBUTION_ID", "RENDER_ROLLOUT_ACTIVE", "PUBLISHER_PROJECT_NAME"]
          : []),
      ].sort(),
    );
  }
});

test("packages the pinned PDF parser only with upload completion", () => {
  const { app, delivery } = createStacks();
  const assemblyDirectory = app.synth().directory;
  const functionCases = [
    ["/ContentApi/TalkUploadStartFunction/Resource", false],
    ["/ContentApi/TalkUploadCompleteFunction/Resource", true],
    ["/ContentApi/TalkRecordsFunction/Resource", false],
  ] as const;

  for (const [constructPath, expectsPdfParser] of functionCases) {
    const fn = findResource(delivery, "AWS::Lambda::Function", constructPath);
    const code = asRecord(fn.Properties.Code, `${constructPath} code`);
    assert.equal(typeof code.S3Key, "string");
    const assetDirectory = `asset.${(code.S3Key as string).replace(/\.zip$/u, "")}`;
    assert.equal(
      existsSync(
        path.join(
          assemblyDirectory,
          assetDirectory,
          "node_modules",
          "pdfjs-dist",
          "package.json",
        ),
      ),
      expectsPdfParser,
      `${constructPath} parser packaging`,
    );
  }

  const infraPackage = path.resolve(__dirname, "../package.json");
  const rootPackage = path.resolve(__dirname, "../../package.json");
  const expectedParserVersion = "6.3.289";
  assert.equal(
    readDependency(infraPackage, "dependencies", "pdfjs-dist"),
    expectedParserVersion,
  );
  assert.equal(
    readDependency(rootPackage, "devDependencies", "pdfjs-dist"),
    expectedParserVersion,
  );
  assert.equal(
    readDependency(infraPackage, "devDependencies", "pdfjs-dist"),
    undefined,
  );
  assert.equal(
    readDependency(rootPackage, "dependencies", "pdfjs-dist"),
    undefined,
  );
});

test("bundles upload completion as ESM so the PDF parser loads through import", () => {
  const { app, delivery } = createStacks();
  const assemblyDirectory = app.synth().directory;
  const fn = findResource(
    delivery,
    "AWS::Lambda::Function",
    "/ContentApi/TalkUploadCompleteFunction/Resource",
  );
  const code = asRecord(fn.Properties.Code, "completion code");
  assert.equal(typeof code.S3Key, "string");
  const assetDirectory = path.join(
    assemblyDirectory,
    `asset.${(code.S3Key as string).replace(/\.zip$/u, "")}`,
  );

  // pdfjs-dist ships only ES modules. The Lambda runtime rejects require() of
  // an ES module (ERR_REQUIRE_ESM), so the handler must be an ESM bundle.
  const entry = path.join(assetDirectory, "index.mjs");
  assert.equal(existsSync(entry), true, "completion bundle must be index.mjs");
  assert.equal(existsSync(path.join(assetDirectory, "index.js")), false);
  const source = readFileSync(entry, "utf8");
  assert.doesNotMatch(source, /require\(\s*["']pdfjs-dist/u);
  assert.match(source, /from\s*["']pdfjs-dist\/legacy\/build\/pdf\.mjs["']/u);
});

test("lets every talk handler list each prefix it reads so absent keys are 404", () => {
  // S3 reports a missing key as AccessDenied (403), not 404, when the caller
  // may GetObject but not ListBucket. Handlers treat 404 as "absent", so every
  // readable talk prefix needs a matching prefix-scoped ListBucket grant.
  const { delivery } = createStacks();
  for (const handler of [
    "TalkUploadStartFunction",
    "TalkUploadCompleteFunction",
    "TalkRecordsFunction",
  ]) {
    const statements = policyStatements(
      delivery,
      `/ContentApi/${handler}/ServiceRole/DefaultPolicy/Resource`,
    );
    const listablePrefixes = new Set(
      statements
        .filter((statement) =>
          asStringArray(statement.Action, `${handler} actions`).includes(
            "s3:ListBucket",
          ),
        )
        .flatMap((statement) => {
          const condition = asRecord(statement.Condition, `${handler} list condition`);
          const like = asRecord(condition.StringLike, `${handler} StringLike`);
          return asStringArray(like["s3:prefix"], `${handler} prefixes`);
        }),
    );
    const readablePrefixes = statements
      .filter((statement) =>
        asStringArray(statement.Action, `${handler} actions`).includes(
          "s3:GetObject",
        ),
      )
      .flatMap((statement) =>
        JSON.stringify(statement.Resource).match(/talks\/[a-z]+\/\*/gu) ?? [],
      );
    assert.ok(readablePrefixes.length > 0, `${handler} reads a talk prefix`);
    for (const prefix of readablePrefixes) {
      assert.ok(
        listablePrefixes.has(prefix),
        `${handler} can read ${prefix} but cannot list it`,
      );
    }
  }
});

test("grants each talk handler only its task-scoped actions and prefixes", () => {
  const { delivery } = createStacks();
  const start = policyStatements(
    delivery,
    "/ContentApi/TalkUploadStartFunction/ServiceRole/DefaultPolicy/Resource",
  );
  assert.equal(start.length, 3);
  assertStatement(start[0], ["s3:ListBucket"], "ContentBucket");
  assert.deepEqual(start[0].Condition, {
    StringLike: { "s3:prefix": ["talks/records/*"] },
  });
  assertStatement(start[1], ["s3:PutObject"], "/talks/pending/*");
  assertStatement(start[2], ["s3:GetObject"], "/talks/records/*");

  const completion = policyStatements(
    delivery,
    "/ContentApi/TalkUploadCompleteFunction/ServiceRole/DefaultPolicy/Resource",
  );
  // 5 PR #10 statements + the render-rollout dual-write StartBuild grant.
  assert.equal(completion.length, 6);
  assertStatement(completion[0], ["s3:ListBucket"], "ContentBucket");
  assert.deepEqual(completion[0].Condition, {
    StringLike: {
      "s3:prefix": ["talks/pending/*", "talks/decks/*", "talks/records/*"],
    },
  });
  assertStatement(
    completion[1],
    ["s3:GetObject", "s3:DeleteObject"],
    "/talks/pending/*",
  );
  assertStatement(
    completion[2],
    ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
    "/talks/decks/*",
  );
  assertStatement(
    completion[3],
    ["s3:GetObject", "s3:PutObject"],
    "/talks/records/*",
  );
  assertStatement(
    completion[4],
    ["cloudfront:CreateInvalidation"],
    "distribution/",
  );
  // render-rollout-flag dual write: StartBuild on the publisher project only.
  assertStatement(completion[5], ["codebuild:StartBuild"], "Publisher");

  const records = policyStatements(
    delivery,
    "/ContentApi/TalkRecordsFunction/ServiceRole/DefaultPolicy/Resource",
  );
  assert.equal(records.length, 5);
  assertStatement(records[0], ["s3:ListBucket"], "ContentBucket");
  assert.deepEqual(records[0].Condition, {
    StringLike: { "s3:prefix": ["talks/records/*"] },
  });
  assertStatement(
    records[1],
    ["s3:GetObject", "s3:DeleteObject"],
    "/talks/records/*",
  );
  assertStatement(records[2], ["s3:DeleteObject"], "/talks/decks/*");
  assertStatement(
    records[3],
    ["cloudfront:CreateInvalidation"],
    "distribution/",
  );
  // render-rollout-flag dual write: StartBuild on the publisher project only.
  assertStatement(records[4], ["codebuild:StartBuild"], "Publisher");

  const talkPolicies = [...start, ...completion, ...records];
  const serialized = JSON.stringify(talkPolicies);
  assert.doesNotMatch(serialized, /\/site\/\*/);
  assert.doesNotMatch(serialized, /s3:\*/);
  assert.doesNotMatch(serialized, /Resource":"\*"/);
});

test("materializes inbound talk caches before validation and gates publication", () => {
  const { delivery } = createStacks();
  const project = findResource(
    delivery,
    "AWS::CodeBuild::Project",
    "/Publisher/Resource",
  );
  assert.equal(project.Properties.ConcurrentBuildLimit, 1);

  const environment = asRecord(
    project.Properties.Environment,
    "build environment",
  );
  const environmentValues = new Map<string, unknown>();
  for (const item of asArray(
    environment.EnvironmentVariables,
    "build environment variables",
  )) {
    const variable = asRecord(item, "build environment variable");
    assert.equal(typeof variable.Name, "string");
    environmentValues.set(variable.Name as string, variable.Value);
  }
  assert.equal(
    environmentValues.get("TALK_RECORD_CACHE_PATH"),
    ".cache/talk-records",
  );
  assert.equal(
    environmentValues.get("TALK_DECK_CACHE_PATH"),
    ".cache/talk-decks",
  );

  const source = asRecord(project.Properties.Source, "publisher source");
  assert.equal(typeof source.BuildSpec, "string");
  const parsedBuildSpec: unknown = JSON.parse(source.BuildSpec as string);
  const buildSpec = asRecord(parsedBuildSpec, "publisher buildspec");
  const phases = asRecord(buildSpec.phases, "publisher phases");
  const preBuild = asRecord(phases.pre_build, "pre_build phase");
  const build = asRecord(phases.build, "build phase");
  const postBuild = asRecord(phases.post_build, "post_build phase");
  const preBuildCommands = asStringArray(
    preBuild.commands,
    "pre_build commands",
  );
  const buildCommands = asStringArray(build.commands, "build commands");
  const postBuildCommands = asStringArray(
    postBuild.commands,
    "post_build commands",
  );

  assert.deepEqual(preBuildCommands.slice(-3), [
    'aws s3 sync "s3://$CONTENT_BUCKET/talks/records/" "$TALK_RECORD_CACHE_PATH" --delete --only-show-errors',
    'aws s3 sync "s3://$CONTENT_BUCKET/talks/decks/" "$TALK_DECK_CACHE_PATH" --delete --only-show-errors',
    "npm run materialize:talks",
  ]);
  assert.deepEqual(buildCommands, [
    "npm run import:dev",
    "npm test",
    "npm run check",
    "npm run build",
    "npm run verify:build",
  ]);
  assert.match(postBuildCommands[0], /CODEBUILD_BUILD_SUCCEEDING/);
  const outboundCommands = postBuildCommands.slice(1).join("\n");
  assert.doesNotMatch(outboundCommands, /src\/content\/talks/);
  assert.doesNotMatch(outboundCommands, /public\/talks\/slides/);
  assert.doesNotMatch(outboundCommands, /talks\/records/);
  assert.doesNotMatch(outboundCommands, /talks\/decks/);
});

test("adds no extra storage, identity, or public editor surface", () => {
  const { delivery, state } = createStacks();

  state.resourceCountIs("AWS::S3::Bucket", 1);
  delivery.resourceCountIs("AWS::S3::Bucket", 2);
  delivery.resourceCountIs("AWS::IAM::User", 0);
  delivery.resourceCountIs("AWS::IAM::AccessKey", 0);
  delivery.resourceCountIs("AWS::Cognito::UserPool", 0);
  delivery.resourceCountIs("AWS::Cognito::IdentityPool", 0);
  // The only Function URL is the render origin, and it is IAM-authed (reachable
  // only through CloudFront via OAC), not a public editor surface.
  delivery.resourceCountIs("AWS::Lambda::Url", 1);
  delivery.hasResourceProperties("AWS::Lambda::Url", {
    AuthType: "AWS_IAM",
  });
  delivery.resourceCountIs("AWS::ApiGatewayV2::DomainName", 0);
});

test("adds a read-only render origin behind CloudFront for the dynamic routes", () => {
  const { delivery } = createStacks();

  // The render Lambda is Node 24 arm64, like the content functions.
  const render = findResource(
    delivery,
    "AWS::Lambda::Function",
    "/RenderFunction/Resource",
  );
  assert.deepEqual(render.Properties.Architectures, ["arm64"]);
  assert.equal(render.Properties.Runtime, "nodejs24.x");
  assert.deepEqual(
    Object.keys(environmentVariables(render)).sort(),
    [
      // PR #10 base.
      "CONTENT_BUCKET_NAME",
      "SALIH_DEV_SSR",
      // render-rollout-flag: the AppConfig flag coordinates, the extension
      // prefetch path, the off-path site bucket, and the rollout marker.
      "APPCONFIG_APPLICATION",
      "APPCONFIG_ENVIRONMENT",
      "APPCONFIG_PROFILE",
      "AWS_APPCONFIG_EXTENSION_PREFETCH_LIST",
      "RENDER_ROLLOUT_ACTIVE",
      "SITE_BUCKET_NAME",
    ].sort(),
  );

  // Read-only, least-privilege: GetObject + prefix-scoped ListBucket only, and
  // no write, delete, StartBuild, or CreateInvalidation.
  const renderStatements = policyStatements(
    delivery,
    "/RenderFunction/ServiceRole/DefaultPolicy/Resource",
  );
  const renderActions = renderStatements.flatMap((statement) =>
    typeof statement.Action === "string"
      ? [statement.Action]
      : (statement.Action as string[]),
  );
  assert.ok(renderActions.includes("s3:GetObject"));
  assert.ok(renderActions.includes("s3:ListBucket"));
  for (const forbidden of [
    "s3:PutObject",
    "s3:DeleteObject",
    "codebuild:StartBuild",
    "cloudfront:CreateInvalidation",
  ]) {
    assert.ok(
      !renderActions.includes(forbidden),
      `render role must not have ${forbidden}`,
    );
  }
  // The render role now has TWO ListBucket statements: the PR #10 content-bucket
  // one (talk records/decks + posts) and the off-path SITE-bucket one (baked
  // dynamic routes). Select the content-bucket one by its exact prefix set.
  const listStatements = renderStatements.filter((statement) =>
    (typeof statement.Action === "string"
      ? [statement.Action]
      : (statement.Action as string[])
    ).includes("s3:ListBucket"),
  );
  const contentListStatement = listStatements.find(
    (statement) =>
      JSON.stringify(statement.Condition) ===
      JSON.stringify({
        StringLike: {
          "s3:prefix": ["talks/records/*", "talks/decks/*", "posts/*"],
        },
      }),
  );
  assert.ok(
    contentListStatement !== undefined,
    "the content-bucket ListBucket statement is present with its prefix scope",
  );
  // The off-path site-bucket ListBucket is scoped to the baked dynamic prefixes.
  const offPathListStatement = listStatements.find(
    (statement) =>
      JSON.stringify(statement.Condition) ===
      JSON.stringify({
        StringLike: {
          "s3:prefix": ["talks/*", "blog/*", "categories/*", "tags/*"],
        },
      }),
  );
  assert.ok(
    offPathListStatement !== undefined,
    "the off-path site-bucket ListBucket statement is present with its prefix scope",
  );

  // The render role reads the site object, talk records and blog posts, and
  // never a deck object (decks are served by CloudFront from the bucket). The
  // off path adds a SECOND GetObject on the site bucket; select the
  // content-bucket statement by the one resource unique to it.
  const getStatement = renderStatements.find((statement) => {
    const actions =
      typeof statement.Action === "string"
        ? [statement.Action]
        : (statement.Action as string[]);
    return (
      actions.includes("s3:GetObject") &&
      JSON.stringify(statement.Resource).includes("site/content.v1.json")
    );
  });
  assert.ok(getStatement !== undefined);
  const getResources = JSON.stringify(getStatement.Resource);
  for (const allowed of ["site/content.v1.json", "talks/records/*", "posts/*"]) {
    assert.ok(getResources.includes(allowed), `render role must read ${allowed}`);
  }
  assert.ok(
    !getResources.includes("talks/decks"),
    "render role must not read deck objects",
  );

  // The render origin is a Function URL with IAM auth (OAC-fronted, non-public).
  delivery.hasResourceProperties("AWS::Lambda::Url", { AuthType: "AWS_IAM" });

  // Every route whose content lives in the content bucket is routed to the
  // render origin; the default (S3) behavior keeps the rest.
  delivery.hasResourceProperties("AWS::CloudFront::Distribution", {
    DistributionConfig: Match.objectLike({
      CacheBehaviors: Match.arrayWith([
        Match.objectLike({ PathPattern: "/" }),
        Match.objectLike({ PathPattern: "/index.md" }),
        Match.objectLike({ PathPattern: "/talks/" }),
        Match.objectLike({ PathPattern: "/talks/index.md" }),
        Match.objectLike({ PathPattern: "/blog/*" }),
        Match.objectLike({ PathPattern: "/categories/*" }),
        Match.objectLike({ PathPattern: "/tags/*" }),
        Match.objectLike({ PathPattern: "/rss.xml" }),
        Match.objectLike({ PathPattern: "/sitemap.xml" }),
        Match.objectLike({ PathPattern: "/llms.txt" }),
        Match.objectLike({ PathPattern: "/llms-full.txt" }),
      ]),
    }),
  });
});

test("serves API-authored slide decks from the content bucket, scoped to talks/decks", () => {
  const { state, delivery } = createStacks();

  // A dedicated behavior serves the public slide path from the content bucket.
  delivery.hasResourceProperties("AWS::CloudFront::Distribution", {
    DistributionConfig: Match.objectLike({
      CacheBehaviors: Match.arrayWith([
        Match.objectLike({
          PathPattern: "/talks/slides/api/*",
          AllowedMethods: ["GET", "HEAD"],
          FunctionAssociations: Match.arrayWith([
            Match.objectLike({ EventType: "viewer-request" }),
          ]),
        }),
      ]),
    }),
  });

  // CloudFront's read of the content bucket is scoped to talks/decks/* only:
  // no statement grants s3:GetObject on the whole bucket or any other prefix.
  const policies = state.findResources("AWS::S3::BucketPolicy");
  const statements = Object.values(policies).flatMap(
    (resource) =>
      resource.Properties.PolicyDocument.Statement as Array<{
        Action: string | string[];
        Resource: unknown;
        Principal?: { Service?: string };
      }>,
  );
  const cloudfrontReads = statements.filter(
    (statement) =>
      statement.Principal?.Service === "cloudfront.amazonaws.com" &&
      (typeof statement.Action === "string"
        ? [statement.Action]
        : statement.Action
      ).includes("s3:GetObject"),
  );
  // Two prefix-scoped CloudFront reads exist (decks and blog images); neither is
  // a whole-bucket grant. Select the deck one and assert it targets only decks.
  const deckReads = cloudfrontReads.filter((statement) =>
    JSON.stringify(statement.Resource).includes("talks/decks/*"),
  );
  assert.equal(deckReads.length, 1);
  const resourceJson = JSON.stringify(deckReads[0].Resource);
  assert.ok(
    resourceJson.includes("talks/decks/*"),
    "CloudFront deck read must target talks/decks/*",
  );
  for (const forbidden of [
    "site/content.v1.json",
    "talks/records/",
    "talks/pending/",
    "posts/",
    "images/",
    "state/",
  ]) {
    assert.ok(
      !resourceJson.includes(forbidden),
      `CloudFront deck read must not reach ${forbidden}`,
    );
  }
  // No CloudFront read is a whole-bucket grant.
  for (const statement of cloudfrontReads) {
    const res = JSON.stringify(statement.Resource);
    assert.ok(
      !/Arn(13DAF1CD)?"\]\},"\/\*"/.test(res) && !res.endsWith('"/*"]]'),
      `CloudFront read must not be a whole-bucket grant: ${res}`,
    );
  }
});

test("serves blog hero images from the content bucket, scoped to images", () => {
  const { state, delivery } = createStacks();

  delivery.hasResourceProperties("AWS::CloudFront::Distribution", {
    DistributionConfig: Match.objectLike({
      CacheBehaviors: Match.arrayWith([
        Match.objectLike({
          PathPattern: "/images/blog/*",
          FunctionAssociations: Match.arrayWith([
            Match.objectLike({ EventType: "viewer-request" }),
          ]),
        }),
      ]),
    }),
  });

  // The API catalog is static capability data, so it stays on the default (S3)
  // behavior and is never routed to the render origin.
  const distribution = Object.values(
    delivery.findResources("AWS::CloudFront::Distribution"),
  )[0];
  const behaviorPatterns = (
    distribution.Properties.DistributionConfig.CacheBehaviors as Array<{
      PathPattern: string;
    }>
  ).map((behavior) => behavior.PathPattern);
  assert.ok(
    !behaviorPatterns.includes("/api/catalog.json"),
    "/api/catalog.json must stay static (no dynamic behavior)",
  );

  const policies = state.findResources("AWS::S3::BucketPolicy");
  const statements = Object.values(policies).flatMap(
    (resource) =>
      resource.Properties.PolicyDocument.Statement as Array<{
        Action: string | string[];
        Resource: unknown;
        Principal?: { Service?: string };
      }>,
  );
  const imageReads = statements.filter(
    (statement) =>
      statement.Principal?.Service === "cloudfront.amazonaws.com" &&
      JSON.stringify(statement.Resource).includes("images/*"),
  );
  assert.equal(imageReads.length, 1);
  const res = JSON.stringify(imageReads[0].Resource);
  for (const forbidden of ["posts/", "talks/", "site/", "state/"]) {
    assert.ok(!res.includes(forbidden), `image read must not reach ${forbidden}`);
  }
});

test("imports DEV posts without a build or a site-bucket sync", () => {
  const { delivery } = createStacks();

  const projects = delivery.findResources("AWS::CodeBuild::Project");
  const specs = Object.values(projects).map((p) =>
    JSON.stringify(p.Properties.Source.BuildSpec),
  );
  const importSpec = specs.find(
    (s) => s.includes("import:dev") && !s.includes("npm run build"),
  );
  assert.ok(
    importSpec !== undefined,
    "an import-only project (import:dev, no npm run build) must exist",
  );
  assert.ok(
    !importSpec.includes("SITE_BUCKET") && !importSpec.includes("sync dist/"),
    "the importer must not sync the site bucket or dist/",
  );
  assert.ok(importSpec.includes("/blog/*"));
  assert.ok(importSpec.includes("/images/blog/*"));
  assert.ok(
    !importSpec.includes('"/*"'),
    "the importer must invalidate scoped paths, not /*",
  );

  delivery.hasResourceProperties("AWS::Scheduler::Schedule", {
    ScheduleExpression: "cron(15 3 * * ? *)",
  });
});

test("adds privacy-first analytics and low-cost monitoring", () => {
  const { delivery } = createStacks();

  // Analytics: one privacy-filtered CloudFront log delivery + catalog + queries.
  delivery.resourceCountIs("AWS::Logs::Delivery", 1);
  delivery.resourceCountIs("AWS::Glue::Database", 1);
  delivery.resourceCountIs("AWS::Glue::Table", 1);
  delivery.resourceCountIs("AWS::Athena::WorkGroup", 1);
  delivery.resourceCountIs("AWS::Athena::NamedQuery", 3);

  // Monitoring: analytics widget, homepage checker, five content API functions,
  // the request-time render function, operations dashboard, and no browser canary.
  delivery.resourceCountIs("AWS::Lambda::Function", 8);
  const lambdaFunctions = delivery.findResources("AWS::Lambda::Function");
  const contentAllowLists = Object.values(lambdaFunctions)
    .map(
      (resource) =>
        resource.Properties.Environment?.Variables?.CONTENT_ALLOWED_CALLER_ARNS,
    )
    .filter(Boolean);
  assert.equal(contentAllowLists.length, 5);
  const serializedAllowLists = JSON.stringify(contentAllowLists);
  assert.match(serializedAllowLists, /:iam::111111111111:root/);
  assert.doesNotMatch(serializedAllowLists, /salih-dev-editor/);
  delivery.resourceCountIs("AWS::Events::Rule", 1);
  delivery.resourceCountIs("AWS::CloudWatch::Dashboard", 1);
  delivery.resourceCountIs("AWS::Synthetics::Canary", 0);

  // Build failure alarm plus CloudFront 4xx/5xx and two homepage-check alarms
  // (5), plus the three render-rollout alarms (render errors, p95 latency and
  // handled render failures) that AppConfig watches as monitors (8 total).
  delivery.resourceCountIs("AWS::CloudWatch::Alarm", 8);

  // Selected log fields must exclude visitor identifiers.
  const deliveries = delivery.findResources("AWS::Logs::Delivery");
  const fields = Object.values(deliveries)[0].Properties
    .RecordFields as string[];
  for (const forbidden of [
    "c-ip",
    "cs(Cookie)",
    "cs-uri-query",
    "cs(User-Agent)",
    "cs(Referer)",
    "x-forwarded-for",
  ]) {
    assert.ok(!fields.includes(forbidden), `must not log ${forbidden}`);
  }
});
