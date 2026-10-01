/**
 * Infrastructure tests for the reader-counts feature: the table, the readers
 * function, its CloudFront route, and the `readerCounts` flag.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";

import { APPCONFIG_AGENT_LAYER_ARN, SalihDevDeliveryStack } from "../lib/delivery-stack";
import { SalihDevStateStack } from "../lib/state-stack";

type Resource = { Properties: Record<string, unknown> };

const templates = (() => {
  const app = new App();
  const env = { account: "111111111111", region: "us-east-1" };
  const state = new SalihDevStateStack(app, "State", { domainName: "salih.dev", env });
  const delivery = new SalihDevDeliveryStack(app, "Delivery", {
    contentBucket: state.contentBucket,
    domainName: "salih.dev",
    env,
    hostedZone: state.hostedZone,
    readerCountsTable: state.readerCountsTable,
    commentsTable: state.commentsTable,
  });
  return { state: Template.fromStack(state), delivery: Template.fromStack(delivery) };
})();

function readersFunction(): Resource {
  const fn = Object.values(templates.delivery.findResources("AWS::Lambda::Function")).find(
    (resource) => {
      const vars = (resource.Properties as { Environment?: { Variables?: Record<string, unknown> } })
        .Environment?.Variables;
      return vars !== undefined && "READER_COUNTS_TABLE_NAME" in vars;
    },
  );
  assert.ok(fn !== undefined, "the readers function exists");
  return fn as Resource;
}

test("the reader-counts table is on-demand, retained, with TTL on expiresAt", () => {
  templates.state.hasResource("AWS::DynamoDB::GlobalTable", {
    DeletionPolicy: "Retain",
    Properties: Match.objectLike({
      BillingMode: "PAY_PER_REQUEST",
      KeySchema: [
        { AttributeName: "pk", KeyType: "HASH" },
        { AttributeName: "sk", KeyType: "RANGE" },
      ],
      TimeToLiveSpecification: { AttributeName: "expiresAt", Enabled: true },
    }),
  });
});

test("the readers function carries the pinned AppConfig layer and flag coordinates", () => {
  const props = readersFunction().Properties as {
    Layers: unknown[];
    Environment: { Variables: Record<string, unknown> };
  };
  assert.ok(props.Layers.includes(APPCONFIG_AGENT_LAYER_ARN));
  assert.equal(props.Environment.Variables.APPCONFIG_PROFILE, "render-flags");
  assert.ok("AWS_APPCONFIG_EXTENSION_PREFETCH_LIST" in props.Environment.Variables);
});

test("the readers role has only the four table actions it uses", () => {
  const statements = Object.values(templates.delivery.findResources("AWS::IAM::Policy"))
    .flatMap(
      (resource) =>
        (resource.Properties as { PolicyDocument: { Statement: Array<{ Action: unknown }> } })
          .PolicyDocument.Statement,
    )
    .filter(
      (statement) =>
        JSON.stringify(statement.Action).includes("dynamodb:") &&
        JSON.stringify((statement as { Resource?: unknown }).Resource).includes("ReaderCounts"),
    );
  assert.equal(statements.length, 1);
  assert.deepEqual(statements[0].Action, [
    "dynamodb:PutItem",
    "dynamodb:UpdateItem",
    "dynamodb:GetItem",
    "dynamodb:Query",
  ]);
});

test("/api/readers/* allows POST, caches nothing and forwards only vid and the payload hash", () => {
  const distribution = Object.values(
    templates.delivery.findResources("AWS::CloudFront::Distribution"),
  )[0] as Resource;
  const behaviors = (distribution.Properties.DistributionConfig as {
    CacheBehaviors: Array<Record<string, unknown>>;
  }).CacheBehaviors;
  const readers = behaviors.find((b) => b.PathPattern === "/api/readers/*");
  assert.ok(readers !== undefined, "the readers behavior exists");
  assert.ok((readers.AllowedMethods as string[]).includes("POST"));
  // Managed CachingDisabled policy.
  assert.equal(readers.CachePolicyId, "4135ea2d-6df8-44a3-9df3-4b5a84be39ad");
  templates.delivery.hasResourceProperties("AWS::CloudFront::OriginRequestPolicy", {
    OriginRequestPolicyConfig: Match.objectLike({
      Name: "salih-dev-readers",
      CookiesConfig: { CookieBehavior: "whitelist", Cookies: ["vid"] },
      HeadersConfig: { HeaderBehavior: "whitelist", Headers: ["x-amz-content-sha256"] },
    }),
  });
});

test("CloudFront may call the readers Function URL and invoke the function", () => {
  const permissions = Object.values(templates.delivery.findResources("AWS::Lambda::Permission"))
    .map((resource) => resource.Properties as { Action: string; FunctionName: unknown });
  // InvokeFunction names the function; InvokeFunctionUrl names its Function URL
  // resource. Both logical ids start with ReadersFunction.
  for (const action of ["lambda:InvokeFunctionUrl", "lambda:InvokeFunction"]) {
    assert.ok(
      permissions.some(
        (p) =>
          p.Action === action &&
          JSON.stringify(p.FunctionName).includes('"ReadersFunction'),
      ),
      `CloudFront has ${action} on the readers function`,
    );
  }
});

test("the flag profile defines readerCounts, off", () => {
  const content = Object.values(
    templates.delivery.findResources("AWS::AppConfig::HostedConfigurationVersion"),
  ).map((r) => (r.Properties as { Content: string }).Content)[0];
  const parsed = JSON.parse(content) as {
    flags: Record<string, unknown>;
    values: Record<string, { enabled: boolean }>;
  };
  assert.ok("readerCounts" in parsed.flags);
  assert.equal(parsed.values.readerCounts.enabled, false);
  assert.equal(parsed.values.renderFromBackend.enabled, false);
});
